#!/usr/bin/env python3
"""
Audit the latest two Git commits.

Usage:
  python Audit_codex/audit_commit_changes.py
  python Audit_codex/audit_commit_changes.py HEAD~1 HEAD

Report-only: this tool never changes the working tree.
It reports line counts, file additions/deletions, addition-only files, and
likely added/removed function signatures for TypeScript/JavaScript/Python.
"""

from __future__ import annotations

import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE_EXTENSIONS = {".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py"}
IGNORED_PARTS = {"node_modules", ".git", "dist", "build", ".next", "coverage"}

FUNCTION_PATTERNS = [
    re.compile(r"^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\("),
    re.compile(r"^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>"),
    re.compile(r"^\s*(?:async\s+)?def\s+([A-Za-z_][\w]*)\s*\("),
]

@dataclass
class FileStat:
    path: str
    old_lines: int
    new_lines: int
    added: int
    deleted: int
    status: str

def run(*args: str) -> str:
    return subprocess.check_output(
        ["git", *args], cwd=ROOT, text=True, stderr=subprocess.STDOUT
    )

def line_count(text: str) -> int:
    return len(text.splitlines())

def function_signatures(text: str) -> set[str]:
    found: set[str] = set()
    for line in text.splitlines():
        for pattern in FUNCTION_PATTERNS:
            match = pattern.match(line)
            if match:
                found.add(match.group(1))
    return found

def is_source(path: str) -> bool:
    p = Path(path)
    return p.suffix in SOURCE_EXTENSIONS and not any(
        part in IGNORED_PARTS for part in p.parts
    )

def parse_numstat(text: str, base: str, head: str) -> list[FileStat]:
    rows: list[FileStat] = []
    for line in text.splitlines():
        parts = line.split("\t")
        if len(parts) != 3:
            continue
        added, deleted, path = parts
        if added == "-" or deleted == "-":
            continue
        try:
            added_n = int(added)
            deleted_n = int(deleted)
        except ValueError:
            continue

        try:
            old = line_count(run("show", f"{base}:{path}"))
        except subprocess.CalledProcessError:
            old = 0
        try:
            new = line_count(run("show", f"{head}:{path}"))
        except subprocess.CalledProcessError:
            new = 0

        if added_n > 0 and deleted_n == 0:
            status = "ADDITION_ONLY"
        elif added_n == 0 and deleted_n > 0:
            status = "DELETION_ONLY"
        else:
            status = "MODIFIED"

        rows.append(FileStat(path, old, new, added_n, deleted_n, status))
    return rows

def main() -> int:
    base = sys.argv[1] if len(sys.argv) > 1 else "HEAD~1"
    head = sys.argv[2] if len(sys.argv) > 2 else "HEAD"

    try:
        old_sha = run("rev-parse", base).strip()
        new_sha = run("rev-parse", head).strip()
    except subprocess.CalledProcessError as exc:
        print(f"ERROR: cannot resolve commits: {exc.output}")
        return 2

    print("=" * 72)
    print("CODEX COMMIT AUDIT")
    print("=" * 72)
    print(f"Base : {base} ({old_sha[:12]})")
    print(f"Head : {head} ({new_sha[:12]})")
    print(f"Commit: {run('show', '-s', '--format=%s', head).strip()}")

    try:
        diff_stat = run("diff", "--shortstat", base, head).strip()
        numstat = run("diff", "--numstat", base, head)
    except subprocess.CalledProcessError as exc:
        print(f"ERROR: cannot compare commits: {exc.output}")
        return 2

    files = parse_numstat(numstat, base, head)
    total_added = sum(x.added for x in files)
    total_deleted = sum(x.deleted for x in files)

    print(f"Summary: {diff_stat or 'no textual changes'}")
    print(f"Lines : +{total_added} / -{total_deleted}")
    print()
    print("FILE CHANGES")
    print("-" * 72)
    for item in files:
        print(
            f"{item.status:14} {item.path} | "
            f"old={item.old_lines} new={item.new_lines} | "
            f"+{item.added}/-{item.deleted}"
        )

    deleted_functions: list[tuple[str, list[str]]] = []
    added_functions: list[tuple[str, list[str]]] = []

    for item in files:
        if not is_source(item.path):
            continue

        try:
            old_text = run("show", f"{base}:{item.path}")
        except subprocess.CalledProcessError:
            old_text = ""
        try:
            new_text = run("show", f"{head}:{item.path}")
        except subprocess.CalledProcessError:
            new_text = ""

        old_funcs = function_signatures(old_text)
        new_funcs = function_signatures(new_text)

        removed = sorted(old_funcs - new_funcs)
        added = sorted(new_funcs - old_funcs)

        if removed:
            deleted_functions.append((item.path, removed))
        if added:
            added_functions.append((item.path, added))

    print()
    print("FUNCTION / API SIGNATURE CHECK")
    print("-" * 72)
    if deleted_functions:
        print("WARNING: likely deleted function signatures detected:")
        for path, names in deleted_functions:
            print(f"  - {path}: {', '.join(names)}")
    else:
        print("OK: no likely deleted function signatures detected.")

    if added_functions:
        print("Added function signatures:")
        for path, names in added_functions:
            print(f"  + {path}: {', '.join(names)}")
    else:
        print("Added function signatures: none detected.")

    print()
    print("DECISION SIGNAL")
    print("-" * 72)
    if deleted_functions:
        print(
            "REVIEW_REQUIRED: function signatures disappeared. "
            "Inspect the diff before continuing."
        )
    elif total_deleted == 0 and total_added > 0:
        print(
            "LOW_RISK_SIGNAL: additions-only at line level; "
            "no deleted lines detected."
        )
    elif total_deleted > 0:
        print(
            "REVIEW_REQUIRED: deletions exist. "
            "This is not proof of a defect, but review is recommended."
        )
    else:
        print("NO_CHANGE: no textual line changes detected.")

    print()
    print(
        "NOTE: This is a guardrail, not a correctness proof. "
        "Renames/moves, multiline declarations, generated files, and "
        "semantic regressions require review and project tests."
    )

    return 1 if deleted_functions else 0

if __name__ == "__main__":
    raise SystemExit(main())
