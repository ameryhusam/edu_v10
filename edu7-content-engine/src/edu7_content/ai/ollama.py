"""Optional Ollama provider for future/local development.

This adapter is intentionally not enabled by default. Gemini remains the active
generative provider. Enable explicitly with EDU7_ENABLE_OLLAMA=true.
"""
from __future__ import annotations
import json
import os
import urllib.request
from typing import Dict, Any
from .base import AIProvider
from ..content.models import LessonAnalysisResult, ExtractedConcept, ExtractedQuestion, QuestionChoice

class OllamaProvider(AIProvider):
    def __init__(self, model_name: str = "qwen2.5:7b", base_url: str | None = None):
        self._model_name = model_name
        self.base_url = (base_url or os.environ.get("OLLAMA_BASE_URL", "http://127.0.0.1:11434")).rstrip("/")

    @property
    def provider_name(self) -> str:
        return f"ollama-{self._model_name}"

    def analyze_lesson(self, lesson_manifest: Dict[str, Any], lesson_text: str, lesson_dir: Any = None) -> LessonAnalysisResult:
        prompt = f"""حلل الدرس العربي التالي واخرج JSON فقط.
الدرس: {lesson_manifest.get('title', '')}
النص:
{lesson_text[:12000]}
الصيغة:
{{"concepts":[{{"name":"","description":"","difficulty":0.5,"evidence":""}}],
"questions":[{{"text":"","conceptName":"","choices":[{{"id":"c1","text":"","isCorrect":true}}],
"evidence":""}}]}}"""
        payload = {"model": self._model_name, "prompt": prompt, "stream": False, "format": "json"}
        data = self._post("/api/generate", payload)
        result = json.loads(data.get("response", "{}"))
        return self._map_to_result(lesson_manifest, result)

    def _post(self, path: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        req = urllib.request.Request(
            f"{self.base_url}{path}",
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=120) as response:
            return json.loads(response.read().decode("utf-8"))

    def _map_to_result(self, lesson_manifest: Dict[str, Any], data: Dict[str, Any]) -> LessonAnalysisResult:
        printed_pages = lesson_manifest.get("printedPages", [1])
        result = LessonAnalysisResult(
            lesson_id=lesson_manifest.get("lessonId", ""),
            lesson_title=lesson_manifest.get("title", ""),
            unit_number=lesson_manifest.get("unitNumber", 1),
            lesson_number=lesson_manifest.get("lessonNumber", 1),
            printed_pages=printed_pages,
            pdf_pages=lesson_manifest.get("pdfPages", [1]),
            model_name=self.provider_name,
        )
        for concept in data.get("concepts", []):
            result.concepts.append(ExtractedConcept(
                name=concept.get("name", ""),
                description=concept.get("description", ""),
                difficulty=float(concept.get("difficulty", 0.5)),
                is_core=True,
                source_pages=printed_pages[:1],
                evidence=concept.get("evidence", ""),
                confidence=0.8,
                model_name=self.provider_name,
            ))
        for question in data.get("questions", []):
            choices = [
                QuestionChoice(
                    id=choice.get("id", f"c{i + 1}"),
                    text=choice.get("text", ""),
                    is_correct=bool(choice.get("isCorrect", False)),
                )
                for i, choice in enumerate(question.get("choices", []))
            ]
            result.questions.append(ExtractedQuestion(
                type="MCQ_SINGLE",
                text=question.get("text", ""),
                concept_name=question.get("conceptName", result.lesson_title),
                hint=None,
                explanation=None,
                difficulty01=0.5,
                choices=choices,
                source_pages=printed_pages[:1],
                evidence=question.get("evidence", ""),
                confidence=0.8,
                model_name=self.provider_name,
            ))
        return result
