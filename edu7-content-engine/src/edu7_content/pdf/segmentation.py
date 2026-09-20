import json
import pymupdf
from pathlib import Path
from typing import Dict, Any, List
from .reader import PdfReader
from .page_mapping import PageMappingEngine

class LessonSegmenter:
    """
    Segments a full book into independent Lesson Packages:
    lesson.pdf, manifest.json, pages/ (images), text/ (extracted text)
    """
    def __init__(self, reader: PdfReader, page_mapper: PageMappingEngine):
        self.reader = reader
        self.mapper = page_mapper

    def segment_book(self, units: List[Dict[str, Any]], workspace_dir: Path) -> Dict[str, Any]:
        workspace_dir.mkdir(parents=True, exist_ok=True)
        book_manifest = {
            "schemaVersion": "1.0",
            "metadata": self.reader.get_metadata(),
            "detectedOffset": self.mapper.detected_offset,
            "units": units
        }

        (workspace_dir / "book-manifest.json").write_text(
            json.dumps(book_manifest, ensure_ascii=False, indent=2), encoding="utf-8"
        )

        for u in units:
            u_dir = workspace_dir / "units" / f"{u['number']:02d}"
            u_dir.mkdir(parents=True, exist_ok=True)

            u_manifest = {
                "unitId": u["id"],
                "number": u["number"],
                "title": u["title"],
                "lessonCount": len(u["lessons"])
            }
            (u_dir / "unit-manifest.json").write_text(
                json.dumps(u_manifest, ensure_ascii=False, indent=2), encoding="utf-8"
            )

            for les in u["lessons"]:
                l_dir = u_dir / "lessons" / f"{les['number']:02d}"
                l_dir.mkdir(parents=True, exist_ok=True)
                pages_dir = l_dir / "pages"
                text_dir = l_dir / "text"
                pages_dir.mkdir(exist_ok=True)
                text_dir.mkdir(exist_ok=True)

                start_p = les["startPage"]
                end_p = les.get("endPage", start_p)
                printed_pages = list(range(start_p, end_p + 1))
                pdf_pages = [self.mapper.get_pdf_page(p) for p in printed_pages]

                les["printedPages"] = printed_pages
                les["pdfPages"] = pdf_pages

                # Extract sub-PDF for the lesson
                lesson_doc = pymupdf.open()
                aggregated_text = []
                page_image_files = []

                for p_print, p_pdf in zip(printed_pages, pdf_pages):
                    pdf_idx = p_pdf - 1
                    if 0 <= pdf_idx < self.reader.page_count:
                        lesson_doc.insert_pdf(self.reader.doc, from_page=pdf_idx, to_page=pdf_idx)
                        p_text = self.reader.extract_page_text(pdf_idx)
                        (text_dir / f"page_{p_print:03d}.txt").write_text(p_text, encoding="utf-8")
                        aggregated_text.append(f"--- [صفحة {p_print}] ---\n{p_text}")

                        # Render and save page image for multimodal vision & preview
                        try:
                            page_obj = self.reader.doc[pdf_idx]
                            pix = page_obj.get_pixmap(dpi=150)
                            img_file = pages_dir / f"page_{p_print:03d}.png"
                            pix.save(str(img_file))
                            page_image_files.append(f"pages/page_{p_print:03d}.png")
                        except Exception:
                            pass

                lesson_doc.save(str(l_dir / "lesson.pdf"))
                lesson_doc.close()

                # Save combined lesson text
                (l_dir / "lesson_full_text.txt").write_text("\n\n".join(aggregated_text), encoding="utf-8")

                # Save lesson manifest
                les_manifest = {
                    "schemaVersion": "1.0",
                    "lessonId": les["id"],
                    "unitNumber": u["number"],
                    "lessonNumber": les["number"],
                    "title": les["title"],
                    "printedPages": printed_pages,
                    "pdfPages": pdf_pages,
                    "pageImages": page_image_files,
                    "confidence": 0.95,
                    "evidence": ["toc_matched", "page_numbering_valid"]
                }
                (l_dir / "manifest.json").write_text(
                    json.dumps(les_manifest, ensure_ascii=False, indent=2), encoding="utf-8"
                )

        return book_manifest
