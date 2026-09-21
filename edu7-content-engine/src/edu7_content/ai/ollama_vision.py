"""Optional Ollama multimodal helpers.

No Ollama call occurs unless the caller explicitly opts in. This module is kept
separate so the active Gemini path remains the single production path.
"""
from __future__ import annotations
import base64
import json
import os
import urllib.request
from typing import Any, Dict, List

def _base_url() -> str:
    return os.environ.get("OLLAMA_BASE_URL", "http://127.0.0.1:11434").rstrip("/")

def _ollama_enabled() -> bool:
    return os.environ.get("EDU7_ENABLE_OLLAMA", "").strip().lower() in {"1", "true", "yes", "on"}

def _ollama_available(timeout: float = 2.0) -> bool:
    if not _ollama_enabled():
        return False
    try:
        with urllib.request.urlopen(f"{_base_url()}/api/tags", timeout=timeout) as response:
            return response.status == 200
    except Exception:
        return False

def _list_ollama_models(timeout: float = 2.0) -> List[str]:
    if not _ollama_enabled():
        return []
    try:
        with urllib.request.urlopen(f"{_base_url()}/api/tags", timeout=timeout) as response:
            data = json.loads(response.read().decode("utf-8"))
        return [str(item.get("name", "")) for item in data.get("models", []) if item.get("name")]
    except Exception:
        return []

def extract_toc_via_ollama(reader: Any, max_pages: int = 10, dpi: int = 150, model_name: str | None = None) -> List[Dict[str, Any]]:
    if not _ollama_enabled():
        return []
    model = model_name or os.environ.get("OLLAMA_MODEL", "qwen2.5:7b")
    if model.startswith("ollama-"):
        model = model[len("ollama-"):]
    images = []
    for i in range(min(max_pages, reader.page_count)):
        image = reader.render_page_to_b64(i, dpi=dpi)
        if image:
            images.append(image)
    if not images:
        return []
    prompt = ("حلل صفحات الفهرس المصورة للكتاب المدرسي العربي. استخرج الوحدات والدروس "
              "وأرقام الصفحات المطبوعة فقط. إذا لم يظهر فهرس موثوق فأعد units فارغة. "
              "أعد JSON فقط بالشكل: {"units":[{"number":1,"title":"","startPage":1,"
              ""lessons":[{"number":1,"title":"","startPage":1}]}]}")
    payload = {
        "model": model,
        "prompt": prompt,
        "images": images,
        "stream": False,
        "format": "json",
    }
    req = urllib.request.Request(
        f"{_base_url()}/api/generate",
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=240) as response:
        data = json.loads(response.read().decode("utf-8"))
    result = json.loads(data.get("response", "{}"))
    units = result.get("units", [])
    for unit in units:
        for lesson in unit.get("lessons", []):
            lesson["endPage"] = lesson.get("startPage")
    return units
