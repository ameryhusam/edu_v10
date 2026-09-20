import os
from typing import Dict, List
from .base import AIProvider
from .heuristic import HeuristicExtractorProvider
from .ollama import OllamaProvider
from .gemini import GeminiFreeProvider


class AIProviderRegistry:
    def __init__(self):
        self._providers: Dict[str, AIProvider] = {}
        # Always register the zero-cost heuristic provider
        self.register(HeuristicExtractorProvider())
        # Auto-register Gemini if API key is available
        if os.environ.get("GEMINI_API_KEY"):
            self.register(GeminiFreeProvider())

    def register(self, provider: AIProvider):
        self._providers[provider.provider_name] = provider

    def get(self, name: str) -> AIProvider:
        if name in self._providers:
            return self._providers[name]
        # Gemini variants: gemini, gemini-free, gemini-2.5-flash, gemini-1.5-flash, etc.
        if name == "gemini" or name == "gemini-free" or name.startswith("gemini-"):
            model = name.replace("gemini-free", "gemini-2.5-flash").replace("gemini-", "", 1) if name != "gemini" else "gemini-2.5-flash"
            # Clean up: if model is still "gemini-2.5-flash" keep as is
            if name == "gemini":
                model = "gemini-2.5-flash"
            provider = GeminiFreeProvider(model_name=model)
            self.register(provider)
            return provider
        # Ollama/local variants
        if name.startswith("ollama") or "qwen" in name or "gemma" in name or "llama" in name:
            model = name.replace("ollama-", "")
            provider = OllamaProvider(model_name=model)
            self.register(provider)
            return provider
        # Default fallback
        return self._providers.get("heuristic-micro-engine")

    def get_gemini(self) -> GeminiFreeProvider:
        """Get or create the configured Gemini provider under its canonical provider id."""
        key = os.environ.get("GEMINI_API_KEY", "")
        model = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
        provider_name = f"gemini-{model}"
        if provider_name not in self._providers:
            self.register(GeminiFreeProvider(api_key=key, model_name=model))
        return self._providers[provider_name]

    def list_providers(self) -> List[str]:
        return list(self._providers.keys())
