from edu7_content.pdf.part_detection import detect_combined_part_boundary


class FakeReader:
    def __init__(self, texts):
        self.texts = texts
        self.page_count = len(texts)

    def extract_page_text(self, index):
        return self.texts[index]


def test_combined_pdf_uses_structural_part_two_marker_after_front_matter():
    texts = [
        "الغلاف\nالجزء الأول\nفهرس المحتويات: الجزء الثاني يبدأ لاحقاً",
        "المحتويات",
    ] + ["محتوى الجزء الأول"] * 13 + [
        "الجزء الثاني",
        "الوحدة الأولى",
    ] + ["محتوى الجزء الثاني"] * 5

    result = detect_combined_part_boundary(FakeReader(texts), analysis_pages=15)

    assert result["status"] == "DETECTED"
    assert result["detectedPart"] == "BOTH"
    assert result["confidence"] == "HIGH"
    assert result["boundaryPdfPage"] == 16
    assert result["part1"] == {"startPdfPage": 1, "endPdfPage": 15}
    assert result["part2"] == {"startPdfPage": 16, "endPdfPage": len(texts)}


def test_semester_one_on_cover_identifies_part_one():
    texts = [
        "كتاب العلوم\nالفصل الدراسي الأول",
        "المحتويات",
    ] + ["محتوى"] * 10

    result = detect_combined_part_boundary(FakeReader(texts), analysis_pages=15)

    assert result["status"] == "IDENTIFIED"
    assert result["detectedPart"] == "PART_1"
    assert result["confidence"] == "HIGH"


def test_semester_two_on_cover_identifies_part_two():
    texts = [
        "كتاب العلوم\nالفصل الدراسي الثاني",
        "المحتويات",
    ] + ["محتوى"] * 10

    result = detect_combined_part_boundary(FakeReader(texts), analysis_pages=15)

    assert result["status"] == "IDENTIFIED"
    assert result["detectedPart"] == "PART_2"
    assert result["confidence"] == "HIGH"


def test_toc_with_both_semesters_marks_source_as_both_but_requires_boundary():
    texts = [
        "الغلاف",
        "المحتويات",
        "الفصل الدراسي الأول: الوحدات 1-4",
        "الفصل الدراسي الثاني: الوحدات 5-8",
    ] + ["محتوى"] * 20

    result = detect_combined_part_boundary(FakeReader(texts), analysis_pages=15)

    assert result["status"] == "REVIEW"
    assert result["detectedPart"] == "BOTH"
    assert result["boundaryPdfPage"] is None


def test_absence_of_part_terms_in_first_five_is_a_both_indicator():
    texts = [
        "الغلاف",
        "وزارة التربية والتعليم",
        "الكتاب المدرسي",
        "الصف السابع",
        "المحتويات",
    ] + ["محتوى"] * 20

    result = detect_combined_part_boundary(FakeReader(texts), analysis_pages=15)

    assert result["bothIndicator"] is True
    assert result["detectedPart"] == "UNKNOWN"
    assert result["status"] == "REVIEW"


def test_combined_pdf_does_not_split_on_part_two_toc_mention_only():
    texts = [
        "الجزء الأول",
        "فهرس: الجزء الثاني",
    ] + ["محتوى الجزء الأول"] * 8

    result = detect_combined_part_boundary(FakeReader(texts), analysis_pages=15)

    assert result["status"] == "IDENTIFIED"
    assert result["detectedPart"] == "PART_1"
    assert result["boundaryPdfPage"] is None


def test_single_part_without_both_markers_requires_review():
    texts = ["غلاف الكتاب"] + ["محتوى"] * 20

    result = detect_combined_part_boundary(FakeReader(texts), analysis_pages=15)

    assert result["status"] == "REVIEW"
    assert result["detectedPart"] == "UNKNOWN"
    assert result["boundaryPdfPage"] is None


def test_both_cannot_become_workspace_identity():
    import pytest
    from edu7_content.workspace_layout import book_workspace, textbook_key

    with pytest.raises(ValueError):
        textbook_key("SCI", 7, "BOTH", "2026")
    with pytest.raises(ValueError):
        book_workspace("SCI", 7, "BOTH", "2026")
