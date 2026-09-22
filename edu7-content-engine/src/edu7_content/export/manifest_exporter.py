"""
export/manifest_exporter.py — Workspace & Manifest Exporter for Edu7
===================================================================
Produces standardized workspace directory layouts, manifests (index.json,
unit_xx.json, lesson_xx.json), and canonical content package (edu7-content-package.json)
without embedding binary Base64 inside JSON files.
"""

import os
import json
import hashlib
import mimetypes
from pathlib import Path
from typing import Any, Dict, List, Optional


def calculate_sha256(filepath: Path) -> str:
    """Calculates SHA-256 hex digest of a file."""
    if not filepath.exists() or not filepath.is_file():
        return "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    sha = hashlib.sha256()
    with open(filepath, "rb") as f:
        while chunk := f.read(65536):
            sha.update(chunk)
    return sha.hexdigest()


class WorkspaceManifestExporter:
    """
    Exports structured manifests and asset registries for a full Edu7 workspace.
    """

    def __init__(self, workspace_dir: Path):
        self.workspace_dir = Path(workspace_dir).resolve()
        self.workspace_dir.mkdir(parents=True, exist_ok=True)

    def export_workspace_manifests(
        self,
        metadata: Dict[str, Any],
        units_data: List[Dict[str, Any]],
        assets_data: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        """
        Builds the entire workspace hierarchy, writing unit_xx.json, lesson_xx.json,
        index.json, and edu7-content-package.json.
        """
        term = metadata.get("term", "T1").upper()
        grade = metadata.get("grade", "G07").upper()
        subject = metadata.get("subject", "MATH").upper()
        edition = str(metadata.get("edition", "2026"))
        title = metadata.get("title") or f"Textbook {subject} {grade}"

        textbook_pdf_rel = "textbook/textbook.pdf"
        textbook_pdf_full = self.workspace_dir / textbook_pdf_rel
        textbook_pdf_sha = calculate_sha256(textbook_pdf_full)
        textbook_pdf_size = textbook_pdf_full.stat().st_size if textbook_pdf_full.exists() else 0

        assets: List[Dict[str, Any]] = []
        if assets_data:
            assets.extend(assets_data)
        elif textbook_pdf_full.exists():
            assets.append({
                "scope": "TEXTBOOK",
                "assetType": "TEXTBOOK_PDF",
                "originalName": "textbook.pdf",
                "relativePath": textbook_pdf_rel,
                "mimeType": "application/pdf",
                "sizeBytes": textbook_pdf_size,
                "sha256": textbook_pdf_sha,
                "version": 1,
            })

        processed_units = []
        pkg_units = []
        pkg_lessons = []
        pkg_concepts = []
        pkg_questions = []
        pkg_flashcards = []
        pkg_resources = []
        pkg_misconceptions = []

        total_questions_count = 0
        total_concepts_count = 0
        total_flashcards_count = 0
        total_resources_count = 0

        for u_idx, u in enumerate(units_data, start=1):
            u_num = u.get("unitNumber", u_idx)
            u_slug = u.get("slug") or f"UNIT_{u_num}"
            u_name = u.get("name") or u.get("title") or f"Unit {u_num}"
            u_dir_name = f"unit_{u_num:02d}_{u_slug.lower()}"
            u_dir = self.workspace_dir / u_dir_name
            u_lessons_dir = u_dir / "lessons"
            u_lessons_dir.mkdir(parents=True, exist_ok=True)

            u_pdf_name = f"U_{u_num:02d}_{u_slug.lower()}.pdf"
            u_pdf_rel = f"{u_dir_name}/{u_pdf_name}"
            u_pdf_full = self.workspace_dir / u_pdf_rel
            u_pdf_sha = calculate_sha256(u_pdf_full)
            u_pdf_size = u_pdf_full.stat().st_size if u_pdf_full.exists() else 0

            if u_pdf_full.exists():
                assets.append({
                    "scope": "UNIT",
                    "unitSlug": u_slug,
                    "assetType": "UNIT_PDF",
                    "originalName": u_pdf_name,
                    "relativePath": u_pdf_rel,
                    "mimeType": "application/pdf",
                    "sizeBytes": u_pdf_size,
                    "sha256": u_pdf_sha,
                    "version": 1,
                })

            pkg_units.append({
                "slug": u_slug,
                "name": u_name,
                "orderIndex": u_num,
                "startPage": u.get("startPage"),
                "endPage": u.get("endPage"),
                "isActive": True,
            })

            processed_lessons = []
            for l_idx, l in enumerate(u.get("lessons", []), start=1):
                l_num = l.get("lessonNumber", l_idx)
                l_slug = l.get("slug") or f"LESSON_{l_num}"
                l_name = l.get("name") or l.get("title") or f"Lesson {l_num}"
                l_dir_name = f"lesson_{l_num:02d}_{l_slug.lower()}"
                l_dir = u_lessons_dir / l_dir_name
                
                (l_dir / "pages").mkdir(parents=True, exist_ok=True)
                (l_dir / "resources" / "readings").mkdir(parents=True, exist_ok=True)
                (l_dir / "resources" / "images").mkdir(parents=True, exist_ok=True)
                (l_dir / "resources" / "summaries").mkdir(parents=True, exist_ok=True)

                l_pdf_name = f"L_{l_num:02d}_{l_slug.lower()}.pdf"
                l_pdf_rel = f"{u_dir_name}/lessons/{l_dir_name}/{l_pdf_name}"
                l_pdf_full = self.workspace_dir / l_pdf_rel
                l_pdf_sha = calculate_sha256(l_pdf_full)
                l_pdf_size = l_pdf_full.stat().st_size if l_pdf_full.exists() else 0

                if l_pdf_full.exists():
                    assets.append({
                        "scope": "LESSON",
                        "unitSlug": u_slug,
                        "lessonSlug": l_slug,
                        "assetType": "LESSON_PDF",
                        "originalName": l_pdf_name,
                        "relativePath": l_pdf_rel,
                        "mimeType": "application/pdf",
                        "sizeBytes": l_pdf_size,
                        "sha256": l_pdf_sha,
                        "version": 1,
                    })

                l_concepts = l.get("concepts", [])
                l_questions = l.get("questions", [])
                l_flashcards = l.get("flashcards", [])
                l_resources = l.get("resources", [])

                total_concepts_count += len(l_concepts)
                total_questions_count += len(l_questions)
                total_flashcards_count += len(l_flashcards)
                total_resources_count += len(l_resources)

                pkg_concepts.extend(l_concepts)
                pkg_questions.extend(l_questions)
                pkg_flashcards.extend(l_flashcards)
                pkg_resources.extend(l_resources)

                # Write sub-json files
                (l_dir / "concepts.json").write_text(json.dumps(l_concepts, indent=2, ensure_ascii=False), encoding="utf-8")
                (l_dir / "questions.json").write_text(json.dumps(l_questions, indent=2, ensure_ascii=False), encoding="utf-8")
                (l_dir / "flashcards.json").write_text(json.dumps(l_flashcards, indent=2, ensure_ascii=False), encoding="utf-8")
                (l_dir / "resources.json").write_text(json.dumps({"schemaVersion": "1.0", "resources": l_resources}, indent=2, ensure_ascii=False), encoding="utf-8")

                lesson_manifest = {
                    "manifestVersion": "1.0",
                    "type": "lesson",
                    "unitNumber": u_num,
                    "lessonNumber": l_num,
                    "unitSlug": u_slug,
                    "slug": l_slug,
                    "name": l_name,
                    "orderIndex": l_num,
                    "startPage": l.get("startPage"),
                    "endPage": l.get("endPage"),
                    "relativePath": f"{u_dir_name}/lessons/{l_dir_name}",
                    "pdf": {
                        "relativePath": l_pdf_rel,
                        "mimeType": "application/pdf",
                        "sha256": l_pdf_sha,
                        "sizeBytes": l_pdf_size,
                    },
                    "directories": {
                        "pages": "pages",
                        "resources": "resources",
                        "summaries": "resources/summaries",
                    },
                    "files": {
                        "concepts": "concepts.json",
                        "questions": "questions.json",
                        "flashcards": "flashcards.json",
                        "resources": "resources.json",
                    },
                }

                (l_dir / f"lesson_{l_num:02d}.json").write_text(
                    json.dumps(lesson_manifest, indent=2, ensure_ascii=False),
                    encoding="utf-8",
                )

                processed_lessons.append({
                    "lessonNumber": l_num,
                    "slug": l_slug,
                    "name": l_name,
                    "relativePath": f"{u_dir_name}/lessons/{l_dir_name}",
                    "manifest": f"{u_dir_name}/lessons/{l_dir_name}/lesson_{l_num:02d}.json",
                    "pdf": l_pdf_rel,
                })

                pkg_lessons.append({
                    "slug": l_slug,
                    "unitSlug": u_slug,
                    "name": l_name,
                    "orderIndex": l_num,
                    "startPage": l.get("startPage"),
                    "endPage": l.get("endPage"),
                    "isActive": True,
                })

            unit_manifest = {
                "manifestVersion": "1.0",
                "type": "unit",
                "unitNumber": u_num,
                "slug": u_slug,
                "name": u_name,
                "orderIndex": u_num,
                "startPage": u.get("startPage"),
                "endPage": u.get("endPage"),
                "relativePath": u_dir_name,
                "pdf": {
                    "relativePath": u_pdf_rel,
                    "mimeType": "application/pdf",
                    "sha256": u_pdf_sha,
                    "sizeBytes": u_pdf_size,
                },
                "lessons": processed_lessons,
            }

            (u_dir / f"unit_{u_num:02d}.json").write_text(
                json.dumps(unit_manifest, indent=2, ensure_ascii=False),
                encoding="utf-8",
            )

            processed_units.append({
                "unitNumber": u_num,
                "slug": u_slug,
                "name": u_name,
                "relativePath": u_dir_name,
                "manifest": f"{u_dir_name}/unit_{u_num:02d}.json",
                "pdf": u_pdf_rel,
                "lessons": processed_lessons,
            })

        index_manifest = {
            "manifestVersion": "1.0",
            "type": "workspace_subject",
            "workspaceId": f"{term}-{grade}-{subject}",
            "term": term,
            "grade": grade,
            "subject": subject,
            "edition": edition,
            "title": title,
            "source": {
                "engine": "edu7-content-engine",
                "engineVersion": "1.2.0",
                "sourcePdf": {
                    "relativePath": textbook_pdf_rel,
                    "mimeType": "application/pdf",
                    "sizeBytes": textbook_pdf_size,
                    "sha256": textbook_pdf_sha,
                },
            },
            "counts": {
                "units": len(processed_units),
                "lessons": len(pkg_lessons),
                "concepts": total_concepts_count,
                "questions": total_questions_count,
                "flashcards": total_flashcards_count,
                "resources": total_resources_count,
                "assets": len(assets),
            },
            "units": processed_units,
            "package": {
                "relativePath": "edu7-content-package.json",
                "profile": "edu7.textbook-content",
                "profileVersion": "1.1",
            },
            "contentVersion": 1,
            "updatedAt": "2026-09-21T00:00:00.000Z",
            "contentHash": textbook_pdf_sha,
        }

        (self.workspace_dir / "index.json").write_text(
            json.dumps(index_manifest, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )

        canonical_package = {
            "meta": {
                "profile": "edu7.textbook-content",
                "profileVersion": "1.1",
                "scope": "FULL",
                "exportedAt": "2026-09-21T00:00:00.000Z",
            },
            "textbook": {
                "key": f"EDU-{subject}-{grade}-{term}-ED{edition}",
                "subjectKey": subject,
                "gradeKey": grade,
                "termKey": term,
                "title": title,
                "edition": edition,
                "description": None,
                "issuer": None,
                "isbn": None,
                "publishYear": None,
                "totalPages": None,
                "status": "DRAFT",
            },
            "units": pkg_units,
            "lessons": pkg_lessons,
            "concepts": pkg_concepts,
            "prerequisites": [],
            "misconceptions": pkg_misconceptions,
            "learningResources": pkg_resources,
            "questions": pkg_questions,
            "assets": assets,
        }

        (self.workspace_dir / "edu7-content-package.json").write_text(
            json.dumps(canonical_package, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )

        return {
            "indexManifest": index_manifest,
            "package": canonical_package,
        }
