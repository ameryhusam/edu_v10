"""
ollama_vision.py
================
Vision-capable Ollama provider for Arabic textbook TOC extraction.

Uses the Ollama HTTP API (localhost:11434) with multimodal models:
  - llava:7b          (default, 4GB VRAM)
  - llava:13b         (better quality, 8GB VRAM)
  - llava-llama3:8b   (best Arabic, 5GB VRAM)
  - minicpm-v:8b      (fast, good Arabic support)
  - qwen2.5vl:7b      (good CJK+Arabic, 4.5GB)

No API key. No cloud. 100% free local inference.

Setup:
  1. Install Ollama: https://ollama.ai
  2. Pull a model: ollama pull llava:7b
  3. Run: ollama serve  (or it auto-starts)
"""
import json
import base64
import urllib.request
import urllib.error
from typing import List, Dict, Any, Optional

OLLAMA_BASE = "http://localhost:11434/api"

# Ranked by Arabic quality for TOC extraction
VISION_MODEL_PRIORITY = [
    "llava-llama3:8b",
    "llava:13b",
    "minicpm-v:8b",
    "qwen2.5vl:7b",
    "llava:7b",
    "llava:latest",
]


def _ollama_available() -> bool:
    """Check if Ollama server is running."""
    try:
        req = urllib.request.Request(f"{OLLAMA_BASE}/tags", method="GET")
        with urllib.request.urlopen(req, timeout=3) as resp:
            return resp.status == 200
    except Exception:
        return False


def _list_ollama_models() -> List[str]:
    """Return list of model names available in local Ollama."""
    try:
        req = urllib.request.Request(f"{OLLAMA_BASE}/tags", method="GET")
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return [m["name"] for m in data.get("models", [])]
    except Exception:
        return []


def _select_best_vision_model(available: List[str]) -> Optional[str]:
    """Pick the best available multimodal model from priority list."""
    avail_lower = {m.lower(): m for m in available}
    for preferred in VISION_MODEL_PRIORITY:
        # Exact match
        if preferred in available:
            return preferred
        # Partial match (e.g. "llava:7b" matches "llava:7b-q4_K_M")
        for av in available:
            if preferred.split(":")[0] in av.lower():
                return av
    return None


def extract_toc_via_ollama(
    images_b64: List[str],
    model: Optional[str] = None,
    timeout: int = 300,
    verbose: bool = True
) -> List[Dict[str, Any]]:
    """
    Send page images to a local Ollama vision model and extract TOC.

    Parameters
    ----------
    images_b64 : list of base64 PNG strings (first N pages of the book)
    model      : specific model name, or None to auto-select best available
    timeout    : request timeout in seconds (vision models can be slow)
    verbose    : print progress messages

    Returns
    -------
    list of unit dicts (same format as TocExtractor.extract_hierarchy)
    or [] on failure.
    """
    if not _ollama_available():
        if verbose:
            print("[!] Ollama not running. Start with: ollama serve")
        return []

    available = _list_ollama_models()
    if not available:
        if verbose:
            print("[!] No Ollama models found. Pull one: ollama pull llava:7b")
        return []

    if model:
        chosen = model if model in available else _select_best_vision_model(available)
    else:
        chosen = _select_best_vision_model(available)

    if not chosen:
        if verbose:
            print(f"[!] No vision model found in Ollama. Available: {available}")
            print("    Pull one: ollama pull llava:7b")
        return []

    if verbose:
        print(f"[*] Using Ollama vision model: {chosen}")

    prompt = (
        "You are analyzing an Arabic school textbook. Look at the attached pages and find the Table of Contents page(s).\n\n"
        "The Table of Contents (فهرس المحتويات) contains:\n"
        "- Unit titles: 'الوحدة الأولى', 'الوحدة الثانية', etc. with a page number\n"
        "- Lesson titles: 'الدرس الأول:', 'الدرس الثاني:' etc. with a page number\n"
        "- Page numbers are printed numbers (not PDF page index), may be Arabic-Indic digits (٧،١٢)\n"
        "- The layout may have two columns\n\n"
        "Extract ALL units and their lessons. Return ONLY valid JSON:\n"
        '{"units":[{"number":1,"title":"الوحدة الأولى: اسم الوحدة","startPage":7,'
        '"lessons":[{"number":1,"title":"الدرس الأول: اسم الدرس","startPage":8}]}]}\n\n'
        "If no TOC is visible, return: {\"units\":[]}\n"
        "Return ONLY JSON, no extra explanation."
    )

    # Ollama /api/generate with images
    payload = {
        "model": chosen,
        "prompt": prompt,
        "images": images_b64[:6],   # Ollama handles fewer images better
        "stream": False,
        "format": "json",
        "options": {
            "temperature": 0.1,
            "num_predict": 2048,
        }
    }

    try:
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            f"{OLLAMA_BASE}/generate",
            data=data,
            headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            result = json.loads(resp.read().decode("utf-8"))

        text = result.get("response", "").strip()
        if verbose:
            print(f"[+] Ollama response ({len(text)} chars)")

        # Try to parse JSON
        text = text.strip()
        if text.startswith("```"):
            lines = text.split("\n")
            text = "\n".join(lines[1:]).rsplit("```", 1)[0]

        parsed = json.loads(text.strip())
        return _map_toc(parsed)

    except urllib.error.URLError as e:
        if verbose:
            print(f"[!] Ollama connection error: {e}")
        return []
    except json.JSONDecodeError as e:
        if verbose:
            print(f"[!] Ollama returned invalid JSON: {e}")
        return []
    except Exception as e:
        if verbose:
            print(f"[!] Ollama TOC extraction error: {e}")
        return []


def _map_toc(data: dict) -> List[Dict[str, Any]]:
    """Convert raw JSON response to internal TOC format."""
    units_raw = data.get("units", [])
    units = []
    all_lessons_flat = []

    for u_raw in units_raw:
        u_num = int(u_raw.get("number", len(units) + 1))
        u_title = str(u_raw.get("title", f"الوحدة {u_num}"))
        lessons = []
        for l_raw in u_raw.get("lessons", []):
            l_num = int(l_raw.get("number", len(lessons) + 1))
            l_title = str(l_raw.get("title", f"الدرس {l_num}"))
            l_start = int(l_raw.get("startPage", 1))
            entry = {
                "id": f"lesson-{l_num:02d}",
                "number": l_num,
                "title": l_title,
                "startPage": l_start,
                "endPage": l_start + 8
            }
            lessons.append(entry)
            all_lessons_flat.append(entry)
        units.append({
            "id": f"unit-{u_num:02d}",
            "number": u_num,
            "title": u_title,
            "lessons": lessons
        })

    # Fix end pages
    for idx, les in enumerate(all_lessons_flat):
        if idx + 1 < len(all_lessons_flat):
            les["endPage"] = max(les["startPage"], all_lessons_flat[idx + 1]["startPage"] - 1)
        else:
            les["endPage"] = les["startPage"] + 12

    return units
