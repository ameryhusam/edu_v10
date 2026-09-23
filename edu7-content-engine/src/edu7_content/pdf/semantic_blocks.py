"""Deterministic semantic block extraction for textbook pages.

The engine preserves page identity while allowing one physical page to contain
multiple educational regions. It deliberately does not create canonical DB
entities; it emits evidence for Workspace review/import.
"""
from __future__ import annotations

import hashlib
import re
from typing import Any, Dict, List, Optional


LESSON_HEADING_RE = re.compile(
    r"^\s*(?:الدرس\s+(?:الأول|الاول|الثاني|الثانى|الثالث|الرابع|الخامس|"
    r"السادس|السابع|الثامن|التاسع|العاشر|[0-9٠-٩]+)|"
    r"(?:[0-9٠-٩]+\.[0-9٠-٩]+)\s+.+)$",
    re.IGNORECASE,
)
UNIT_HEADING_RE = re.compile(r"^\s*الوحد(?:ة|ه)\s+(?:الأول|الاول|الثاني|الثانى|الثالث|الرابع|الخامس|السادس|السابع|الثامن|التاسع|العاشر|[0-9٠-٩]+)", re.IGNORECASE)
UNIT_ASSESSMENT_RE = re.compile(r"^\s*تقويم\s+(?:الوحد(?:ة|ه)|الوحدات)", re.IGNORECASE)
LESSON_ASSESSMENT_RE = re.compile(r"^\s*(?:تقويم\s+الدرس|مراجعة\s+الدرس|تقويم)$", re.IGNORECASE)
SELF_TEST_RE = re.compile(r"^\s*(?:اختبر\s+نفسك|اختبر\s+نفسك:)", re.IGNORECASE)
ACTIVITY_RE = re.compile(r"^\s*(?:نشاط|بطاقة\s+تفكير|نشاط\s+منزلي|قضية\s+للبحث|اعمل\s+مع\s+زملائك)", re.IGNORECASE)
EXERCISE_RE = re.compile(r"^\s*(?:تدريبات|تمارين|التدريبات|التدريبات\s+اللغوية|تمارين\s+ومسائل)", re.IGNORECASE)
QUESTION_LEAD_RE = re.compile(
    r"^\s*(?:[٠-٩0-9]+\s*[.)-:]|[أ-ي]\s*[-:.)]|"
    r"(?:أجب|أكمل|اختر|صل|رتب|صح|خطأ|علل|اذكر|حدد|استخرج|قارن|ضع|"
    r"املأ|املئي|ضع\s+علامة))\b",
    re.IGNORECASE,
)
BRANCH_PATTERNS = (
    ("نحو", re.compile(r"\b(?:النحو|نحوية|التراكيب)\b", re.IGNORECASE)),
    ("إملاء", re.compile(r"\b(?:الإملاء|املاء|إملائية)\b", re.IGNORECASE)),
    ("قراءة", re.compile(r"\b(?:القراءة|قراءة)\b", re.IGNORECASE)),
    ("نصوص", re.compile(r"\b(?:نصوص|النص)\b", re.IGNORECASE)),
    ("تطبيقات", re.compile(r"\b(?:تطبيقات|تطبيق)\b", re.IGNORECASE)),
)


def _norm(text: str) -> str:
    value = (text or "").replace("\u0640", " ")
    value = re.sub(r"\s+", " ", value).strip()
    return value


def _sha(*parts: Any) -> str:
    raw = "|".join(str(p) for p in parts)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


def _font_stats(blocks: List[Dict[str, Any]]) -> tuple[float, float]:
    sizes = [float(b.get("fontSize", 0) or 0) for b in blocks if b.get("fontSize")]
    if not sizes:
        return 0.0, 0.0
    ordered = sorted(sizes)
    mid = ordered[len(ordered) // 2]
    return sum(sizes) / len(sizes), mid


def _position_evidence(block: Dict[str, Any], page_height: float) -> List[str]:
    bbox = block.get("bbox") or (0, 0, 0, 0)
    top = float(bbox[1])
    return ["top_of_page"] if page_height and top <= page_height * 0.25 else []


def classify_block(
    block: Dict[str, Any],
    *,
    page_height: float,
    median_font_size: float,
    toc_titles: Optional[List[str]] = None,
) -> Dict[str, Any]:
    text = _norm(block.get("text", ""))
    low = text.lower()
    bbox = list(block.get("bbox") or (0, 0, 0, 0))
    evidence: List[str] = []
    scores: Dict[str, float] = {}
    kind = "LESSON_BODY"

    if not text:
        return {"type": "OTHER", "text": "", "bbox": bbox, "confidence": 0.0, "evidence": []}

    def choose(name: str, score: float, *ev: str) -> None:
        nonlocal kind
        scores[name] = score
        if score > scores.get("_best", -1):
            scores["_best"] = score
            kind = name
            evidence.clear()
            evidence.extend(ev)

    if UNIT_ASSESSMENT_RE.search(text):
        choose("UNIT_ASSESSMENT", 0.98, "explicit_unit_assessment_heading")
    elif UNIT_HEADING_RE.search(text):
        choose("UNIT_START", 0.98, "explicit_unit_heading")
    elif LESSON_HEADING_RE.search(text):
        ev = ["explicit_lesson_heading"]
        if toc_titles and any(_norm(t) in text or text in _norm(t) for t in toc_titles):
            ev.append("toc_title_match")
        ev.extend(_position_evidence(block, page_height))
        score = 0.90 + (0.05 if "toc_title_match" in ev else 0)
        choose("LESSON_TITLE", min(score, 1.0), *ev)
    elif LESSON_ASSESSMENT_RE.search(text):
        choose("LESSON_ASSESSMENT", 0.94, "explicit_lesson_assessment_heading")
    elif SELF_TEST_RE.search(text):
        choose("SELF_TEST", 0.90, "explicit_self_test_heading")
    elif ACTIVITY_RE.search(text):
        choose("ACTIVITY", 0.90, "explicit_activity_heading")
    elif EXERCISE_RE.search(text):
        choose("EXERCISE", 0.88, "explicit_exercise_heading")
    elif QUESTION_LEAD_RE.search(text):
        choose("QUESTION_BLOCK", 0.86, "question_lead_pattern")
    else:
        font_size = float(block.get("fontSize", 0) or 0)
        if median_font_size and font_size >= median_font_size * 1.4:
            evidence.append("larger_font")
            scores["LESSON_BODY"] = 0.45
        if any(p.search(low) for _, p in BRANCH_PATTERNS):
            evidence.append("branch_keyword")

    if median_font_size and float(block.get("fontSize", 0) or 0) >= median_font_size * 1.4:
        if "larger_font" not in evidence:
            evidence.append("larger_font")
        if kind == "LESSON_BODY" and len(text) <= 140:
            kind = "HEADING_CANDIDATE"
            scores["_best"] = max(scores.get("_best", 0), 0.55)

    branch_hint = next((name for name, pattern in BRANCH_PATTERNS if pattern.search(text)), None)
    confidence = scores.get("_best", 0.45)
    if kind == "LESSON_BODY" and len(text) > 20:
        confidence = max(confidence, 0.55)

    return {
        "type": kind,
        "text": text,
        "bbox": bbox,
        "confidence": round(min(confidence, 1.0), 3),
        "evidence": evidence,
        "branchHint": branch_hint,
    }


def extract_page_semantic_blocks(
    reader: Any,
    pdf_page: int,
    *,
    printed_page: Optional[int] = None,
    toc_titles: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """Extract page regions using geometry first, text second."""
    blocks = reader.extract_page_blocks(pdf_page)
    page_width, page_height = reader.get_page_size(pdf_page)
    if not blocks:
        text = reader.extract_page_text(pdf_page)
        if not text.strip():
            return {
                "pdfPage": pdf_page + 1,
                "printedPage": printed_page,
                "classification": {"primaryType": "OTHER", "hasLesson": False, "hasQuestions": False, "hasActivity": False},
                "segments": [],
                "review": True,
                "reviewReasons": ["no_text_or_geometry"],
            }
        blocks = [{"bbox": (0, 0, page_width, page_height), "text": text, "fontSize": 0, "block_no": 0}]

    for b in blocks:
        # PyMuPDF block tuples do not expose font size; recover it from spans
        # when possible without making layout dependent on a specific backend.
        if "fontSize" not in b:
            b["fontSize"] = 0.0

    _, median = _font_stats(blocks)
    ordered = sorted(blocks, key=lambda b: (float((b.get("bbox") or (0, 0, 0, 0))[1]), float((b.get("bbox") or (0, 0, 0, 0))[0])))
    segments: List[Dict[str, Any]] = []

    for ordinal, block in enumerate(ordered):
        item = classify_block(block, page_height=page_height, median_font_size=median, toc_titles=toc_titles)
        if not item["text"]:
            continue
        item.update({
            "segmentId": _sha(pdf_page + 1, printed_page, ordinal, item["text"][:120]),
            "ordinal": ordinal,
            "pdfPage": pdf_page + 1,
            "printedPage": printed_page,
            "pageWidth": page_width,
            "pageHeight": page_height,
        })
        segments.append(item)

    has_questions = any(s["type"] in {"QUESTION_BLOCK", "LESSON_ASSESSMENT", "UNIT_ASSESSMENT", "SELF_TEST", "EXERCISE"} for s in segments)
    has_activity = any(s["type"] == "ACTIVITY" for s in segments)
    has_lesson = any(s["type"] in {"LESSON_TITLE", "LESSON_BODY", "HEADING_CANDIDATE"} for s in segments)
    types = [s["type"] for s in segments]
    primary = "MIXED" if len(set(types)) > 1 else (types[0] if types else "OTHER")

    review_reasons: List[str] = []
    if has_lesson and has_questions:
        review_reasons.append("mixed_lesson_and_question_regions")
    if any(s["confidence"] < 0.60 for s in segments):
        review_reasons.append("low_confidence_segment")
    if not segments:
        review_reasons.append("no_segments")

    return {
        "pdfPage": pdf_page + 1,
        "printedPage": printed_page,
        "classification": {
            "primaryType": primary,
            "hasLesson": has_lesson,
            "hasQuestions": has_questions,
            "hasActivity": has_activity,
            "includeInLessonView": has_lesson,
            "includeInQuestionExtraction": has_questions,
        },
        "segments": segments,
        "review": bool(review_reasons),
        "reviewReasons": review_reasons,
    }
