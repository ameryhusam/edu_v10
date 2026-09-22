#!/usr/bin/env python3
"""
Edu7 local migration: Workspace physical-part identity alignment.

This file is intentionally stored under scripts/local_migrations/.
It is NOT imported by the application and performs no work on import.

Commands:
  python scripts/local_migrations/workspace_identity_audit_and_migration.py audit
  python scripts/local_migrations/workspace_identity_audit_and_migration.py apply

Design:
- Workspace filesystem identity is: Workspace/<P1|P2|PB>/<Gxx>/<SUBJECT>/<ED...>/
- Textbook business identity is supplied by the CLI/domain canonical key.
- Academic Term is not a Workspace coordinate.
- The migration does not touch Prisma, TypeScript, or persisted data.
- apply creates timestamped .bak files before changing anything.
- All changes are guarded by AST/structural checks; no global word replacement.
"""

from __future__ import annotations

import argparse
import ast
import re
import shutil
import sys
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
ENGINE = ROOT / "edu7-content-engine"
SRC = ENGINE / "src" / "edu7_content"
LAYOUT = SRC / "workspace_layout.py"
SEGMENTATION = SRC / "pdf" / "segmentation.py"
CLI = SRC / "cli" / "main.py"


def fail(message: str) -> None:
    raise RuntimeError(message)


def read(path: Path) -> str:
    if not path.is_file():
        fail(f"Missing required file: {path}")
    return path.read_text(encoding="utf-8")


def parse(path: Path, source: str) -> ast.Module:
    try:
        return ast.parse(source, filename=str(path))
    except SyntaxError as exc:
        fail(f"Python syntax error in {path}: {exc}")
    raise AssertionError("unreachable")


def function_node(module: ast.Module, name: str) -> ast.FunctionDef:
    matches = [
        n for n in ast.walk(module)
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name == name
    ]
    if len(matches) != 1:
        fail(f"Expected exactly one function {name} in {module}, found {len(matches)}")
    return matches[0]  # type: ignore[return-value]


def source_lines(source: str) -> list[str]:
    return source.splitlines(keepends=True)


def replace_line_block(
    source: str,
    start_line: int,
    end_line: int,
    replacement: str,
) -> str:
    lines = source_lines(source)
    if not (1 <= start_line <= end_line <= len(lines)):
        fail(f"Invalid source range: {start_line}-{end_line}")
    return "".join(lines[: start_line - 1]) + replacement + "".join(lines[end_line:])


def backup(path: Path) -> Path:
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    target = path.with_name(f"{path.name}.{stamp}.bak")
    shutil.copy2(path, target)
    return target


def audit_workspace_layout(source: str) -> list[str]:
    module = parse(LAYOUT, source)
    findings: list[str] = []

    book_ws = function_node(module, "book_workspace")
    segment = ast.get_source_segment(source, book_ws)
    if segment is None:
        fail("Could not recover book_workspace source segment.")

    args = [a.arg for a in book_ws.args.args]
    expected = ["subject", "grade", "part", "edition"]
    if args != expected:
        findings.append(
            f"FAIL book_workspace arguments are {args}; expected {expected}"
        )
    else:
        findings.append("PASS book_workspace accepts subject, grade, part, edition only.")

    if "normalize_part(part)" not in segment:
        findings.append("FAIL book_workspace does not normalize the physical part.")
    else:
        findings.append("PASS book_workspace normalizes physical part.")

    if "part_key / grade_key / normalize_subject(subject) / edition_segment" in segment:
        findings.append("PASS Workspace path is P?/Gxx/SUBJECT/ED....")
    else:
        findings.append(
            "FAIL Workspace path expression is not the required physical-part layout."
        )

    if re.search(r"\bterm\b", segment):
        findings.append("FAIL book_workspace still contains academic term logic.")
    else:
        findings.append("PASS book_workspace contains no academic Term coordinate.")

    textbook = function_node(module, "textbook_key")
    textbook_src = ast.get_source_segment(source, textbook) or ""
    if "part_code" in textbook_src and "P1" in textbook_src:
        findings.append("PASS Python textbook_key uses physical part P1/P2/PB.")
    else:
        findings.append("FAIL Python textbook_key does not visibly encode P1/P2/PB.")

    return findings


def audit_segmentation(source: str) -> list[str]:
    module = parse(SEGMENTATION, source)
    fn = function_node(module, "segment_book")
    segment = ast.get_source_segment(source, fn) or ""
    findings: list[str] = []

    args = [a.arg for a in fn.args.args]
    if "textbook_key" in args:
        findings.append("PASS segment_book accepts canonical textbook_key.")
    else:
        findings.append("FAIL segment_book does not accept canonical textbook_key.")

    direct_builder = re.search(
        r"textbook_key\s*=\s*f[\"']EDU-",
        segment,
    )
    if direct_builder:
        findings.append(
            "FAIL segment_book locally constructs Textbook.key instead of consuming the canonical key."
        )
    else:
        findings.append(
            "PASS segment_book does not contain the old direct Textbook.key constructor."
        )

    if "CANONICAL_DOMAIN_INPUT" in segment:
        findings.append("PASS segmentation records canonical-key provenance.")
    else:
        findings.append(
            "INFO segmentation provenance marker is not present yet."
        )

    return findings


def audit_cli(source: str) -> list[str]:
    module = parse(CLI, source)
    fn = function_node(module, "_cmd_prepare")
    segment = ast.get_source_segment(source, fn) or ""
    findings: list[str] = []

    if "book_key = textbook_key(subject_key, grade_number, supplied_part, edition)" in segment:
        findings.append(
            "PASS CLI derives the canonical Textbook.key once from domain-aligned coordinates."
        )
    else:
        findings.append(
            "FAIL CLI no longer has the expected single canonical textbook_key derivation."
        )

    calls = [
        n
        for n in ast.walk(fn)
        if isinstance(n, ast.Call)
        and isinstance(n.func, ast.Attribute)
        and n.func.attr == "segment_book"
    ]
    if not calls:
        findings.append("FAIL _cmd_prepare has no segment_book call.")
    else:
        call_src = ast.get_source_segment(source, calls[-1]) or ""
        if "textbook_key=book_key" in call_src:
            findings.append("PASS CLI passes canonical textbook_key into segment_book.")
        else:
            findings.append(
                "FAIL CLI does not pass canonical textbook_key into segment_book."
            )

    if "Workspace/P1/G07/MATH/<textbookKey>" in source:
        findings.append("PASS CLI help examples use physical part P1.")
    else:
        findings.append("INFO CLI help examples do not contain the expected P1 example.")

    if "workspace/T01/G04/MATH/<textbookKey>" in source:
        findings.append("FAIL CLI still advertises the obsolete Term-based workspace example.")

    return findings


def audit() -> int:
    print(f"Repository: {ROOT}")
    print("Target contract: Workspace/<P1|P2|PB>/<Gxx>/<SUBJECT>/<ED...>/")
    print("")

    all_findings = []
    all_findings += [f"[workspace_layout] {x}" for x in audit_workspace_layout(read(LAYOUT))]
    all_findings += [f"[segmentation] {x}" for x in audit_segmentation(read(SEGMENTATION))]
    all_findings += [f"[cli] {x}" for x in audit_cli(read(CLI))]

    for finding in all_findings:
        print(finding)

    failures = sum(" FAIL " in f for f in all_findings)
    print("")
    print(f"Audit result: {'FAIL' if failures else 'PASS'} ({failures} blocking finding(s))")
    return 1 if failures else 0


def patch_segmentation(source: str) -> str:
    module = parse(SEGMENTATION, source)
    fn = function_node(module, "segment_book")
    lines = source_lines(source)

    # Structural guard: current function signature must contain coordinates as
    # the last parameter. We add one explicit canonical input, preserving the
    # rest of the function byte-for-byte.
    fn_start = fn.lineno
    fn_first = lines[fn_start - 1]
    if not fn_first.lstrip().startswith("def segment_book("):
        fail("segment_book definition shape changed; refusing automatic migration.")

    signature_start = fn_start - 1
    signature_end = fn.body[0].lineno - 1
    signature = "".join(lines[signature_start:signature_end])
    if "coordinates: Optional[Dict[str, Any]] = None" not in signature:
        fail(
            "segment_book signature no longer matches the audited shape; "
            "inspect manually before migration."
        )

    new_signature = signature.replace(
        "coordinates: Optional[Dict[str, Any]] = None,",
        "coordinates: Optional[Dict[str, Any]] = None,\n        textbook_key: Optional[str] = None,",
        1,
    )
    source = replace_line_block(
        source,
        fn_start,
        fn.body[0].lineno - 1,
        new_signature,
    )

    # Re-parse after the signature change and locate the assignment by AST.
    module = parse(SEGMENTATION, source)
    fn = function_node(module, "segment_book")
    segment = ast.get_source_segment(source, fn) or ""
    if "textbook_key: Optional[str] = None" not in segment:
        fail("Canonical textbook_key parameter was not installed.")

    direct_assignments = [
        n
        for n in ast.walk(fn)
        if isinstance(n, ast.Assign)
        and any(isinstance(t, ast.Name) and t.id == "textbook_key" for t in n.targets)
    ]
    old = []
    for node in direct_assignments:
        text = ast.get_source_segment(source, node) or ""
        if "f\"EDU-" in text or "f'EDU-" in text:
            old.append(node)

    if len(old) != 1:
        fail(
            f"Expected exactly one old direct textbook_key constructor, found {len(old)}."
        )

    node = old[0]
    replacement = (
        '        if not textbook_key or not str(textbook_key).strip():\n'
        '            raise ValueError(\n'
        '                "Canonical Textbook.key is required; Python segmentation must not derive it."\n'
        '            )\n'
        '        textbook_key = str(textbook_key).strip()\n'
    )
    source = replace_line_block(source, node.lineno, node.end_lineno, replacement)

    # Add explicit provenance without rewriting unrelated metadata.
    module = parse(SEGMENTATION, source)
    fn = function_node(module, "segment_book")
    segment = ast.get_source_segment(source, fn) or ""

    marker = '"textbookKeySource": "CANONICAL_DOMAIN_INPUT"'
    if marker not in segment:
        needle = '            "textbookKey": textbook_key,\n'
        if needle not in segment:
            fail("Could not locate textbook manifest textbookKey field.")
        source = source.replace(
            needle,
            needle + '            "textbookKeySource": "CANONICAL_DOMAIN_INPUT",\n',
            1,
        )

    return source


def patch_cli(source: str) -> str:
    module = parse(CLI, source)
    fn = function_node(module, "_cmd_prepare")

    calls = [
        n
        for n in ast.walk(fn)
        if isinstance(n, ast.Call)
        and isinstance(n.func, ast.Attribute)
        and n.func.attr == "segment_book"
    ]
    if len(calls) != 1:
        fail(f"Expected exactly one _cmd_prepare segment_book call, found {len(calls)}.")

    call = calls[0]
    call_src = ast.get_source_segment(source, call) or ""
    if "textbook_key=book_key" in call_src:
        return source

    if "coordinates=coordinates" not in call_src:
        fail("segment_book call shape changed; refusing automatic migration.")

    new_call = call_src.replace(
        "coordinates=coordinates",
        "coordinates=coordinates, textbook_key=book_key",
        1,
    )

    return replace_line_block(source, call.lineno, call.end_lineno, "    " + new_call + "\n")


def apply() -> int:
    # First run the read-only audit and refuse to mutate if the repository is
    # already in an unexpected shape. This makes the migration replay-safe.
    print("Running pre-migration structural audit...")
    if audit() != 0:
        fail("Blocking audit findings exist. Review them before applying the migration.")

    original_segmentation = read(SEGMENTATION)
    original_cli = read(CLI)

    new_segmentation = patch_segmentation(original_segmentation)
    new_cli = patch_cli(original_cli)

    # Syntax validation before any write.
    parse(SEGMENTATION, new_segmentation)
    parse(CLI, new_cli)

    backups = [backup(SEGMENTATION), backup(CLI)]
    try:
        SEGMENTATION.write_text(new_segmentation, encoding="utf-8")
        CLI.write_text(new_cli, encoding="utf-8")
    except Exception:
        # Restore if the second write fails.
        SEGMENTATION.write_text(original_segmentation, encoding="utf-8")
        CLI.write_text(original_cli, encoding="utf-8")
        raise

    print("")
    print("Migration applied.")
    for path in backups:
        print(f"Backup: {path}")

    print("")
    print("Post-migration audit:")
    return audit()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["audit", "apply"])
    args = parser.parse_args()

    try:
        return audit() if args.command == "audit" else apply()
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
