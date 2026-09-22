#!/usr/bin/env python3

from __future__ import annotations

import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]

TARGET_ROOTS = [
    ROOT / "src",
    ROOT / "tests",
    ROOT / "prisma" / "seed",
]

EXCLUDED_PARTS = {
    "node_modules",
    ".git",
    "dist",
    "build",
    "coverage",
    ".next",
    ".vite",
    ".local-migration-backups",
}

SUFFIXES = {".ts", ".tsx"}

PATTERNS = {
    "termId": re.compile(r"\btermId\b"),
    "termKey": re.compile(r"\btermKey\b"),
    "textbookKey": re.compile(r"\btextbookKey\s*\("),
    "TextbookCoordinates": re.compile(r"\bTextbookCoordinates\b"),
    "textbookId": re.compile(r"\btextbookId\b"),
    "Textbook": re.compile(r"\bTextbook\b"),
    "textbook": re.compile(r"\btextbook\b"),
}


def iter_files():
    for root in TARGET_ROOTS:
        if not root.exists():
            continue

        for path in root.rglob("*"):
            if not path.is_file():
                continue

            if path.suffix not in SUFFIXES:
                continue

            if any(part in EXCLUDED_PARTS for part in path.parts):
                continue

            yield path


def main():
    print("=== STAGE 1: TEXTBOOK TERM INVENTORY ===")
    print()

    total = 0

    for path in sorted(iter_files()):
        lines = path.read_text(encoding="utf-8").splitlines()

        for number, line in enumerate(lines, 1):
            matched = [
                name
                for name, pattern in PATTERNS.items()
                if pattern.search(line)
            ]

            if not matched:
                continue

            total += 1

            relative = path.relative_to(ROOT)

            print(
                f"{relative}:{number} "
                f"[{','.join(matched)}]"
            )
            print(f"    {line.strip()}")

    print()
    print(f"TOTAL MATCHING LINES: {total}")


if __name__ == "__main__":
    main()
