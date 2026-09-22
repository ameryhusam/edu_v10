"""Gemini-only multimodal TOC extraction.

PDF reading/rendering is deterministic preprocessing. Generative interpretation
is delegated to the single ContentAIService.
"""
import re
from typing import List, Optional, Dict, Any


PART_1_PATTERNS = [
    r"الجزء\s+الأول",
    r"الجزء\s+الاول",
    r"الجزء\s+١",
]

PART_2_PATTERNS = [
    r"الجزء\s+الثاني",
    r"الجزء\s+الثانى",
    r"الجزء\s+٢",
]

TOC_PATTERNS = [
    r"فهرس",
    r"الفهرس",
    r"المحتويات",
    r"محتويات",
    r"الموضوعات",
    r"الوحدات",
    r"الدروس",
]


def _contains_any(text: str, patterns: list[str]) -> bool:
    return any(re.search(pattern, text, flags=re.IGNORECASE) for pattern in patterns)


def _first_ten_page_text(reader) -> list[dict[str, Any]]:
    pages = []

    for index in range(min(10, reader.page_count)):
        text = reader.extract_page_text(index) or ""
        pages.append({
            "pdfPage": index + 1,
            "text": text,
        })

    return pages


def _deterministic_part_evidence(page_texts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    evidence = []

    has_part_1 = False
    has_part_2 = False

    for page in page_texts:
        text = page["text"]

        if _contains_any(text, PART_1_PATTERNS):
            has_part_1 = True
            evidence.append({
                "pdfPage": page["pdfPage"],
                "field": "part",
                "value": "PART_1",
                "text": text[:1000],
            })

        if _contains_any(text, PART_2_PATTERNS):
            has_part_2 = True
            evidence.append({
                "pdfPage": page["pdfPage"],
                "field": "part",
                "value": "PART_2",
                "text": text[:1000],
            })

    if has_part_1 and has_part_2:
        return [
            *evidence,
            {
                "field": "part",
                "value": "BOTH",
                "reason": "Both explicit part markers were detected in the first ten pages.",
            },
        ]

    return evidence


def _deterministic_toc_evidence(page_texts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    evidence = []

    for page in page_texts:
        text = page["text"]

        if _contains_any(text, TOC_PATTERNS):
            evidence.append({
                "pdfPage": page["pdfPage"],
                "field": "toc",
                "text": text[:2000],
            })

    return evidence


def extract_book_front_matter(
    reader,
    model_name=None,
    use_gemini=True,
    max_pages=10,
    dpi=150,
):
    """
    Extract physical textbook identity evidence and TOC evidence.

    Deterministic extraction is performed first.
    Gemini receives the same first-ten-page evidence for semantic validation.

    AI never becomes the canonical source of truth.
    """

    max_pages = min(max(1, max_pages), 10)

    page_texts = _first_ten_page_text(reader)

    part_evidence = _deterministic_part_evidence(page_texts)
    toc_evidence = _deterministic_toc_evidence(page_texts)

    identity = {
        "title": None,
        "subjectKey": None,
        "gradeKey": None,
        "part": None,
        "termOrdinal": None,
        "edition": None,
        "printingYear": None,
        "publicationYear": None,
        "issuer": None,
    }

    # Conservative deterministic part resolution.
    part_values = {
        item.get("value")
        for item in part_evidence
        if item.get("field") == "part"
        and item.get("value") in {"PART_1", "PART_2"}
    }

    if {"PART_1", "PART_2"}.issubset(part_values):
        identity["part"] = "BOTH"
    elif "PART_1" in part_values:
        identity["part"] = "PART_1"
    elif "PART_2" in part_values:
        identity["part"] = "PART_2"

    ai_result = None

    if use_gemini:
        try:
            from ..ai.content_service import ContentAIService

            images = render_pages_to_b64(
                reader,
                max_pages=max_pages,
                dpi=dpi,
            )

            service = ContentAIService(
                model_name=(
                    model_name
                    if model_name and str(model_name).startswith("gemini")
                    else None
                )
            )

            if service.provider.client.api_keys:
                ai_result = service.extract_book_front_matter(
                    page_texts=page_texts,
                    images_b64=images,
                )

        except Exception as err:
            print(f"[!] Unified front-matter AI validation unavailable: {err}")

    if isinstance(ai_result, dict):
        ai_identity = ai_result.get("identity") or {}

        for field in identity:
            value = ai_identity.get(field)

            if value is not None and value != "":
                identity[field] = value

    return {
        "identity": identity,
        "toc": {
            "found": bool(toc_evidence),
            "evidence": toc_evidence,
        },
        "evidence": [
            *part_evidence,
            *toc_evidence,
        ],
        "aiValidation": ai_result,
        "pagesAnalyzed": len(page_texts),
        "maxPages": 10,
    }

def is_image_based_pdf(reader, sample_pages: int = 8) -> bool:
    limit = min(sample_pages, reader.page_count)
    arabic_chars = 0
    pages_with_images = 0
    for i in range(limit):
        t = reader.extract_page_text(i)
        arabic_chars += sum(1 for ch in t if "\u0600" <= ch <= "\u06FF")
        try:
            if reader.backend == "pymupdf":
                if reader.doc[i].get_images(full=True):
                    pages_with_images += 1
            elif hasattr(reader.doc.pages[i], "images") and reader.doc.pages[i].images:
                pages_with_images += 1
        except Exception:
            pass
    if not limit:
        return False
    return pages_with_images / limit >= 0.75 or arabic_chars < 50

def render_pages_to_b64(reader, max_pages: int = 10, dpi: int = 150) -> List[str]:
    images = []
    for i in range(min(max_pages, reader.page_count)):
        b64 = reader.render_page_to_b64(i, dpi=dpi)
        if b64:
            images.append(b64)
            print(f"    [+] Rendered page {i + 1} ({len(b64) // 1024} KB)")
    return images

def render_page_to_b64(reader, page_idx: int, dpi: int = 150) -> Optional[str]:
    return reader.render_page_to_b64(page_idx, dpi=dpi) if hasattr(reader, "render_page_to_b64") else None

def extract_edition_from_cover(reader, model_name=None, use_gemini=True, dpi=150) -> Optional[str]:
    """Compatibility wrapper around the ten-page front-matter extractor."""
    result = extract_book_front_matter(
        reader,
        model_name=model_name,
        use_gemini=use_gemini,
        max_pages=10,
        dpi=dpi,
    )
    value = (result.get("identity") or {}).get("edition")
    return str(value).strip() if value else None


def extract_toc_via_vision(reader, max_pages=10, dpi=150, api_key=None,
                           model_name=None, use_ollama=False,
                           use_gemini=True, force_vision=False) -> List[Dict[str, Any]]:
    """Extract the TOC with Gemini by default; Ollama remains an explicit opt-in adapter."""
    print(f"[*] Preparing first {max_pages} pages for Gemini TOC analysis (DPI={dpi})...")
    images_b64 = render_pages_to_b64(reader, max_pages=max_pages, dpi=dpi)
    page_texts = [{"pdfPage": i + 1, "text": reader.extract_page_text(i)}
                  for i in range(min(max_pages, reader.page_count))]
    if force_vision and not images_b64:
        print("[!] Visual extraction requested but no page renderer is available.")
        return []
    if not images_b64 and not any(p["text"].strip() for p in page_texts):
        print("[!] No usable text or rendered page images are available.")
        return []
    if use_ollama:
        try:
            from ..ai.ollama_vision import extract_toc_via_ollama
            result = extract_toc_via_ollama(reader, max_pages=max_pages, dpi=dpi, model_name=model_name)
            if result:
                return result
        except Exception as err:
            print(f"[!] Ollama TOC extraction unavailable: {err}")
        if not use_gemini:
            return []

    if not use_gemini:
        return []

    from ..ai.content_service import ContentAIService
    try:
        service = ContentAIService(model_name=model_name if model_name and model_name.startswith("gemini") else None)
        if not service.provider.client.api_keys:
            print("[!] Gemini skipped: GEMINI_API_KEYS/GEMINI_API_KEY is not configured.")
            return []
        schema = {"type":"object","properties":{"units":{"type":"array","items":{"type":"object",
            "properties":{"number":{"type":"integer"},"title":{"type":"string"},"startPage":{"type":"integer"},
            "lessons":{"type":"array","items":{"type":"object","properties":{
                "number":{"type":"integer"},"title":{"type":"string"},"startPage":{"type":"integer"}},
                "required":["number","title","startPage"]}}},
            "required":["number","title","startPage","lessons"]}}},
            "required":["units"]}
        prompt = ("أنت خبير في فهارس الكتب المدرسية العربية. حلل الصفحات المرفقة وابحث عن "
                  "فهرس المحتويات. استخرج كل الوحدات والدروس وأرقام الصفحات المطبوعة فقط. "
                  "إذا لم يظهر فهرس موثوق أرجع units فارغة. لا تخمن. أرجع JSON فقط.")
        if images_b64:
            result = service.request("TOC_VISION", prompt, schema, images_b64=images_b64, timeout=240)
        else:
            source = "\n\n".join(f"--- PDF page {p['pdfPage']} ---\n{p['text']}"
                                  for p in page_texts if p["text"].strip())
            result = service.request("TOC_TEXT", prompt + "\n" + source, schema, timeout=180)
        units = result.get("units", [])
        for unit in units:
            for lesson in unit.get("lessons", []):
                lesson["endPage"] = lesson["startPage"]
        print(f"[+] Gemini TOC: {len(units)} units, {sum(len(u.get('lessons', [])) for u in units)} lessons.")
        return units
    except Exception as err:
        print(f"[!] Gemini TOC extraction failed: {err}")
        return []
