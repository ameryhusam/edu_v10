"""Physical-part detection and isolation for combined textbook PDFs.

The detector uses explicit cover/front-matter semester/part evidence, TOC
evidence, and later structural markers. BOTH is a source-input mode only and
is resolved into independent PART_1 and PART_2 preparation inputs.
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
    re.compile(r"الفصل\s+الدراسي\s+الأول", re.IGNORECASE),
    re.compile(r"الفصل\s+الدراسي\s+الاول", re.IGNORECASE),
    re.compile(r"الفصل\s+الأول", re.IGNORECASE),
    re.compile(r"الفصل\s+الاول", re.IGNORECASE),
    re.compile(r"الفصل\s+الدراسي\s+١", re.IGNORECASE),
    re.compile(r"الفصل\s+١", re.IGNORECASE),
    re.compile(r"الجزء\s*[-:]?\s*(?:الأول|الاول|1|١)", re.IGNORECASE),
    re.compile(r"\b(?:PART|VOLUME)\s*[-:]?\s*(?:1|I|ONE)\b", re.IGNORECASE),
    re.compile(r"\b(?:FIRST\s+)?SEMESTER\s*(?:1|I|ONE)\b", re.IGNORECASE),
    re.compile(r"\bPUPIL(?:'S|’S)?\s+BOOK\s*(?:1|I|ONE)\b", re.IGNORECASE),
    re.compile(r"\bBOOK\s*(?:1|I|ONE)\b", re.IGNORECASE),
)

PART_2_PATTERNS = (
    re.compile(r"الجزء\s+الثاني", re.IGNORECASE),
    re.compile(r"الجزء\s+الثانى", re.IGNORECASE),
    re.compile(r"الجزء\s+٢", re.IGNORECASE),
    re.compile(r"الفصل\s+الدراسي\s+الثاني", re.IGNORECASE),
    re.compile(r"الفصل\s+الدراسي\s+الثانى", re.IGNORECASE),
    re.compile(r"الفصل\s+الثاني", re.IGNORECASE),
    re.compile(r"الفصل\s+الثانى", re.IGNORECASE),
    re.compile(r"الفصل\s+الدراسي\s+٢", re.IGNORECASE),
    re.compile(r"الفصل\s+٢", re.IGNORECASE),
    re.compile(r"الجزء\s*[-:]?\s*(?:الثاني|الثانى|2|٢)", re.IGNORECASE),
    re.compile(r"\b(?:PART|VOLUME)\s*[-:]?\s*(?:2|II|TWO)\b", re.IGNORECASE),
    re.compile(r"\b(?:SECOND\s+)?SEMESTER\s*(?:2|II|TWO)\b", re.IGNORECASE),
    re.compile(r"\bPUPIL(?:'S|’S)?\s+BOOK\s*(?:2|II|TWO)\b", re.IGNORECASE),
    re.compile(r"\bBOOK\s*(?:2|II|TWO)\b", re.IGNORECASE),
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


def _evidence_pages(
    reader: PdfReader,
    *,
    max_pages: int | None = None,
) -> list[dict[str, Any]]:
    limit = reader.page_count if max_pages is None else max(1, min(int(max_pages), reader.page_count))
    pages: list[dict[str, Any]] = []

    for index in range(limit):
        text = reader.extract_page_text(index) or ""
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
                }
            )
    return pages


def detect_combined_part_boundary(
    reader: PdfReader,
    *,
    analysis_pages: int = 15,
    front_matter_pages: int = 5,
) -> dict[str, Any]:
    """Detect physical part mode and, when possible, its PDF boundary.

    Detection order:
    1. First five pages are the cover/front-matter identity window.
    2. Explicit first/second semester or part identifies a single part.
    3. Both identities in the early TOC/front matter identify a BOTH source.
    4. If neither identity occurs in the first five pages, BOTH is an
       indicator only; a later structural marker is still required to split.
    5. Ambiguous cases remain REVIEW and are never silently split.

    The result includes detectedPart: PART_1, PART_2, BOTH, or UNKNOWN.
    """

    first_window = max(1, min(int(front_matter_pages), reader.page_count))
    evidence_window = max(1, min(int(analysis_pages), reader.page_count))
    initial_pages = _evidence_pages(reader, max_pages=first_window)
    analysis_evidence = _evidence_pages(reader, max_pages=evidence_window)
    all_evidence = _evidence_pages(reader)

    p1_initial = any(p["part1"] for p in initial_pages)
    p2_initial = any(p["part2"] for p in initial_pages)
    p1_analysis = any(p["part1"] for p in analysis_evidence)
    p2_analysis = any(p["part2"] for p in analysis_evidence)
    both_early = p1_analysis and p2_analysis

    result: dict[str, Any] = {
        "mode": "BOTH",
        "status": "REVIEW",
        "detectedPart": "UNKNOWN",
        "confidence": "LOW",
        "boundaryPdfPage": None,
        "part1": {"startPdfPage": 1, "endPdfPage": None},
        "part2": {"startPdfPage": None, "endPdfPage": reader.page_count},
        "analysisPages": evidence_window,
        "frontMatterPages": first_window,
        "frontMatterEvidence": initial_pages,
        "evidence": all_evidence,
    }

    if p1_initial and not p2_initial and not both_early:
        result.update(
            {
                "status": "IDENTIFIED",
                "detectedPart": "PART_1",
                "confidence": "HIGH",
                "reason": "First five pages explicitly identify the book as first semester/part.",
            }
        )
    elif p2_initial and not p1_initial and not both_early:
        result.update(
            {
                "status": "IDENTIFIED",
                "detectedPart": "PART_2",
                "confidence": "HIGH",
                "reason": "First five pages explicitly identify the book as second semester/part.",
            }
        )

    if both_early:
        result["detectedPart"] = "BOTH"
        result["confidence"] = "HIGH"
        result["reason"] = (
            "Early source pages contain evidence for both first and second "
            "semester/part, including TOCs that explicitly separate the two."
        )

    if not p1_initial and not p2_initial:
        # Absence of an early marker is not evidence of BOTH. The detector
        # remains UNKNOWN until TOC/content evidence establishes the mode.
        result["bothIndicator"] = False
        result["indicatorReason"] = "No early part marker; no inference is made from absence."

    p1_pages = [p["pdfPage"] for p in all_evidence if p["part1"]]
    p2_pages = [p["pdfPage"] for p in all_evidence if p["part2"]]

    # Seeing first- and second-part/semester terminology in the same source is
    # combined-book evidence. It establishes BOTH identity, but not the split
    # page. The latter still requires a structural boundary.
    if p1_pages and p2_pages:
        result["detectedPart"] = "BOTH"
        result["confidence"] = "HIGH" if both_early else "MEDIUM"
        result["reason"] = (
            "Both first- and second-semester/part terminology occurs in the "
            "same source; physical split is resolved separately."
        )

    if p1_pages and p2_pages:
        later_candidates = [
            p for p in all_evidence
            if p["part2"] and p["pdfPage"] > evidence_window and p["part2Strength"] >= 2
        ]
        repeated_candidates = [
            p for p in all_evidence
            if p["part2"] and p["pdfPage"] > min(p2_pages) and p["part2Strength"] >= 2
        ]
        candidate = later_candidates[0] if later_candidates else (
            repeated_candidates[0] if repeated_candidates else None
        )

        if candidate and any(page < candidate["pdfPage"] for page in p1_pages):
            boundary = candidate["pdfPage"]
            if 1 < boundary <= reader.page_count:
                result.update(
                    {
                        "status": "DETECTED",
                        "detectedPart": "BOTH",
                        "confidence": "HIGH" if later_candidates else "MEDIUM",
                        "boundaryPdfPage": boundary,
                        "part1": {"startPdfPage": 1, "endPdfPage": boundary - 1},
                        "part2": {"startPdfPage": boundary, "endPdfPage": reader.page_count},
                        "reason": (
                            "Distinct first-part and later structural second-part "
                            "markers establish a physical split."
                        ),
                    }
                )
                return result

    if result["detectedPart"] == "BOTH":
        result["status"] = "REVIEW"
        result["reason"] = (
            result.get("reason", "")
            + " A physical boundary was not established; human review is required."
        ).strip()
        return result

    if result["detectedPart"] in {"PART_1", "PART_2"}:
        return result

    result["reason"] = (
        "Part identity is unresolved. No sufficient explicit first-five-page "
        "identity or validated physical boundary was found."
    )
    return result


def build_local_page_mapping(
    original_mapper: PageMappingEngine,
    *,
    source_start_pdf_page: int,
) -> PageMappingEngine:
    """Build a mapping for a temporary part PDF while retaining printed pages."""
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

    reader.copy_pages_to_pdf(list(range(p1_start - 1, p1_end)), p1_path)
    reader.copy_pages_to_pdf(list(range(p2_start - 1, p2_end)), p2_path)

    return ("PART_1", p1_path), ("PART_2", p2_path), temp_dir
