from edu7_content.pdf.page_mapping import PageMappingEngine


class FakePage:
    rect = type("Rect", (), {"height": 800.0})()


class FakeReader:
    page_count = 8
    doc = [FakePage() for _ in range(page_count)]

    def extract_page_blocks(self, index):
        if index < 5:
            return []
        printed = index - 4
        return [{"bbox": (250, 720, 300, 790), "text": str(printed), "fontSize": 10}]

    def get_page_size(self, index):
        return (600.0, 800.0)


def test_mapping_uses_dominant_offset_and_reports_consistency():
    mapper = PageMappingEngine(FakeReader())
    mapper.detect_mapping()
    assert mapper.detected_offset == 5
    assert mapper.offset_consistency == 1.0
    assert mapper.mapping_review_required is False
    assert mapper.get_pdf_page(1) == 6
