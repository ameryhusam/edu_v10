from edu7_content.pdf.question_extraction import extract_question_blocks, group_cross_page_questions
from edu7_content.pdf.semantic_blocks import extract_page_semantic_blocks


class FakeReader:
    page_count = 3

    def extract_page_blocks(self, index):
        return [
            {"bbox": (10, 10, 500, 50), "text": "الدرس الأول: الجزء والذرة", "fontSize": 20},
            {"bbox": (10, 80, 500, 140), "text": "شرح مفهوم الذرة والعنصر.", "fontSize": 12},
            {"bbox": (10, 300, 500, 340), "text": "١- أجب عن السؤال الآتي", "fontSize": 12},
            {"bbox": (10, 350, 500, 390), "text": "٢- أكمل الفراغ", "fontSize": 12},
        ]

    def extract_page_text(self, index):
        return "الدرس الأول"

    def get_page_size(self, index):
        return (600.0, 800.0)


def test_mixed_page_preserves_semantic_segments():
    result = extract_page_semantic_blocks(FakeReader(), 0, printed_page=8)
    assert result["classification"]["primaryType"] == "MIXED"
    assert result["classification"]["hasLesson"] is True
    assert result["classification"]["hasQuestions"] is True
    assert len(result["segments"]) >= 3


def test_question_blocks_have_bbox_and_type():
    page = extract_page_semantic_blocks(FakeReader(), 0, printed_page=8)
    questions = extract_question_blocks(page)
    assert len(questions) >= 2
    assert questions[0]["bbox"]
    assert questions[0]["type"] in {"SHORT_ANSWER", "OPEN"}


def test_cross_page_question_groups_link_sequential_numbers():
    reader = FakeReader()
    first = extract_page_semantic_blocks(reader, 0, printed_page=42)
    second = extract_page_semantic_blocks(reader, 1, printed_page=43)
    groups = group_cross_page_questions([first, second])
    assert any(group["crossPage"] for group in groups)
