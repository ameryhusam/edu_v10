#!/usr/bin/env python3
"""
Edu7 — Textbook Term/Part Contract Migration — SAFE SECOND PASS

Purpose
-------
Audit and, only when all expected TypeScript contracts are classified,
patch the contracts affected by the change:

    OLD physical textbook identity:
        subject + grade + term + edition

    NEW physical textbook identity:
        subject + grade + part + edition

Academic term remains valid elsewhere.

Academic association rule:
    PART_1 -> term ordinal 1
    PART_2 -> term ordinal 2
    BOTH   -> term ordinal 1 or 2

Important
---------
This script:

- never touches Workspace
- never touches generated files
- never touches package-lock.json
- never modifies unrelated architecture fixes
- never modifies Python content-engine files
- never commits
- never pushes
- aborts when an unexpected Textbook/term usage is detected
- requires exact-match guards before every patch
- creates a backup before writing

Usage
-----

Audit only:

    python3 scripts/local_migrations/apply_textbook_term_contracts.py

Apply after audit:

    python3 scripts/local_migrations/apply_textbook_term_contracts.py --apply
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime
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
}

ALLOWED_SUFFIXES = {
    ".ts",
    ".tsx",
}

BACKUP_ROOT = ROOT / ".local-migration-backups"


@dataclass
class Match:
    path: Path
    line: int
    text: str
    category: str


@dataclass
class Patch:
    path: Path
    label: str
    old: str
    new: str
    expected_count: int = 1


class MigrationError(RuntimeError):
    pass


def rel(path: Path) -> str:
    return str(path.relative_to(ROOT))


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def iter_source_files():
    for root in TARGET_ROOTS:
        if not root.exists():
            continue

        for path in root.rglob("*"):
            if not path.is_file():
                continue

            if path.suffix not in ALLOWED_SUFFIXES:
                continue

            if any(part in EXCLUDED_PARTS for part in path.parts):
                continue

            yield path


def grep_terms(text: str):
    patterns = {
        "termId": re.compile(r"\btermId\b"),
        "termKey": re.compile(r"\btermKey\b"),
        "textbookKey(": re.compile(r"\btextbookKey\s*\("),
        "TextbookCoordinates": re.compile(r"\bTextbookCoordinates\b"),
        "createTextbook": re.compile(r"\bcreateTextbook\b"),
        "resolveTextbookCoordinates": re.compile(
            r"\bresolveTextbookCoordinates\b"
        ),
        "textbook\.find": re.compile(
            r"\btextbook\.(find|findFirst|findMany|create|upsert)\b"
        ),
        "textbookId": re.compile(r"\btextbookId\b"),
    }

    found = []

    for line_no, line in enumerate(text.splitlines(), start=1):
        for name, pattern in patterns.items():
            if pattern.search(line):
                found.append((name, line_no, line.rstrip()))

    return found


def classify(path: Path, term: str, line: str) -> str:
    p = rel(path)

    # Pure academic context. These MUST NOT be migrated merely because
    # they contain termId.
    if "learning.repository.ts" in p:
        return "ACADEMIC_CONTEXT"

    if "enrollment" in line and term == "termId":
        return "ACADEMIC_CONTEXT"

    if "TextbookAdoption" in line:
        return "ACADEMIC_ASSOCIATION"

    # Physical textbook identity contracts.
    if "identifiers.ts" in p:
        return "BOOK_IDENTITY"

    if "authoring.service.ts" in p:
        return "BOOK_IDENTITY_OR_AUTHORING"

    if "content.repository.ts" in p:
        return "BOOK_IDENTITY_OR_AUTHORING"

    if "ports.ts" in p:
        return "BOOK_IDENTITY_OR_AUTHORING"

    if "prisma/seed" in p:
        return "SEED_CONTRACT"

    if "content-authoring.service.test.ts" in p:
        return "TEST_CONTRACT"

    # Explicit textbook query using termId is potentially dangerous:
    # it must be reviewed rather than blindly rewritten.
    if term == "termId" and (
        "textbook" in line.lower()
        or "termId:" in line
    ):
        return "POTENTIAL_TEXTBOOK_ASSOCIATION"

    return "UNEXPECTED"


def audit():
    print()
    print("=== EDU7 TEXTBOOK TERM/PART CONTRACT AUDIT ===")
    print()

    matches: list[Match] = []

    for path in iter_source_files():
        text = read_text(path)

        for term, line_no, line in grep_terms(text):
            category = classify(path, term, line)

            matches.append(
                Match(
                    path=path,
                    line=line_no,
                    text=line,
                    category=category,
                )
            )

    by_category: dict[str, list[Match]] = {}

    for match in matches:
        by_category.setdefault(match.category, []).append(match)

    for category in sorted(by_category):
        print(f"\n[{category}] {len(by_category[category])}")

        for match in by_category[category]:
            print(
                f"  {rel(match.path)}:{match.line}"
                f"  {match.text.strip()}"
            )

    unexpected = by_category.get("UNEXPECTED", [])
    potential = by_category.get("POTENTIAL_TEXTBOOK_ASSOCIATION", [])

    print()
    print("=== AUDIT RESULT ===")

    if unexpected:
        print(
            f"[STOP] {len(unexpected)} unexpected textbook/term usages found."
        )

        for item in unexpected:
            print(
                f"  {rel(item.path)}:{item.line}:"
                f" {item.text.strip()}"
            )

        print()
        print(
            "No files may be modified until every unexpected usage is "
            "classified explicitly."
        )

        return False

    if potential:
        print(
            f"[STOP] {len(potential)} potentially unsafe textbook/term "
            "association(s) require explicit classification."
        )

        for item in potential:
            print(
                f"  {rel(item.path)}:{item.line}:"
                f" {item.text.strip()}"
            )

        return False

    print("[OK] No unclassified usages found.")
    return True


def exact_replace(
    path: Path,
    old: str,
    new: str,
    label: str,
    expected_count: int = 1,
):
    text = read_text(path)
    count = text.count(old)

    if count != expected_count:
        raise MigrationError(
            f"PATCH ABORTED: {rel(path)} :: {label}\n"
            f"Expected exact count: {expected_count}\n"
            f"Actual count: {count}"
        )

    updated = text.replace(old, new)

    return Patch(
        path=path,
        label=label,
        old=old,
        new=updated,
        expected_count=expected_count,
    )


def build_patches():
    patches: list[Patch] = []

    identifiers = ROOT / "src/shared/kernel/identifiers.ts"

    patches.append(
        exact_replace(
            identifiers,
            """ * A textbook is identified by subject + grade + term + **printed edition** —
 * the physical book being taught. Academic year is deliberately NOT part of
 * identity: the same printed edition is used across several years, so keying on
 * the year would mint a new key annually for a book that has not changed.
 * Which years a book is used in is a deployment fact, recorded by adoption.
""",
            """ * A textbook is identified by subject + grade + physical part +
 * **printed edition**. Academic term is NOT part of physical textbook identity.
 *
 * Physical part semantics:
 *   PART_1 -> first physical part / logical T1 content
 *   PART_2 -> second physical part / logical T2 content
 *   BOTH   -> one physical book containing both parts
 *
 * Academic year and academic term remain deployment/enrollment context.
 * They must not create duplicate physical textbook identities.
""",
            "Update textbook identity documentation",
        )
    )

    patches.append(
        exact_replace(
            identifiers,
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
}
""",
            """export type TextbookPart = 'PART_1' | 'PART_2' | 'BOTH';

export interface TextbookCoordinates {
  /** Uppercase subject code, e.g. `MATH`. */
  readonly subject: string;
  /** Grade ordinal, 1-based. */
  readonly grade: number;
  /** Physical part of the printed textbook. */
  readonly part: TextbookPart;
  /**
   * Printed edition of the physical book: a year (`2026`), a span
   * (`2026-2027`), or a label (`REV2`). Not the academic year of use.
   */
  readonly edition: string;
}
""",
            "Replace physical textbook coordinates",
        )
    )

    patches.append(
        exact_replace(
            identifiers,
            """function validateCoordinates(c: TextbookCoordinates): Result<TextbookCoordinates> {
  if (!Number.isInteger(c.term) || c.term < 1 || c.term > 4) {
    return Err(Errors.validation('identity.bad_term', 'Term must be an integer between 1 and 4.'));
  }
  if (!Number.isInteger(c.grade) || c.grade < 1 || c.grade > 12) {
""",
            """function validateCoordinates(c: TextbookCoordinates): Result<TextbookCoordinates> {
  if (!['PART_1', 'PART_2', 'BOTH'].includes(c.part)) {
    return Err(
      Errors.validation(
        'identity.bad_part',
        'Textbook part must be PART_1, PART_2, or BOTH.',
      ),
    );
  }

  if (!Number.isInteger(c.grade) || c.grade < 1 || c.grade > 12) {
""",
            "Replace term validation with part validation",
        )
    )

    patches.append(
        exact_replace(
            identifiers,
            """ * `EDU-MATH-G07-T1-ED2026`
 *
 * Subject + grade + term + printed edition. Sorting is by subject then grade,
 * which is how a catalogue is browsed.
 */
export function textbookKey(coords: TextbookCoordinates): Result<TextbookKey> {
  const v = validateCoordinates(coords);
  if (!v.ok) return v;
  const edition = normalizeEdition(v.value.edition);
  if (!edition.ok) return edition;
  const { subject, grade, term } = v.value;
  return Ok(`EDU-${subject}-G${pad(grade)}-T${term}-${edition.value}` as TextbookKey);
}
""",
            """ * `EDU-MATH-G07-P1-ED2026`
 *
 * Subject + grade + physical part + printed edition.
 *
 * This key identifies the physical textbook only. Academic term is resolved
 * later from enrollment/academic context.
 */
export function textbookKey(coords: TextbookCoordinates): Result<TextbookKey> {
  const v = validateCoordinates(coords);
  if (!v.ok) return v;
  const edition = normalizeEdition(v.value.edition);
  if (!edition.ok) return edition;

  const { subject, grade, part } = v.value;
  const partCode = part === 'PART_1'
    ? 'P1'
    : part === 'PART_2'
      ? 'P2'
      : 'PB';

  return Ok(
    `EDU-${subject}-G${pad(grade)}-${partCode}-${edition.value}` as TextbookKey,
  );
}
""",
            "Change textbookKey identity contract",
        )
    )

    patches.append(
        exact_replace(
            identifiers,
            """  const m = /^EDU-([A-Z0-9]+)-G(\\d{2})-T(\\d)-ED(.+)$/.exec(key);
""",
            """  const m = /^EDU-([A-Z0-9]+)-G(\\d{2})-(P1|P2|PB)-ED(.+)$/.exec(key);
""",
            "Update textbook key parser",
        )
    )

    patches.append(
        exact_replace(
            identifiers,
            """    term: Number(m[3]),
    edition: m[4]!,
""",
            """    part: m[3] === 'P1'
      ? 'PART_1'
      : m[3] === 'P2'
        ? 'PART_2'
        : 'BOTH',
    edition: m[4]!,
""",
            "Update textbook key parser coordinates",
        )
    )

    return patches


def apply_patches(patches: list[Patch]):
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup = BACKUP_ROOT / timestamp
    backup.mkdir(parents=True, exist_ok=False)

    touched = sorted({patch.path for patch in patches})

    print()
    print("=== BACKUP ===")

    for path in touched:
        target = backup / rel(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, target)
        print(f"[BACKUP] {rel(path)}")

    print()
    print("=== APPLY ===")

    original_hashes = {
        path: sha256(read_text(path))
        for path in touched
    }

    for patch in patches:
        current = read_text(patch.path)

        if sha256(current) != original_hashes[patch.path]:
            raise MigrationError(
                f"File changed during migration preparation: {rel(patch.path)}"
            )

        if patch.old not in current:
            raise MigrationError(
                f"Patch guard failed: source fragment disappeared: "
                f"{rel(patch.path)} :: {patch.label}"
            )

        # `patch.new` is the COMPLETE updated file.
        patch.path.write_text(patch.new, encoding="utf-8")

        print(f"[PATCH] {rel(patch.path)}")
        print(f"        {patch.label}")

    print()
    print(f"[OK] Backup: {backup}")


def git_diff():
    print()
    print("=== GIT DIFF — SECOND PASS ===")

    try:
        result = subprocess.run(
            [
                "git",
                "diff",
                "--",
                "src/shared/kernel/identifiers.ts",
            ],
            cwd=ROOT,
            text=True,
            capture_output=True,
            check=False,
        )

        print(result.stdout)

    except Exception as exc:
        print(f"[WARN] git diff unavailable: {exc}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Apply the audited patches.",
    )
    args = parser.parse_args()

    print("=== EDU7 SAFE SECOND MIGRATION ===")
    print(f"Repository: {ROOT}")
    print()

    if not audit():
        sys.exit(2)

    patches = build_patches()

    print()
    print("=== PATCH PLAN ===")

    for patch in patches:
        print(
            f"[PATCH] {rel(patch.path)} :: {patch.label}"
        )

    if not args.apply:
        print()
        print(
            "[AUDIT ONLY] No files modified."
        )
        print(
            "Run with --apply only after reviewing the audit output."
        )
        return

    apply_patches(patches)

    git_diff()

    print()
    print("[SUCCESS] Second migration completed.")
    print("No git commit was created.")
    print("No git push was performed.")


if __name__ == "__main__":
    main()
