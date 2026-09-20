"""
reader.py — Primary PDF Reader wrapper
Uses PyMuPDF (pymupdf package, import as fitz or pymupdf).
Delegates Arabic normalization to pdf_ocr.normalize_arabic_text().
"""
from typing import List, Dict, Any, Optional
from pathlib import Path

import pymupdf
from .pdf_ocr import normalize_arabic_text


class PdfReader:
    """
    Wrapper around a PyMuPDF document.
    Provides normalized Arabic text extraction for all higher-level modules.
    """

    def __init__(self, pdf_path: str):
        self.pdf_path = Path(pdf_path)
        if not self.pdf_path.exists():
            raise FileNotFoundError(f"PDF not found: {pdf_path}")
        self.doc = pymupdf.open(str(self.pdf_path))
        self.page_count = len(self.doc)

    # ── Metadata ──────────────────────────────────────────────────────────────

    def get_metadata(self) -> Dict[str, Any]:
        meta = self.doc.metadata or {}
        return {
            "title":     meta.get("title", ""),
            "author":    meta.get("author", ""),
            "subject":   meta.get("subject", ""),
            "pageCount": self.page_count,
            "filename":  self.pdf_path.name,
        }

    # ── Text extraction ───────────────────────────────────────────────────────

    def extract_page_text(self, page_num: int) -> str:
        """
        Extract normalized Arabic text from page (zero-indexed).
        Returns empty string if page out of range or contains no text.
        """
        if not (0 <= page_num < self.page_count):
            return ""
        raw = self.doc[page_num].get_text("text")
        return normalize_arabic_text(raw)

    def extract_page_blocks(self, page_num: int) -> List[Dict[str, Any]]:
        """
        Extract text blocks with bounding boxes from a page.
        Each block: {"bbox": (x0,y0,x1,y1), "text": str, "block_no": int, "type": int}
        """
        if not (0 <= page_num < self.page_count):
            return []
        raw_blocks = self.doc[page_num].get_text("blocks")
        blocks = []
        for b in raw_blocks:
            norm_text = normalize_arabic_text(b[4])
            if norm_text.strip():
                blocks.append({
                    "bbox":     (b[0], b[1], b[2], b[3]),
                    "text":     norm_text,
                    "block_no": b[5],
                    "type":     b[6],
                })
        return blocks

    def close(self):
        self.doc.close()
