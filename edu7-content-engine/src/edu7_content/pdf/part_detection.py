"""Physical-part detection and isolation for combined textbook PDFs.

BOTH is a source-input mode only. It is resolved into independent PART_1 and
PART_2 preparation inputs before any Workspace identity is created.
"""

from __future__ import annotations

import re
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .page_mapping import PageMappingEngine
from .reader import PdfReader
from .pdf_ocr import extract_page_text_ocr


PART_1_PATTERNS = (
    re.compile(r"الجزء\s+الأول", re.IGNORECASE),
    re.compile(r"الجزء\s+الاول", re.IGNORECASE),
    re.compile(r"الجزء\s+١", re.IGNORECASE),
)

PART_2_PATTERNS = (
    re.compile(r"الجزء\s+الثاني", re.IGNORECASE),
    re.compile(r"الجزء\s+الثانى", re.IGNORECASE),
    re.compile(r"الجزء\s+٢", re.IGNORECASE),
)


@dataclass(frozen=True)
class PartBoundary:
    """Evidence-backed physical boundary in the original PDF."""

    part_1_start_pdf: int
    part_1_end_pdf: int
    part_2_start_pdf: int
    part_2_end_pdf: int
    confidence: str
    evidence: list[dict[str, Any]]


def _matches(text: str, patterns: tuple[re.Pattern[str], ...]) -> bool:
    return any(pattern.search(text or "") for pattern in patterns)


def _marker_strength(text: str, patterns: tuple[re.Pattern[str], ...]) -> int:
    """Score explicit markers higher when they look like standalone headings."""
    lines = [line.strip() for line in (text or "").splitlines() if line.strip()]
    score = 0
    for line in lines:
        if _matches(line, patterns):
            score += 2 if len(line) <= 80 else 1
    return score


def detect_combined_part_boundary(
    reader: PdfReader,
    *,
    analysis_pages: int = 15,
) -> dict[str, Any]:
    """Detect BOTH and return a reviewable boundary proposal.

    Deterministic evidence is preferred. A boundary is accepted only when a
    PART_1 marker occurs before a distinct PART_2 marker and the PART_2 marker
    is supported by a strong/structural occurrence. A mention of PART_2 in an
    early TOC/front-matter page alone is never enough to split the source.
    """

    window = max(1, min(int(analysis_pages), reader.page_count))
    pages: list[dict[str, Any]] = []

    for index in range(reader.page_count):
        text = reader.extract_page_text(index) or ""
        # Combined scanned PDFs may have no text layer. Reuse the engine's
        # existing offline Arabic OCR before falling back to human review.
        if not text.strip() and getattr(reader, "backend", None) == "pymupdf":
            try:
                text = extract_page_text_ocr(reader.doc, index, lang="ara") or ""
            except Exception:
                text = ""
        p1 = _matches(text, PART_1_PATTERNS)
        p2 = _matches(text, PART_2_PATTERNS)
        if p1 or p2:
            pages.append(
                {
                    "pdfPage": index + 1,
                    "part1": p1,
                    "part2": p2,
                    "part1Strength": _marker_strength(text, PART_1_PATTERNS),
                    "part2Strength": _marker_strength(text, PART_2_PATTERNS),
                    "text": text[:1000],
                    "withinAnalysisWindow": index + 1 <= window,
                }
            )

    p1_pages = [p["pdfPage"] for p in pages if p["part1"]]
    p2_pages = [p["pdfPage"] for p in pages if p["part2"]]

    result: dict[str, Any] = {
        "mode": "BOTH",
        "status": "REVIEW",
        "confidence": "LOW",
        "boundaryPdfPage": None,
        "part1": {"startPdfPage": 1, "endPdfPage": None},
        "part2": {"startPdfPage": None, "endPdfPage": reader.page_count},
        "analysisPages": window,
        "evidence": pages,
    }

    if not p1_pages or not p2_pages:
        result["reason"] = "Both physical-part markers were not found in the source PDF."
        return result

    # Prefer a repeated/standalone PART_2 heading outside the initial
    # front-matter/TOC window. This avoids treating a TOC mention as the split.
    later_candidates = [
        p for p in pages
        if p["part2"] and p["pdfPage"] > window and p["part2Strength"] >= 2
    ]
    if later_candidates:
        candidate = later_candidates[0]
        confidence = "HIGH"
    else:
        # If PART_2 appears in the initial window and later appears again,
        # the later occurrence is the structural boundary candidate.
        repeated_candidates = [
            p for p in pages
            if p["part2"] and p["pdfPage"] > min(p2_pages) and p["part2Strength"] >= 2
        ]
        if repeated_candidates:
            candidate = repeated_candidates[0]
            confidence = "MEDIUM"
        else:
            result["reason"] = (
                "PART_2 was detected, but no distinct structural boundary was "
                "found after the initial analysis window."
            )
            return result

    if not any(page < candidate["pdfPage"] for page in p1_pages):
        result["reason"] = "PART_1 evidence does not precede the PART_2 boundary."
        return result

    boundary = candidate["pdfPage"]
    if boundary <= 1 or boundary > reader.page_count:
        result["reason"] = "Detected PART_2 boundary is outside the valid PDF range."
        return result

    result.update(
        {
            "status": "DETECTED",
            "confidence": confidence,
            "boundaryPdfPage": boundary,
            "part1": {"startPdfPage": 1, "endPdfPage": boundary - 1},
            "part2": {"startPdfPage": boundary, "endPdfPage": reader.page_count},
            "reason": "Distinct PART_1/PART_2 structural markers detected.",
        }
    )
    return result


def build_local_page_mapping(
    original_mapper: PageMappingEngine,
    *,
    source_start_pdf_page: int,
) -> PageMappingEngine:
    """Build a mapping for a temporary part PDF while retaining printed pages.

    If original PDF page = printed page + original_offset, then local PDF page
    = printed page + original_offset - source_start + 1.
    """

    detected = original_mapper.detected_offset
    offset = (int(detected) - int(source_start_pdf_page) + 1) if detected is not None else 0
    local_mapper = PageMappingEngine.__new__(PageMappingEngine)
    local_mapper.reader = None
    local_mapper.mapping = {}
    local_mapper.reverse_mapping = {}
    local_mapper.detected_offset = offset
    return local_mapper


def split_combined_source(
    reader: PdfReader,
    boundary: dict[str, Any],
) -> tuple[tuple[str, Path], tuple[str, Path], Path]:
    """Create temporary PART_1/PART_2 PDFs; caller owns the temp directory."""

    if boundary.get("status") != "DETECTED":
        raise ValueError("Combined PDF boundary is not validated; preparation requires review.")

    p1_start = int(boundary["part1"]["startPdfPage"])
    p1_end = int(boundary["part1"]["endPdfPage"])
    p2_start = int(boundary["part2"]["startPdfPage"])
    p2_end = int(boundary["part2"]["endPdfPage"])

    temp_dir = Path(tempfile.mkdtemp(prefix="edu7-both-"))
    p1_path = temp_dir / "PART_1.pdf"
    p2_path = temp_dir / "PART_2.pdf"

    reader.copy_pages_to_pdf(
        list(range(p1_start - 1, p1_end)),
        p1_path,
    )
    reader.copy_pages_to_pdf(
        list(range(p2_start - 1, p2_end)),
        p2_path,
    )

    return ("PART_1", p1_path), ("PART_2", p2_path), temp_dir
