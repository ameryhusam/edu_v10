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
    assert result["confidence"] == "HIGH"
    assert result["boundaryPdfPage"] == 16
    assert result["part1"] == {"startPdfPage": 1, "endPdfPage": 15}
    assert result["part2"] == {"startPdfPage": 12, "endPdfPage": len(texts)}


def test_combined_pdf_does_not_split_on_part_two_toc_mention_only():
    texts = [
        "الجزء الأول",
        "فهرس: الجزء الثاني",
    ] + ["محتوى الجزء الأول"] * 8

    result = detect_combined_part_boundary(FakeReader(texts), analysis_pages=15)

    assert result["status"] == "REVIEW"
    assert result["boundaryPdfPage"] is None


def test_single_part_without_both_markers_requires_review():
    texts = ["الجزء الأول"] + ["محتوى"] * 20

    result = detect_combined_part_boundary(FakeReader(texts), analysis_pages=15)

    assert result["status"] == "REVIEW"
    assert result["boundaryPdfPage"] is None
