"""Unified Gemini-only content AI service."""
from __future__ import annotations
import base64, hashlib, json, re
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional
from .gemini import GeminiFreeProvider

class ContentAIService:
    """One generative AI entry point; never writes the Edu7 database."""
    SERVICE_VERSION = "1.0"
    PROMPT_VERSION = "edu7-content-ai-v1"

    def __init__(self, model_name: Optional[str] = None):
        self.provider = GeminiFreeProvider(model_name=model_name)

    @property
    def provider_name(self): return self.provider.provider_name

    @property
    def model_name(self): return self.provider.model_name


    def extract_book_front_matter(
        self,
        *,
        page_texts: List[Dict[str, Any]],
        images_b64: Optional[List[str]] = None,
        pdf_path: Optional[Path] = None,
    ) -> Dict[str, Any]:
        """
        Validate textbook identity + TOC from the initial PDF analysis window.

        When PyMuPDF rendering is unavailable, the original PDF is sent to
        Gemini as an application/pdf part. pypdf remains responsible for local
        text extraction/page counting; Gemini supplies the visual/semantic
        evidence needed for identity.

        AI is evidence validation, not the canonical persistence layer.
        """

        schema = {
            "type": "object",
            "properties": {
                "identity": {
                    "type": "object",
                    "properties": {
                        "title": {"type": ["string", "null"]},
                        "subjectKey": {"type": ["string", "null"]},
                        "gradeKey": {"type": ["string", "null"]},
                        "part": {
                            "type": ["string", "null"],
                            "enum": [
                                "PART_1",
                                "PART_2",
                                "BOTH",
                                None,
                            ],
                        },
                        "termOrdinal": {"type": ["integer", "null"]},
                        "edition": {"type": ["string", "null"]},
                        "printingYear": {"type": ["integer", "null"]},
                        "publicationYear": {"type": ["integer", "null"]},
                        "issuer": {"type": ["string", "null"]},
                    },
                    "required": [
                        "title",
                        "subjectKey",
                        "gradeKey",
                        "part",
                        "termOrdinal",
                        "edition",
                        "printingYear",
                        "publicationYear",
                        "issuer",
                    ],
                },
                "toc": {
                    "type": "object",
                    "properties": {
                        "found": {"type": "boolean"},
                        "phrases": {
                            "type": "array",
                            "items": {"type": "string"},
                        },
                        "units": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "number": {"type": "integer"},
                                    "title": {"type": "string"},
                                    "startPage": {"type": "integer"},
                                    "lessons": {
                                        "type": "array",
                                        "items": {
                                            "type": "object",
                                            "properties": {
                                                "number": {"type": "integer"},
                                                "title": {"type": "string"},
                                                "startPage": {"type": "integer"},
                                            },
                                            "required": [
                                                "number",
                                                "title",
                                                "startPage",
                                            ],
                                        },
                                    },
                                },
                                "required": [
                                    "number",
                                    "title",
                                    "startPage",
                                    "lessons",
                                ],
                            },
                        },
                    },
                    "required": [
                        "found",
                        "phrases",
                        "units",
                    ],
                },
                "evidence": {
                    "type": "array",
                    "items": {"type": "object"},
                },
                "conflicts": {
                    "type": "array",
                    "items": {"type": "string"},
                },
                "needsReview": {"type": "boolean"},
            },
            "required": [
                "identity",
                "toc",
                "evidence",
                "conflicts",
                "needsReview",
            ],
        }

        prompt = """
أنت محلل متخصص في الكتب المدرسية العربية.

حلل الصفحات العشر الأولى فقط من الكتاب المرفق.

المطلوب استخراج هوية الكتاب والفهرس.

أولاً: هوية الكتاب

ابحث عن:
1. اسم الكتاب
2. اسم المادة
3. الصف
4. الجزء:
   - الجزء الأول
   - الجزء الثاني
   - الجزآن معًا
5. الفصل الدراسي إذا كان مكتوبًا بوضوح
6. رقم أو وصف الطبعة
7. سنة الطباعة
8. سنة النشر
9. الجهة الناشرة أو المصدرة

قواعد الهوية الإلزامية:
- لا تخمن ولا تنشئ قيمة من عندك.
- subjectKey يجب أن يكون مفتاح المادة النظامي بصيغة uppercase فقط عندما يكون اسم المادة الظاهر في المصدر قابلاً للمطابقة بشكل مؤكد؛ أمثلة معروفة: ARAB، MATH، SCI، ENG. إذا تعذر تحديد المفتاح النظامي من الدليل، أرجع null.
- gradeKey يجب أن يكون بالشكل GNN (مثل G07) عندما يظهر الصف بوضوح. إذا ظهر رقم الصف فقط، يمكن تطبيعه إلى GNN؛ لا تستنتجه من مستوى أو وصف غير صريح.
- "الجزء الأول" = PART_1.
- "الجزء الثاني" = PART_2.
- إذا ظهر الجزء الأول والثاني في الكتاب نفسه = BOTH.
- إذا طُبعت عبارة طبعة مع سنة، مثل "الطبعة 2026"، يمكن تطبيع edition إلى ED2026. أما السنة وحدها بدون دليل أنها طبعة فلا تكفي.
- لا تستنتج edition من السنة الدراسية أو سنة النشر وحدها.
- لا تستنتج الجزء أو الفصل الدراسي من اسم الملف أو من التخمين.
- إذا لم يوجد دليل واضح لأي حقل = null.

ثانيًا: الفهرس

ابحث عن:
فهرس
المحتويات
الموضوعات
الوحدات
الدروس

استخرج:
- جميع الوحدات
- اسم الوحدة
- رقم صفحة بداية الوحدة
- جميع الدروس
- اسم الدرس
- رقم صفحة بداية الدرس

استخدم أرقام الصفحات المطبوعة وليس رقم PDF.

لا تستخدم طولًا ثابتًا للدرس.

لا تخمن أرقام الصفحات.

لكل قيمة مهمة أرجع دليل الصفحة.

إذا ظهر تعارض، أدرجه في conflicts.

أرجع JSON فقط.
"""

        return self.request(
            "BOOK_FRONT_MATTER",
            prompt,
            schema,
            pdf_path=pdf_path,
            images_b64=images_b64,
            context={
                "pages": page_texts,
                "maxAnalyzedPdfPages": len(page_texts),
                "pdfAttachmentProvided": bool(pdf_path),
            },
            timeout=240,
        )


    def request(self, task: str, prompt: str, schema: Dict[str, Any], *, pdf_path: Optional[Path] = None, images_b64: Optional[List[str]] = None, context: Optional[Dict[str, Any]] = None, timeout: int = 240):
        parts = [{"text": prompt}]
        if context: parts.append({"text": "\nCONTEXT_JSON:\n" + json.dumps(context, ensure_ascii=False)})
        if pdf_path: parts.append({"inlineData": {"mimeType": "application/pdf", "data": base64.b64encode(pdf_path.read_bytes()).decode("ascii")}})
        for image in images_b64 or []: parts.append({"inlineData": {"mimeType": "image/png", "data": image}})
        payload = {"contents": [{"parts": parts}], "generationConfig": {"responseMimeType": "application/json", "responseSchema": schema, "temperature": 0.1, "maxOutputTokens": 16384}}
        response = self.provider.client.generate(payload, timeout=timeout)
        text = self.provider._extract_text(response).strip()
        if text.startswith("```"): text = "\n".join(text.splitlines()[1:]).rsplit("```", 1)[0]
        result = json.loads(text)
        if not isinstance(result, dict): raise ValueError(f"{task} must return a JSON object")
        return result

    def segment_ranges(self, pdf_path: Path, page_count: int, *, printed_page_map=None, preview_images_b64=None, prompt=None):
        schema = {"type":"object","properties":{"units":{"type":"array","items":{"type":"object","properties":{"number":{"type":"integer"},"title":{"type":"string"},"startPage":{"type":"integer"},"endPage":{"type":"integer"},"lessons":{"type":"array","items":{"type":"object","properties":{"number":{"type":"integer"},"title":{"type":"string"},"startPage":{"type":"integer"},"endPage":{"type":"integer"}},"required":["number","title","startPage","endPage"]}}},"required":["number","title","startPage","endPage","lessons"]}}},"required":["units"]}
        result = self.request("SEGMENT_RANGES", prompt or "استخرج الوحدات والدروس من الكتاب المرفق. استخدم الصفحات المطبوعة. حدد بداية ونهاية كل درس من الأدلة الفعلية؛ لا تستخدم طولاً ثابتاً ولا تخمن.", schema, pdf_path=pdf_path, images_b64=preview_images_b64, context={"pageCount": page_count, "printedPageMap": printed_page_map or {}, "sourceSha256": self.sha256(pdf_path)})
        result["_meta"] = self.meta("SEGMENT_RANGES", pdf_path)
        return result

    def analyze_lesson(self, lesson_pdf: Path, prompt: str, context=None):
        result = self.request("LESSON_ANALYSIS", prompt, self.lesson_schema(), pdf_path=lesson_pdf, context=context)
        self.mark_ai(result); result["_meta"] = self.meta("LESSON_ANALYSIS", lesson_pdf); return result

    def refresh_questions(self, lesson_pdf: Path, prompt: str, *, existing_questions=None, question_count=10, context=None):
        ctx = dict(context or {}); ctx.update({"requestedQuestionCount": max(1, min(question_count, 100)), "existingQuestions": existing_questions or []})
        result = self.request("QUESTION_REFRESH", prompt, self.question_schema(), pdf_path=lesson_pdf, context=ctx)
        result["questions"] = deduplicate_questions([self.normalize_question(q) for q in result.get("questions", [])], existing_questions or [])
        result["_meta"] = self.meta("QUESTION_REFRESH", lesson_pdf); return result

    def generate_explanation(self, lesson_pdf: Path, prompt: str, context=None):
        schema = {"type":"object","properties":{"resources":{"type":"array","items":{"type":"object","properties":{"kind":{"type":"string"},"title":{"type":"string"},"body":{"type":"string"},"sourcePages":{"type":"array","items":{"type":"integer"}},"evidence":{"type":"string"},"confidence":{"type":"number"}},"required":["kind","title","body","sourcePages","evidence","confidence"]}}},"required":["resources"]}
        result = self.request("EXPLANATION", prompt, schema, pdf_path=lesson_pdf, context=context); result["_meta"] = self.meta("EXPLANATION", lesson_pdf); return result

    def generate_prerequisites(self, lesson_pdf: Path, prompt: str, candidate_concepts: List[Dict[str, Any]]):
        schema = {"type":"object","properties":{"prerequisites":{"type":"array","items":{"type":"object","properties":{"conceptKey":{"type":"string"},"requiredMastery":{"type":"number"},"reason":{"type":"string"},"source":{"type":"string"},"confidence":{"type":"number"}},"required":["conceptKey","requiredMastery","reason","source","confidence"]}}},"required":["prerequisites"]}
        result = self.request("PREREQUISITES", prompt, schema, pdf_path=lesson_pdf, context={"candidateConcepts": candidate_concepts}); result["_meta"] = self.meta("PREREQUISITES", lesson_pdf); return result

    @staticmethod
    def sha256(path: Path):
        h = hashlib.sha256();
        with path.open("rb") as f:
            for chunk in iter(lambda: f.read(1024 * 1024), b""): h.update(chunk)
        return h.hexdigest()

    def meta(self, task, source):
        return {"service":"ContentAIService","serviceVersion":self.SERVICE_VERSION,"task":task,"provider":self.provider_name,"model":self.model_name,"promptVersion":self.PROMPT_VERSION,"sourceFile":str(source),"sourceSha256":self.sha256(source),"status":"PROPOSED","databaseWrite":False}

    @staticmethod
    def mark_ai(result):
        for collection in ("concepts","questions","flashcards"):
            for item in result.get(collection, []): item["origin"] = "AI"

    @staticmethod
    def normalize_question(q):
        out = dict(q); out["origin"]="AI"; out["text"]=str(out.get("text","")).strip(); out["type"]=str(out.get("type","MCQ_SINGLE")).upper()
        out["choices"]=[{**dict(c),"id":str(c.get("id") or f"c{i+1}"),"text":str(c.get("text","")).strip()} for i,c in enumerate(out.get("choices",[]))]
        answer=dict(out.get("answerKey") or {}); answer.setdefault("correctChoiceIds",[]); answer.setdefault("acceptedTexts",[]); answer.setdefault("expectedOrder",[]); answer.setdefault("expectedPairs",None); out["answerKey"]=answer; return out

    @staticmethod
    def lesson_schema():
        return {"type":"object","properties":{"concepts":{"type":"array","items":{"type":"object"}},"objectives":{"type":"array","items":{"type":"object"}},"misconceptions":{"type":"array","items":{"type":"object"}},"flashcards":{"type":"array","items":{"type":"object"}},"questions":{"type":"array","items":{"type":"object"}}},"required":["concepts","objectives","misconceptions","flashcards","questions"]}

    @staticmethod
    def question_schema():
        return {"type":"object","properties":{"questions":{"type":"array","items":{"type":"object","properties":{"type":{"type":"string","enum":["MCQ_SINGLE","MCQ_MULTI","TRUE_FALSE","NUMERIC","SHORT_TEXT","FILL_BLANK","MATCHING","ORDERING","ESSAY"]},"text":{"type":"string"},"conceptName":{"type":"string"},"hint":{"type":"string"},"explanation":{"type":"string"},"difficulty01":{"type":"number"},"choices":{"type":"array","items":{"type":"object"}},"answerKey":{"type":"object"},"sourcePages":{"type":"array","items":{"type":"integer"}},"evidence":{"type":"string"},"confidence":{"type":"number"}},"required":["type","text","difficulty01","choices","answerKey","sourcePages","evidence","confidence"]}}},"required":["questions"]}

def normalize_arabic(text):
    value = str(text or "").strip().lower(); value = re.sub(r"[إأآٱ]","ا",value).replace("ى","ي").replace("ة","ه"); value = re.sub(r"[\u064B-\u065F\u0670]","",value).replace("\u0640",""); return re.sub(r"\s+"," ",value)

def question_identity(question):
    answer=question.get("answerKey") or {}; parts=[str(question.get("type","")).upper(),normalize_arabic(question.get("text","")),"|".join(sorted(normalize_arabic(x) for x in answer.get("correctChoiceIds",[]))),"|".join(sorted(normalize_arabic(x) for x in answer.get("acceptedTexts",[]))),"|".join(normalize_arabic(x) for x in answer.get("expectedOrder",[]))]; return hashlib.sha256("|".join(parts).encode()).hexdigest()

def deduplicate_questions(candidates: Iterable[Dict[str, Any]], existing: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    seen={question_identity(q) for q in existing}; output=[]
    for candidate in candidates:
        identity=question_identity(candidate)
        if not candidate.get("text") or identity in seen: continue
        seen.add(identity); output.append(candidate)
    return output
