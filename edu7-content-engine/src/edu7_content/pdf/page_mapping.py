import re
from collections import Counter
from typing import Dict, List, Optional
from .reader import PdfReader

ARABIC_INDIC_DIGITS = "٠١٢٣٤٥٦٧٨٩"
WESTERN_DIGITS = "0123456789"
DIGIT_TRANS = str.maketrans(ARABIC_INDIC_DIGITS, WESTERN_DIGITS)

def to_western(text: str) -> str:
    return text.translate(DIGIT_TRANS)

class PageMappingEngine:
    """Evidence-backed printed-page -> physical PDF-page mapping."""

    def __init__(self, reader: PdfReader):
        self.reader = reader
        self.mapping: Dict[int, int] = {}
        self.reverse_mapping: Dict[int, int] = {}
        self.detected_offset: Optional[int] = None
        self.offset_consistency: float = 0.0
        self.offset_observations: List[Dict[str, int]] = []
        self.mapping_review_required: bool = False

    def detect_mapping(self, max_sample_pages: int = 40) -> Dict[int, int]:
        offsets: List[int] = []
        limit = min(self.reader.page_count, max_sample_pages)

        for pdf_idx in range(limit):
            pdf_page = pdf_idx + 1
            blocks = self.reader.extract_page_blocks(pdf_idx)
            if not blocks:
                continue
            _, page_height = self.reader.get_page_size(pdf_idx)
            candidates: List[int] = []

            for block in blocks:
                y0, y1 = block["bbox"][1], block["bbox"][3]
                if y0 <= page_height * 0.85 and y1 >= page_height * 0.12:
                    continue
                for raw in re.findall(r"[0-9٠-٩]+", block["text"].strip()):
                    value = int(to_western(raw))
                    if 1 <= value <= 500:
                        candidates.append(value)

            if not candidates:
                continue

            # Textbooks normally have a small front-matter offset. Select the
            # candidate closest to the physical page index to avoid year/grade
            # numbers being mistaken for the printed page number.
            printed = min(candidates, key=lambda value: abs(pdf_page - value))
            offset = pdf_page - printed
            offsets.append(offset)
            self.offset_observations.append(
                {"pdfPage": pdf_page, "printedPage": printed, "offset": offset}
            )
            self.mapping[printed] = pdf_page
            self.reverse_mapping[pdf_page] = printed

        if offsets:
            counts = Counter(offsets)
            self.detected_offset = counts.most_common(1)[0][0]
            self.offset_consistency = counts[self.detected_offset] / len(offsets)
            self.mapping_review_required = self.offset_consistency < 0.75
        else:
            self.detected_offset = 0
            self.offset_consistency = 0.0
            self.mapping_review_required = True

        return self.mapping

    def calibrate_from_pdf_page(self, printed_page: int, pdf_page: int) -> int:
        if printed_page < 1 or pdf_page < 1 or pdf_page > self.reader.page_count:
            raise ValueError("Printed/PDF page numbers are outside the document.")
        self.mapping[int(printed_page)] = int(pdf_page)
        self.reverse_mapping[int(pdf_page)] = int(printed_page)
        self.detected_offset = int(pdf_page) - int(printed_page)
        self.offset_observations.append(
            {"pdfPage": int(pdf_page), "printedPage": int(printed_page), "offset": self.detected_offset}
        )
        self.offset_consistency = 1.0
        self.mapping_review_required = False
        return self.detected_offset

    def get_pdf_page(self, printed_page: int) -> int:
        if printed_page in self.mapping:
            return self.mapping[printed_page]
        if self.detected_offset is not None:
            return printed_page + self.detected_offset
        return printed_page

    def get_printed_page(self, pdf_page: int) -> int:
        if pdf_page in self.reverse_mapping:
            return self.reverse_mapping[pdf_page]
        if self.detected_offset is not None:
            return max(1, pdf_page - self.detected_offset)
        return pdf_page
