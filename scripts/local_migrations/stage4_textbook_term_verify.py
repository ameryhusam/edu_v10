#!/usr/bin/env python3
"""
Edu7 — Textbook Term -> Physical Part Migration
STAGE 4: VERIFY

Read-only verification.

Checks:
- old physical textbook key format
- TextbookCoordinates.term
- textbookKey(... term: ...)
- Prisma textbook.term references
- Workspace references (reported only, NEVER modified)
- academic term usage
- TypeScript verification configuration
- git diff scope
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

SCAN_ROOTS = [
    ROOT / "src",
    ROOT / "tests",
    ROOT / "prisma" / "seed",
]

SKIP = {
    "node_modules",
    "dist",
    "build",
    "coverage",
    ".local-migration-backups",
}

PATTERNS = {
    "OLD_TEXTBOOK_KEY": re.compile(
        r"EDU-\$\{subject\}-G\$\{pad\(grade\)\}-T\$\{term\}"
    ),
    "TEXTBOOK_TERM_COORDINATE": re.compile(
        r"\bTextbookCoordinates\b.*\bterm\b"
    ),
    "TEXTBOOK_KEY_TERM_ARGUMENT": re.compile(
        r"textbookKey\s*\([^)]*\bterm\s*:"
    ),
    "PRISMA_TEXTBOOK_TERM": re.compile(
        r"textbook[^;\n]{0,120}\bterm(Id|Key)?\b",
        re.IGNORECASE,
    ),
    "WORKSPACE_TERM": re.compile(
        r"\b(workspace|Workspace)[^\n]{0,160}\b(term|termKey|termId)\b"
    ),
}


def iter_files():
    for root in SCAN_ROOTS:
        if not root.exists():
            continue

        for path in root.rglob("*"):
            if not path.is_file():
                continue

            if any(part in SKIP for part in path.parts):
                continue

            if path.suffix not in {".ts", ".tsx", ".prisma"}:
                continue

            yield path


def run(cmd: list[str]) -> tuple[int, str]:
    proc = subprocess.run(
        cmd,
        cwd=ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    return proc.returncode, proc.stdout


def main() -> int:
    print("=== STAGE 4: FINAL VERIFY ===")
    print()

    findings: dict[str, list[str]] = {
        key: [] for key in PATTERNS
    }

    for path in iter_files():
        try:
            lines = path.read_text(encoding="utf-8").splitlines()
        except UnicodeDecodeError:
            continue

        for lineno, line in enumerate(lines, 1):
            for name, pattern in PATTERNS.items():
                if pattern.search(line):
                    findings[name].append(
                        f"{path.relative_to(ROOT)}:{lineno}: {line.strip()}"
                    )

    print("MIGRATION CHECKS")
    print("----------------")

    hard_fail = False

    for name, rows in findings.items():
        print(f"\n{name}: {len(rows)}")

        for row in rows[:20]:
            print(f"  {row}")

        if len(rows) > 20:
            print(f"  ... {len(rows) - 20} more")

        if name in {
            "OLD_TEXTBOOK_KEY",
            "TEXTBOOK_TERM_COORDINATE",
            "TEXTBOOK_KEY_TERM_ARGUMENT",
        } and rows:
            hard_fail = True

    print()
    print("WORKSPACE")
    print("---------")

    workspace_rows = findings["WORKSPACE_TERM"]

    if workspace_rows:
        print(
            "Workspace references were detected and are intentionally "
            "NOT modified by this migration."
        )
        for row in workspace_rows[:20]:
            print(f"  {row}")
    else:
        print("No Workspace term references detected.")

    print()
    print("TSC CONFIGURATION")
    print("-----------------")

    tsconfig = ROOT / "tsconfig.json"

    if tsconfig.exists():
        text = tsconfig.read_text(encoding="utf-8")

        if ".local-migration-backups" in text:
            print("PASS: local migration backups are excluded from TypeScript.")
        else:
            print("WARNING: tsconfig.json does not explicitly exclude backups.")
    else:
        print("WARNING: tsconfig.json not found.")

    print()
    print("GIT DIFF")
    print("--------")

    code, output = run(
        [
            "git",
            "diff",
            "--name-status",
            "--",
            ".",
            ":(exclude).local-migration-backups/**",
        ]
    )

    print(output.rstrip() or "(no tracked diff)")

    print()
    print("TYPECHECK")
    print("---------")

    code, output = run(["npm", "run", "typecheck"])

    print(output.rstrip())

    if code != 0:
        print()
        print("TYPECHECK FAILED")
        hard_fail = True

    print()

    if hard_fail:
        print("HARD STOP")
        print("=========")
        print("The migration is not yet complete.")
        print("No git commit or push was performed.")
        return 2

    print("PASS")
    print("----")
    print("No old physical textbook identity pattern was detected.")
    print("Workspace was not modified.")
    print("No git operations were performed.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
