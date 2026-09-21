"""Single-provider AI registry for Edu7 content generation."""
import os
from typing import Dict, List
from .base import AIProvider
from .heuristic import HeuristicExtractorProvider
from .gemini import GeminiFreeProvider, SUPPORTED_MODELS
from .content_service import ContentAIService

class AIProviderRegistry:
    """Gemini is the only generative provider. Heuristic is deterministic fallback logic."""
    def __init__(self):
        self._providers: Dict[str, AIProvider] = {}
        self.register(HeuristicExtractorProvider())
        if os.environ.get("GEMINI_API_KEYS") or os.environ.get("GEMINI_API_KEY"):
            self.register(GeminiFreeProvider())

    def register(self, provider: AIProvider):
        self._providers[provider.provider_name] = provider

    def get(self, name: str) -> AIProvider:
        if name in self._providers:
            return self._providers[name]
        if name in ("gemini", "gemini-free") or name.startswith("gemini-"):
            model = name if name.startswith("gemini-") else os.environ.get("GEMINI_MODEL", SUPPORTED_MODELS[0])
            if model not in SUPPORTED_MODELS:
                raise ValueError(f"Unsupported Gemini model: {model}. Supported models: {", ".join(SUPPORTED_MODELS)}")
            provider = GeminiFreeProvider(model_name=model)
            self.register(provider)
            return provider
        if name == "heuristic-micro-engine":
            return self._providers["heuristic-micro-engine"]
        raise ValueError(f"Unsupported AI provider {name!r}. Edu7 content generation uses Gemini only.")

    def content_service(self, model_name: str | None = None) -> ContentAIService:
        return ContentAIService(model_name=model_name)

    def get_gemini(self) -> GeminiFreeProvider:
        model = os.environ.get("GEMINI_MODEL", SUPPORTED_MODELS[0])
        if model not in SUPPORTED_MODELS:
            raise ValueError(f"Unsupported Gemini model: {model}")
        provider_name = f"gemini-{model}"
        if provider_name not in self._providers:
            self.register(GeminiFreeProvider(model_name=model))
        return self._providers[provider_name]

    def list_providers(self) -> List[str]:
        return list(self._providers.keys())
