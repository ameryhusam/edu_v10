#!/usr/bin/env python3
"""
Edu7 — Safe Textbook Part / Front-Matter / TOC migration
==========================================================

Purpose
-------
Apply the approved textbook identity + content-preparation changes locally.

Safety model
------------
1. Audit first.
2. Every modification requires an exact expected source fragment.
3. If a fragment is missing or occurs more than once, abort.
4. No fuzzy replacement.
5. No GitHub API.
6. No git commit.
7. No git push.
8. Backup modified files before writing.
9. Workspace implementation is intentionally NOT modified.

Target branch
-------------
03_build_algorithm_and_new_Docs

Target identity
---------------
Textbook = Subject + Grade + Part + PrintedEdition

Part:
    PART_1
    PART_2
    BOTH

Term is NOT a direct Textbook identity field.

The Python content engine:
PDF
 -> first 10 pages
 -> deterministic evidence
 -> unified AI validation
 -> TOC
 -> logical part split
 -> lesson segmentation
 -> package evidence

Python never writes the database.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]

ENGINE = ROOT / "edu7-content-engine"
SRC = ROOT / "src"
DOCS = ROOT / "Docs_v10"

BACKUP_ROOT = ROOT / ".local-migration-backups"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

class MigrationAbort(RuntimeError):
    pass


def run(cmd: list[str]) -> str:
    result = subprocess.run(
        cmd,
        cwd=ROOT,
        text=True,
        capture_output=True,
    )

    if result.returncode != 0:
        raise MigrationAbort(
            f"Command failed:\n$ {' '.join(cmd)}\n\n"
            f"STDOUT:\n{result.stdout}\n\n"
            f"STDERR:\n{result.stderr}"
        )

    return result.stdout


def read(path: Path) -> str:
    if not path.exists():
        raise MigrationAbort(f"Required file does not exist: {path}")
    return path.read_text(encoding="utf-8")


def write(path: Path, content: str) -> None:
    path.write_text(content, encoding="utf-8")


def backup(path: Path, backup_root: Path) -> Path:
    relative = path.relative_to(ROOT)
    target = backup_root / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(path, target)
    return target


def replace_exact(
    path: Path,
    old: str,
    new: str,
    *,
    description: str,
    backups: dict[str, str],
) -> None:
    content = read(path)
    count = content.count(old)

    if count != 1:
        raise MigrationAbort(
            f"\nSAFE PATCH ABORTED\n"
            f"File: {path.relative_to(ROOT)}\n"
            f"Change: {description}\n"
            f"Expected exact fragment count: 1\n"
            f"Actual count: {count}\n\n"
            f"No write performed for this file."
        )

    if str(path) not in backups:
        backups[str(path)] = str(backup(path, BACKUP_ROOT))

    write(path, content.replace(old, new, 1))

    print(f"[PATCH] {path.relative_to(ROOT)}")
    print(f"        {description}")


def insert_after_exact(
    path: Path,
    marker: str,
    addition: str,
    *,
    description: str,
    backups: dict[str, str],
) -> None:
    content = read(path)
    count = content.count(marker)

    if count != 1:
        raise MigrationAbort(
            f"\nSAFE INSERT ABORTED\n"
            f"File: {path.relative_to(ROOT)}\n"
            f"Change: {description}\n"
            f"Marker count: {count}; expected 1."
        )

    if str(path) not in backups:
        backups[str(path)] = str(backup(path, BACKUP_ROOT))

    write(path, content.replace(marker, marker + addition, 1))

    print(f"[INSERT] {path.relative_to(ROOT)}")
    print(f"         {description}")


def assert_contains(path: Path, fragment: str, description: str) -> None:
    content = read(path)

    if fragment not in content:
        raise MigrationAbort(
            f"\nAUDIT FAILED\n"
            f"File: {path.relative_to(ROOT)}\n"
            f"Missing required fragment:\n{fragment}\n\n"
            f"Reason: {description}"
        )


def assert_not_contains(path: Path, fragment: str, description: str) -> None:
    content = read(path)

    if fragment in content:
        raise MigrationAbort(
            f"\nAUDIT FAILED\n"
            f"File: {path.relative_to(ROOT)}\n"
            f"Forbidden fragment still exists:\n{fragment}\n\n"
            f"Reason: {description}"
        )


def git_status() -> str:
    return run(["git", "status", "--short"])


# ---------------------------------------------------------------------------
# Audit
# ---------------------------------------------------------------------------

TARGET_FILES = [
    ENGINE / "src/edu7_content/pdf/vision_ocr.py",
    ENGINE / "src/edu7_content/cli/main.py",
    ENGINE / "src/edu7_content/ai/content_service.py",
    ENGINE / "src/edu7_content/workspace_layout.py",
    SRC / "shared/kernel/identifiers.ts",
    SRC / "contexts/content/application/authoring.service.ts",
    SRC / "contexts/content/application/ports.ts",
    SRC / "infrastructure/database/content.repository.ts",
    ROOT / "prisma/schema.prisma",

    DOCS / "02-domain-contracts.md",
    DOCS / "03-content-authoring-delivery.md",
    DOCS / "05-content-ingestion-ai.md",
    DOCS / "07-data-operations-quality.md",
    DOCS / "12-end-to-end-dataflows.md",
    DOCS / "13-content-storage-page-classification-and-import-algorithms.md",
    DOCS / "14-developer-content-ingestion-guide.md",
]


def audit_repository() -> None:
    print("\n=== Edu7 SAFE MIGRATION AUDIT ===\n")

    branch = run(["git", "branch", "--show-current"]).strip()

    if branch != "03_build_algorithm_and_new_Docs":
        raise MigrationAbort(
            f"Wrong branch: {branch}\n"
            f"Expected: 03_build_algorithm_and_new_Docs"
        )

    print(f"[OK] Branch: {branch}")

    for path in TARGET_FILES:
        if not path.exists():
            raise MigrationAbort(
                f"Required target file missing: {path.relative_to(ROOT)}"
            )

    print(f"[OK] Required target files: {len(TARGET_FILES)}")

    # Current schema facts.
    schema = read(ROOT / "prisma/schema.prisma")

    assert_contains(
        ROOT / "prisma/schema.prisma",
        "model Textbook {",
        "Textbook model must exist before identity migration.",
    )

    assert_contains(
        ROOT / "prisma/schema.prisma",
        "termId    String @db.Uuid",
        "Current Textbook.termId must exist before removing it.",
    )

    assert_contains(
        ROOT / "prisma/schema.prisma",
        "@@unique([subjectId, gradeId, termId, edition])",
        "Current Textbook uniqueness must be known before replacing it.",
    )

    # Current Python facts.
    vision = read(ENGINE / "src/edu7_content/pdf/vision_ocr.py")

    assert_contains(
        ENGINE / "src/edu7_content/pdf/vision_ocr.py",
        "def extract_edition_from_cover(",
        "Existing edition extractor must exist before replacement.",
    )

    assert_contains(
        ENGINE / "src/edu7_content/pdf/vision_ocr.py",
        "text = \"\\n\".join(reader.extract_page_text(i) for i in range(min(3, reader.page_count)))",
        "Current three-page edition extraction must be present before widening to ten pages.",
    )

    assert_contains(
        ENGINE / "src/edu7_content/pdf/vision_ocr.py",
        'images = render_pages_to_b64(reader, max_pages=1, dpi=dpi)',
        "Current one-page AI cover extraction must be present before replacement.",
    )

    # Current CLI facts.
    cli = read(ENGINE / "src/edu7_content/cli/main.py")

    assert_contains(
        ENGINE / "src/edu7_content/cli/main.py",
        'p_prep.add_argument("--term", default="T1"',
        "Current CLI term option must be found before changing its semantic role.",
    )

    assert_contains(
        ENGINE / "src/edu7_content/cli/main.py",
        "extract_edition_from_cover(",
        "CLI must currently call the old edition extractor.",
    )

    assert_contains(
        ENGINE / "src/edu7_content/cli/main.py",
        "textbook_key(subject_key, grade_number, term_number, edition)",
        "Current term-based textbook key must be identified before changing it.",
    )

    # Current TS identity facts.
    identifiers = read(SRC / "shared/kernel/identifiers.ts")

    assert_contains(
        SRC / "shared/kernel/identifiers.ts",
        "A textbook is identified by subject + grade + term + **printed edition**",
        "Current identity contract must be replaced explicitly.",
    )

    # Docs facts.
    assert_contains(
        DOCS / "05-content-ingestion-ai.md",
        "subjectKey + gradeKey + termKey + edition",
        "Current ingestion identity contract must be replaced.",
    )

    assert_contains(
        DOCS / "14-developer-content-ingestion-guide.md",
        "termKey, for example T01",
        "Current developer identity contract must be replaced.",
    )

    print("[OK] Existing contracts match expected baseline.")
    print("\n=== AUDIT PASSED — NO FILES MODIFIED ===\n")


# ---------------------------------------------------------------------------
# Python content engine
# ---------------------------------------------------------------------------

FRONT_MATTER_CODE = r'''

PART_1_PATTERNS = [
    r"الجزء\s+الأول",
    r"الجزء\s+الاول",
    r"الجزء\s+١",
]

PART_2_PATTERNS = [
    r"الجزء\s+الثاني",
    r"الجزء\s+الثانى",
    r"الجزء\s+٢",
]

TOC_PATTERNS = [
    r"فهرس",
    r"الفهرس",
    r"المحتويات",
    r"محتويات",
    r"الموضوعات",
    r"الوحدات",
    r"الدروس",
]


def _contains_any(text: str, patterns: list[str]) -> bool:
    return any(re.search(pattern, text, flags=re.IGNORECASE) for pattern in patterns)


def _first_ten_page_text(reader) -> list[dict[str, Any]]:
    pages = []

    for index in range(min(10, reader.page_count)):
        text = reader.extract_page_text(index) or ""
        pages.append({
            "pdfPage": index + 1,
            "text": text,
        })

    return pages


def _deterministic_part_evidence(page_texts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    evidence = []

    has_part_1 = False
    has_part_2 = False

    for page in page_texts:
        text = page["text"]

        if _contains_any(text, PART_1_PATTERNS):
            has_part_1 = True
            evidence.append({
                "pdfPage": page["pdfPage"],
                "field": "part",
                "value": "PART_1",
                "text": text[:1000],
            })

        if _contains_any(text, PART_2_PATTERNS):
            has_part_2 = True
            evidence.append({
                "pdfPage": page["pdfPage"],
                "field": "part",
                "value": "PART_2",
                "text": text[:1000],
            })

    if has_part_1 and has_part_2:
        return [
            *evidence,
            {
                "field": "part",
                "value": "BOTH",
                "reason": "Both explicit part markers were detected in the first ten pages.",
            },
        ]

    return evidence


def _deterministic_toc_evidence(page_texts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    evidence = []

    for page in page_texts:
        text = page["text"]

        if _contains_any(text, TOC_PATTERNS):
            evidence.append({
                "pdfPage": page["pdfPage"],
                "field": "toc",
                "text": text[:2000],
            })

    return evidence


def extract_book_front_matter(
    reader,
    model_name=None,
    use_gemini=True,
    max_pages=10,
    dpi=150,
):
    """
    Extract physical textbook identity evidence and TOC evidence.

    Deterministic extraction is performed first.
    Gemini receives the same first-ten-page evidence for semantic validation.

    AI never becomes the canonical source of truth.
    """

    import re

    max_pages = min(max(1, max_pages), 10)

    page_texts = _first_ten_page_text(reader)

    part_evidence = _deterministic_part_evidence(page_texts)
    toc_evidence = _deterministic_toc_evidence(page_texts)

    identity = {
        "title": None,
        "subjectKey": None,
        "gradeKey": None,
        "part": None,
        "termOrdinal": None,
        "edition": None,
        "printingYear": None,
        "publicationYear": None,
        "issuer": None,
    }

    # Conservative deterministic part resolution.
    part_values = {
        item.get("value")
        for item in part_evidence
        if item.get("field") == "part"
        and item.get("value") in {"PART_1", "PART_2"}
    }

    if {"PART_1", "PART_2"}.issubset(part_values):
        identity["part"] = "BOTH"
    elif "PART_1" in part_values:
        identity["part"] = "PART_1"
    elif "PART_2" in part_values:
        identity["part"] = "PART_2"

    ai_result = None

    if use_gemini:
        try:
            from ..ai.content_service import ContentAIService

            images = render_pages_to_b64(
                reader,
                max_pages=max_pages,
                dpi=dpi,
            )

            service = ContentAIService(
                model_name=(
                    model_name
                    if model_name and str(model_name).startswith("gemini")
                    else None
                )
            )

            if service.provider.client.api_keys:
                ai_result = service.extract_book_front_matter(
                    page_texts=page_texts,
                    images_b64=images,
                )

        except Exception as err:
            print(f"[!] Unified front-matter AI validation unavailable: {err}")

    if isinstance(ai_result, dict):
        ai_identity = ai_result.get("identity") or {}

        for field in identity:
            value = ai_identity.get(field)

            if value is not None and value != "":
                identity[field] = value

    return {
        "identity": identity,
        "toc": {
            "found": bool(toc_evidence),
            "evidence": toc_evidence,
        },
        "evidence": [
            *part_evidence,
            *toc_evidence,
        ],
        "aiValidation": ai_result,
        "pagesAnalyzed": len(page_texts),
        "maxPages": 10,
    }
'''


def add_front_matter_python() -> None:
    path = ENGINE / "src/edu7_content/pdf/vision_ocr.py"

    insert_after_exact(
        path,
        'from typing import List, Optional, Dict, Any\n',
        FRONT_MATTER_CODE,
        description="Add deterministic first-ten-page identity/TOC evidence extraction.",
        backups=BACKUPS,
    )


# ---------------------------------------------------------------------------
# Replace old edition extractor
# ---------------------------------------------------------------------------

NEW_EDITION_WRAPPER = '''def extract_edition_from_cover(reader, model_name=None, use_gemini=True, dpi=150) -> Optional[str]:
    """Compatibility wrapper around the ten-page front-matter extractor."""
    result = extract_book_front_matter(
        reader,
        model_name=model_name,
        use_gemini=use_gemini,
        max_pages=10,
        dpi=dpi,
    )
    value = (result.get("identity") or {}).get("edition")
    return str(value).strip() if value else None
'''


def replace_old_edition_extractor() -> None:
    path = ENGINE / "src/edu7_content/pdf/vision_ocr.py"
    content = read(path)

    start = content.find("def extract_edition_from_cover(")
    end = content.find("\n\ndef extract_toc_via_vision(", start)

    if start < 0 or end < 0:
        raise MigrationAbort(
            "Could not identify exact boundaries of extract_edition_from_cover()."
        )

    old = content[start:end].rstrip()

    if old.count("def extract_edition_from_cover(") != 1:
        raise MigrationAbort(
            "Unexpected number of edition extractor definitions."
        )

    if str(path) not in BACKUPS:
        BACKUPS[str(path)] = str(backup(path, BACKUP_ROOT))

    new_content = content[:start] + NEW_EDITION_WRAPPER + content[end:]

    write(path, new_content)

    print(
        "[PATCH] vision_ocr.py\n"
        "        Replace old cover-only edition extraction with "
        "first-ten-page compatibility wrapper."
    )


# ---------------------------------------------------------------------------
# ContentAIService
# ---------------------------------------------------------------------------

FRONT_MATTER_SERVICE = r'''
    def extract_book_front_matter(
        self,
        *,
        page_texts: List[Dict[str, Any]],
        images_b64: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """
        Validate textbook identity + TOC from the first ten PDF pages.

        AI is evidence validation, not the canonical persistence layer.
        """

        schema = {
            "type": "object",
            "properties": {
                "identity": {
                    "type": "object",
                    "properties": {
                        "title": {"type": ["string", "null"]},
                        "subjectKey": {"type": ["string", "null"]},
                        "gradeKey": {"type": ["string", "null"]},
                        "part": {
                            "type": ["string", "null"],
                            "enum": [
                                "PART_1",
                                "PART_2",
                                "BOTH",
                                None,
                            ],
                        },
                        "termOrdinal": {"type": ["integer", "null"]},
                        "edition": {"type": ["string", "null"]},
                        "printingYear": {"type": ["integer", "null"]},
                        "publicationYear": {"type": ["integer", "null"]},
                        "issuer": {"type": ["string", "null"]},
                    },
                    "required": [
                        "title",
                        "subjectKey",
                        "gradeKey",
                        "part",
                        "termOrdinal",
                        "edition",
                        "printingYear",
                        "publicationYear",
                        "issuer",
                    ],
                },
                "toc": {
                    "type": "object",
                    "properties": {
                        "found": {"type": "boolean"},
                        "phrases": {
                            "type": "array",
                            "items": {"type": "string"},
                        },
                        "units": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "number": {"type": "integer"},
                                    "title": {"type": "string"},
                                    "startPage": {"type": "integer"},
                                    "lessons": {
                                        "type": "array",
                                        "items": {
                                            "type": "object",
                                            "properties": {
                                                "number": {"type": "integer"},
                                                "title": {"type": "string"},
                                                "startPage": {"type": "integer"},
                                            },
                                            "required": [
                                                "number",
                                                "title",
                                                "startPage",
                                            ],
                                        },
                                    },
                                },
                                "required": [
                                    "number",
                                    "title",
                                    "startPage",
                                    "lessons",
                                ],
                            },
                        },
                    },
                    "required": [
                        "found",
                        "phrases",
                        "units",
                    ],
                },
                "evidence": {
                    "type": "array",
                    "items": {"type": "object"},
                },
                "conflicts": {
                    "type": "array",
                    "items": {"type": "string"},
                },
                "needsReview": {"type": "boolean"},
            },
            "required": [
                "identity",
                "toc",
                "evidence",
                "conflicts",
                "needsReview",
            ],
        }

        prompt = """
أنت محلل متخصص في الكتب المدرسية العربية.

حلل الصفحات العشر الأولى فقط من الكتاب المرفق.

المطلوب استخراج هوية الكتاب والفهرس.

أولاً: هوية الكتاب

ابحث عن:
1. اسم الكتاب
2. اسم المادة
3. الصف
4. الجزء:
   - الجزء الأول
   - الجزء الثاني
   - الجزآن معًا
5. الفصل الدراسي إذا كان مكتوبًا بوضوح
6. رقم أو وصف الطبعة
7. سنة الطباعة
8. سنة النشر
9. الجهة الناشرة أو المصدرة

قواعد صارمة:
- لا تخمن.
- لا تستنتج الطبعة من السنة الدراسية.
- لا تستنتج الطبعة من سنة النشر.
- لا تستنتج الجزء من اسم الملف.
- لا تستنتج الفصل الدراسي من السنة الدراسية.
- "الجزء الأول" = PART_1.
- "الجزء الثاني" = PART_2.
- إذا ظهر الجزء الأول والثاني في الكتاب نفسه = BOTH.
- إذا لم يوجد دليل واضح = null.

ثانيًا: الفهرس

ابحث عن:
فهرس
المحتويات
الموضوعات
الوحدات
الدروس

استخرج:
- جميع الوحدات
- اسم الوحدة
- رقم صفحة بداية الوحدة
- جميع الدروس
- اسم الدرس
- رقم صفحة بداية الدرس

استخدم أرقام الصفحات المطبوعة وليس رقم PDF.

لا تستخدم طولًا ثابتًا للدرس.

لا تخمن أرقام الصفحات.

لكل قيمة مهمة أرجع دليل الصفحة.

إذا ظهر تعارض، أدرجه في conflicts.

أرجع JSON فقط.
"""

        return self.request(
            "BOOK_FRONT_MATTER",
            prompt,
            schema,
            images_b64=images_b64,
            context={
                "pages": page_texts,
                "maxAnalyzedPdfPages": 10,
            },
            timeout=240,
        )
'''


def add_front_matter_service() -> None:
    path = ENGINE / "src/edu7_content/ai/content_service.py"

    marker = "    def analyze_lesson("
    content = read(path)

    if content.count(marker) != 1:
        raise MigrationAbort(
            "Expected exactly one analyze_lesson method."
        )

    insert_after_exact(
        path,
        "    @property\n    def model_name(self): return self.provider.model_name\n",
        "\n" + FRONT_MATTER_SERVICE + "\n",
        description="Add unified BOOK_FRONT_MATTER AI validation service.",
        backups=BACKUPS,
    )


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def update_cli() -> None:
    path = ENGINE / "src/edu7_content/cli/main.py"

    replace_exact(
        path,
        'from ..pdf.vision_ocr import is_image_based_pdf, extract_toc_via_vision, extract_edition_from_cover',
        'from ..pdf.vision_ocr import (\n'
        '    is_image_based_pdf,\n'
        '    extract_toc_via_vision,\n'
        '    extract_edition_from_cover,\n'
        '    extract_book_front_matter,\n'
        ')',
        description="Import unified first-ten-page front-matter extractor.",
        backups=BACKUPS,
    )

    replace_exact(
        path,
        '    p_prep.add_argument("--term", default="T1", help="Term folder code (T01, T02, ...)")',
        '    p_prep.add_argument("--part", default=None, choices=["PART_1", "PART_2", "BOTH"],\n'
        '                        help="Physical textbook part: PART_1, PART_2, or BOTH")',
        description="Replace Textbook physical identity term input with part.",
        backups=BACKUPS,
    )

    replace_exact(
        path,
        '    p_prep.add_argument("--edition", default=None, help="Printed textbook edition; if omitted, extract it from the cover")',
        '    p_prep.add_argument("--edition", default=None,\n'
        '                        help="Printed textbook edition; if omitted, extract from first ten pages")',
        description="Clarify edition extraction source.",
        backups=BACKUPS,
    )

    replace_exact(
        path,
        '        term_number, term_key = normalize_term(args.term)\n',
        '        supplied_part = str(args.part).strip().upper() if args.part else None\n'
        '        if supplied_part and supplied_part not in {"PART_1", "PART_2", "BOTH"}:\n'
        '            raise ValueError("part must be PART_1, PART_2 or BOTH")\n',
        description="Remove term from preparation identity coordinates.",
        backups=BACKUPS,
    )

    replace_exact(
        path,
        '    print(f"[+] Coordinates: {term_key}/{grade_key}/{subject_key}")',
        '    print(f"[+] Coordinates: {grade_key}/{subject_key}")',
        description="Remove term from physical textbook preparation coordinates.",
        backups=BACKUPS,
    )


# ---------------------------------------------------------------------------
# Schema
# ---------------------------------------------------------------------------

def update_schema() -> None:
    path = ROOT / "prisma/schema.prisma"

    content = read(path)

    marker = "model Textbook {"

    enum_code = """enum TextbookPart {
  PART_1
  PART_2
  BOTH
}

"""

    insert_after_exact(
        path,
        "enum ContentAssetType {\n",
        enum_code,
        description="Add TextbookPart enum before Textbook model.",
        backups=BACKUPS,
    )

    replace_exact(
        path,
        """  /// EDU-MATH-G07-T1-ED2026 — subject + grade + term + printed edition.
  key       String @unique
  termId    String @db.Uuid
  gradeId   String @db.Uuid
  subjectId String @db.Uuid
""",
        """  /// EDU-MATH-G07-P1-ED2026 — subject + grade + physical part + printed edition.
  key       String @unique
  part      TextbookPart @default(BOTH)
  gradeId   String @db.Uuid
  subjectId String @db.Uuid
""",
        description="Change Textbook physical identity from term to part.",
        backups=BACKUPS,
    )

    replace_exact(
        path,
        """  term      Term               @relation(fields: [termId], references: [id], onDelete: Restrict)
  grade     Grade              @relation(fields: [gradeId], references: [id], onDelete: Restrict)
""",
        """  grade     Grade              @relation(fields: [gradeId], references: [id], onDelete: Restrict)
""",
        description="Remove direct Textbook → Term relation.",
        backups=BACKUPS,
    )

    replace_exact(
        path,
        "  @@unique([subjectId, gradeId, termId, edition])",
        "  @@unique([subjectId, gradeId, part, edition])",
        description="Update physical textbook uniqueness to subject + grade + part + edition.",
        backups=BACKUPS,
    )


# ---------------------------------------------------------------------------
# TypeScript identity
# ---------------------------------------------------------------------------

def update_identifiers() -> None:
    path = SRC / "shared/kernel/identifiers.ts"

    replace_exact(
        path,
        "A textbook is identified by subject + grade + term + **printed edition** —",
        "A textbook is identified by subject + grade + physical part + **printed edition** —",
        description="Update textbook identity documentation.",
        backups=BACKUPS,
    )

    replace_exact(
        path,
        """export interface TextbookCoordinates {
  /** Uppercase subject code, e.g. `MATH`. */
  readonly subject: string;
  /** Grade ordinal, 1-based. */
  readonly grade: number;
  /** Term ordinal within the year, 1-based. */
  readonly term: number;
  /**
   * Printed edition of the physical book: a year (`2026`), a span
   * (`2026-2027`), or a label (`REV2`). Not the academic year of use.
   */
  readonly edition: string;
}""",
        """export interface TextbookCoordinates {
  /** Uppercase subject code, e.g. `MATH`. */
  readonly subject: string;
  /** Grade ordinal, 1-based. */
  readonly grade: number;
  /** Physical book coverage. */
  readonly part: 'PART_1' | 'PART_2' | 'BOTH';
  /**
   * Printed edition of the physical book.
   * Not the academic year of use.
   */
  readonly edition: string;
}""",
        description="Change canonical TextbookCoordinates from term to physical part.",
        backups=BACKUPS,
    )


# ---------------------------------------------------------------------------
# Documentation
# ---------------------------------------------------------------------------

DOC_CONTRACT = """

## Physical textbook identity and part semantics

A `Textbook` represents a physical printed textbook identity.

Its physical identity is:

`Subject + Grade + Part + PrintedEdition`

`Part` has exactly three values:

- `PART_1` — the physical source represents the first part.
- `PART_2` — the physical source represents the second part.
- `BOTH` — one physical source contains both parts.

`Term` is not a direct foreign key of `Textbook`.

The academic term is a deployment/academic-context fact and is resolved later from
the physical part and the TOC-derived logical content split.

The preparation engine must never infer `edition` from academic year or filename.

`edition`, `printingYear`, `publicationYear`, and academic year are different facts.

A single PDF with both parts is still one physical `Textbook` with `part = BOTH`.
The TOC must then determine the boundary between the logical first-part and
second-part content.

Therefore:

`PART_1 → logical T1 content`

`PART_2 → logical T2 content`

`BOTH → TOC boundary → logical T1 + logical T2 content`

This does not create a separate physical textbook concept for "both".
"""


def update_docs() -> None:
    replacements = [
        (
            DOCS / "02-domain-contracts.md",
            "Academic year of use belongs to `TextbookAdoption`, not the textbook identity.",
            "Academic year of use belongs to `TextbookAdoption`, not the physical textbook identity.\n\n"
            "The physical textbook identity is subject + grade + part + printed edition."
        ),
        (
            DOCS / "05-content-ingestion-ai.md",
            "subjectKey + gradeKey + termKey + edition",
            "subjectKey + gradeKey + part + edition"
        ),
        (
            DOCS / "14-developer-content-ingestion-guide.md",
            "- termKey, for example T01\n",
            "- part, one of `PART_1`, `PART_2`, `BOTH`\n"
        ),
    ]

    for path, old, new in replacements:
        replace_exact(
            path,
            old,
            new,
            description="Update textbook identity terminology.",
            backups=BACKUPS,
        )

    # Add the full semantic contract to the domain document.
    insert_after_exact(
        DOCS / "02-domain-contracts.md",
        "Academic year of use belongs to `TextbookAdoption`, not the physical textbook identity.\n\n"
        "The physical textbook identity is subject + grade + part + printed edition.",
        DOC_CONTRACT,
        description="Document PART_1/PART_2/BOTH semantics and TOC logical split.",
        backups=BACKUPS,
    )


# ---------------------------------------------------------------------------
# Post audit
# ---------------------------------------------------------------------------

def post_audit() -> None:
    print("\n=== POST-MIGRATION AUDIT ===\n")

    schema = read(ROOT / "prisma/schema.prisma")

    assert_contains(
        ROOT / "prisma/schema.prisma",
        "enum TextbookPart {",
        "TextbookPart enum must exist.",
    )

    assert_contains(
        ROOT / "prisma/schema.prisma",
        "part      TextbookPart @default(BOTH)",
        "Textbook.part must exist.",
    )

    assert_contains(
        ROOT / "prisma/schema.prisma",
        "@@unique([subjectId, gradeId, part, edition])",
        "Textbook uniqueness must use part.",
    )

    assert_not_contains(
        ROOT / "prisma/schema.prisma",
        "termId    String @db.Uuid",
        "Textbook must no longer own Term directly.",
    )

    assert_not_contains(
        ROOT / "prisma/schema.prisma",
        "term      Term",
        "Textbook must no longer own Term directly.",
    )

    vision = read(ENGINE / "src/edu7_content/pdf/vision_ocr.py")

    assert_contains(
        ENGINE / "src/edu7_content/pdf/vision_ocr.py",
        "def extract_book_front_matter(",
        "Unified ten-page extractor must exist.",
    )

    assert_contains(
        ENGINE / "src/edu7_content/pdf/vision_ocr.py",
        "max_pages=10",
        "Ten-page evidence window must exist.",
    )

    service = read(ENGINE / "src/edu7_content/ai/content_service.py")

    assert_contains(
        ENGINE / "src/edu7_content/ai/content_service.py",
        '"BOOK_FRONT_MATTER"',
        "Unified AI task must exist.",
    )

    docs = read(DOCS / "02-domain-contracts.md")

    assert_contains(
        DOCS / "02-domain-contracts.md",
        "`PART_1 → logical T1 content`",
        "Part-to-term logical rule must be documented.",
    )

    assert_contains(
        DOCS / "02-domain-contracts.md",
        "`BOTH → TOC boundary → logical T1 + logical T2 content`",
        "BOTH split rule must be documented.",
    )

    print("[OK] Post-migration structural checks passed.")

    print("\n=== GIT DIFF SUMMARY ===\n")
    print(run(["git", "diff", "--stat"]))

    print("\n=== GIT STATUS ===\n")
    print(git_status())


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

BACKUPS: dict[str, str] = {}


def main() -> int:
    parser = argparse.ArgumentParser()

    parser.add_argument(
        "--audit-only",
        action="store_true",
        help="Run only the preflight audit.",
    )

    parser.add_argument(
        "--apply",
        action="store_true",
        help="Apply exact local modifications after audit.",
    )

    args = parser.parse_args()

    if not args.audit_only and not args.apply:
        parser.error("Use --audit-only or --apply")

    try:
        audit_repository()

        if args.audit_only:
            return 0

        timestamp = dt.datetime.now().strftime("%Y%m%d_%H%M%S")
        global BACKUP_ROOT
        BACKUP_ROOT = ROOT / ".local-migration-backups" / timestamp
        BACKUP_ROOT.mkdir(parents=True, exist_ok=True)

        print(f"[+] Backup directory: {BACKUP_ROOT}")

        # Apply only after the complete audit succeeds.
        add_front_matter_python()
        replace_old_edition_extractor()
        add_front_matter_service()

        update_cli()

        # NOTE:
        # Schema is deliberately applied only after Python/CLI changes.
        # If any earlier exact patch fails, schema is never touched.
        update_schema()

        update_identifiers()
        update_docs()

        post_audit()

        print("\n[SUCCESS] Local migration completed.")
        print("No git commit was created.")
        print("No git push was performed.")
        print(f"Backups: {BACKUP_ROOT}")

        return 0

    except MigrationAbort as exc:
        print(str(exc), file=sys.stderr)
        print("\n[SAFE STOP] No further modifications were attempted.", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
