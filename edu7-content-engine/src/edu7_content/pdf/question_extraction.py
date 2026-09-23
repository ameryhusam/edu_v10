"""Question-block extraction from semantic page regions.

Questions remain source evidence in Workspace; this module does not create
canonical Question rows and never writes the database.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List

NUMBER_RE = re.compile(r"^\s*([٠-٩0-9]+)\s*[.)\-:]")
LETTER_RE = re.compile(r"^\s*([أ-ي])\s*[-:.)]")
TYPE_PATTERNS = (
    ("FILL_BLANK", re.compile(r"\b(?:أكمل|املأ|املئي|الفراغ|الفراغات)\b", re.I)),
    ("MATCHING", re.compile(r"\b(?:صل|صِل|طابق|صل بين)\b", re.I)),
    ("MCQ", re.compile(r"\b(?:اختر|اختاري|اختر الإجابة)\b", re.I)),
    ("TRUE_FALSE", re.compile(r"\b(?:صح|خطأ|صواب|خطأ)\b", re.I)),
    ("ORDERING", re.compile(r"\b(?:رتب|رتبي|رتب تصاعديا|رتب تنازليا)\b", re.I)),
    ("SHORT_ANSWER", re.compile(r"\b(?:أجب|اذكر|علل|حدد|استخرج|قارن|اكتب|احسب)\b", re.I)),
)


def _number(text: str) -> tuple[str | None, int | None]:
    m = NUMBER_RE.match(text or "")
    if m:
        raw = m.group(1)
        trans = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")
        return raw, int(raw.translate(trans))
    m = LETTER_RE.match(text or "")
    return (m.group(1), None) if m else (None, None)


def classify_question_type(text: str) -> str:
    for name, pattern in TYPE_PATTERNS:
        if pattern.search(text or ""):
            return name
    return "OPEN"


def extract_question_blocks(page_analysis: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Convert semantic QUESTION/assessment regions into question evidence."""
    out: List[Dict[str, Any]] = []
    for segment in page_analysis.get("segments", []):
        if segment.get("type") not in {
            "QUESTION_BLOCK", "LESSON_ASSESSMENT", "UNIT_ASSESSMENT",
            "SELF_TEST", "EXERCISE",
        }:
            continue
        text = segment.get("text", "").strip()
        label, numeric = _number(text)
        out.append({
            "questionBlockId": segment["segmentId"],
            "pageSegmentId": segment["segmentId"],
            "pdfPage": segment.get("pdfPage"),
            "printedPage": segment.get("printedPage"),
            "bbox": segment.get("bbox"),
            "text": text,
            "number": numeric,
            "label": label,
            "type": classify_question_type(text),
            "role": {
                "UNIT_ASSESSMENT": "UNIT_ASSESSMENT",
                "LESSON_ASSESSMENT": "LESSON_ASSESSMENT",
                "SELF_TEST": "SELF_ASSESSMENT",
                "EXERCISE": "EXERCISE",
            }.get(segment.get("type"), "QUESTION"),
            "confidence": segment.get("confidence", 0.0),
            "evidence": segment.get("evidence", []),
        })
    return out


def group_cross_page_questions(
    pages: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """Link adjacent page blocks when numbering/continuity supports it."""
    groups: List[Dict[str, Any]] = []
    previous: Dict[str, Any] | None = None

    for page in sorted(pages, key=lambda p: int(p.get("pdfPage", 0) or 0)):
        blocks = extract_question_blocks(page)
        for block in blocks:
            num = block.get("number")
            can_continue = False
            if previous and num is not None and previous.get("number") is not None:
                can_continue = num == previous["number"] + 1
            if previous and can_continue and previous.get("printedPage") != block.get("printedPage"):
                group = next((g for g in groups if g["id"] == previous["groupId"]), None)
                if group:
                    group["blocks"].append(block["questionBlockId"])
                    group["endPage"] = block.get("printedPage")
                    group["crossPage"] = True
                block["groupId"] = previous["groupId"]
            else:
                group_id = f"qg-{block['questionBlockId']}"
                block["groupId"] = group_id
                groups.append({
                    "id": group_id,
                    "startPage": block.get("printedPage"),
                    "endPage": block.get("printedPage"),
                    "blocks": [block["questionBlockId"]],
                    "crossPage": False,
                })
            previous = block

    return groups
