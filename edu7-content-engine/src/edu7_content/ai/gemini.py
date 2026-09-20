import os
import json
import base64
import time
import urllib.error
from pathlib import Path
from typing import Dict, Any, Optional, List
from .base import AIProvider
from .client import GeminiClient
from ..content.models import (
    LessonAnalysisResult, ExtractedConcept, ExtractedQuestion,
    QuestionChoice, ExtractedObjective, ExtractedMisconception,
    ExtractedFlashcard
)


def _load_env_file():
    """Look for .env file in project paths and load variables into os.environ if missing."""
    search_dirs = [
        Path.cwd(),
        Path(__file__).resolve().parent,
        Path(__file__).resolve().parents[2],
        Path(__file__).resolve().parents[3]
    ]
    for d in search_dirs:
        env_file = d / ".env"
        if env_file.exists():
            try:
                for line in env_file.read_text(encoding="utf-8").splitlines():
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        k, v = line.split("=", 1)
                        k = k.strip()
                        v = v.strip().strip("'\"")
                        if k and k not in os.environ:
                            os.environ[k] = v
            except Exception:
                pass
            break


class GeminiFreeProvider(AIProvider):
    """
    Google Gemini provider for text and multimodal content analysis.
    Authentication and quota are controlled by the configured Google API account.
    Supports:
      - Text & Multimodal Lesson Analysis (analyze_lesson)
      - Vision-based TOC extraction from page images (extract_toc_from_page_images)
      - Automatic rate-limit handling (429 backoff)
      - Auto-detection from environment variable or .env file
    Default model: gemini-2.5-flash
    """

    def __init__(self, api_key: Optional[str] = None, model_name: str = "gemini-2.5-flash"):
        _load_env_file()
        self.api_key = api_key or os.environ.get("GEMINI_API_KEY", "")
        self.model_name = model_name
        self.client = GeminiClient(self.api_key, model_name)

    @property
    def provider_name(self) -> str:
        return f"gemini-{self.model_name}"

    # ------------------------------------------------------------------ #
    #  Core HTTP helper with automatic 429 retry backoff                  #
    # ------------------------------------------------------------------ #
    def _call_api(self, payload: dict, timeout: int = 120, max_retries: int = 3) -> dict:
        # Kept as a thin compatibility method for existing callers.
        return self.client.generate(payload, timeout=timeout)

    def _extract_text(self, response: dict) -> str:
        try:
            return GeminiClient.text(response)
        except (KeyError, IndexError) as e:
            raise ValueError(f"Unexpected Gemini response structure: {e}")

    # ------------------------------------------------------------------ #
    #  Vision: TOC extraction from page images                            #
    # ------------------------------------------------------------------ #
    def extract_toc_from_page_images(self, page_images_b64: List[str]) -> List[Dict[str, Any]]:
        """
        Send page images (base64-encoded PNG) to Gemini Vision and extract
        the TOC structure. Returns list matching TocExtractor format, or [].
        """
        if not self.api_key:
            print("[!] GEMINI_API_KEY not set - cannot use Vision TOC extraction.")
            return []

        prompt_text = (
            "أنت خبير في استخراج فهارس الكتب والمناهج المدرسية العربية.\n"
            "انظر إلى صفحات الكتاب المرفقة وابحث عن صفحة أو صفحات فهرس المحتويات (فهرس / جدول المحتويات).\n\n"
            "الفهرس يحتوي عادةً على:\n"
            "- أسماء الوحدات: 'الوحدة الأولى'، 'الوحدة الثانية' إلخ مع رقم الصفحة\n"
            "- أسماء الدروس: 'الدرس الأول:'، 'الدرس الثاني:' إلخ مع رقم الصفحة\n"
            "- قد تكون الصفحة مقسمة إلى عمودين (عمود أيمن وعمود أيسر)\n\n"
            "استخرج كل الوحدات والدروس بدقة. أرجع JSON فقط بالشكل التالي دون أي نص إضافي:\n"
            '{"units":[{"number":1,"title":"الوحدة الأولى: اسم الوحدة","startPage":7,'
            '"lessons":[{"number":1,"title":"الدرس الأول: اسم الدرس","startPage":8}]}]}\n\n'
            "قواعد هامة:\n"
            "- أرقام الصفحات هي الأرقام المطبوعة داخل صفحات الكتاب (وليست رقم الفهرس في PDF).\n"
            "- حول الأرقام الهندية (٧، ١٢) إلى أرقام عربية/إنجليزية (7, 12).\n"
            '- إذا لم تجد أي فهرس، أرجع: {"units":[]}\n'
            "- أرجع JSON فقط صالحاً للاستخدام."
        )

        parts = [{"text": prompt_text}]
        for b64_img in page_images_b64[:10]:
            parts.append({
                "inlineData": {
                    "mimeType": "image/png",
                    "data": b64_img
                }
            })

        payload = {
            "contents": [{"parts": parts}],
            "generationConfig": {
                "responseMimeType": "application/json",
                "temperature": 0.1,
                "maxOutputTokens": 4096
            }
        }

        try:
            response = self._call_api(payload, timeout=180)
            text_resp = self._extract_text(response).strip()
            if text_resp.startswith("```"):
                lines = text_resp.split("\n")
                text_resp = "\n".join(lines[1:]).rsplit("```", 1)[0]
            data = json.loads(text_resp.strip())
            return self._map_toc_response(data)
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="replace")
            print(f"[!] Gemini Vision HTTP error {e.code}: {body[:300]}")
            return []
        except Exception as err:
            print(f"[!] Gemini Vision TOC extraction failed: {err}")
            return []

    def extract_toc_from_page_texts(self, page_texts: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Extract the printed-page TOC from the first ten PDF pages using text only.

        This is the AI path used when PyMuPDF rendering is unavailable and the
        PdfReader has fallen back to pypdf.
        """
        if not self.api_key:
            return []

        pages = page_texts[:10]
        source = "\n\n".join(
            f"--- PDF page {p.get('pdfPage', i + 1)} ---\n{p.get('text', '')}"
            for i, p in enumerate(pages)
            if p.get("text", "").strip()
        )
        if not source.strip():
            return []

        prompt_text = (
            "أنت خبير في استخراج فهرس الكتب المدرسية العربية. حلل النص المستخرج من أول "
            "عشر صفحات من كتاب واحد. استخرج فهرس المحتويات فقط إذا كان موجوداً. "
            "أرقام startPage/endPage يجب أن تكون أرقام الصفحات المطبوعة داخل الكتاب، "
            "وليس أرقام صفحات PDF. لا تخمن أرقاماً غير ظاهرة. "
            "أرجع JSON فقط بالشكل: "
            '{"units":[{"number":1,"title":"...","startPage":1,"lessons":' 
            '[{"number":1,"title":"...","startPage":2}]}]}. '
            "إذا لم يظهر فهرس موثوق أرجع {\"units\":[]}. "
            "يمكن أن يمتد الفهرس عبر عدة صفحات من أول عشر صفحات."
        )
        payload = {
            "contents": [{"parts": [{"text": prompt_text + "\n\n" + source}]}],
            "generationConfig": {
                "responseMimeType": "application/json",
                "temperature": 0.0,
                "maxOutputTokens": 4096,
            },
        }
        try:
            response = self._call_api(payload, timeout=120)
            text_resp = self._extract_text(response).strip()
            if text_resp.startswith("```"):
                parts = text_resp.split("\n")
                text_resp = "\n".join(parts[1:]).rsplit("```", 1)[0]
            return self._map_toc_response(json.loads(text_resp))
        except Exception as err:
            print(f"[!] Gemini text TOC extraction failed: {err}")
            return []

    def _map_toc_response(self, data: dict) -> List[Dict[str, Any]]:
        units_raw = data.get("units", [])
        units = []
        all_lessons_flat = []
        for u_raw in units_raw:
            u_num = int(u_raw.get("number", len(units) + 1))
            u_title = str(u_raw.get("title", f"الوحدة {u_num}"))
            lessons = []
            for l_raw in u_raw.get("lessons", []):
                l_num = int(l_raw.get("number", len(lessons) + 1))
                l_title = str(l_raw.get("title", f"الدرس {l_num}"))
                l_start = int(l_raw.get("startPage", 1))
                entry = {
                    "id": f"lesson-{l_num:02d}",
                    "number": l_num,
                    "title": l_title,
                    "startPage": l_start,
                    "endPage": l_start + 8
                }
                lessons.append(entry)
                all_lessons_flat.append(entry)
            u_start = u_raw.get("startPage")
            try:
                u_start = int(u_start) if u_start is not None else (
                    lessons[0]["startPage"] if lessons else 1
                )
            except (TypeError, ValueError):
                u_start = lessons[0]["startPage"] if lessons else 1
            units.append({
                "id": f"unit-{u_num:02d}",
                "number": u_num,
                "title": u_title,
                "startPage": u_start,
                "lessons": lessons
            })
        for idx, les in enumerate(all_lessons_flat):
            if idx + 1 < len(all_lessons_flat):
                les["endPage"] = max(les["startPage"], all_lessons_flat[idx + 1]["startPage"] - 1)
            else:
                les["endPage"] = les["startPage"] + 8
        return units

    # ------------------------------------------------------------------ #
    #  Lesson Content Analysis (Text or Multimodal Vision)                #
    # ------------------------------------------------------------------ #
    def analyze_lesson(
        self,
        lesson_manifest: Dict[str, Any],
        lesson_text: str,
        lesson_dir: Any = None
    ) -> LessonAnalysisResult:
        """
        Analyze an individual lesson package using Gemini Free Tier.
        If lesson_text has selectable Arabic, analyzes text.
        If lesson_text is empty (scanned/image PDF), loads page images
        from lesson_dir/pages and analyzes them multimodally.
        """
        if not self.api_key:
            print("[!] GEMINI_API_KEY not set. Falling back to HeuristicExtractorProvider...")
            from .heuristic import HeuristicExtractorProvider
            return HeuristicExtractorProvider().analyze_lesson(lesson_manifest, lesson_text)

        first_page = lesson_manifest.get("printedPages", [1])[0]
        title = lesson_manifest.get("title", "")
        printed_pages = lesson_manifest.get("printedPages", [1])

        # Check if text is sufficient or if we should use multimodal page images
        arabic_chars = sum(
            1 for ch in lesson_text
            if ('\u0600' <= ch <= '\u06FF') or ('\uFB50' <= ch <= '\uFEFF')
        )
        is_scanned_lesson = arabic_chars < 80

        parts: List[Dict[str, Any]] = []

        system_instruction = (
            "أنت خبير تربوي ومصمم مناهج دراسية عربية دقيق جداً ملتزم بمبدأ التأصيل بالأدلة (Evidence-First).\n"
            f"مهمتك: تحليل الدرس المحدد بعنوان '{title}' واستخراج عناصر المحتوى بدقة تامة.\n"
            "القواعد الأساسية:\n"
            "1. لكل مفهوم، ناتج تعلم، سؤال، أو بطاقة تعليمية، يجب ذكر نص الشاهد الحرفي (evidence) ورقم الصفحة (page).\n"
            "2. لكل سؤال اختيار من متعدد (MCQ_SINGLE)، وفّر 4 خيارات (واحد صحيح و3 مشتتات ذكية مع توضيح سبب الخطأ distractorRationale).\n"
            "3. استخرج بطاقات تعليمية (flashcards) تحتوي على سؤال/مصطلح في الوجه (front) والإجابة/التعريف في الظهر (back).\n"
            "4. استخرج المفاهيم الخاطئة الشائعة (misconceptions) وتصحيحها العلمي.\n\n"
            "أجب بصيغة JSON فقط متطابقة مع المخطط التالي:\n"
            "{\n"
            '  "concepts": [\n'
            '    {"name": "اسم المفهوم", "description": "تعريف وشرح المفهوم", "difficulty": 0.5, "isCore": true, "evidence": "نص الشاهد من الصفحة", "page": ' + str(first_page) + '}\n'
            '  ],\n'
            '  "objectives": [\n'
            '    {"text": "ناتج التعلم أو الهدف التعليمي", "bloomLevel": "APPLY", "evidence": "الشاهد النصي"}\n'
            '  ],\n'
            '  "questions": [\n'
            '    {\n'
            '      "text": "نص السؤال",\n'
            '      "conceptName": "اسم المفهوم المرتبط",\n'
            '      "type": "MCQ_SINGLE",\n'
            '      "hint": "تلميح للحل",\n'
            '      "explanation": "شرح وتفسير الإجابة الصحيحة",\n'
            '      "difficulty01": 0.5,\n'
            '      "choices": [\n'
            '        {"id": "c1", "text": "الخيار الصحيح", "isCorrect": true},\n'
            '        {"id": "c2", "text": "مشتت خاطئ 1", "isCorrect": false, "distractorRationale": "سبب خطأ هذا الخيار"},\n'
            '        {"id": "c3", "text": "مشتت خاطئ 2", "isCorrect": false, "distractorRationale": "سبب خطأ هذا الخيار"},\n'
            '        {"id": "c4", "text": "مشتت خاطئ 3", "isCorrect": false, "distractorRationale": "سبب خطأ هذا الخيار"}\n'
            '      ],\n'
            '      "evidence": "الشاهد الحرفي",\n'
            '      "page": ' + str(first_page) + '\n'
            '    }\n'
            '  ],\n'
            '  "flashcards": [\n'
            '    {"conceptName": "اسم المفهوم", "front": "وجه البطاقة / المصطلح أو السؤال", "back": "ظهر البطاقة / التعريف أو الإجابة المركزة", "evidence": "الشاهد"}\n'
            '  ],\n'
            '  "misconceptions": [\n'
            '    {"conceptName": "اسم المفهوم", "name": "الفهم الخاطئ الشائع", "description": "كيف يخطئ الطالب", "correction": "التصحيح العلمي الدقيق", "evidence": "الشاهد"}\n'
            '  ]\n'
            "}"
        )

        parts.append({"text": system_instruction})

        # Load page images if scanned lesson or lesson_dir has images
        loaded_images = 0
        if lesson_dir:
            l_path = Path(lesson_dir)
            pages_dir = l_path / "pages"
            if pages_dir.exists():
                png_files = sorted(pages_dir.glob("*.png"))
                for img_path in png_files[:8]:  # max 8 pages per lesson
                    try:
                        b64_data = base64.b64encode(img_path.read_bytes()).decode("ascii")
                        parts.append({
                            "inlineData": {
                                "mimeType": "image/png",
                                "data": b64_data
                            }
                        })
                        loaded_images += 1
                    except Exception:
                        pass

        if loaded_images > 0:
            parts.append({
                "text": f"المرفق أعلاه هو صور صفحات الدرس المطبوعة: {printed_pages}. حللها واستخرج المفاهيم والأسئلة منها."
            })
        elif lesson_text.strip():
            parts.append({
                "text": f"نص الدرس:\n{lesson_text[:5000]}"
            })
        else:
            parts.append({
                "text": f"الدرس: {title}. الصفحات: {printed_pages}."
            })

        payload = {
            "contents": [{"parts": parts}],
            "generationConfig": {
                "responseMimeType": "application/json",
                "temperature": 0.2,
                "maxOutputTokens": 4096
            }
        }

        try:
            response = self._call_api(payload, timeout=90)
            text_resp = self._extract_text(response).strip()
            if text_resp.startswith("```"):
                lines = text_resp.split("\n")
                text_resp = "\n".join(lines[1:]).rsplit("```", 1)[0]
            output_json = json.loads(text_resp.strip())
            return self._map_to_result(lesson_manifest, output_json)
        except Exception as err:
            print(f"[!] Gemini API call failed for '{title}' ({err}). Falling back to heuristic...")
            from .heuristic import HeuristicExtractorProvider
            return HeuristicExtractorProvider().analyze_lesson(lesson_manifest, lesson_text, lesson_dir)

    def _map_to_result(self, lesson_manifest: Dict[str, Any], data: Dict[str, Any]) -> LessonAnalysisResult:
        printed_pages = lesson_manifest.get("printedPages", [1])
        first_p = printed_pages[0] if printed_pages else 1

        res = LessonAnalysisResult(
            lesson_id=lesson_manifest.get("lessonId", ""),
            lesson_title=lesson_manifest.get("title", ""),
            unit_number=lesson_manifest.get("unitNumber", 1),
            lesson_number=lesson_manifest.get("lessonNumber", 1),
            printed_pages=printed_pages,
            pdf_pages=lesson_manifest.get("pdfPages", [1]),
            model_name=self.provider_name
        )

        for c in data.get("concepts", []):
            try:
                page_val = int(c.get("page", first_p))
            except (ValueError, TypeError):
                page_val = first_p
            res.concepts.append(ExtractedConcept(
                name=c.get("name", "").strip(),
                description=c.get("description", "").strip(),
                difficulty=float(c.get("difficulty", 0.5)),
                is_core=bool(c.get("isCore", True)),
                source_pages=[page_val],
                evidence=c.get("evidence", ""),
                confidence=0.96,
                model_name=self.provider_name,
                status="PROPOSED"
            ))

        for obj in data.get("objectives", []):
            res.objectives.append(ExtractedObjective(
                text=obj.get("text", "").strip(),
                bloom_level=obj.get("bloomLevel", "APPLY").upper(),
                source_pages=printed_pages[:1],
                evidence=obj.get("evidence", ""),
                confidence=0.94,
                model_name=self.provider_name
            ))

        for mis in data.get("misconceptions", []):
            res.misconceptions.append(ExtractedMisconception(
                concept_name=mis.get("conceptName", res.lesson_title).strip(),
                name=mis.get("name", "").strip(),
                description=mis.get("description", "").strip(),
                correction=mis.get("correction", "").strip(),
                source_pages=printed_pages[:1],
                evidence=mis.get("evidence", ""),
                confidence=0.93,
                model_name=self.provider_name
            ))

        for fc in data.get("flashcards", []):
            res.flashcards.append(ExtractedFlashcard(
                concept_name=fc.get("conceptName", res.lesson_title).strip(),
                front=fc.get("front", "").strip(),
                back=fc.get("back", "").strip(),
                source_pages=printed_pages[:1],
                evidence=fc.get("evidence", ""),
                confidence=0.95,
                model_name=self.provider_name,
                status="PROPOSED"
            ))

        for i, q in enumerate(data.get("questions", [])):
            choices = []
            for j, ch in enumerate(q.get("choices", [])):
                choices.append(QuestionChoice(
                    id=ch.get("id", f"c{j+1}"),
                    text=ch.get("text", "").strip(),
                    is_correct=bool(ch.get("isCorrect", False)),
                    distractor_rationale=ch.get("distractorRationale")
                ))
            try:
                page_val = int(q.get("page", first_p))
            except (ValueError, TypeError):
                page_val = first_p

            res.questions.append(ExtractedQuestion(
                type=q.get("type", "MCQ_SINGLE"),
                text=q.get("text", "").strip(),
                concept_name=q.get("conceptName", res.lesson_title).strip(),
                hint=q.get("hint"),
                explanation=q.get("explanation"),
                difficulty01=float(q.get("difficulty01", 0.5)),
                choices=choices,
                source_pages=[page_val],
                evidence=q.get("evidence", ""),
                confidence=0.95,
                model_name=self.provider_name,
                status="PROPOSED"
            ))

        return res

