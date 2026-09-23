import json
import os
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional

GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models"
SUPPORTED_MODELS = (
    "gemini-3.8-flash",
    "gemini-3.7-flash",
    "gemini-3.6-flash",
    "gemini-3.5-flash",
)


class GeminiClient:
    """Single provider-neutral Gemini HTTP transport with quota-aware key rotation."""

    def __init__(self, api_key: Optional[str] = None, model_name: Optional[str] = None):
        self._load_env_file()

        raw_keys = os.environ.get("GEMINI_API_KEYS", "")
        keys = [k.strip() for k in raw_keys.replace(";", ",").split(",") if k.strip()]
        if api_key:
            keys = [api_key.strip()]
        elif not keys:
            indexed = []
            index = 1
            while True:
                value = os.environ.get(f"GEMINI_API_KEY_{index}", "").strip()
                if not value:
                    break
                indexed.append(value)
                index += 1
            keys = indexed

        if not keys:
            single = os.environ.get("GEMINI_API_KEY", "").strip()
            if single:
                keys = [single]

        self.api_keys: List[str] = list(dict.fromkeys(keys))
        self.key_index = 0

        raw_models = os.environ.get("GEMINI_MODELS", "")
        models = [m.strip() for m in raw_models.replace(";", ",").split(",") if m.strip()]
        if not models:
            configured = os.environ.get("GEMINI_MODEL", "gemini-3.8-flash").strip()
            models = [configured] if configured else list(SUPPORTED_MODELS)

        requested_model = model_name.strip() if model_name else None
        if requested_model:
            models = [requested_model] + [m for m in models if m != requested_model]

        self.models = list(dict.fromkeys(models))
        self.model_index = 0
        self.max_retries = max(0, int(os.environ.get("GEMINI_MAX_RETRIES", "3")))
        self.timeout = max(1, int(os.environ.get("GEMINI_TIMEOUT_SECONDS", "120")))
        self.model_name = self.models[0] if self.models else ""

        if not self.model_name:
            raise ValueError("No Gemini model configured.")
        if self.model_name not in SUPPORTED_MODELS:
            raise ValueError(
                f"Unsupported Gemini model: {self.model_name}. "
                f"Supported models: {', '.join(SUPPORTED_MODELS)}"
            )
        self._validate_models()

        # Temporary in-process cooldown. It avoids hammering a key that just
        # returned a quota/access error while allowing later requests to retry it.
        self._key_retry_at: Dict[int, float] = {}
        self.quota_cooldown = max(
            0.0,
            float(os.environ.get("GEMINI_QUOTA_COOLDOWN_SECONDS", "300")),
        )

    def _validate_models(self) -> None:
        unsupported = [m for m in self.models if m not in SUPPORTED_MODELS]
        if unsupported:
            raise ValueError(
                f"Unsupported Gemini model(s): {', '.join(unsupported)}. "
                f"Supported models: {', '.join(SUPPORTED_MODELS)}"
            )

    def _key_order(self) -> List[int]:
        """Round-robin keys, preferring keys outside their temporary cooldown."""
        if not self.api_keys:
            return []

        now = time.monotonic()
        start = self.key_index % len(self.api_keys)
        ordered = [
            (start + offset) % len(self.api_keys)
            for offset in range(len(self.api_keys))
        ]
        ready = [i for i in ordered if self._key_retry_at.get(i, 0.0) <= now]
        cooling = [i for i in ordered if i not in ready]

        if not ready and cooling:
            cooling.sort(key=lambda i: self._key_retry_at.get(i, 0.0))
            return cooling
        return ready + cooling

    def _mark_key_unavailable(
        self,
        key_index: int,
        *,
        retry_after: Optional[float] = None,
    ) -> None:
        cooldown = retry_after if retry_after is not None else self.quota_cooldown
        self._key_retry_at[key_index] = time.monotonic() + max(0.0, cooldown)

    def generate(
        self,
        payload: Dict[str, Any],
        *,
        timeout: Optional[int] = None,
    ) -> Dict[str, Any]:
        if not self.api_keys:
            raise ValueError(
                "GEMINI_API_KEYS, GEMINI_API_KEY_1/... or GEMINI_API_KEY not set."
            )

        last_error: Optional[Exception] = None

        # For every configured model, try all configured keys. Quota/access
        # failures rotate immediately; transient failures use bounded retries.
        for model_index, model in enumerate(self.models):
            self.model_index = model_index

            for key_index in self._key_order():
                key = self.api_keys[key_index]
                self.key_index = key_index
                delay = 2.0

                for attempt in range(self.max_retries + 1):
                    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
                    request = urllib.request.Request(
                        f"{GEMINI_API_BASE}/{model}:generateContent",
                        data=data,
                        headers={
                            "Content-Type": "application/json",
                            "x-goog-api-key": key,
                        },
                    )

                    try:
                        with urllib.request.urlopen(
                            request,
                            timeout=timeout or self.timeout,
                        ) as response:
                            self.model_name = model
                            self.key_index = key_index
                            return json.loads(
                                response.read().decode("utf-8")
                            )

                    except urllib.error.HTTPError as exc:
                        last_error = exc
                        body = ""
                        try:
                            body = exc.read().decode("utf-8", errors="replace")
                        except Exception:
                            pass

                        error_code, _ = self._classify_http_error(
                            exc.code,
                            body,
                        )

                        if exc.code == 429:
                            retry_after = self._retry_after_seconds(exc)

                            # RPM/short-lived pressure can recover quickly.
                            # Quota exhaustion advances to the next key.
                            if (
                                error_code == "rate_limit_exceeded"
                                and attempt < 1
                            ):
                                time.sleep(
                                    retry_after
                                    if retry_after is not None
                                    else delay
                                )
                                delay = min(delay * 2.0, 20.0)
                                continue

                            self._mark_key_unavailable(
                                key_index,
                                retry_after=retry_after,
                            )
                            print(
                                f"[!] Gemini {model} HTTP 429 "
                                f"({error_code or 'quota'}); rotating API key."
                            )
                            break

                        if exc.code in (408, 500, 502, 503, 504):
                            if attempt < self.max_retries:
                                time.sleep(delay)
                                delay = min(delay * 2.0, 20.0)
                                continue
                            print(
                                f"[!] Gemini {model} transient HTTP {exc.code}; "
                                "rotating API key/model."
                            )
                            break

                        if exc.code in (401, 403):
                            # Invalid/restricted keys should not block other
                            # configured keys. The final error is retained.
                            self._mark_key_unavailable(key_index)
                            print(
                                f"[!] Gemini {model} access error "
                                f"({error_code or exc.code}); rotating API key."
                            )
                            break

                        raise

                    except (urllib.error.URLError, TimeoutError) as exc:
                        last_error = exc
                        if attempt < self.max_retries:
                            time.sleep(delay)
                            delay = min(delay * 2.0, 20.0)
                            continue
                        print(
                            f"[!] Gemini {model} network error; "
                            "rotating API key/model."
                        )
                        break

        if last_error is not None:
            raise last_error
        raise RuntimeError("Gemini request failed without a response.")

    @staticmethod
    def _classify_http_error(status: int, body: str) -> tuple[str, str]:
        try:
            payload = json.loads(body)
            error = payload.get("error", {}) if isinstance(payload, dict) else {}
            code = str(
                error.get("status") or error.get("code") or ""
            ).lower()
            message = str(error.get("message") or "").lower()
        except Exception:
            code = ""
            message = body.lower()

        if status == 429:
            if (
                "quota" in code
                or "quota" in message
                or "daily" in message
                or "per day" in message
            ):
                return "quota_exceeded", message
            if (
                "rate" in code
                or "rate" in message
                or "too many" in message
            ):
                return "rate_limit_exceeded", message
            return "resource_exhausted", message
        if status == 503:
            return "service_unavailable", message
        return code, message

    @staticmethod
    def _retry_after_seconds(
        exc: urllib.error.HTTPError,
    ) -> Optional[float]:
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
            raise ValueError(
                f"Unexpected Gemini response structure: {exc}"
            ) from exc

    @staticmethod
    def _load_env_file() -> None:
        """Load a local .env file without adding a dotenv dependency."""
        search_dirs = [
            Path.cwd(),
            Path(__file__).resolve().parent,
            Path(__file__).resolve().parents[2],
            Path(__file__).resolve().parents[3],
            Path(__file__).resolve().parents[4],
        ]

        for directory in search_dirs:
            env_file = directory / ".env"
            if not env_file.exists():
                continue

            try:
                for line in env_file.read_text(
                    encoding="utf-8"
                ).splitlines():
                    line = line.strip()
                    if (
                        not line
                        or line.startswith("#")
                        or "=" not in line
                    ):
                        continue

                    key, value = line.split("=", 1)
                    key = key.strip()
                    value = value.strip().strip("'\\\"")
                    if key and key not in os.environ:
                        os.environ[key] = value
            except OSError:
                pass
            break
