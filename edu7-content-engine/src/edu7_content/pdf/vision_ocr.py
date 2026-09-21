"""
vision_ocr.py
=============
Multi-layer TOC extraction pipeline for Arabic textbook PDFs.

Extraction strategy (in priority order):
  Layer 1: PyMuPDF native text layer  (free, instant, no AI)
  Layer 2: PyMuPDF + Tesseract OCR    (free, offline, no API key)
  Layer 3: Ollama local vision model  (free, local GPU/CPU inference)
  Layer 4: Gemini API (multimodal when renderable, text-only with pypdf)

The system tries each layer in sequence and stops at first success.
"""
import base64
from typing import List, Optional, Dict, Any
from pathlib import Path

try:
    import pymupdf  # optional; PdfReader handles pypdf fallback
except Exception:
    pymupdf = None


# ─────────────────────────────────────────────────────────────────────────────
#  Core: is this an image-based PDF?
# ─────────────────────────────────────────────────────────────────────────────

def is_image_based_pdf(reader, sample_pages: int = 8) -> bool:
    """Detect whether sampled pages are visually image-dominant.

    A scanned textbook can contain an OCR text layer, so Arabic character
    counts alone cannot prove that the PDF is text-native. Embedded page
    images are used as an independent signal.
    """
    limit = min(sample_pages, reader.page_count)
    arabic_chars = 0
    pages_with_images = 0

    for i in range(limit):
        t = reader.extract_page_text(i)
        arabic_chars += sum(
            1 for ch in t
            if ('\u0600' <= ch <= '\u06FF') or ('\u0750' <= ch <= '\u077F') or
               ('\uFB50' <= ch <= '\uFDFF') or ('\uFE70' <= ch <= '\uFEFF')
        )
        try:
            if reader.backend == "pymupdf":
                if reader.doc[i].get_images(full=True):
                    pages_with_images += 1
            elif hasattr(reader.doc.pages[i], "images") and len(reader.doc.pages[i].images) > 0:
                pages_with_images += 1
        except Exception:
            pass

    if limit == 0:
        return False

    if pages_with_images / limit >= 0.75:
        return True

    return arabic_chars < 50


# ─────────────────────────────────────────────────────────────────────────────
#  Layer: render page to base64 PNG
# ─────────────────────────────────────────────────────────────────────────────

def render_pages_to_b64(reader, max_pages: int = 10, dpi: int = 150) -> List[str]:
    """Render first pages through PdfReader when the active backend supports it."""
    images = []
    for i in range(min(max_pages, reader.page_count)):
        b64 = reader.render_page_to_b64(i, dpi=dpi)
        if b64:
            images.append(b64)
            print(f"    [+] Rendered page {i+1} ({len(b64) // 1024} KB)")
    return images

# Backwards-compatible single-page helper
def render_page_to_b64(reader, page_idx: int, dpi: int = 150) -> Optional[str]:
    """Render a single page to base64 PNG."""
    if hasattr(reader, "render_page_to_b64"):
        return reader.render_page_to_b64(page_idx, dpi=dpi)
    return None


# ─────────────────────────────────────────────────────────────────────────────
#  Main pipeline: extract_toc_via_vision
# ─────────────────────────────────────────────────────────────────────────────

def extract_toc_via_vision(
    reader,
    max_pages: int = 10,
    dpi: int = 150,
    api_key: Optional[str] = None,
    model_name: Optional[str] = None,
    use_ollama: bool = True,
    use_gemini: bool = True,
    force_vision: bool = False,
) -> List[Dict[str, Any]]:
    """
    Multi-layer TOC extraction for image-based or text-layer-failed PDFs.

    Parameters
    ----------
    reader      : PdfReader or ArabicPdfExtractor
    max_pages   : how many pages to render/send
    dpi         : render resolution (higher = better quality, larger payload)
    api_key     : optional explicit Gemini key (normally leave unset so key rotation is used)
    model_name  : specific AI model name (gemini-3.6-flash or gemini-3.5-flash)
    use_ollama  : try Ollama local models (default: True)
    use_gemini  : try Gemini API (default: True, using configured key rotation)

    Returns
    -------
    list of unit dicts or []
    """
    # ── Prepare the first pages ──────────────────────────────────────────
    print(f"[*] Preparing first {max_pages} pages for AI TOC analysis (DPI={dpi})...")
    images_b64 = render_pages_to_b64(reader, max_pages=max_pages, dpi=dpi)
    page_texts = [
        {"pdfPage": i + 1, "text": reader.extract_page_text(i)}
        for i in range(min(max_pages, reader.page_count))
    ]

    # A forced visual run must never silently fall back to a text-only OCR layer.
    if force_vision and not images_b64:
        print("[!] Visual extraction was requested, but no page renderer is available.")
        print("[!] Install PyMuPDF, or a system renderer such as pdftoppm/mutool.")
        return []

    # A scanned PDF with no usable text and no renderer cannot reach a vision model.
    if not images_b64 and not any(p["text"].strip() for p in page_texts):
        print("[!] Scanned PDF has no text layer and no available renderer.")
        print("[!] Install PyMuPDF, or a system renderer such as pdftoppm/mutool.")
        return []

    # ── Layer 3: Ollama (local, free, no API key) ─────────────────────────
    if use_ollama:
        print("[*] Trying Ollama local vision model...")
        from ..ai.ollama_vision import extract_toc_via_ollama, _ollama_available
        if _ollama_available():
            ollama_model = None
            if model_name and not model_name.startswith("gemini"):
                ollama_model = model_name
            units = extract_toc_via_ollama(images_b64, model=ollama_model)
            if units:
                total_lessons = sum(len(u.get("lessons", [])) for u in units)
                print(f"[+] Ollama TOC: {len(units)} units, {total_lessons} lessons.")
                return units
            print("[!] Ollama did not extract any TOC data.")
        else:
            print("[!] Ollama not available (not running or not installed).")

    # ── Layer 4: Gemini API ───────────────────────────────────────────────
    if use_gemini:
        from ..ai.gemini import GeminiFreeProvider

        # Do not inspect GEMINI_API_KEY here. GeminiFreeProvider/GeminiClient
        # owns authentication, plural-key rotation, model validation, and 429
        # failover. Passing api_key=None is intentional.
        try:
            requested_model = model_name if model_name and model_name.startswith("gemini") else None
            provider = GeminiFreeProvider(api_key=api_key, model_name=requested_model)

            if not provider.client.api_keys:
                print("[!] Gemini skipped (GEMINI_API_KEYS/GEMINI_API_KEY not set).")
                return []

            gemini_model = provider.model_name
            print(f"[*] Trying Gemini {gemini_model} TOC extraction...")
            units = (
                provider.extract_toc_from_page_images(images_b64)
                if images_b64
                else provider.extract_toc_from_page_texts(page_texts)
            )
            if units:
                total_lessons = sum(len(u.get("lessons", [])) for u in units)
                mode = "Vision" if images_b64 else "text/pypdf"
                print(f"[+] Gemini {mode} TOC: {len(units)} units, {total_lessons} lessons.")
                return units
            print("[!] Gemini TOC analysis returned no results.")
        except Exception as err:
            print(f"[!] Gemini TOC provider unavailable: {err}")

    return []
