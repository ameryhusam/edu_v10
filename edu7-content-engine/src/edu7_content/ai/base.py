from abc import ABC, abstractmethod
from typing import Dict, Any, List
from ..content.models import LessonAnalysisResult

class AIProvider(ABC):
    """
    Abstract interface for Multi-Model AI Analysis:
    Supports Local lightweight (Qwen3-VL-2B), High-capacity (Qwen3-VL-8B, Gemma 3),
    Ollama, and Rule-based Heuristic Micro-Engine.
    """
    @property
    @abstractmethod
    def provider_name(self) -> str:
        pass

    @abstractmethod
    def analyze_lesson(
        self,
        lesson_manifest: Dict[str, Any],
        lesson_text: str,
        lesson_dir: Any = None
    ) -> LessonAnalysisResult:
        """
        Execute Task 1 to Task 8 with strict Evidence-First grounding.
        Optionally receives lesson_dir to access page images for multimodal extraction.
        """
        pass
