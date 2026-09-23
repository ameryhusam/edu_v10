"""
toc.py  — Table of Contents Extractor
======================================
Detects and parses the TOC from Arabic textbook PDFs.

TOC detection strategy:
  A page is a TOC page if it satisfies ALL of:
    1. Contains "المحتويات" or "محتويات" or "فهرس" (the title/header)
    2. Contains "الوحدة" or "الدرس" (structural keywords)
    3. Contains digits/Arabic-Indic digits (page numbers)

Parsing strategy:
  - Reads blocks sorted RTL (right column first, then left column)
  - Unit lines: match "الوحدة الأولى/الثانية/..." with optional title
  - Lesson lines: match "الدرس الأول/الثاني/..." + trailing page number
  - Dotted leaders (. . . . .) between title and page number are stripped
"""
import re
from typing import List, Dict, Any, Optional, Tuple
from ..comparison.normalizer import normalize_arabic

# ─── digit helpers ───────────────────────────────────────────────────────────
AR_INDIC = "٠١٢٣٤٥٦٧٨٩"
WESTERN  = "0123456789"
_DTRANS  = str.maketrans(AR_INDIC, WESTERN)

def _w(text: str) -> str:
    """Convert Arabic-Indic digits → Western digits."""
    return text.translate(_DTRANS)

def _find_page_num(text: str) -> Optional[int]:
    """
    Find the rightmost plausible page number (1-800) in a text line.
    Handles both Western and Arabic-Indic digits and dotted leaders.
    """
    nums = re.findall(r'[0-9٠-٩]+', text)
    # Prefer last number (page numbers are usually at the end/right)
    for n in reversed(nums):
        val = int(_w(n))
        if 1 <= val <= 800:
            return val
    return None


# ─── ordinal map (normalized form → integer) ────────────────────────────────
ORDINALS = {
    "الاول": 1,  "الاولي": 1,  "الاولى": 1,
    "الثاني": 2, "الثانيه": 2, "الثانيه": 2,
    "الثالث": 3, "الثالثه": 3,
    "الرابع": 4, "الرابعه": 4,
    "الخامس": 5, "الخامسه": 5,
    "السادس": 6, "السادسه": 6,
    "السابع": 7, "السابعه": 7,
    "الثامن": 8, "الثامنه": 8,
    "التاسع": 9, "التاسعه": 9,
    "العاشر": 10,"العاشره": 10,
}

# ─── TOC detection keywords ──────────────────────────────────────────────────
# Primary markers (must appear for page to be TOC)
TOC_TITLE_KW   = {"المحتويات", "محتويات", "الفهرس", "فهرس"}
# Secondary markers (at least one must also appear)
TOC_STRUCT_KW  = {"الوحده", "الدرس", "الوحدات", "الدروس", "الموضوع", "الموضوعات"}


# ─────────────────────────────────────────────────────────────────────────────
class TocExtractor:
    """
    Extracts unit/lesson hierarchy from Arabic textbook PDFs.

    Works on:
    - Text-layer PDFs (direct text extraction)
    - OCR-processed PDFs (via ArabicPdfExtractor)
    """

    def __init__(self, reader):
        """
        reader: PdfReader instance OR ArabicPdfExtractor instance.
        Both expose .doc, .page_count, .extract_page_text(), .extract_page_blocks()
        """
        self.reader = reader

    # ── Public API ───────────────────────────────────────────────────────────

    def find_toc_pages(self, max_search: int = 15) -> List[int]:
        """Find TOC pages using title/structure/number density and continuation."""
        limit = min(self.reader.page_count, max_search)
        candidates: List[int] = []

        def metrics(index: int) -> tuple[bool, bool, int, int]:
            norm = normalize_arabic(self.reader.extract_page_text(index))
            has_title = any(kw in norm for kw in TOC_TITLE_KW)
            structural = sum(norm.count(kw) for kw in TOC_STRUCT_KW)
            numbers = len(re.findall(r"[0-9٠-٩]+", norm))
            dotted = len(re.findall(r"\.{2,}|…{2,}|-{2,}", norm))
            return has_title, structural > 0, structural, numbers + dotted

        for i in range(limit):
            has_title, has_struct, struct_count, number_score = metrics(i)
            if has_title and has_struct and number_score >= 3:
                candidates.append(i)

        if not candidates:
            for i in range(limit):
                has_title, has_struct, struct_count, number_score = metrics(i)
                if has_struct and struct_count >= 3 and number_score >= 3:
                    candidates.append(i)

        # A TOC commonly spans consecutive pages and the continuation page
        # does not repeat "المحتويات". Extend only while structure + numbers
        # remain strong, avoiding accidental back-of-book index pages.
        if candidates:
            expanded = set(candidates)
            for start in list(candidates):
                page = start + 1
                while page < limit:
                    _, has_struct, struct_count, number_score = metrics(page)
                    if has_struct and struct_count >= 2 and number_score >= 3:
                        expanded.add(page)
                        page += 1
                    else:
                        break
            candidates = sorted(expanded)

        return candidates

    def extract_hierarchy(
        self,
        toc_pages: Optional[List[int]] = None
    ) -> List[Dict[str, Any]]:
        """
        Parse the TOC pages and return units with nested lessons.

        Return format:
        [
          {
            "id": "unit-01", "number": 1,
            "title": "الوحدة الأولى: ...",
            "lessons": [
              {"id": "lesson-01", "number": 1, "title": "...",
               "startPage": 12, "endPage": 25}
            ]
          }
        ]
        """
        if toc_pages is None:
            toc_pages = self.find_toc_pages()

        units: List[Dict[str, Any]] = []
        current_unit: Optional[Dict[str, Any]] = None

        for p_idx in toc_pages:
            lines = self._get_toc_lines(p_idx)
            for line_raw, line_norm in lines:
                # ── Unit line ────────────────────────────────────────────
                u_num, u_title = self._parse_unit_line(line_norm, line_raw)
                if u_num is not None:
                    current_unit = {
                        "id": f"unit-{u_num:02d}",
                        "number": u_num,
                        "title": u_title,
                        "lessons": []
                    }
                    units.append(current_unit)
                    continue

                # ── Lesson line ──────────────────────────────────────────
                l_entry = self._parse_lesson_line(line_norm, line_raw, current_unit, units)
                if l_entry:
                    if current_unit is None:
                        # Create implicit unit
                        current_unit = {
                            "id": f"unit-{len(units)+1:02d}",
                            "number": len(units) + 1,
                            "title": f"الوحدة {len(units)+1}",
                            "lessons": []
                        }
                        units.append(current_unit)
                    current_unit["lessons"].append(l_entry)

        self._fill_end_pages(units)
        return units

    # ── Private helpers ──────────────────────────────────────────────────────

    def _get_toc_lines(self, page_idx: int) -> List[Tuple[str, str]]:
        """
        Return (raw_line, norm_line) tuples from the page, sorted RTL.
        For two-column layouts, right column comes first.
        """
        blocks = self.reader.extract_page_blocks(page_idx)
        if not blocks:
            # Fallback: split full page text into lines
            raw_text = self.reader.extract_page_text(page_idx)
            lines = []
            for ln in raw_text.splitlines():
                ln = ln.strip()
                if ln:
                    lines.append((ln, normalize_arabic(ln)))
            return lines

        page = self.reader.doc[page_idx]
        mid_x = page.rect.width / 2.0

        right = sorted(
            [b for b in blocks if (b["bbox"][0] + b["bbox"][2]) / 2 >= mid_x - 30],
            key=lambda b: b["bbox"][1]
        )
        left = sorted(
            [b for b in blocks if (b["bbox"][0] + b["bbox"][2]) / 2 < mid_x - 30],
            key=lambda b: b["bbox"][1]
        )

        # Two-column layout: right column first (RTL reading order)
        ordered = (right + left) if (len(right) > 1 and len(left) > 1) else sorted(blocks, key=lambda b: b["bbox"][1])

        lines = []
        for b in ordered:
            for ln in b["text"].splitlines():
                ln = ln.strip()
                if ln:
                    lines.append((ln, normalize_arabic(ln)))
        return lines

    def _parse_unit_line(self, norm: str, raw: str) -> Tuple[Optional[int], str]:
        """
        Detect and parse a unit header line.
        Returns (unit_number, title) or (None, "").

        Matches patterns like:
          الوحدة الأولى: الخلية والكائن الحي     ٧
          الوحدة الأولى
          الوحده الثانيه
        """
        m = re.search(
            r'الوحده\s+'
            r'(الاول\w*|الثاني\w*|الثالث\w*|الرابع\w*|الخامس\w*'
            r'|السادس\w*|السابع\w*|الثامن\w*|التاسع\w*|العاشر\w*'
            r'|[0-9٠-٩]+)',
            norm
        )
        if not m:
            return None, ""

        raw_ord = m.group(1)
        # Get ordinal number
        u_num = None
        for key, val in ORDINALS.items():
            if raw_ord.startswith(key) or key.startswith(raw_ord):
                u_num = val
                break
        if u_num is None:
            digs = re.search(r'[0-9٠-٩]+', raw_ord)
            u_num = int(_w(digs.group())) if digs else len([]) + 1

        # Clean title: remove digits, dots, dashes from start/end
        title = re.sub(r'[0-9٠-٩\.\-–]+', '', raw).strip('. -–:\t')
        if not title:
            title = raw.strip()

        return u_num, title

    def _parse_lesson_line(
        self,
        norm: str,
        raw: str,
        current_unit: Optional[Dict],
        all_units: List[Dict]
    ) -> Optional[Dict[str, Any]]:
        """
        Detect and parse a lesson line.
        Returns lesson dict or None.

        Matches patterns like:
          الدرس الأول: العلاقات الغذائية      ١٢
          الدرس الثاني                         ٢٥
        Also handles lines with any page number (not just درس-prefixed).
        """
        # Find page number first (required)
        page_num = _find_page_num(raw)
        if page_num is None:
            return None

        # Skip pure header lines
        if any(kw in norm for kw in ("المحتويات", "محتويات", "الفهرس", "الموضوع", "الصفحه")):
            return None

        # Must be either a درس-labeled line OR contain Arabic text + page number
        is_lesson = re.search(r'الدرس\s+', norm) is not None
        has_arabic = sum(1 for ch in norm if '\u0600' <= ch <= '\u06FF') >= 4

        if not (is_lesson or has_arabic):
            return None

        # Determine lesson number
        l_num = len(current_unit["lessons"]) + 1 if current_unit else 1
        l_match = re.search(
            r'الدرس\s+(الاول\w*|الثاني\w*|الثالث\w*|الرابع\w*|الخامس\w*'
            r'|السادس\w*|السابع\w*|الثامن\w*|التاسع\w*|العاشر\w*|[0-9٠-٩]+)',
            norm
        )
        if l_match:
            raw_ord = l_match.group(1)
            for key, val in ORDINALS.items():
                if raw_ord.startswith(key):
                    l_num = val
                    break
            else:
                digs = re.search(r'[0-9٠-٩]+', raw_ord)
                if digs:
                    l_num = int(_w(digs.group()))

        # Clean lesson title
        title = re.sub(r'[0-9٠-٩]+', '', raw)        # remove all digits
        title = re.sub(r'\.{2,}', '', title)            # remove dotted leaders
        title = re.sub(r'\s{2,}', ' ', title)
        title = title.strip('. -–:\t')

        if len(title) < 2:
            title = f"الدرس {l_num}"

        return {
            "id": f"lesson-{l_num:02d}",
            "number": l_num,
            "title": title,
            "startPage": page_num,
            "endPage": page_num + 8  # placeholder
        }

    @staticmethod
    def _fill_end_pages(units: List[Dict[str, Any]]):
        """Compute endPage for each lesson based on next lesson's startPage."""
        all_lessons = [les for u in units for les in u["lessons"]]
        for idx, les in enumerate(all_lessons):
            if idx + 1 < len(all_lessons):
                les["endPage"] = max(les["startPage"], all_lessons[idx + 1]["startPage"] - 1)
            else:
                les["endPage"] = les["startPage"] + 12
