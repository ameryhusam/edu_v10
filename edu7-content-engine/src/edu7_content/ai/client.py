import json
import os
import time
import urllib.error
import urllib.request
from typing import Any, Dict, List, Optional

GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models"
SUPPORTED_MODELS = ("gemini-3.6-flash", "gemini-3.5-flash")


class GeminiClient:
    """Single provider-neutral HTTP transport used by all Python Gemini tasks."""

    def __init__(self, api_key: Optional[str] = None, model_name: Optional[str] = None):
        """Transport with explicit model validation and quota-aware key rotation."""
        raw_keys = os.environ.get("GEMINI_API_KEYS", "")
        keys = [k.strip() for k in raw_keys.replace(";", ",").split(",") if k.strip()]
        if api_key:
            keys = [api_key]
        elif not keys:
            single = os.environ.get("GEMINI_API_KEY", "").strip()
            if single:
                keys = [single]
        self.api_keys: List[str] = keys
        raw_models = os.environ.get("GEMINI_MODELS", "")
        models = [m.strip() for m in raw_models.replace(";", ",").split(",") if m.strip()]
        if not models:
            configured = os.environ.get("GEMINI_MODEL", "gemini-3.6-flash").strip()
            models = [configured] if configured else list(SUPPORTED_MODELS)
        requested_model = model_name.strip() if model_name else None
        if requested_model:
            models = [requested_model] + [m for m in models if m != requested_model]
        self.models = models
        self.model_index = 0
        self.key_index = 0
        self.max_retries = int(os.environ.get("GEMINI_MAX_RETRIES", "3"))
        self.timeout = int(os.environ.get("GEMINI_TIMEOUT_SECONDS", "120"))
        self.model_name = model_name or self.models[0]
        if self.model_name not in SUPPORTED_MODELS:
            raise ValueError(
                f"Unsupported Gemini model: {self.model_name}. "
                f"Supported models: {', '.join(SUPPORTED_MODELS)}"
            )
        self._validate_models()

    def _validate_models(self) -> None:
        unsupported = [m for m in self.models if m not in SUPPORTED_MODELS]
        if unsupported:
            raise ValueError(
                f"Unsupported Gemini model(s): {', '.join(unsupported)}. "
                f"Supported models: {', '.join(SUPPORTED_MODELS)}"
            )

    def generate(self, payload: Dict[str, Any], *, timeout: Optional[int] = None) -> Dict[str, Any]:
        if not self.api_keys:
            raise ValueError("GEMINI_API_KEYS (or GEMINI_API_KEY) not set.")
        delay = 2.0
        for attempt in range(self.max_retries + 1):
            model = self.models[self.model_index]
            key = self.api_keys[self.key_index]
            url = f"{GEMINI_API_BASE}/{model}:generateContent?key={key}"
            data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
            try:
                with urllib.request.urlopen(req, timeout=timeout or self.timeout) as resp:
                    return json.loads(resp.read().decode("utf-8"))
            except urllib.error.HTTPError as exc:
                if exc.code == 429:
                    if self.key_index + 1 < len(self.api_keys):
                        self.key_index += 1
                        delay = 1.0
                        continue
                    if self.model_index + 1 < len(self.models):
                        self.model_index += 1
                        self.key_index = 0
                        delay = 1.0
                        continue
                if exc.code in (408, 500, 502, 503, 504) and attempt < self.max_retries:
                    time.sleep(delay)
                    delay = min(delay * 2.0, 20.0)
                    continue
                raise

    @staticmethod
    def text(response: Dict[str, Any]) -> str:
        try:
            return response["candidates"][0]["content"]["parts"][0]["text"]
        except (KeyError, IndexError, TypeError) as exc:
            raise ValueError(f"Unexpected Gemini response structure: {exc}") from exc
