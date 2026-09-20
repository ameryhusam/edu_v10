import json
import urllib.request
from typing import Dict, Any
from .base import AIProvider
from ..content.models import LessonAnalysisResult, ExtractedConcept, ExtractedQuestion, QuestionChoice

class OllamaProvider(AIProvider):
    """
    Connects to local Ollama runtime to execute open-weights models:
    Qwen3-VL, Gemma 3, Llama 3, etc.
    """
    def __init__(self, model_name: str = "qwen2.5:7b", base_url: str = "http://localhost:11434"):
        self._model_name = model_name
        self.base_url = base_url.rstrip("/")

    @property
    def provider_name(self) -> str:
        return f"ollama-{self._model_name}"

    def analyze_lesson(
        self,
        lesson_manifest: Dict[str, Any],
        lesson_text: str,
        lesson_dir: Any = None
    ) -> LessonAnalysisResult:
        # Construct strict structured prompt
        prompt = f"""
أنت خبير مناهج تعليمية عربية. قم بتحليل نص الدرس التالي واستخرج المفاهيم والأسئلة بدقة مع إلزامية إرفاق نص الدليل من الدرس لكل عنصر.
الدرس: {lesson_manifest.get('title')}
النص:
{lesson_text[:3000]}

أجب بصيغة JSON فقط:
{{
  "concepts": [
    {{"name": "...", "description": "...", "difficulty": 0.5, "evidence": "نص الشاهد من الدرس"}}
  ],
  "questions": [
    {{
      "text": "...",
      "conceptName": "...",
      "choices": [
        {{"id": "c1", "text": "...", "isCorrect": true}},
        {{"id": "c2", "text": "...", "isCorrect": false}}
      ],
      "evidence": "نص الشاهد"
    }}
  ]
}}
"""
        payload = json.dumps({
            "model": self._model_name,
            "prompt": prompt,
            "stream": False,
            "format": "json"
        }).encode("utf-8")

        req = urllib.request.Request(
            f"{self.base_url}/api/generate",
            data=payload,
            headers={"Content-Type": "application/json"}
        )

        try:
            with urllib.request.urlopen(req, timeout=45) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                output_json = json.loads(data.get("response", "{}"))
                return self._map_to_result(lesson_manifest, output_json)
        except Exception as err:
            # Graceful fallback to heuristic if local Ollama is offline
            from .heuristic import HeuristicExtractorProvider
            print(f"Ollama call failed ({err}), falling back to HeuristicExtractorProvider...")
            return HeuristicExtractorProvider().analyze_lesson(lesson_manifest, lesson_text)

    def _map_to_result(self, lesson_manifest: Dict[str, Any], data: Dict[str, Any]) -> LessonAnalysisResult:
        printed_pages = lesson_manifest.get("printedPages", [1])
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
            res.concepts.append(ExtractedConcept(
                name=c.get("name", ""),
                description=c.get("description", ""),
                difficulty=float(c.get("difficulty", 0.5)),
                is_core=True,
                source_pages=printed_pages[:1],
                evidence=c.get("evidence", ""),
                confidence=0.90,
                model_name=self.provider_name
            ))
        for q in data.get("questions", []):
            choices = [
                QuestionChoice(id=ch.get("id", f"c{i}"), text=ch.get("text", ""), is_correct=ch.get("isCorrect", False))
                for i, ch in enumerate(q.get("choices", []))
            ]
            res.questions.append(ExtractedQuestion(
                type="MCQ_SINGLE",
                text=q.get("text", ""),
                concept_name=q.get("conceptName", res.lesson_title),
                hint=None,
                explanation=None,
                difficulty01=0.5,
                choices=choices,
                source_pages=printed_pages[:1],
                evidence=q.get("evidence", ""),
                confidence=0.88,
                model_name=self.provider_name
            ))
        return res
