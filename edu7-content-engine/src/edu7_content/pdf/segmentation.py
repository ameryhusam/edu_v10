import hashlib
import json
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

from .page_mapping import PageMappingEngine
from .reader import PdfReader


def slugify(text: str, fallback: str = "item") -> str:
    """Derive a URL and file-safe alphanumeric slug."""
    if not text:
        return fallback
    clean = text.strip()
    clean = re.sub(r"[^\w\u0600-\u06FF]+", "-", clean, flags=re.UNICODE)
    clean = clean.strip("-_")
    return clean or fallback


def _text_sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _build_grounding_chunks(text: str, max_chars: int = 1800) -> List[str]:
    """Build deterministic, evidence-preserving chunks without an AI writer."""
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    chunks: List[str] = []
    current = ""
    for paragraph in paragraphs:
        candidate = f"{current}\n\n{paragraph}" if current else paragraph
        if current and len(candidate) > max_chars:
            chunks.append(current)
            current = paragraph
        else:
            current = candidate
    if current:
        chunks.append(current)
    return chunks


def compute_sha256(file_path: Path) -> str:
    """Compute sha256 hex digest of a file."""
    h = hashlib.sha256()
    with open(file_path, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()


class LessonSegmenter:
    """
    Segments a full book PDF into standard Workspace packages:
    - textbook/ (textbook.pdf, textbook_manifest.json)
    - unit_01_<slug>/ (U_01_<slug>.pdf, unit_manifest.json)
      - lesson_01_<slug>/ (L_01_<slug>.pdf, lesson_manifest.json, pages/, text/, lesson_full_text.txt)
    - index.json (master workspace index)
    - edu7-content-package.json (canonical package manifest)
    """

    def __init__(self, reader: PdfReader, page_mapper: PageMappingEngine):
        self.reader = reader
        self.mapper = page_mapper

    def segment_book(
        self,
        units: List[Dict[str, Any]],
        workspace_dir: Path,
        coordinates: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        workspace_dir.mkdir(parents=True, exist_ok=True)
        raw_meta = self.reader.get_metadata()
        coords = coordinates or {}

        subject = coords.get("subject", raw_meta.get("subject", "GENERAL"))
        grade = coords.get("grade", "G07")
        term = coords.get("term", "T1")
        edition = str(coords.get("edition", "2026"))
        title = coords.get("title", raw_meta.get("title", f"كتاب {subject}"))

        textbook_key = f"EDU-{subject}-{grade}-{term}-ED{edition}"

        # 1. Prepare textbook/ folder
        textbook_dir = workspace_dir / "textbook"
        textbook_dir.mkdir(parents=True, exist_ok=True)
        dest_pdf = textbook_dir / "textbook.pdf"

        # Copy/save source PDF
        if hasattr(self.reader, "pdf_path") and self.reader.pdf_path.exists():
            import shutil
            shutil.copy2(str(self.reader.pdf_path), str(dest_pdf))
        else:
            self.reader.doc.save(str(dest_pdf))

        tb_sha256 = compute_sha256(dest_pdf)
        tb_size = dest_pdf.stat().st_size

        assets_registry: List[Dict[str, Any]] = [
            {
                "scope": "TEXTBOOK",
                "assetType": "TEXTBOOK_PDF",
                "originalName": dest_pdf.name,
                "relativePath": "textbook/textbook.pdf",
                "mimeType": "application/pdf",
                "sizeBytes": tb_size,
                "sha256": tb_sha256,
                "version": 1,
            }
        ]

        textbook_manifest = {
            "schemaVersion": "1.1",
            "textbookKey": textbook_key,
            "subject": subject,
            "grade": grade,
            "term": term,
            "edition": edition,
            "title": title,
            "totalPages": self.reader.page_count,
            "detectedOffset": self.mapper.detected_offset,
            "pageNumbering": {
                "printedPageIsCanonical": True,
                "pdfPageIsPhysical": True,
                "formula": "pdfPage = printedPage + detectedOffset",
            },
            "sha256": tb_sha256,
        }
        (textbook_dir / "textbook_manifest.json").write_text(
            json.dumps(textbook_manifest, ensure_ascii=False, indent=2), encoding="utf-8"
        )

        processed_units: List[Dict[str, Any]] = []
        flat_lessons_pkg: List[Dict[str, Any]] = []
        flat_units_pkg: List[Dict[str, Any]] = []

        # 2. Iterate units and lessons
        for u_idx, u in enumerate(units, start=1):
            u_num = u.get("number", u_idx)
            u_title = u.get("title", f"الوحدة {u_num}")
            u_slug = slugify(u_title, f"UNIT-{u_num:02d}")
            u_dir_name = f"unit_{u_num:02d}_{u_slug}"
            u_dir = workspace_dir / u_dir_name
            u_dir.mkdir(parents=True, exist_ok=True)

            lessons = u.get("lessons", [])
            unit_start_page = min([les.get("startPage", 1) for les in lessons]) if lessons else 1
            unit_end_page = max([les.get("endPage", unit_start_page) for les in lessons]) if lessons else unit_start_page

            # Slice Unit PDF using the active reader backend.
            unit_printed_pages = list(range(unit_start_page, unit_end_page + 1))
            unit_pdf_pages = [self.mapper.get_pdf_page(p) for p in unit_printed_pages]
            unit_pdf_name = f"U_{u_num:02d}_{u_slug}.pdf"
            unit_pdf_path = u_dir / unit_pdf_name
            self.reader.copy_pages_to_pdf([p - 1 for p in unit_pdf_pages], unit_pdf_path)

            u_sha = compute_sha256(unit_pdf_path)
            u_size = unit_pdf_path.stat().st_size
            u_rel_path = f"{u_dir_name}/{unit_pdf_name}"

            assets_registry.append({
                "scope": "UNIT",
                "unitSlug": u_slug,
                "assetType": "UNIT_PDF",
                "originalName": unit_pdf_name,
                "relativePath": u_rel_path,
                "mimeType": "application/pdf",
                "sizeBytes": u_size,
                "sha256": u_sha,
                "version": 1,
            })

            flat_units_pkg.append({
                "slug": u_slug,
                "name": u_title,
                "orderIndex": u_num,
                "startPage": unit_start_page,
                "endPage": unit_end_page,
                "printedPageStart": unit_start_page,
                "printedPageEnd": unit_end_page,
                "pdfPageStart": unit_pdf_pages[0] if unit_pdf_pages else None,
                "pdfPageEnd": unit_pdf_pages[-1] if unit_pdf_pages else None,
                "isActive": True,
            })

            processed_lessons: List[Dict[str, Any]] = []

            for l_idx, les in enumerate(lessons, start=1):
                l_num = les.get("number", l_idx)
                l_title = les.get("title", f"الدرس {l_num}")
                l_slug = slugify(l_title, f"LESSON-{l_num:02d}")
                l_dir_name = f"lesson_{l_num:02d}_{l_slug}"
                l_dir = u_dir / l_dir_name
                l_dir.mkdir(parents=True, exist_ok=True)

                pages_dir = l_dir / "pages"
                text_dir = l_dir / "text"
                pages_dir.mkdir(exist_ok=True)
                text_dir.mkdir(exist_ok=True)

                start_p = les.get("startPage", unit_start_page)
                end_p = les.get("endPage", start_p)
                printed_pages = list(range(start_p, end_p + 1))
                pdf_pages = [self.mapper.get_pdf_page(p) for p in printed_pages]

                les["printedPages"] = printed_pages
                les["pdfPages"] = pdf_pages

                # Slice Lesson PDF using the active reader backend.
                lesson_pdf_name = f"L_{l_num:02d}_{l_slug}.pdf"
                lesson_pdf_path = l_dir / lesson_pdf_name
                self.reader.copy_pages_to_pdf([p - 1 for p in pdf_pages], lesson_pdf_path)
                aggregated_text = []
                page_image_files = []
                grounding_pages = []
                grounding_chunks = []

                for p_print, p_pdf in zip(printed_pages, pdf_pages):
                    pdf_idx = p_pdf - 1
                    if 0 <= pdf_idx < self.reader.page_count:
                        p_text = self.reader.extract_page_text(pdf_idx)
                        grounding_pages.append({
                            "printedPage": p_print,
                            "pdfPage": p_pdf,
                            "textSha256": _text_sha256(p_text),
                            "textChars": len(p_text),
                        })
                        for chunk_text in _build_grounding_chunks(p_text):
                            grounding_chunks.append({
                                "ordinal": len(grounding_chunks),
                                "printedPage": p_print,
                                "pdfPage": p_pdf,
                                "text": chunk_text,
                                "textSha256": _text_sha256(chunk_text),
                            })
                        (text_dir / f"page_{p_print:03d}.txt").write_text(p_text, encoding="utf-8")
                        aggregated_text.append(f"--- [صفحة {p_print}] ---\n{p_text}")

                        # Render High-Res PNG (150 DPI)
                        try:
                            png_data = self.reader.render_page_to_png(pdf_idx, dpi=150)
                            if not png_data:
                                raise RuntimeError("Page rendering unavailable with pypdf backend")
                            img_file = pages_dir / f"page_{p_print:03d}.png"
                            img_file.write_bytes(png_data)
                            rel_img_path = f"{u_dir_name}/{l_dir_name}/pages/page_{p_print:03d}.png"
                            page_image_files.append(rel_img_path)

                            assets_registry.append({
                                "scope": "LESSON",
                                "unitSlug": u_slug,
                                "lessonSlug": l_slug,
                                "assetType": "PAGE_IMAGE",
                                "originalName": f"page_{p_print:03d}.png",
                                "relativePath": rel_img_path,
                                "mimeType": "image/png",
                                "sizeBytes": img_file.stat().st_size,
                                "sha256": compute_sha256(img_file),
                                "pageStart": p_print,
                                "pageEnd": p_print,
                                "version": 1,
                            })
                        except Exception:
                            pass

                l_sha = compute_sha256(lesson_pdf_path)
                l_size = lesson_pdf_path.stat().st_size
                l_rel_path = f"{u_dir_name}/{l_dir_name}/{lesson_pdf_name}"

                assets_registry.append({
                    "scope": "LESSON",
                    "unitSlug": u_slug,
                    "lessonSlug": l_slug,
                    "assetType": "LESSON_PDF",
                    "originalName": lesson_pdf_name,
                    "relativePath": l_rel_path,
                    "mimeType": "application/pdf",
                    "sizeBytes": l_size,
                    "sha256": l_sha,
                    "version": 1,
                })

                (l_dir / "lesson_full_text.txt").write_text("\n\n".join(aggregated_text), encoding="utf-8")
                grounding_manifest = {
                    "schemaVersion": "1.0",
                    "textbookKey": textbook_key,
                    "unitSlug": u_slug,
                    "lessonSlug": l_slug,
                    "pageNumbering": {
                        "printedPageIsCanonical": True,
                        "pdfPageIsPhysical": True,
                        "formula": "pdfPage = printedPage + detectedOffset",
                    },
                    "pages": grounding_pages,
                    "chunks": grounding_chunks,
                }
                (l_dir / "grounding_manifest.json").write_text(
                    json.dumps(grounding_manifest, ensure_ascii=False, indent=2), encoding="utf-8"
                )

                lesson_manifest = {
                    "schemaVersion": "1.1",
                    "lessonId": les.get("id", f"lesson-{l_num:02d}"),
                    "unitSlug": u_slug,
                    "lessonSlug": l_slug,
                    "unitNumber": u_num,
                    "lessonNumber": l_num,
                    "title": l_title,
                    "printedPages": printed_pages,
                    "pdfPages": pdf_pages,
                    "startPage": start_p,
                    "endPage": end_p,
                    "printedPageStart": start_p,
                    "printedPageEnd": end_p,
                    "pdfPageStart": pdf_pages[0] if pdf_pages else None,
                    "pdfPageEnd": pdf_pages[-1] if pdf_pages else None,
                    "pageImages": page_image_files,
                    "groundingFile": f"{u_dir_name}/{l_dir_name}/grounding_manifest.json",
                    "grounding": {
                        "pageCount": len(grounding_pages),
                        "chunkCount": len(grounding_chunks),
                    },
                    "pdfFile": l_rel_path,
                    "sha256": l_sha,
                }
                (l_dir / "lesson_manifest.json").write_text(
                    json.dumps(lesson_manifest, ensure_ascii=False, indent=2), encoding="utf-8"
                )

                processed_lessons.append(lesson_manifest)
                flat_lessons_pkg.append({
                    "slug": l_slug,
                    "unitSlug": u_slug,
                    "name": l_title,
                    "orderIndex": l_num,
                    "startPage": start_p,
                    "endPage": end_p,
                    "isActive": True,
                })

            unit_manifest = {
                "schemaVersion": "1.1",
                "unitId": u.get("id", f"unit-{u_num:02d}"),
                "unitSlug": u_slug,
                "number": u_num,
                "title": u_title,
                "startPage": unit_start_page,
                "endPage": unit_end_page,
                "lessonCount": len(lessons),
                "pdfFile": u_rel_path,
                "sha256": u_sha,
                "lessons": processed_lessons,
            }
            (u_dir / "unit_manifest.json").write_text(
                json.dumps(unit_manifest, ensure_ascii=False, indent=2), encoding="utf-8"
            )
            processed_units.append(unit_manifest)

        # 3. Master workspace index.json
        index_manifest = {
            "schemaVersion": "1.1",
            "textbookKey": textbook_key,
            "metadata": {
                "title": title,
                "subjectKey": subject,
                "gradeKey": grade,
                "termKey": term,
                "edition": edition,
                "totalPages": self.reader.page_count,
            },
            "detectedOffset": self.mapper.detected_offset,
            "pageNumbering": {
                "printedPageIsCanonical": True,
                "pdfPageIsPhysical": True,
                "formula": "pdfPage = printedPage + detectedOffset",
            },
            "units": processed_units,
            "assetsCount": len(assets_registry),
        }
        (workspace_dir / "index.json").write_text(
            json.dumps(index_manifest, ensure_ascii=False, indent=2), encoding="utf-8"
        )

        # 4. Standard edu7-content-package.json skeleton
        edu7_package = {
            "meta": {
                "profile": "edu7.textbook-content",
                "profileVersion": "1.1",
                "scope": "FULL",
                "exportedAt": "2026-09-20T00:00:00.000Z",
            },
            "textbook": {
                "key": textbook_key,
                "subjectKey": subject,
                "gradeKey": grade,
                "termKey": term,
                "title": title,
                "edition": edition,
                "status": "DRAFT",
                "totalPages": self.reader.page_count,
            },
            "units": flat_units_pkg,
            "lessons": flat_lessons_pkg,
            "concepts": [],
            "prerequisites": [],
            "misconceptions": [],
            "learningResources": [],
            "questions": [],
            "assets": assets_registry,
        }
        (workspace_dir / "edu7-content-package.json").write_text(
            json.dumps(edu7_package, ensure_ascii=False, indent=2), encoding="utf-8"
        )

        return index_manifest
