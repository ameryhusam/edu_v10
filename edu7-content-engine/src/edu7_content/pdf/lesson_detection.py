"""Lesson boundary detection and reconciliation evidence.

TOC supplies the expected coordinate; page content validates it. A mismatch
never silently rewrites canonical identity: it is emitted as REVIEW evidence.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List
\n
LESSON_RE = re.compile(
    r"^\s*(?:الدرس\s+(?:الأول|الاول|الثاني|الثانى|الثالث|الرابع|الخامس|السادس|السابع|الثامن|التاسع|العاشر|[0-9٠-٩]+)|[0-9٠-٩]+\.[0-9٠-٩]+\s+.+)",
    re.I,
)


def detect_lesson_start_candidates(reader: Any, start_pdf: int, end_pdf: int, expected_title: str | None = None) -> List[Dict[str, Any]]:
    candidates: List[Dict[str, Any]] = []
    for pdf_page in range(max(1, start_pdf), min(reader.page_count, end_pdf) + 1):
        idx = pdf_page - 1
        blocks = reader.extract_page_blocks(idx)
        if not blocks:
            text = reader.extract_page_text(idx)
            if LESSON_RE.search(text or "") or (expected_title and expected_title.strip() and expected_title.strip() in (text or "")):
                candidates.append({
                    "pdfPage": pdf_page,
                    "score": 0.75,
                    "evidence": ["explicit_lesson_heading_text_fallback" if LESSON_RE.search(text or "") else "toc_title_text_match"],
                })
            continue

        _, height = reader.get_page_size(idx)
        sizes = [float(b.get("fontSize", 0) or 0) for b in blocks if b.get("fontSize")]
        median = sorted(sizes)[len(sizes) // 2] if sizes else 0.0
        for block in blocks:
            text = (block.get("text") or "").strip()
            if not LESSON_RE.search(text) and not (expected_title and expected_title.strip() and expected_title.strip() in text):
                continue
            evidence = ["explicit_lesson_heading"] if LESSON_RE.search(text) else ["toc_title_text_match"]
            if block.get("bbox", (0, 0, 0, 0))[1] <= height * 0.25:
                evidence.append("top_of_page")
            if median and float(block.get("fontSize", 0) or 0) >= median * 1.4:
                evidence.append("larger_font")
            score = min(1.0, 0.70 + 0.10 * (len(evidence) - 1))
            candidates.append({
                "pdfPage": pdf_page,
                "score": round(score, 3),
                "evidence": evidence,
                "text": text,
                "bbox": list(block.get("bbox", (0, 0, 0, 0))),
            })
    return candidates


def reconcile_lesson_range(
    reader: Any,
    *,
    toc_start_pdf: int,
    toc_end_pdf: int,
    next_lesson_start_pdf: int | None = None,
    expected_title: str | None = None,
) -> Dict[str, Any]:
    end = next_lesson_start_pdf - 1 if next_lesson_start_pdf else toc_end_pdf
    candidates = detect_lesson_start_candidates(reader, toc_start_pdf, end, expected_title=expected_title)
    best = max(candidates, key=lambda c: c["score"], default=None)
    review_reasons: List[str] = []

    if best is None:
        review_reasons.append("no_explicit_lesson_heading_found")
    elif best["pdfPage"] != toc_start_pdf:
        delta = best["pdfPage"] - toc_start_pdf
        if abs(delta) <= 2:
            review_reasons.append("toc_start_differs_from_content_heading")
        else:
            review_reasons.append("large_toc_content_start_mismatch")

    return {
        "tocStartPdf": toc_start_pdf,
        "contentStartPdf": best["pdfPage"] if best else None,
        "nextLessonStartPdf": next_lesson_start_pdf,
        "candidates": candidates,
        "status": "NEEDS_REVIEW" if review_reasons else "RECONCILED",
        "reviewReasons": review_reasons,
    }
