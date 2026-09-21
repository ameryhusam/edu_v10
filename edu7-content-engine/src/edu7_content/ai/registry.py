import os
from typing import Dict, List
from .base import AIProvider
from .heuristic import HeuristicExtractorProvider
from .ollama import OllamaProvider
from .gemini import GeminiFreeProvider, SUPPORTED_MODELS


class AIProviderRegistry:
    def __init__(self):
        self._providers: Dict[str, AIProvider] = {}
        # Always register the zero-cost heuristic provider
        self.register(HeuristicExtractorProvider())
        # Auto-register Gemini when one or more local keys are configured.
        if os.environ.get("GEMINI_API_KEYS") or os.environ.get("GEMINI_API_KEY"):
            self.register(GeminiFreeProvider())

    def register(self, provider: AIProvider):
        self._providers[provider.provider_name] = provider

    def get(self, name: str) -> AIProvider:
        if name in self._providers:
            return self._providers[name]
        if name in ("gemini", "gemini-free"):
            return self.get_gemini()
        if name.startswith("gemini-"):
            model = name
            if model not in SUPPORTED_MODELS:
                raise ValueError(
                    f"Unsupported Gemini model: {model}. "
                    f"Supported models: {', '.join(SUPPORTED_MODELS)}"
                )
            provider = GeminiFreeProvider(model_name=model)
            self.register(provider)
            return provider
        if name.startswith("ollama") or "qwen" in name or "gemma" in name or "llama" in name:
            model = name.replace("ollama-", "")
            provider = OllamaProvider(model_name=model)
            self.register(provider)
            return provider
        return self._providers.get("heuristic-micro-engine")

    def get_gemini(self) -> GeminiFreeProvider:
        """Get the configured Gemini provider using the 3.6/3.5 key rotation transport."""
        model = os.environ.get("GEMINI_MODEL", SUPPORTED_MODELS[0])
        if model not in SUPPORTED_MODELS:
            raise ValueError(
                f"Unsupported Gemini model: {model}. "
                f"Supported models: {', '.join(SUPPORTED_MODELS)}"
            )
        provider_name = f"gemini-{model}"
        if provider_name not in self._providers:
            self.register(GeminiFreeProvider(model_name=model))
        return self._providers[provider_name]

    def list_providers(self) -> List[str]:
        return list(self._providers.keys())
