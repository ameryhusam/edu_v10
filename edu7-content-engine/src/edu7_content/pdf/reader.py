"""Primary PDF reader with a PyMuPDF -> pypdf fallback.

PyMuPDF is preferred because Edu7 needs page geometry and image rendering.
If PyMuPDF cannot be imported/loaded (common on Android/Termux), pypdf remains
usable for text extraction and PDF slicing. Features that require rendering
are reported as unavailable instead of breaking the whole preparation flow.
"""
from __future__ import annotations

import base64
import io
from pathlib import Path
from typing import Any, Dict, List, Optional

from .pdf_ocr import normalize_arabic_text

try:  # Preferred backend
    import pymupdf as _pymupdf
except Exception:  # pragma: no cover - environment dependent
    _pymupdf = None

try:  # Required fallback
    from pypdf import PdfReader as _PyPdfReader, PdfWriter as _PyPdfWriter
except Exception:  # pragma: no cover - environment dependent
    _PyPdfReader = None
    _PyPdfWriter = None


class PdfReader:
    """Stable Edu7 PDF API independent of the installed PDF backend."""

    def __init__(self, pdf_path: str):
        self.pdf_path = Path(pdf_path)
        if not self.pdf_path.exists():
            raise FileNotFoundError(f"PDF not found: {pdf_path}")

        self.backend = "pymupdf" if _pymupdf is not None else "pypdf"
        if self.backend == "pymupdf":
            try:
                self.doc = _pymupdf.open(str(self.pdf_path))
                self.page_count = len(self.doc)
            except Exception:
                if _PyPdfReader is None:
                    raise
                self.backend = "pypdf"
                self.doc = _PyPdfReader(str(self.pdf_path))
                self.page_count = len(self.doc.pages)
        else:
            if _PyPdfReader is None:
                raise RuntimeError(
                    "Neither PyMuPDF nor pypdf is available. "
                    "Install pymupdf or pypdf."
                )
            self.doc = _PyPdfReader(str(self.pdf_path))
            self.page_count = len(self.doc.pages)

    @property
    def can_render(self) -> bool:
        return self.backend == "pymupdf"

    def get_metadata(self) -> Dict[str, Any]:
        if self.backend == "pymupdf":
            meta = self.doc.metadata or {}
            return {
                "title": meta.get("title", ""),
                "author": meta.get("author", ""),
                "subject": meta.get("subject", ""),
                "pageCount": self.page_count,
                "filename": self.pdf_path.name,
                "backend": self.backend,
            }

        meta = getattr(self.doc, "metadata", None) or {}
        return {
            "title": str(meta.get("/Title", "") or ""),
            "author": str(meta.get("/Author", "") or ""),
            "subject": str(meta.get("/Subject", "") or ""),
            "pageCount": self.page_count,
            "filename": self.pdf_path.name,
            "backend": self.backend,
        }

    def extract_page_text(self, page_num: int) -> str:
        if not (0 <= page_num < self.page_count):
            return ""
        if self.backend == "pymupdf":
            raw = self.doc[page_num].get_text("text")
        else:
            raw = self.doc.pages[page_num].extract_text() or ""
        return normalize_arabic_text(raw)

    def extract_page_blocks(self, page_num: int) -> List[Dict[str, Any]]:
        if not (0 <= page_num < self.page_count):
            return []

        if self.backend == "pypdf":
            # pypdf deliberately exposes text, not page geometry. Callers must
            # use extract_page_text() when running on the fallback backend.
            return []

        raw_blocks = self.doc[page_num].get_text("blocks")
        blocks: List[Dict[str, Any]] = []
        for b in raw_blocks:
            norm_text = normalize_arabic_text(b[4])
            if norm_text.strip():
                blocks.append({
                    "bbox": (b[0], b[1], b[2], b[3]),
                    "text": norm_text,
                    "block_no": b[5],
                    "type": b[6],
                })
        return blocks

    def get_page_size(self, page_num: int) -> tuple[float, float]:
        if not (0 <= page_num < self.page_count):
            return (0.0, 0.0)
        if self.backend == "pymupdf":
            rect = self.doc[page_num].rect
            return float(rect.width), float(rect.height)
        page = self.doc.pages[page_num]
        return (
            float(page.mediabox.width),
            float(page.mediabox.height),
        )

    def render_page_to_png(self, page_num: int, dpi: int = 150) -> Optional[bytes]:
        """Render a page only when PyMuPDF is available."""
        if not self.can_render or not (0 <= page_num < self.page_count):
            return None
        page = self.doc[page_num]
        pix = page.get_pixmap(dpi=dpi, alpha=False)
        return pix.tobytes("png")

    def render_page_to_b64(self, page_num: int, dpi: int = 150) -> Optional[str]:
        data = self.render_page_to_png(page_num, dpi)
        return base64.b64encode(data).decode("ascii") if data else None

    def copy_pages_to_pdf(self, page_indices: List[int], output_path: Path) -> None:
        """Write selected zero-based PDF pages using the active backend."""
        output_path.parent.mkdir(parents=True, exist_ok=True)

        if self.backend == "pymupdf":
            out = _pymupdf.open()
            try:
                for idx in page_indices:
                    if 0 <= idx < self.page_count:
                        out.insert_pdf(self.doc, from_page=idx, to_page=idx)
                out.save(str(output_path))
            finally:
                out.close()
            return

        if _PyPdfWriter is None:
            raise RuntimeError("pypdf PdfWriter is unavailable")
        writer = _PyPdfWriter()
        for idx in page_indices:
            if 0 <= idx < self.page_count:
                writer.add_page(self.doc.pages[idx])
        with output_path.open("wb") as fh:
            writer.write(fh)

    def close(self):
        close = getattr(self.doc, "close", None)
        if callable(close):
            close()
