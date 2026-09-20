import json
import os
import time
import urllib.error
import urllib.request
from typing import Any, Dict, Optional

GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models"


class GeminiClient:
    """Single provider-neutral HTTP transport used by all Python Gemini tasks."""

    def __init__(self, api_key: Optional[str] = None, model_name: str = "gemini-2.5-flash"):
        self.api_key = api_key or os.environ.get("GEMINI_API_KEY", "")
        self.model_name = model_name
        self.max_retries = int(os.environ.get("GEMINI_MAX_RETRIES", "3"))
        self.timeout = int(os.environ.get("GEMINI_TIMEOUT_SECONDS", "120"))

    def generate(self, payload: Dict[str, Any], *, timeout: Optional[int] = None) -> Dict[str, Any]:
        if not self.api_key:
            raise ValueError("GEMINI_API_KEY not set.")
        url = f"{GEMINI_API_BASE}/{self.model_name}:generateContent?key={self.api_key}"
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        delay = 2.0
        for attempt in range(self.max_retries + 1):
            req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
            try:
                with urllib.request.urlopen(req, timeout=timeout or self.timeout) as resp:
                    return json.loads(resp.read().decode("utf-8"))
            except urllib.error.HTTPError as exc:
                if exc.code in (408, 429, 500, 502, 503, 504) and attempt < self.max_retries:
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
