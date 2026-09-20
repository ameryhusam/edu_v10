import re
from typing import Dict, List, Optional, Tuple
from .reader import PdfReader

ARABIC_INDIC_DIGITS = "٠١٢٣٤٥٦٧٨٩"
WESTERN_DIGITS = "0123456789"
DIGIT_TRANS = str.maketrans(ARABIC_INDIC_DIGITS, WESTERN_DIGITS)

def to_western(text: str) -> str:
    return text.translate(DIGIT_TRANS)

class PageMappingEngine:
    """
    Maps printed page numbers in textbook headers/footers to actual PDF 1-based page indices.
    Offset = PDF_Page - Printed_Page
    """
    def __init__(self, reader: PdfReader):
        self.reader = reader
        self.mapping: Dict[int, int] = {}  # printed_page -> pdf_page (1-based)
        self.reverse_mapping: Dict[int, int] = {}  # pdf_page -> printed_page
        self.detected_offset: Optional[int] = None

    def detect_mapping(self, max_sample_pages: int = 40) -> Dict[int, int]:
        offsets = []
        limit = min(self.reader.page_count, max_sample_pages)

        # Inspect footer and header blocks of sample pages
        for pdf_idx in range(limit):
            pdf_page_1based = pdf_idx + 1
            blocks = self.reader.extract_page_blocks(pdf_idx)
            if not blocks:
                continue

            page_height = self.reader.doc[pdf_idx].rect.height

            # Look for numbers in bottom 15% (footer) or top 10% (header)
            candidate_numbers = []
            for b in blocks:
                y0, y1 = b["bbox"][1], b["bbox"][3]
                text = b["text"].strip()
                if y0 > page_height * 0.85 or y1 < page_height * 0.12:
                    clean_nums = re.findall(r'[0-9٠-٩]+', text)
                    for n in clean_nums:
                        val = int(to_western(n))
                        # Reasonable printed page range
                        if 1 <= val <= 500:
                            candidate_numbers.append(val)

            if candidate_numbers:
                # Pick the most isolated small number
                printed = candidate_numbers[0]
                offset = pdf_page_1based - printed
                offsets.append(offset)
                self.mapping[printed] = pdf_page_1based
                self.reverse_mapping[pdf_page_1based] = printed

        # Find median or dominant offset
        if offsets:
            from collections import Counter
            counts = Counter(offsets)
            self.detected_offset = counts.most_common(1)[0][0]
        else:
            self.detected_offset = 0

        return self.mapping

    def calibrate_from_pdf_page(self, printed_page: int, pdf_page: int) -> int:
        """Register an evidence-backed printed-to-physical mapping."""
        if printed_page < 1 or pdf_page < 1 or pdf_page > self.reader.page_count:
            raise ValueError("Printed/PDF page numbers are outside the document.")
        self.mapping[int(printed_page)] = int(pdf_page)
        self.reverse_mapping[int(pdf_page)] = int(printed_page)
        self.detected_offset = int(pdf_page) - int(printed_page)
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
