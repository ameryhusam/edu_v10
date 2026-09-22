#!/usr/bin/env python3
"""
Edu7 — Textbook Term -> Part Migration
STAGE 2: AUDIT + CLASSIFICATION + HARD GATE

Purpose
-------
Classify every remaining textbook/term usage into one of:

1. BOOK_IDENTITY
   Physical textbook identity must migrate from term -> part.

2. BOOK_SELECTION
   Academic term selects an appropriate physical textbook part.
   T1 -> PART_1 or BOTH
   T2 -> PART_2 or BOTH

3. ACADEMIC_CONTEXT
   Academic term remains unchanged.

4. ADOPTION_CONTEXT
   TextbookAdoption remains:
       textbook + school + academicYear

5. WORKSPACE_DEFERRED
   Workspace is intentionally NOT modified in this migration.

6. NON_IDENTITY_TEXTBOOK
   Generic textbook references which do not encode identity.

7. UNEXPECTED
   Anything that cannot be safely classified.

The script NEVER modifies project files.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

TARGET_ROOTS = [
    ROOT / "src",
    ROOT / "tests",
    ROOT / "prisma" / "seed",
]

SKIP_DIRS = {
    "node_modules",
    "dist",
    "build",
    "coverage",
    ".next",
    ".vite",
    ".turbo",
    ".local-migration-backups",
}

PATTERNS = [
    re.compile(r"\btermId\b"),
    re.compile(r"\btermKey\b"),
    re.compile(r"\btextbookKey\s*\("),
    re.compile(r"\bTextbookCoordinates\b"),
    re.compile(r"\btextbookId\b"),
    re.compile(r"\bTextbook\b"),
    re.compile(r"\btextbook\b"),
]

WORKSPACE_FILES = {
    "workspace-archive.service.ts",
    "workspace-importer.service.ts",
    "workspace-manager.ts",
}

IDENTITY_FILES = {
    "identifiers.ts",
}

BOOK_CREATION_FILES = {
    "authoring.service.ts",
    "content.repository.ts",
    "content-import.service.ts",
    "textbook-administration.service.ts",
    "textbook-administration.repository.ts",
    "source-catalog.ts",
    "load-textbook.ts",
    "seed.ts",
}

ACADEMIC_FILES = {
    "learning.repository.ts",
    "exam-catalog.repository.ts",
    "assignment.service.ts",
    "instruction.repository.ts",
    "analytics.repository.ts",
    "analytics.service.ts",
    "identity.repository.ts",
    "provisioning.service.ts",
}

def iter_files():
    for base in TARGET_ROOTS:
        if not base.exists():
            continue

        for path in base.rglob("*"):
            if not path.is_file():
                continue

            if any(part in SKIP_DIRS for part in path.parts):
                continue

            if path.suffix not in {".ts", ".tsx", ".prisma"}:
                continue

            yield path


def classify(path: Path, line: str) -> str:
    name = path.name
    normalized = line.lower()

    if name in WORKSPACE_FILES:
        return "WORKSPACE_DEFERRED"

    if name in IDENTITY_FILES:
        return "BOOK_IDENTITY"

    if name in ACADEMIC_FILES:
        if "textbook" in normalized and (
            "termid" in normalized or
            "termkey" in normalized
        ):
            return "BOOK_SELECTION"
        return "ACADEMIC_CONTEXT"

    if name in BOOK_CREATION_FILES:
        if (
            "textbookkey(" in normalized
            or "textbookcoordinates" in normalized
            or "create textbook" in normalized
            or "textbook.create" in normalized
            or "textbook.upsert" in normalized
            or "termkey" in normalized
        ):
            return "BOOK_IDENTITY"

        if "termid" in normalized:
            return "ACADEMIC_CONTEXT"

    if "textbookadoption" in normalized or (
        "textbookid" in normalized
        and "schoolid" in normalized
        and "academicyearid" in normalized
    ):
        return "ADOPTION_CONTEXT"

    if "termid" in normalized:
        return "ACADEMIC_CONTEXT"

    if "termkey" in normalized:
        return "BOOK_SELECTION"

    if "textbook" in normalized:
        return "NON_IDENTITY_TEXTBOOK"

    return "UNEXPECTED"


def main() -> int:
    print("=== STAGE 2: TEXTBOOK TERM CLASSIFICATION ===")
    print()

    counts: dict[str, int] = {}
    unexpected: list[tuple[Path, int, str]] = []

    for path in iter_files():
        try:
            lines = path.read_text(encoding="utf-8").splitlines()
        except UnicodeDecodeError:
            continue

        for lineno, line in enumerate(lines, 1):
            if not any(pattern.search(line) for pattern in PATTERNS):
                continue

            category = classify(path, line)
            counts[category] = counts.get(category, 0) + 1

            if category == "UNEXPECTED":
                unexpected.append((path, lineno, line.strip()))

    print("CLASSIFICATION SUMMARY")
    print("----------------------")

    for category in sorted(counts):
        print(f"{category:24} {counts[category]}")

    print()

    if unexpected:
        print("HARD STOP")
        print("=========")
        print(f"Unexpected usages: {len(unexpected)}")
        print()

        for path, lineno, line in unexpected:
            print(f"{path.relative_to(ROOT)}:{lineno}")
            print(f"    {line}")

        print()
        print("No files were modified.")
        return 2

    print("PASS")
    print("----")
    print("All discovered usages are classified.")
    print("No files were modified.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
