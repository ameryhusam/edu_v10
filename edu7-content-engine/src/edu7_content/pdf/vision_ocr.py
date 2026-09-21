"""Gemini-only multimodal TOC extraction.

PDF reading/rendering is deterministic preprocessing. Generative interpretation
is delegated to the single ContentAIService.
"""
from typing import List, Optional, Dict, Any

def is_image_based_pdf(reader, sample_pages: int = 8) -> bool:
    limit = min(sample_pages, reader.page_count)
    arabic_chars = 0
    pages_with_images = 0
    for i in range(limit):
        t = reader.extract_page_text(i)
        arabic_chars += sum(1 for ch in t if "\u0600" <= ch <= "\u06FF")
        try:
            if reader.backend == "pymupdf":
                if reader.doc[i].get_images(full=True):
                    pages_with_images += 1
            elif hasattr(reader.doc.pages[i], "images") and reader.doc.pages[i].images:
                pages_with_images += 1
        except Exception:
            pass
    if not limit:
        return False
    return pages_with_images / limit >= 0.75 or arabic_chars < 50

def render_pages_to_b64(reader, max_pages: int = 10, dpi: int = 150) -> List[str]:
    images = []
    for i in range(min(max_pages, reader.page_count)):
        b64 = reader.render_page_to_b64(i, dpi=dpi)
        if b64:
            images.append(b64)
            print(f"    [+] Rendered page {i + 1} ({len(b64) // 1024} KB)")
    return images

def render_page_to_b64(reader, page_idx: int, dpi: int = 150) -> Optional[str]:
    return reader.render_page_to_b64(page_idx, dpi=dpi) if hasattr(reader, "render_page_to_b64") else None

def extract_toc_via_vision(reader, max_pages=10, dpi=150, api_key=None,
                           model_name=None, use_ollama=False,
                           use_gemini=True, force_vision=False) -> List[Dict[str, Any]]:
    """Extract the TOC with Gemini by default; Ollama remains an explicit opt-in adapter."""
    print(f"[*] Preparing first {max_pages} pages for Gemini TOC analysis (DPI={dpi})...")
    images_b64 = render_pages_to_b64(reader, max_pages=max_pages, dpi=dpi)
    page_texts = [{"pdfPage": i + 1, "text": reader.extract_page_text(i)}
                  for i in range(min(max_pages, reader.page_count))]
    if force_vision and not images_b64:
        print("[!] Visual extraction requested but no page renderer is available.")
        return []
    if not images_b64 and not any(p["text"].strip() for p in page_texts):
        print("[!] No usable text or rendered page images are available.")
        return []
    if use_ollama:
        try:
            from ..ai.ollama_vision import extract_toc_via_ollama
            result = extract_toc_via_ollama(reader, max_pages=max_pages, dpi=dpi, model_name=model_name)
            if result:
                return result
        except Exception as err:
            print(f"[!] Ollama TOC extraction unavailable: {err}")
        if not use_gemini:
            return []

    if not use_gemini:
        return []

    from ..ai.content_service import ContentAIService
    try:
        service = ContentAIService(model_name=model_name if model_name and model_name.startswith("gemini") else None)
        if not service.provider.client.api_keys:
            print("[!] Gemini skipped: GEMINI_API_KEYS/GEMINI_API_KEY is not configured.")
            return []
        schema = {"type":"object","properties":{"units":{"type":"array","items":{"type":"object",
            "properties":{"number":{"type":"integer"},"title":{"type":"string"},"startPage":{"type":"integer"},
            "lessons":{"type":"array","items":{"type":"object","properties":{
                "number":{"type":"integer"},"title":{"type":"string"},"startPage":{"type":"integer"}},
                "required":["number","title","startPage"]}}},
            "required":["number","title","startPage","lessons"]}}},
            "required":["units"]}
        prompt = ("أنت خبير في فهارس الكتب المدرسية العربية. حلل الصفحات المرفقة وابحث عن "
                  "فهرس المحتويات. استخرج كل الوحدات والدروس وأرقام الصفحات المطبوعة فقط. "
                  "إذا لم يظهر فهرس موثوق أرجع units فارغة. لا تخمن. أرجع JSON فقط.")
        if images_b64:
            result = service.request("TOC_VISION", prompt, schema, images_b64=images_b64, timeout=240)
        else:
            source = "\n\n".join(f"--- PDF page {p['pdfPage']} ---\n{p['text']}"
                                  for p in page_texts if p["text"].strip())
            result = service.request("TOC_TEXT", prompt + "\n" + source, schema, timeout=180)
        units = result.get("units", [])
        for unit in units:
            for lesson in unit.get("lessons", []):
                lesson["endPage"] = lesson["startPage"]
        print(f"[+] Gemini TOC: {len(units)} units, {sum(len(u.get('lessons', [])) for u in units)} lessons.")
        return units
    except Exception as err:
        print(f"[!] Gemini TOC extraction failed: {err}")
        return []
