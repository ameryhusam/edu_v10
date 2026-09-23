"""Primary PDF reader with a PyMuPDF -> pypdf fallback.

PyMuPDF is preferred because Edu7 needs page geometry and image rendering.
If PyMuPDF cannot be imported/loaded (common on Android/Termux), pypdf remains
usable for text extraction and PDF slicing. Features that require rendering
are reported as unavailable instead of breaking the whole preparation flow.
"""
from __future__ import annotations

import base64
import io
import os
import shutil
import subprocess
import tempfile
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
        return self.backend == "pymupdf" or any(
            shutil.which(tool) for tool in ("pdftoppm", "mutool")
        )

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

        page = self.doc[page_num]
        raw_blocks = page.get_text("blocks")
        # Build a lightweight bbox -> font-size lookup from the structured
        # text representation. Geometry remains the stable block contract;
        # font size is supplementary visual evidence for heading detection.
        font_sizes: Dict[tuple[float, float, float, float], float] = {}
        font_bold: Dict[tuple[float, float, float, float], bool] = {}
        font_colors: Dict[tuple[float, float, float, float], int] = {}
        try:
            for block in page.get_text("dict").get("blocks", []):
                if block.get("type") != 0:
                    continue
                bbox = tuple(float(v) for v in block.get("bbox", (0, 0, 0, 0)))
                sizes = [
                    float(span.get("size", 0) or 0)
                    for line in block.get("lines", [])
                    for span in line.get("spans", [])
                    if span.get("size")
                ]
                if sizes:
                    font_sizes[bbox] = max(sizes)
                spans = [
                    span
                    for line in block.get("lines", [])
                    for span in line.get("spans", [])
                ]
                if spans:
                    font_bold[bbox] = any(
                        "bold" in str(span.get("font", "")).lower()
                        for span in spans
                    )
                    colors = [span.get("color") for span in spans if span.get("color") is not None]
                    if colors:
                        font_colors[bbox] = int(colors[0])
        except Exception:
            font_sizes = {}
            font_bold = {}
            font_colors = {}

        blocks: List[Dict[str, Any]] = []
        for b in raw_blocks:
            norm_text = normalize_arabic_text(b[4])
            if norm_text.strip():
                bbox = tuple(float(v) for v in b[:4])
                blocks.append({
                    "bbox": bbox,
                    "text": norm_text,
                    "block_no": b[5],
                    "type": b[6],
                    "fontSize": font_sizes.get(bbox, 0.0),
                    "fontBold": font_bold.get(bbox, False),
                    "fontColor": font_colors.get(bbox),
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
        """Render with PyMuPDF first, then pdftoppm/mutool if available."""
        if not (0 <= page_num < self.page_count):
            return None
        if self.backend == "pymupdf":
            page = self.doc[page_num]
            pix = page.get_pixmap(dpi=dpi, alpha=False)
            return pix.tobytes("png")
        return self._render_with_system_tool(page_num, dpi)

    def _render_with_system_tool(self, page_num: int, dpi: int) -> Optional[bytes]:
        page = page_num + 1
        source = str(self.pdf_path)

        pdftoppm = shutil.which("pdftoppm")
        if pdftoppm:
            with tempfile.TemporaryDirectory(prefix="edu7-render-") as tmp:
                prefix = os.path.join(tmp, "page")
                try:
                    result = subprocess.run(
                        [pdftoppm, "-f", str(page), "-l", str(page),
                         "-singlefile", "-png", "-r", str(dpi), source, prefix],
                        capture_output=True, text=True, timeout=60, check=False,
                    )
                    output = Path(prefix + ".png")
                    if result.returncode == 0 and output.exists():
                        return output.read_bytes()
                except (OSError, subprocess.SubprocessError):
                    pass

        mutool = shutil.which("mutool")
        if mutool:
            with tempfile.TemporaryDirectory(prefix="edu7-render-") as tmp:
                output = Path(tmp) / "page.png"
                try:
                    result = subprocess.run(
                        [mutool, "draw", "-F", "png", "-r", str(dpi),
                         "-o", str(output), source, str(page)],
                        capture_output=True, text=True, timeout=60, check=False,
                    )
                    if result.returncode == 0 and output.exists():
                        return output.read_bytes()
                except (OSError, subprocess.SubprocessError):
                    pass
        return None

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
