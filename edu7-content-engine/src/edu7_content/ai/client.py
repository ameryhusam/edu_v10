import json
import os
import time
import urllib.error
import urllib.request
from typing import Any, Dict, List, Optional

GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models"
SUPPORTED_MODELS = (
    "gemini-3.8-flash",
    "gemini-3.7-flash",
    "gemini-3.6-flash",
    "gemini-3.5-flash",
)


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
        last_error: Optional[Exception] = None

        # Failover: transient retry, then rotate key/model on pressure, quota,
        # authentication, service, or network failures.
        for model_index, model in enumerate(self.models):
            self.model_index = model_index
            for key_index, key in enumerate(self.api_keys):
                self.key_index = key_index
                delay = 2.0

                for attempt in range(self.max_retries + 1):
                    url = f"{GEMINI_API_BASE}/{model}:generateContent?key={key}"
                    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
                    req = urllib.request.Request(
                        url,
                        data=data,
                        headers={"Content-Type": "application/json"},
                    )
                    try:
                        with urllib.request.urlopen(req, timeout=timeout or self.timeout) as resp:
                            self.model_name = model
                            return json.loads(resp.read().decode("utf-8"))
                    except urllib.error.HTTPError as exc:
                        last_error = exc
                        body = ""
                        try:
                            body = exc.read().decode("utf-8", errors="replace")
                        except Exception:
                            pass
                        error_code, _ = self._classify_http_error(exc.code, body)

                        if exc.code == 429:
                            # Retry short-lived pressure once; quota exhaustion
                            # immediately advances to the next key/model.
                            if error_code in {"rate_limit_exceeded", "too_many_requests"} and attempt < 1:
                                retry_after = self._retry_after_seconds(exc)
                                time.sleep(retry_after if retry_after is not None else delay)
                                delay = min(delay * 2.0, 20.0)
                                continue
                            print(f"[!] Gemini {model} HTTP 429 ({error_code or 'quota'}); failing over.")
                            break

                        if exc.code in (408, 500, 502, 503, 504):
                            if attempt < self.max_retries:
                                time.sleep(delay)
                                delay = min(delay * 2.0, 20.0)
                                continue
                            print(f"[!] Gemini {model} transient HTTP {exc.code}; failing over.")
                            break

                        if exc.code in (401, 403):
                            print(f"[!] Gemini {model} access error ({error_code or exc.code}); trying next key.")
                            break

                        raise

                    except (urllib.error.URLError, TimeoutError) as exc:
                        last_error = exc
                        if attempt < self.max_retries:
                            time.sleep(delay)
                            delay = min(delay * 2.0, 20.0)
                            continue
                        print(f"[!] Gemini {model} network error; failing over.")
                        break

        self.model_index = len(self.models) - 1
        self.key_index = len(self.api_keys) - 1
        if last_error is not None:
            raise last_error
        raise RuntimeError("Gemini request failed without a response.")

    @staticmethod
    def _classify_http_error(status: int, body: str) -> tuple[str, str]:
        try:
            payload = json.loads(body)
            error = payload.get("error", {}) if isinstance(payload, dict) else {}
            code = str(error.get("status") or error.get("code") or "").lower()
            message = str(error.get("message") or "").lower()
        except Exception:
            code = ""
            message = body.lower()

        if status == 429:
            if "quota" in code or "quota" in message or "daily" in message or "per day" in message:
                return "quota_exceeded", message
            if "rate" in code or "rate" in message or "too many" in message:
                return "rate_limit_exceeded", message
            return "resource_exhausted", message
        if status == 503:
            return "service_unavailable", message
        return code, message

    @staticmethod
    def _retry_after_seconds(exc: urllib.error.HTTPError) -> Optional[float]:
        raw = exc.headers.get("Retry-After") if exc.headers else None
        if not raw:
            return None
        try:
            return max(0.0, min(float(raw), 60.0))
        except (TypeError, ValueError):
            return None

    @staticmethod
    def text(response: Dict[str, Any]) -> str:
        try:
            return response["candidates"][0]["content"]["parts"][0]["text"]
        except (KeyError, IndexError, TypeError) as exc:
            raise ValueError(f"Unexpected Gemini response structure: {exc}") from exc
