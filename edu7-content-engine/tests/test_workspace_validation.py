from types import SimpleNamespace

import pytest

from edu7_content.pdf.workspace_validation import validate_segmentation_input


def page_mapper(offset=0):
    return SimpleNamespace(get_pdf_page=lambda printed: printed + offset)


def units():
    return [
        {
            "number": 1,
            "title": "الوحدة الأولى",
            "lessons": [
                {"number": 1, "title": "الدرس الأول", "startPage": 1, "endPage": 2},
                {"number": 2, "title": "الدرس الثاني", "startPage": 3, "endPage": 4},
            ],
        }
    ]


def base_kwargs(data):
    return {
        "units": data,
        "subject": "SCI",
        "grade": "G07",
        "part": "PART_1",
        "edition": "2026",
        "page_count": 4,
        "page_mapper": page_mapper(),
    }


def test_accepts_complete_workspace_input():
    validate_segmentation_input(**base_kwargs(units()))


def test_rejects_empty_unit():
    data = units()
    data[0]["lessons"] = []
    with pytest.raises(ValueError, match="at least one lesson"):
        validate_segmentation_input(**base_kwargs(data))


def test_rejects_reversed_page_range():
    data = units()
    data[0]["lessons"][0]["startPage"] = 3
    data[0]["lessons"][0]["endPage"] = 2
    with pytest.raises(ValueError, match="startPage after endPage"):
        validate_segmentation_input(**base_kwargs(data))


def test_rejects_duplicate_pdf_mapping():
    data = units()
    data[0]["lessons"][1]["startPage"] = 2
    data[0]["lessons"][1]["endPage"] = 3
    with pytest.raises(ValueError, match="mapped more than once"):
        validate_segmentation_input(**base_kwargs(data))


def test_rejects_out_of_document_mapping():
    data = units()
    with pytest.raises(ValueError, match="outside 1..3"):
        validate_segmentation_input(**{**base_kwargs(data), "page_count": 3})


def test_rejects_duplicate_unit_number():
    data = units()
    data.append({
        "number": 1,
        "title": "الوحدة الثانية",
        "lessons": [{"number": 1, "title": "درس", "startPage": 5, "endPage": 5}],
    })
    with pytest.raises(ValueError, match="Duplicate unit number"):
        validate_segmentation_input(**{**base_kwargs(data), "page_count": 5})


def test_rejects_duplicate_lesson_number():
    data = units()
    data[0]["lessons"].append(
        {"number": 2, "title": "درس مكرر", "startPage": 5, "endPage": 5}
    )
    with pytest.raises(ValueError, match="Duplicate lesson number"):
        validate_segmentation_input(**{**base_kwargs(data), "page_count": 5})
