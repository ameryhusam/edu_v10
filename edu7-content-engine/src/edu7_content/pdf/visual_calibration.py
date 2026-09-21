"""Evidence-backed visual calibration for scanned textbook page numbering."""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from ..ai.gemini import GeminiFreeProvider


def calibrate_first_lesson(
    reader: Any,
    units: List[Dict[str, Any]],
    mapper: Any,
    model_name: Optional[str],
    dpi: int = 150,
    radius: int = 6,
) -> Optional[int]:
    """Verify the first lesson's physical PDF page with one Gemini Vision call."""
    lesson = next((
        lesson
        for unit in units
        for lesson in unit.get("lessons", [])
        if lesson.get("startPage") is not None and lesson.get("title")
    ), None)
    if not lesson:
        return None

    provider = GeminiFreeProvider(
        api_key=None,
        model_name=model_name if model_name and model_name.startswith("gemini") else None,
    )
    printed = int(lesson["startPage"])
    estimated = max(1, mapper.get_pdf_page(printed))
    candidates: List[Dict[str, Any]] = []
    for pdf_page in range(
        max(1, estimated - radius),
        min(reader.page_count, estimated + radius) + 1,
    ):
        image = reader.render_page_to_b64(pdf_page - 1, dpi=dpi)
        if image:
            candidates.append({"pdfPage": pdf_page, "image": image})
    if not candidates:
        return None

    parts = [{
        "text": (
            "حدد الصفحة الفيزيائية التي يبدأ فيها الدرس التالي اعتماداً على الصور. "
            f"عنوان الدرس: {lesson['title']}؛ الصفحة المطبوعة في الفهرس: {printed}. "
            "لكل صورة قيمة PDF_PAGE. ابحث عن بداية الدرس وليس مجرد ذكر العنوان. "
            "أرجع JSON فقط بالشكل "
            "{\"pdfPage\":123,\"confidence\":0.0}. "
            "إذا لم يمكن تحديد البداية بثقة أرجع "
            "{\"pdfPage\":null,\"confidence\":0}. لا تخمن."
        )
    }]
    for item in candidates:
        parts.append({"text": f"PDF_PAGE={item['pdfPage']}"})
        parts.append({"inlineData": {"mimeType": "image/png", "data": item["image"]}})

    payload = {
        "contents": [{"parts": parts}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "temperature": 0.0,
            "maxOutputTokens": 256,
        },
    }
    response = provider._call_api(payload, timeout=120)
    raw = provider._extract_text(response).strip()
    if raw.startswith(chr(96) * 3):
        raw = raw.split("\n", 1)[1].rsplit(chr(96) * 3, 1)[0]
    import json
    data = json.loads(raw)
    confidence = float(data.get("confidence", 0.0))
    pdf_page = data.get("pdfPage")
    if pdf_page is None or confidence < 0.70:
        return None
    allowed = {item["pdfPage"] for item in candidates}
    return int(pdf_page) if int(pdf_page) in allowed else None
