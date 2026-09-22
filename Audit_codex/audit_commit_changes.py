#!/usr/bin/env python3
"""
Audit the latest project commit and write machine-readable feedback.

Usage:
  python Audit_codex/audit_commit_changes.py
  python Audit_codex/audit_commit_changes.py <old-commit> <new-commit>

Default mode is intentionally "latest project commit":
- It ignores commits whose changes are only inside Audit_codex/report.
- It audits the newest commit that changed project files outside Audit_codex/report.
- The comparison base is that commit's first parent.
- Historical explicit comparisons are reported as historical and MUST NOT be
  treated as the decision source for the latest project change.

The generated feedback is written to:
  Audit_codex/report/latest_commit_feedback.txt

The report is overwritten on every run. This tool never modifies source code.
"""

from __future__ import annotations

import re
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPORT_DIR = Path(__file__).resolve().parent / "report"
REPORT_FILE = REPORT_DIR / "latest_commit_feedback.txt"

SOURCE_EXTENSIONS = {".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py"}
IGNORED_PARTS = {"node_modules", ".git", "dist", "build", ".next", "coverage"}
AUDIT_PREFIX = "Audit_codex/report/"

FUNCTION_PATTERNS = [
    re.compile(
        r"^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\("
    ),
    re.compile(
        r"^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>"
    ),
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


def is_decision_relevant_path(path: str) -> bool:
    return not path.startswith(AUDIT_PREFIX)


def commit_changed_paths(commit: str) -> list[str]:
    return [
        path
        for path in run("diff-tree", "--no-commit-id", "--name-only", "-r", commit)
        .splitlines()
        if path
    ]


def find_latest_project_commit(start: str = "HEAD") -> tuple[str, str]:
    """
    Find the newest commit that changed something outside Audit_codex/report.

    Returns (commit_sha, reason). The first parent of that commit is the
    authoritative comparison base.
    """
    commits = run("rev-list", start).splitlines()
    for commit in commits:
        paths = commit_changed_paths(commit)
        relevant = [p for p in paths if is_decision_relevant_path(p)]
        if relevant:
            return commit, (
                "Latest commit with project changes outside "
                "Audit_codex/report."
            )
    raise RuntimeError("No project commit found outside Audit_codex/report.")


def parent_of(commit: str) -> str:
    parents = run("rev-list", "--parents", "-n", "1", commit).split()
    if len(parents) < 2:
        raise RuntimeError(f"Commit {commit[:12]} has no parent to compare.")
    return parents[1]


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


def build_report(base: str, head: str, historical: bool, selection_reason: str) -> tuple[str, int]:
    old_sha = run("rev-parse", base).strip()
    new_sha = run("rev-parse", head).strip()
    commit_subject = run("show", "-s", "--format=%s", head).strip()
    commit_date = run("show", "-s", "--format=%cI", head).strip()

    diff_stat = run("diff", "--shortstat", base, head).strip()
    numstat = run("diff", "--numstat", base, head)
    files = parse_numstat(numstat, base, head)
    total_added = sum(x.added for x in files)
    total_deleted = sum(x.deleted for x in files)

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

    if deleted_functions:
        decision = "REVIEW_REQUIRED"
        decision_reason = (
            "Likely function signatures disappeared. Inspect the diff and "
            "verify callers before allowing the next AI change."
        )
        exit_code = 1
    elif total_deleted > 0:
        decision = "REVIEW_REQUIRED"
        decision_reason = (
            "Deleted lines exist. This is not proof of a defect, but the "
            "change must be reviewed before continuing."
        )
        exit_code = 0
    elif total_added > 0:
        decision = "LOW_RISK_SIGNAL"
        decision_reason = (
            "No deleted lines detected. This is only a line-level signal, "
            "not proof of correctness."
        )
        exit_code = 0
    else:
        decision = "NO_CHANGE"
        decision_reason = "No textual line changes detected."
        exit_code = 0

    if historical:
        decision = "HISTORICAL_ONLY"
        decision_reason = (
            "This comparison was explicitly requested between commits. "
            "Do NOT use this report as the decision source for the latest "
            "project change. Run the default command for the current change."
        )
        exit_code = 0

    lines: list[str] = []
    lines.append("=" * 78)
    lines.append("EDU_V10 LATEST COMMIT FEEDBACK")
    lines.append("=" * 78)
    lines.append(f"Generated: {datetime.now(timezone.utc).isoformat()}")
    lines.append("")
    lines.append("DECISION SCOPE")
    lines.append("-" * 78)
    if historical:
        lines.append("SCOPE: HISTORICAL COMPARISON — NOT A DECISION SOURCE")
    else:
        lines.append("SCOPE: LATEST PROJECT COMMIT — DECISION SOURCE")
    lines.append(f"Selection: {selection_reason}")
    lines.append("")
    lines.append("COMMITS")
    lines.append("-" * 78)
    lines.append(f"Base : {base} ({old_sha})")
    lines.append(f"Head : {head} ({new_sha})")
    lines.append(f"Date : {commit_date}")
    lines.append(f"Commit: {commit_subject}")
    lines.append("")
    lines.append("CHANGE SUMMARY")
    lines.append("-" * 78)
    lines.append(f"Git diff: {diff_stat or 'no textual changes'}")
    lines.append(f"Lines: +{total_added} / -{total_deleted}")
    lines.append("")
    lines.append("FILE CHANGES")
    lines.append("-" * 78)
    if files:
        for item in files:
            lines.append(
                f"{item.status:14} {item.path} | "
                f"old={item.old_lines} new={item.new_lines} | "
                f"+{item.added}/-{item.deleted}"
            )
    else:
        lines.append("No file-level textual changes detected.")
    lines.append("")
    lines.append("FUNCTION / API SIGNATURE CHECK")
    lines.append("-" * 78)
    if deleted_functions:
        lines.append("WARNING: likely deleted function signatures:")
        for path, names in deleted_functions:
            lines.append(f"  - {path}: {', '.join(names)}")
    else:
        lines.append("OK: no likely deleted function signatures detected.")

    if added_functions:
        lines.append("Added function signatures:")
        for path, names in added_functions:
            lines.append(f"  + {path}: {', '.join(names)}")
    else:
        lines.append("Added function signatures: none detected.")
    lines.append("")
    lines.append("DECISION SIGNAL")
    lines.append("-" * 78)
    lines.append(decision)
    lines.append(decision_reason)
    lines.append("")
    lines.append("AI DECISION RULE")
    lines.append("-" * 78)
    if historical:
        lines.append(
            "IGNORE THIS REPORT FOR DECIDING WHETHER THE LATEST CHANGE IS "
            "CORRECT. It describes an older/external comparison only."
        )
    else:
        lines.append(
            "This report describes the latest project commit relative to its "
            "immediate first parent. Use it as the first change-safety "
            "feedback before continuing to another AI coding step."
        )
        lines.append(
            "A REVIEW_REQUIRED signal means stop and inspect the diff; it "
            "does not by itself prove that the implementation is wrong."
        )
    lines.append("")
    lines.append("LIMITATIONS")
    lines.append("-" * 78)
    lines.append(
        "This is a guardrail, not a correctness proof. Renames/moves, "
        "multiline declarations, generated files, semantic regressions, "
        "and runtime behavior require deeper review and project tests."
    )
    return "\n".join(lines) + "\n", exit_code


def main() -> int:
    try:
        if len(sys.argv) == 1:
            head, reason = find_latest_project_commit()
            base = parent_of(head)
            historical = False
        elif len(sys.argv) == 3:
            base = sys.argv[1]
            head = sys.argv[2]
            reason = (
                "Explicit commit range requested. This is historical-only "
                "feedback and is not used as the latest-change decision source."
            )
            historical = True
        else:
            print(
                "Usage: python Audit_codex/audit_commit_changes.py "
                "[<old-commit> <new-commit>]"
            )
            return 2

        report, exit_code = build_report(base, head, historical, reason)
        REPORT_DIR.mkdir(parents=True, exist_ok=True)
        REPORT_FILE.write_text(report, encoding="utf-8")

        print(report)
        print(f"\nREPORT SAVED: {REPORT_FILE}")
        return exit_code
    except (subprocess.CalledProcessError, RuntimeError) as exc:
        print(f"ERROR: {exc}")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
