"""
pdf_ocr.py
==========
Arabic OCR extraction from PDF pages using PyMuPDF built-in capabilities.

PyMuPDF can:
1. Extract text from text-layer PDFs (fast, no OCR needed)
2. Render pages to pixmaps and extract embedded images
3. Use Tesseract OCR if installed (page.get_textpage_ocr)
4. Extract text from image-embedded objects (get_text with flags)

This module is the PRIMARY text extraction layer.
No external AI needed — 100% free via PyMuPDF + Tesseract (optional).
"""
import re
import unicodedata
from pathlib import Path
from typing import List, Dict, Any, Optional, Tuple

try:
    import pymupdf
except Exception:
    pymupdf = None


# ─────────────────────────────────────────────────────────────────────────────
#  Arabic text normalization
# ─────────────────────────────────────────────────────────────────────────────

def normalize_arabic_text(text: str) -> str:
    """
    Full Arabic normalization pipeline:
    1. Detect & reverse Unicode Presentation Forms (FB50-FEFF) if needed
    2. NFKD normalization (converts presentation forms to base Arabic)
    3. Remove tashkeel (diacritics)
    4. Unify Alef variants → ا
    5. Ta marbuta → ه
    6. Ya variants → ي
    """
    if not text:
        return ""

    has_pf = any('\uFB50' <= ch <= '\uFEFC' for ch in text)
    lines_out = []

    for line in text.splitlines():
        if has_pf and any('\uFB50' <= ch <= '\uFEFC' for ch in line):
            # Reverse visual-order glyph lines, keep digit runs intact
            parts = re.split(r'(\d+)', line)
            rev = [p[::-1] if not p.isdigit() else p for p in reversed(parts)]
            line = ''.join(rev)

        # NFKD converts presentation forms → canonical Arabic codepoints
        line = unicodedata.normalize('NFKD', line)
        lines_out.append(line)

    text = '\n'.join(lines_out)

    # Remove tashkeel / diacritics
    text = re.sub(r'[\u0610-\u061A\u064B-\u065F\u0670]', '', text)

    # Normalize Alef variants
    text = re.sub(r'[أإآٱ]', 'ا', text)

    # Normalize Waw with hamza
    text = text.replace('ؤ', 'و')

    # Normalize Ya variants
    text = re.sub(r'[ىئ]', 'ي', text)

    # Normalize Ta marbuta
    text = text.replace('ة', 'ه')

    return text


# ─────────────────────────────────────────────────────────────────────────────
#  PDF type detection
# ─────────────────────────────────────────────────────────────────────────────

class PdfContentType:
    TEXT = "text"           # Selectable Arabic text layer
    IMAGE = "image"         # Pure image/scanned PDF
    MIXED = "mixed"         # Mostly images with some text overlay
    WATERMARK = "watermark" # Only watermark/URL text, no real content


def detect_pdf_type(doc, sample_pages: int = 8) -> PdfContentType:
    """
    Analyze the first N pages to determine PDF content type.
    Counts Arabic characters (including Presentation Forms) vs image-only pages.
    """
    limit = min(sample_pages, len(doc))
    arabic_chars_total = 0
    image_only_pages = 0

    for i in range(limit):
        page = doc[i]
        text = page.get_text("text")

        arabic_chars = sum(
            1 for ch in text
            if ('\u0600' <= ch <= '\u06FF') or ('\u0750' <= ch <= '\u077F') or
               ('\uFB50' <= ch <= '\uFDFF') or ('\uFE70' <= ch <= '\uFEFF')
        )
        images = page.get_images(full=False)

        if arabic_chars < 10 and len(images) >= 1:
            image_only_pages += 1
        arabic_chars_total += arabic_chars

    if image_only_pages >= limit * 0.7:
        return PdfContentType.IMAGE
    if arabic_chars_total < 50:
        return PdfContentType.WATERMARK
    return PdfContentType.TEXT


# ─────────────────────────────────────────────────────────────────────────────
#  Page rendering to pixmap / bytes
# ─────────────────────────────────────────────────────────────────────────────

def render_page_to_pixmap(doc, page_idx: int, dpi: int = 200):
    """Render a PDF page to a PyMuPDF Pixmap at given DPI."""
    page = doc[page_idx]
    zoom = dpi / 72.0
    mat = pymupdf.Matrix(zoom, zoom)
    return page.get_pixmap(matrix=mat, colorspace=pymupdf.csRGB, alpha=False)


def render_page_to_bytes(doc, page_idx: int, dpi: int = 200) -> bytes:
    """Render a page and return PNG bytes."""
    pix = render_page_to_pixmap(doc, page_idx, dpi)
    return pix.tobytes("png")


def render_page_to_b64(doc, page_idx: int, dpi: int = 150) -> Optional[str]:
    """Render a page and return base64-encoded PNG string."""
    import base64
    try:
        png_bytes = render_page_to_bytes(doc, page_idx, dpi)
        return base64.b64encode(png_bytes).decode("ascii")
    except Exception as e:
        print(f"[!] render_page_to_b64 error (page {page_idx+1}): {e}")
        return None


# ─────────────────────────────────────────────────────────────────────────────
#  PyMuPDF OCR text extraction (Tesseract-based, free & offline)
# ─────────────────────────────────────────────────────────────────────────────

def _tesseract_available() -> bool:
    """Check if Tesseract OCR is available on the system."""
    import shutil
    return shutil.which("tesseract") is not None


def extract_page_text_ocr(doc, page_idx: int, lang: str = "ara") -> str:
    """
    Extract Arabic text from a page using PyMuPDF's built-in Tesseract OCR.
    Requires: Tesseract installed with Arabic language pack (ara.traineddata).

    Install:
      Windows: https://github.com/UB-Mannheim/tesseract/wiki
      Linux: sudo apt install tesseract-ocr tesseract-ocr-ara
      macOS: brew install tesseract tesseract-lang

    Falls back to empty string if Tesseract not available.
    """
    if not _tesseract_available():
        return ""

    try:
        page = doc[page_idx]
        # PyMuPDF's built-in OCR: renders page internally and runs Tesseract
        tp = page.get_textpage_ocr(language=lang, dpi=200, full=True)
        raw = tp.extractText()
        return normalize_arabic_text(raw)
    except Exception as e:
        # get_textpage_ocr may not be available in older pymupdf versions
        return ""


def extract_page_text_blocks_ocr(doc, page_idx: int, lang: str = "ara") -> List[Dict[str, Any]]:
    """
    Extract text blocks with bounding boxes using PyMuPDF OCR.
    Returns same format as PdfReader.extract_page_blocks().
    """
    if not _tesseract_available():
        return []
    try:
        page = doc[page_idx]
        tp = page.get_textpage_ocr(language=lang, dpi=200, full=True)
        raw_blocks = page.get_text("blocks", textpage=tp)
        blocks = []
        for b in raw_blocks:
            norm_text = normalize_arabic_text(b[4])
            if norm_text.strip():
                blocks.append({
                    "bbox": (b[0], b[1], b[2], b[3]),
                    "text": norm_text,
                    "block_no": b[5],
                    "type": b[6]
                })
        return blocks
    except Exception as e:
        return []


# ─────────────────────────────────────────────────────────────────────────────
#  Embedded image extraction from PDF
# ─────────────────────────────────────────────────────────────────────────────

def extract_page_images(doc, page_idx: int) -> List[bytes]:
    """
    Extract all embedded images from a PDF page as PNG bytes.
    Useful for PDFs that embed images as XObject resources.
    """
    page = doc[page_idx]
    images = []
    for img_info in page.get_images(full=True):
        xref = img_info[0]
        try:
            base_image = doc.extract_image(xref)
            if base_image:
                # Convert to PNG via Pixmap
                pix = pymupdf.Pixmap(doc, xref)
                if pix.n > 4:  # CMYK → RGB
                    pix = pymupdf.Pixmap(pymupdf.csRGB, pix)
                images.append(pix.tobytes("png"))
        except Exception:
            pass
    return images


# ─────────────────────────────────────────────────────────────────────────────
#  Main extractor class
# ─────────────────────────────────────────────────────────────────────────────

class ArabicPdfExtractor:
    """
    Unified Arabic PDF text extractor using PyMuPDF.

    Extraction priority:
    1. Text layer (if real Arabic text available)
    2. PyMuPDF built-in OCR via Tesseract (if installed)
    3. Return page as rendered image (for AI vision fallback)

    100% free — no API keys needed for steps 1 and 2.
    """

    def __init__(self, pdf_path: str, tesseract_lang: str = "ara"):
        self.pdf_path = Path(pdf_path)
        if not self.pdf_path.exists():
            raise FileNotFoundError(f"PDF not found: {pdf_path}")
        self.doc = pymupdf.open(str(self.pdf_path))
        self.page_count = len(self.doc)
        self.tesseract_lang = tesseract_lang
        self.pdf_type = detect_pdf_type(self.doc)
        self.tesseract_ok = _tesseract_available()
        self._print_info()

    def _print_info(self):
        print(f"[+] PDF type: {self.pdf_type} | pages: {self.page_count} | Tesseract: {self.tesseract_ok}")

    def extract_page_text(self, page_idx: int) -> str:
        """
        Extract text from a single page using best available method.
        Returns normalized Arabic text or empty string.
        """
        page = self.doc[page_idx]

        # --- Step 1: Try native text layer ---
        raw = page.get_text("text")
        arabic_chars = sum(1 for ch in raw if '\u0600' <= ch <= '\u06FF')
        if arabic_chars >= 20:
            return normalize_arabic_text(raw)

        # --- Step 2: Tesseract OCR via PyMuPDF ---
        if self.tesseract_ok:
            ocr_text = extract_page_text_ocr(self.doc, page_idx, self.tesseract_lang)
            if ocr_text.strip():
                return ocr_text

        # --- Step 3: No text available, return placeholder ---
        return ""

    def extract_page_blocks(self, page_idx: int) -> List[Dict[str, Any]]:
        """
        Extract text blocks with coordinates from a single page.
        """
        page = self.doc[page_idx]

        raw_blocks = page.get_text("blocks")
        blocks = []
        for b in raw_blocks:
            norm_text = normalize_arabic_text(b[4])
            if norm_text.strip():
                blocks.append({
                    "bbox": (b[0], b[1], b[2], b[3]),
                    "text": norm_text,
                    "block_no": b[5],
                    "type": b[6]
                })

        # If no blocks from text layer, try OCR
        if not blocks and self.tesseract_ok:
            blocks = extract_page_text_blocks_ocr(self.doc, page_idx, self.tesseract_lang)

        return blocks

    def extract_all_text(self, max_pages: Optional[int] = None) -> str:
        """Extract concatenated text from all pages."""
        limit = max_pages or self.page_count
        parts = []
        for i in range(min(limit, self.page_count)):
            t = self.extract_page_text(i)
            if t.strip():
                parts.append(f"--- صفحة {i+1} ---\n{t}")
        return "\n\n".join(parts)

    def get_page_image_b64(self, page_idx: int, dpi: int = 150) -> Optional[str]:
        """Get base64-encoded PNG of a page for AI vision analysis."""
        return render_page_to_b64(self.doc, page_idx, dpi)

    def close(self):
        self.doc.close()
