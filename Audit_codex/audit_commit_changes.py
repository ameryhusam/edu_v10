#!/usr/bin/env python3
"""
Audit Codex changes as both individual commits and multi-commit task groups.

Usage:
  python Audit_codex/audit_commit_changes.py
  python Audit_codex/audit_commit_changes.py --base <commit> --head <commit>

Default mode:
- finds the newest project commit outside Audit_codex/
- treats it as the current head
- builds a candidate task group by walking backwards through related commits
- audits the cumulative task diff (candidate base -> head)
- also records every commit inside the candidate group
- writes an immutable timestamped report plus latest_commit_feedback.txt

Explicit --base/--head:
- authoritative task boundary requested by the user
- report is marked TASK_SCOPE_EXPLICIT
- this is the decision source for that requested task when the head is the
  latest project commit; otherwise it is historical-only

IMPORTANT:
- Audit_codex/report/index.txt is a human-controlled acceptance ledger.
- This program NEVER creates, edits, or rewrites index.txt.
- The index is changed only by explicit user instruction after a report has
  been discussed and accepted.
"""

from __future__ import annotations

import argparse
import re
import subprocess
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPORT_DIR = Path(__file__).resolve().parent / "report"
LATEST_FILE = REPORT_DIR / "latest_commit_feedback.txt"
INDEX_FILE = REPORT_DIR / "index.txt"

AUDIT_PREFIX = "Audit_codex/"
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


@dataclass
class CommitInfo:
    sha: str
    subject: str
    date: str
    paths: tuple[str, ...]


def run(*args: str) -> str:
    return subprocess.check_output(
        ["git", *args], cwd=ROOT, text=True, stderr=subprocess.STDOUT
    )


def safe_run(*args: str) -> str:
    try:
        return run(*args)
    except subprocess.CalledProcessError:
        return ""


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


def is_decision_relevant_path(path: str) -> bool:
    return not path.startswith(AUDIT_PREFIX)


def is_source(path: str) -> bool:
    p = Path(path)
    return p.suffix in SOURCE_EXTENSIONS and not any(
        part in IGNORED_PARTS for part in p.parts
    )


def changed_paths(commit: str) -> tuple[str, ...]:
    out = safe_run("diff-tree", "--no-commit-id", "--name-only", "-r", commit)
    return tuple(p for p in out.splitlines() if p)


def first_parent(commit: str) -> str:
    parents = run("rev-list", "--parents", "-n", "1", commit).split()
    if len(parents) < 2:
        raise RuntimeError(f"Commit {commit[:12]} has no first parent.")
    return parents[1]


def commit_info(commit: str) -> CommitInfo:
    return CommitInfo(
        sha=run("rev-parse", commit).strip(),
        subject=run("show", "-s", "--format=%s", commit).strip(),
        date=run("show", "-s", "--format=%cI", commit).strip(),
        paths=changed_paths(commit),
    )


def latest_project_commit(start: str = "HEAD") -> tuple[str, str]:
    for commit in run("rev-list", "--first-parent", start).splitlines():
        paths = changed_paths(commit)
        if any(is_decision_relevant_path(p) for p in paths):
            return commit, "Latest first-parent commit with project changes outside Audit_codex."
    raise RuntimeError("No project commit found outside Audit_codex.")


def normalize_subject(subject: str) -> str:
    # Keep the conventional prefix/scope, but remove issue/commit-specific noise.
    text = subject.lower().strip()
    text = re.sub(r"\b\d{5,}\b", " ", text)
    text = re.sub(r"[^a-z0-9_:/.-]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def scope_tokens(info: CommitInfo) -> set[str]:
    tokens: set[str] = set()
    for path in info.paths:
        if not is_decision_relevant_path(path):
            continue
        parts = Path(path).parts
        if parts:
            tokens.add(parts[0].lower())
        if len(parts) > 1:
            tokens.add("/".join(parts[:2]).lower())
        if len(parts) > 2:
            tokens.add("/".join(parts[:3]).lower())
    subject = normalize_subject(info.subject)
    for token in re.findall(r"[a-z0-9_]+", subject):
        if len(token) >= 4:
            tokens.add(token)
    return tokens


def related_score(left: CommitInfo, right: CommitInfo) -> int:
    left_paths = set(p for p in left.paths if is_decision_relevant_path(p))
    right_paths = set(p for p in right.paths if is_decision_relevant_path(p))
    overlap = len(left_paths & right_paths)
    left_top = {Path(p).parts[0].lower() for p in left_paths if Path(p).parts}
    right_top = {Path(p).parts[0].lower() for p in right_paths if Path(p).parts}
    top_overlap = len(left_top & right_top)
    token_overlap = len(scope_tokens(left) & scope_tokens(right))
    score = overlap * 5 + top_overlap * 2 + min(token_overlap, 4)
    if normalize_subject(left.subject).split(":", 1)[0] == normalize_subject(right.subject).split(":", 1)[0]:
        score += 3
    return score


def candidate_task_group(head: str, max_commits: int = 20) -> tuple[list[CommitInfo], str]:
    chain = run("rev-list", "--first-parent", head).splitlines()
    selected: list[CommitInfo] = []
    previous: CommitInfo | None = None
    boundary_reasons: list[str] = []

    for sha in chain[:max_commits]:
        info = commit_info(sha)
        if not any(is_decision_relevant_path(p) for p in info.paths):
            continue
        if previous is None:
            selected.append(info)
            previous = info
            continue

        score = related_score(previous, info)
        # Conservative automatic grouping: require meaningful continuity.
        if score < 3:
            boundary_reasons.append(
                f"boundary before {previous.sha[:12]}: relatedness score {score} < 3"
            )
            break
        selected.append(info)
        previous = info

    selected.reverse()
    if not selected:
        raise RuntimeError("Unable to identify a project task group.")

    if len(selected) == 1:
        confidence = "SINGLE_COMMIT_OR_NO_RELIABLE_MULTI_COMMIT_LINK"
    elif boundary_reasons:
        confidence = "CANDIDATE_GROUP_WITH_BOUNDARY_EVIDENCE"
    else:
        confidence = "CANDIDATE_GROUP_CONTINUITY_ONLY"

    return selected, confidence


def task_commits(base: str, head: str) -> list[CommitInfo]:
    commits = run("rev-list", "--first-parent", "--reverse", f"{base}..{head}").splitlines()
    return [commit_info(c) for c in commits if any(is_decision_relevant_path(p) for p in changed_paths(c))]


def parse_numstat(base: str, head: str) -> list[FileStat]:
    rows: list[FileStat] = []
    text = safe_run("diff", "--numstat", base, head)
    for line in text.splitlines():
        parts = line.split("\t")
        if len(parts) != 3:
            continue
        added, deleted, path = parts
        if added == "-" or deleted == "-":
            continue
        try:
            added_n, deleted_n = int(added), int(deleted)
        except ValueError:
            continue
        old = line_count(safe_run("show", f"{base}:{path}")) if safe_run("cat-file", "-e", f"{base}:{path}") else 0
        new = line_count(safe_run("show", f"{head}:{path}")) if safe_run("cat-file", "-e", f"{head}:{path}") else 0
        if added_n > 0 and deleted_n == 0:
            status = "ADDITION_ONLY"
        elif added_n == 0 and deleted_n > 0:
            status = "DELETION_ONLY"
        else:
            status = "MODIFIED"
        rows.append(FileStat(path, old, new, added_n, deleted_n, status))
    return rows


def signature_delta(base: str, head: str, files: list[FileStat]) -> tuple[list[tuple[str, list[str]]], list[tuple[str, list[str]]]]:
    removed: list[tuple[str, list[str]]] = []
    added: list[tuple[str, list[str]]] = []
    for item in files:
        if not is_source(item.path):
            continue
        old_text = safe_run("show", f"{base}:{item.path}")
        new_text = safe_run("show", f"{head}:{item.path}")
        old_funcs = function_signatures(old_text)
        new_funcs = function_signatures(new_text)
        r = sorted(old_funcs - new_funcs)
        a = sorted(new_funcs - old_funcs)
        if r:
            removed.append((item.path, r))
        if a:
            added.append((item.path, a))
    return removed, added


def commit_internal_risk(info: CommitInfo) -> str:
    try:
        parent = first_parent(info.sha)
    except RuntimeError:
        return "ROOT_COMMIT"
    files = parse_numstat(parent, info.sha)
    deleted = sum(f.deleted for f in files)
    if deleted:
        return "REVIEW_REQUIRED"
    if sum(f.added for f in files):
        return "LOW_RISK_SIGNAL"
    return "NO_CHANGE"


def accepted_reports() -> list[str]:
    # Read-only. The tool must never write the acceptance index.
    if not INDEX_FILE.exists():
        return []
    return [
        line.strip()
        for line in INDEX_FILE.read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    ]


def build_report(base: str, head: str, scope_kind: str, selection_reason: str, group: list[CommitInfo], confidence: str) -> tuple[str, int, str]:
    base_sha = run("rev-parse", base).strip()
    head_sha = run("rev-parse", head).strip()
    files = parse_numstat(base, head)
    total_added = sum(x.added for x in files)
    total_deleted = sum(x.deleted for x in files)
    deleted_functions, added_functions = signature_delta(base, head, files)

    is_latest = run("rev-parse", head).strip() == run("rev-parse", "HEAD").strip()
    if deleted_functions:
        decision = "REVIEW_REQUIRED"
        reason = "The cumulative task diff contains likely disappeared function signatures."
        exit_code = 1
    elif total_deleted:
        decision = "REVIEW_REQUIRED"
        reason = "The cumulative task diff contains textual deletions; inspect the task as a whole."
        exit_code = 0
    elif total_added:
        decision = "LOW_RISK_SIGNAL"
        reason = "No cumulative textual deletions detected; this is only a change-safety signal."
        exit_code = 0
    else:
        decision = "NO_CHANGE"
        reason = "No textual changes detected in the requested scope."
        exit_code = 0

    if not is_latest:
        decision_scope = "HISTORICAL_ONLY"
        scope_note = "Head is not the repository HEAD; this report is historical and is not the current decision source."
        exit_code = 0
    elif scope_kind == "EXPLICIT":
        decision_scope = "TASK_SCOPE_EXPLICIT"
        scope_note = "User-specified base/head define the Codex task boundary. This is the current decision source for that task."
    else:
        decision_scope = "TASK_SCOPE_CANDIDATE"
        scope_note = "Task boundary was inferred. Treat grouping as evidence, not certainty; explicit --base/--head overrides it."
    
    lines = [
        "=" * 90,
        "EDU_V10 CODEX TASK AUDIT FEEDBACK",
        "=" * 90,
        f"Generated: {datetime.now(timezone.utc).isoformat()}",
        "",
        "DECISION SCOPE",
        "-" * 90,
        f"SCOPE: {decision_scope}",
        f"Selection: {selection_reason}",
        f"Grouping confidence: {confidence}",
        f"Head is current HEAD: {'YES' if is_latest else 'NO'}",
        scope_note,
        "",
        "TASK BOUNDARY",
        "-" * 90,
        f"Base: {base} ({base_sha})",
        f"Head: {head} ({head_sha})",
        f"Commits in task group: {len(group)}",
        "",
        "COMMIT GROUP",
        "-" * 90,
    ]
    for idx, info in enumerate(group, 1):
        lines.append(
            f"{idx:02d}. {info.sha} | {info.date} | {commit_internal_risk(info)} | {info.subject}"
        )
        relevant_paths = [p for p in info.paths if is_decision_relevant_path(p)]
        lines.append(f"    files: {len(relevant_paths)}")
        for path in relevant_paths[:20]:
            lines.append(f"      - {path}")
        if len(relevant_paths) > 20:
            lines.append(f"      ... {len(relevant_paths)-20} more")
    lines += [
        "",
        "CUMULATIVE TASK DIFF",
        "-" * 90,
        f"Git diff: {safe_run('diff', '--shortstat', base, head).strip() or 'no textual changes'}",
        f"Lines: +{total_added} / -{total_deleted}",
        "",
        "FILE CHANGES (BASE -> HEAD)",
        "-" * 90,
    ]
    if files:
        for item in files:
            lines.append(
                f"{item.status:14} {item.path} | old={item.old_lines} new={item.new_lines} | +{item.added}/-{item.deleted}"
            )
    else:
        lines.append("No file-level textual changes detected.")
    lines += ["", "FUNCTION / API SIGNATURE CHECK", "-" * 90]
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

    lines += [
        "",
        "DECISION SIGNAL",
        "-" * 90,
        decision,
        reason,
        "",
        "HOW TO READ THIS REPORT",
        "-" * 90,
        "1. The COMMIT GROUP shows the individual Codex commits included in this task.",
        "2. CUMULATIVE TASK DIFF is the authoritative final-state comparison for this task.",
        "3. Do not sum deletions across individual commits: a later commit may restore or replace earlier changes.",
        "4. Per-commit REVIEW_REQUIRED is an internal warning; final task safety is judged from the cumulative diff plus semantic review.",
        "5. An accepted report is not recorded automatically. Audit_codex/report/index.txt is manually controlled.",
        "",
        "ACCEPTANCE INDEX STATUS (READ ONLY)",
        "-" * 90,
    ]
    accepted = accepted_reports()
    if accepted:
        lines.extend(f"- {x}" for x in accepted)
    else:
        lines.append("No accepted report entries detected (or index.txt does not exist).")
    
    lines += [
        "",
        "LIMITATIONS",
        "-" * 90,
        "Automatic grouping is conservative evidence, not proof of a Codex task boundary.",
        "Use --base <commit> --head <commit> when the task boundary is known.",
        "Function detection is signature-based and may miss multiline declarations, renames, moves, generated code, and semantic/API behavior changes.",
        "This guardrail does not prove runtime, database, API, architecture, or business-rule correctness.",
        "",
        "RECOMMENDED COMMANDS",
        "-" * 90,
        "Current inferred task:",
        "  python Audit_codex/audit_commit_changes.py",
        "Known task boundary:",
        "  python Audit_codex/audit_commit_changes.py --base <BASE_SHA> --head <HEAD_SHA>",
        "",
        "IMPORTANT: index.txt is human-controlled and is NEVER modified by this tool.",
    ]
    report = "\n".join(lines) + "\n"
    return report, exit_code, decision_scope


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base")
    parser.add_argument("--head")
    args = parser.parse_args()

    if (args.base is None) != (args.head is None):
        parser.error("--base and --head must be supplied together")

    try:
        if args.base and args.head:
            base = args.base
            head = args.head
            group = task_commits(base, head)
            if not group:
                group = [commit_info(head)]
            reason = "Explicit task boundary supplied by the user."
            scope_kind = "EXPLICIT"
            confidence = "AUTHORITATIVE_USER_BOUNDARY"
        else:
            head, reason = latest_project_commit()
            group, confidence = candidate_task_group(head)
            base = first_parent(group[0].sha)
            scope_kind = "AUTO"

        report, exit_code, _ = build_report(
            base, head, scope_kind, reason, group, confidence
        )
        REPORT_DIR.mkdir(parents=True, exist_ok=True)

        timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        base_short = run("rev-parse", "--short", base).strip()
        head_short = run("rev-parse", "--short", head).strip()
        archive = REPORT_DIR / f"audit_{timestamp}_{base_short}_{head_short}.txt"

        archive.write_text(report, encoding="utf-8")
        LATEST_FILE.write_text(report, encoding="utf-8")

        print(report)
        print(f"ARCHIVE REPORT: {archive}")
        print(f"LATEST FEEDBACK: {LATEST_FILE}")
        print("ACCEPTANCE INDEX: READ ONLY (never modified)")
        return exit_code
    except (subprocess.CalledProcessError, RuntimeError, OSError) as exc:
        print(f"ERROR: {exc}")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
