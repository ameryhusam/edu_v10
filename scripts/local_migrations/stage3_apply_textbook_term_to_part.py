#!/usr/bin/env python3
"""
Edu7 — Stage 3 Correction
Textbook academic-term contracts -> physical-part contracts

This script corrects the incomplete Stage 3 migration.

Rules
-----
Physical textbook identity:
    subject + grade + physical part + printed edition

Academic term:
    remains academic context.

Mapping:
    academic term 1 -> PART_1
    academic term 2 -> PART_2

A physical textbook with BOTH is compatible with either academic term.

IMPORTANT
---------
- Workspace files are intentionally excluded.
- No git operations.
- No /tmp.
- Existing local backup directory is preserved.
- Every replacement is exact and guarded.
- The script stops before writing if any expected block is missing.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
import shutil
import sys


ROOT = Path(__file__).resolve().parents[2]
BACKUP_ROOT = ROOT / ".local-migration-backups" / datetime.now().strftime(
    "%Y%m%d_%H%M%S"
)


@dataclass(frozen=True)
class Replacement:
    path: str
    old: str
    new: str
    label: str


def fail(message: str) -> None:
    print(f"\n[STOP] {message}")
    print("No files were modified.")
    raise SystemExit(1)


def read(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except FileNotFoundError:
        fail(f"File not found: {path}")


def replacement(path: str, old: str, new: str, label: str) -> Replacement:
    return Replacement(path, old, new, label)


# ---------------------------------------------------------------------------
# 1. identifiers.ts
# ---------------------------------------------------------------------------

IDENTIFIERS = "src/shared/kernel/identifiers.ts"

IDENTIFIERS_VALIDATE_OLD = """function validateCoordinates(c: TextbookCoordinates): Result<TextbookCoordinates> {
  if (!Number.isInteger(c.term) || c.term < 1 || c.term > 4) {
    return Err(Errors.validation('identity.bad_term', 'Term must be an integer between 1 and 4.'));
  }
  if (!Number.isInteger(c.grade) || c.grade < 1 || c.grade > 12) {
    return Err(Errors.validation('identity.bad_grade', 'Grade must be an integer between 1 and 12.'));
  }
  const subject = normalizeSubjectCode(c.subject);
  if (!subject.ok) return subject;
  const edition = normalizeEdition(c.edition);
  if (!edition.ok) return edition;
  return Ok({ ...c, subject: subject.value });
}"""

IDENTIFIERS_VALIDATE_NEW = """function validateCoordinates(c: TextbookCoordinates): Result<TextbookCoordinates> {
  if (!['PART_1', 'PART_2', 'BOTH'].includes(c.part)) {
    return Err(
      Errors.validation(
        'identity.bad_part',
        'Textbook part must be PART_1, PART_2, or BOTH.',
      ),
    );
  }

  if (!Number.isInteger(c.grade) || c.grade < 1 || c.grade > 12) {
    return Err(
      Errors.validation(
        'identity.bad_grade',
        'Grade must be an integer between 1 and 12.',
      ),
    );
  }

  const subject = normalizeSubjectCode(c.subject);
  if (!subject.ok) return subject;

  const edition = normalizeEdition(c.edition);
  if (!edition.ok) return edition;

  return Ok({
    ...c,
    subject: subject.value,
  });
}

/**
 * Academic term -> physical textbook part.
 *
 * Academic term remains academic context. It is never stored on Textbook.
 */
export function textbookPartForTerm(
  termOrdinal: number,
): TextbookCoordinates['part'] | null {
  if (termOrdinal === 1) return 'PART_1';
  if (termOrdinal === 2) return 'PART_2';
  return null;
}

/**
 * Whether a physical textbook part can satisfy an academic term.
 *
 * PART_1 satisfies T1.
 * PART_2 satisfies T2.
 * BOTH satisfies either.
 */
export function textbookPartMatchesTerm(
  part: TextbookCoordinates['part'],
  termOrdinal: number,
): boolean {
  const required = textbookPartForTerm(termOrdinal);
  if (!required) return false;
  return part === required || part === 'BOTH';
}"""


IDENTIFIERS_KEY_OLD = """export function textbookKey(coords: TextbookCoordinates): Result<TextbookKey> {
  const v = validateCoordinates(coords);
  if (!v.ok) return v;
  const edition = normalizeEdition(v.value.edition);
  if (!edition.ok) return edition;
  const { subject, grade, term } = v.value;
  return Ok(`EDU-${subject}-G${pad(grade)}-T${term}-${edition.value}` as TextbookKey);
}"""

IDENTIFIERS_KEY_NEW = """export function textbookKey(coords: TextbookCoordinates): Result<TextbookKey> {
  const v = validateCoordinates(coords);
  if (!v.ok) return v;

  const { subject, grade, part, edition } = v.value;

  const partCode =
    part === 'PART_1'
      ? 'P1'
      : part === 'PART_2'
        ? 'P2'
        : 'PB';

  const normalizedEdition = normalizeEdition(edition);
  if (!normalizedEdition.ok) return normalizedEdition;

  return Ok(
    `EDU-${subject}-G${pad(grade)}-${partCode}-${normalizedEdition.value}` as TextbookKey,
  );
}"""


IDENTIFIERS_PARSE_OLD = """export function parseTextbookKey(key: string): Result<TextbookCoordinates> {
  const m = /^EDU-([A-Z0-9]+)-G(\\d{2})-T(\\d)-ED(.+)$/.exec(key);
  if (!m) {
    return Err(Errors.validation('identity.unparseable_key', 'Not a canonical textbook key.', { key }));
  }
  return Ok({
    subject: m[1]!,
    grade: Number(m[2]),
    term: Number(m[3]),
    edition: m[4]!,
  });
}"""

IDENTIFIERS_PARSE_NEW = """export function parseTextbookKey(key: string): Result<TextbookCoordinates> {
  const m = /^EDU-([A-Z0-9]+)-G(\\d{2})-(P1|P2|PB)-ED(.+)$/.exec(key);

  if (!m) {
    return Err(
      Errors.validation(
        'identity.unparseable_key',
        'Not a canonical textbook key.',
        { key },
      ),
    );
  }

  const part =
    m[3] === 'P1'
      ? 'PART_1'
      : m[3] === 'P2'
        ? 'PART_2'
        : 'BOTH';

  return Ok({
    subject: m[1]!,
    grade: Number(m[2]),
    part,
    edition: m[4]!,
  });
}"""


# ---------------------------------------------------------------------------
# 2. prisma/seed/load-textbook.ts
# ---------------------------------------------------------------------------

LOAD_TEXTBOOK = "prisma/seed/load-textbook.ts"

LOAD_SPEC_OLD = """export interface TextbookSpec {
  subjectKey: string;
  gradeKey: string;
  term: number;
  edition: string;
  title: string;"""

LOAD_SPEC_NEW = """export interface TextbookSpec {
  subjectKey: string;
  gradeKey: string;
  part: 'PART_1' | 'PART_2' | 'BOTH';
  edition: string;
  title: string;"""


LOAD_TERM_CHECK_OLD = """  if (!ctx.termKey.endsWith(`-T0${spec.term}`)) {
    throw new Error(
      `textbook spec term ${spec.term} does not match seeding term ${ctx.termKey}`,
    );
  }

  const grade = await prisma.grade.findUniqueOrThrow({ where: { key: spec.gradeKey } });
  const subject = await prisma.subject.findUniqueOrThrow({ where: { key: spec.subjectKey } });
  const tbKey = unwrap(
    textbookKey({
      subject: spec.subjectKey,
      grade: Number(spec.gradeKey.replace('G0', '').replace('G', '')),
      term: spec.term,
      edition: spec.edition,
    }),
  );"""

LOAD_TERM_CHECK_NEW = """  const grade = await prisma.grade.findUniqueOrThrow({ where: { key: spec.gradeKey } });
  const subject = await prisma.subject.findUniqueOrThrow({ where: { key: spec.subjectKey } });

  const tbKey = unwrap(
    textbookKey({
      subject: spec.subjectKey,
      grade: Number(spec.gradeKey.replace('G0', '').replace('G', '')),
      part: spec.part,
      edition: spec.edition,
    }),
  );"""


LOAD_CREATE_OLD = """      key: tbKey,
      termId: ctx.termId,
      gradeId: grade.id,"""

LOAD_CREATE_NEW = """      key: tbKey,
      part: spec.part,
      gradeId: grade.id,"""


# ---------------------------------------------------------------------------
# 3. prisma/seed/seed.ts
# ---------------------------------------------------------------------------

SEED = "prisma/seed/seed.ts"

SEED_MAIN_KEY_OLD = """  const tbKey = unwrap(textbookKey({ subject: SUBJECT, grade: GRADE, term: TERM, edition: EDITION }));

  const textbook = await prisma.textbook.upsert({
    where: { key: tbKey },
    create: {
      key: tbKey,
      termId: term.id,
      gradeId: grade.id,"""

SEED_MAIN_KEY_NEW = """  const tbKey = unwrap(
    textbookKey({
      subject: SUBJECT,
      grade: GRADE,
      part: TERM === 1 ? 'PART_1' : 'PART_2',
      edition: EDITION,
    }),
  );

  const textbook = await prisma.textbook.upsert({
    where: { key: tbKey },
    create: {
      key: tbKey,
      part: TERM === 1 ? 'PART_1' : 'PART_2',
      gradeId: grade.id,"""


SEED_JUNIOR_KEY_OLD = """  const juniorTbKey = unwrap(
    textbookKey({ subject: SUBJECT, grade: 3, term: TERM, edition: EDITION }),
  );

  const juniorBook = await prisma.textbook.upsert({
    where: { key: juniorTbKey },
    create: {
      key: juniorTbKey,
      termId: term.id,
      gradeId: juniorGrade.id,"""

SEED_JUNIOR_KEY_NEW = """  const juniorTbKey = unwrap(
    textbookKey({
      subject: SUBJECT,
      grade: 3,
      part: TERM === 1 ? 'PART_1' : 'PART_2',
      edition: EDITION,
    }),
  );

  const juniorBook = await prisma.textbook.upsert({
    where: { key: juniorTbKey },
    create: {
      key: juniorTbKey,
      part: TERM === 1 ? 'PART_1' : 'PART_2',
      gradeId: juniorGrade.id,"""


# ---------------------------------------------------------------------------
# 4. prisma/seed/source-catalog.ts
# ---------------------------------------------------------------------------

SOURCE_CATALOG = "prisma/seed/source-catalog.ts"

SOURCE_KEY_OLD = """    const key = unwrap(
      textbookKey({
        subject: source.subjectKey,
        grade: grade.ordinal,
        term: source.termOrdinal,
        edition: catalog.edition,
      }),
    );

    const textbook = await prisma.textbook.upsert({
      where: { key },
      create: {
        key,
        termId: term.id,
        gradeId: grade.id,"""

SOURCE_KEY_NEW = """    const part =
      source.termOrdinal === 1
        ? 'PART_1'
        : source.termOrdinal === 2
          ? 'PART_2'
          : 'BOTH';

    const key = unwrap(
      textbookKey({
        subject: source.subjectKey,
        grade: grade.ordinal,
        part,
        edition: catalog.edition,
      }),
    );

    const textbook = await prisma.textbook.upsert({
      where: { key },
      create: {
        key,
        part,
        gradeId: grade.id,"""


# ---------------------------------------------------------------------------
# 5. authoring.service.ts
# ---------------------------------------------------------------------------

AUTHORING = "src/contexts/content/application/authoring.service.ts"

AUTHORING_KEY_BLOCK_OLD = """    const key = buildTextbookKey({
      subject: subject.key,
      grade: grade.ordinal,
      term: term.ordinal,
      edition: input.edition,
    });
    if (!key.ok) return key;"""

AUTHORING_KEY_BLOCK_NEW = """    const part =
      term.ordinal === 1
        ? 'PART_1'
        : term.ordinal === 2
          ? 'PART_2'
          : 'BOTH';

    const key = buildTextbookKey({
      subject: subject.key,
      grade: grade.ordinal,
      part,
      edition: input.edition,
    });
    if (!key.ok) return key;"""


AUTHORING_CREATE_OLD = """    const created = await this.repo.createTextbook({
      key: key.value,
      subjectId: subject.id,
      gradeId: grade.id,
      termId: term.id,
      title,"""

AUTHORING_CREATE_NEW = """    const created = await this.repo.createTextbook({
      key: key.value,
      subjectId: subject.id,
      gradeId: grade.id,
      part,
      title,"""


AUTHORING_EXISTS_MSG_OLD = """'A textbook already exists for this subject, grade, term and edition.'"""

AUTHORING_EXISTS_MSG_NEW = """'A textbook already exists for this subject, grade, physical part and printed edition.'"""


# ---------------------------------------------------------------------------
# 6. content-asset.service.ts
# ---------------------------------------------------------------------------

CONTENT_ASSET = "src/contexts/content/application/content-asset.service.ts"

CONTENT_ASSET_BLOCK_OLD = """    const tbKeyRes = buildTextbookKey({
      subject: input.subject,
      grade: gradeNum,
      term: termNum,
      edition,
    });"""

CONTENT_ASSET_BLOCK_NEW = """    const part =
      termNum === 1
        ? 'PART_1'
        : termNum === 2
          ? 'PART_2'
          : 'BOTH';

    const tbKeyRes = buildTextbookKey({
      subject: input.subject,
      grade: gradeNum,
      part,
      edition,
    });"""


# ---------------------------------------------------------------------------
# 7. ports.ts
# ---------------------------------------------------------------------------

PORTS = "src/contexts/content/application/ports.ts"

PORT_COORD_OLD = """  /** True when a textbook with this key already exists. */
  textbookExists(key: string): Promise<boolean>;

  createTextbook(input: {
    key: string;
    subjectId: string;
    gradeId: string;
    termId: string;
    title: string;"""

PORT_COORD_NEW = """  /** True when a textbook with this key already exists. */
  textbookExists(key: string): Promise<boolean>;

  createTextbook(input: {
    key: string;
    subjectId: string;
    gradeId: string;
    part: 'PART_1' | 'PART_2' | 'BOTH';
    title: string;"""


# ---------------------------------------------------------------------------
# 8. content.repository.ts
# ---------------------------------------------------------------------------

CONTENT_REPO = "src/infrastructure/database/content.repository.ts"

CONTENT_REPO_RESOLVE_OLD = """    return { subject, grade, term };
  }

  async textbookExists(key: string): Promise<boolean> {"""

CONTENT_REPO_RESOLVE_NEW = """    return { subject, grade, term };
  }

  async textbookExists(key: string): Promise<boolean> {"""


CONTENT_REPO_CREATE_OLD = """  async createTextbook(input: {
    key: string;
    subjectId: string;
    gradeId: string;
    termId: string;
    title: string;"""

CONTENT_REPO_CREATE_NEW = """  async createTextbook(input: {
    key: string;
    subjectId: string;
    gradeId: string;
    part: 'PART_1' | 'PART_2' | 'BOTH';
    title: string;"""


CONTENT_REPO_TERM_CONNECT_OLD = """      data: {
        key: input.key,
        subjectId: input.subjectId,
        gradeId: input.gradeId,
        termId: input.termId,"""

CONTENT_REPO_TERM_CONNECT_NEW = """      data: {
        key: input.key,
        subjectId: input.subjectId,
        gradeId: input.gradeId,
        part: input.part,"""


# ---------------------------------------------------------------------------
# 9. tests/unit/identifiers.test.ts
# ---------------------------------------------------------------------------

IDENTIFIERS_TEST = "tests/unit/identifiers.test.ts"

IDENT_TEST_COORD_OLD = """const coords = { subject: 'MATH', grade: 7, term: 1, edition: '2026' };"""

IDENT_TEST_COORD_NEW = """const coords = { subject: 'MATH', grade: 7, part: 'PART_1' as const, edition: '2026' };"""


IDENT_TEST_EXPECTATIONS_OLD = [
    (
        "expect(book()).toBe('EDU-MATH-G07-T1-ED2026');",
        "expect(book()).toBe('EDU-MATH-G07-P1-ED2026');",
    ),
    (
        "'EDU-MATH-G07-T1-EDREV2'",
        "'EDU-MATH-G07-P1-EDREV2'",
    ),
    (
        "'EDU-MATH-G07-T1-ED2026-2027'",
        "'EDU-MATH-G07-P1-ED2026-2027'",
    ),
    (
        "expect(textbookKey({ ...coords, term: 5 }).ok).toBe(false);",
        "expect(textbookKey({ ...coords, part: 'INVALID' as never }).ok).toBe(false);",
    ),
]

IDENT_TEST_ROUNDTRIP_OLD = """    expect(unwrap(parseTextbookKey(book()))).toEqual({
      subject: 'MATH',
      grade: 7,
      term: 1,
      edition: '2026',
    });"""

IDENT_TEST_ROUNDTRIP_NEW = """    expect(unwrap(parseTextbookKey(book()))).toEqual({
      subject: 'MATH',
      grade: 7,
      part: 'PART_1',
      edition: '2026',
    });"""


# ---------------------------------------------------------------------------
# 10. tests/unit/key-identity.test.ts
# ---------------------------------------------------------------------------

KEY_IDENTITY_TEST = "tests/unit/key-identity.test.ts"

KEY_IDENTITY_BOOK_OLD = """  unwrap(textbookKey({ subject: 'MATH', grade: 7, term: 1, edition: '2026' }));"""

KEY_IDENTITY_BOOK_NEW = """  unwrap(
    textbookKey({
      subject: 'MATH',
      grade: 7,
      part: 'PART_1',
      edition: '2026',
    }),
  );"""


# ---------------------------------------------------------------------------
# Build replacement list
# ---------------------------------------------------------------------------

REPLACEMENTS = [
    replacement(
        IDENTIFIERS,
        IDENTIFIERS_VALIDATE_OLD,
        IDENTIFIERS_VALIDATE_NEW,
        "identifiers: validateCoordinates",
    ),
    replacement(
        IDENTIFIERS,
        IDENTIFIERS_KEY_OLD,
        IDENTIFIERS_KEY_NEW,
        "identifiers: textbookKey",
    ),
    replacement(
        IDENTIFIERS,
        IDENTIFIERS_PARSE_OLD,
        IDENTIFIERS_PARSE_NEW,
        "identifiers: parseTextbookKey",
    ),

    replacement(
        LOAD_TEXTBOOK,
        LOAD_SPEC_OLD,
        LOAD_SPEC_NEW,
        "seed loader: TextbookSpec",
    ),
    replacement(
        LOAD_TEXTBOOK,
        LOAD_TERM_CHECK_OLD,
        LOAD_TERM_CHECK_NEW,
        "seed loader: textbook coordinates",
    ),
    replacement(
        LOAD_TEXTBOOK,
        LOAD_CREATE_OLD,
        LOAD_CREATE_NEW,
        "seed loader: textbook create",
    ),

    replacement(
        SEED,
        SEED_MAIN_KEY_OLD,
        SEED_MAIN_KEY_NEW,
        "seed: main textbook",
    ),
    replacement(
        SEED,
        SEED_JUNIOR_KEY_OLD,
        SEED_JUNIOR_KEY_NEW,
        "seed: junior textbook",
    ),

    replacement(
        SOURCE_CATALOG,
        SOURCE_KEY_OLD,
        SOURCE_KEY_NEW,
        "source catalog: textbook identity",
    ),

    replacement(
        AUTHORING,
        AUTHORING_KEY_BLOCK_OLD,
        AUTHORING_KEY_BLOCK_NEW,
        "authoring: physical part",
    ),
    replacement(
        AUTHORING,
        AUTHORING_CREATE_OLD,
        AUTHORING_CREATE_NEW,
        "authoring: repository contract",
    ),
    replacement(
        AUTHORING,
        AUTHORING_EXISTS_MSG_OLD,
        AUTHORING_EXISTS_MSG_NEW,
        "authoring: duplicate message",
    ),

    replacement(
        CONTENT_ASSET,
        CONTENT_ASSET_BLOCK_OLD,
        CONTENT_ASSET_BLOCK_NEW,
        "content asset: textbook identity",
    ),

    replacement(
        PORTS,
        PORT_COORD_OLD,
        PORT_COORD_NEW,
        "ports: createTextbook",
    ),

    replacement(
        CONTENT_REPO,
        CONTENT_REPO_CREATE_OLD,
        CONTENT_REPO_CREATE_NEW,
        "repository: createTextbook contract",
    ),
    replacement(
        CONTENT_REPO,
        CONTENT_REPO_TERM_CONNECT_OLD,
        CONTENT_REPO_TERM_CONNECT_NEW,
        "repository: physical part persistence",
    ),

    replacement(
        IDENTIFIERS_TEST,
        IDENT_TEST_COORD_OLD,
        IDENT_TEST_COORD_NEW,
        "identifier tests: coordinates",
    ),
    replacement(
        IDENTIFIERS_TEST,
        IDENT_TEST_ROUNDTRIP_OLD,
        IDENT_TEST_ROUNDTRIP_NEW,
        "identifier tests: round trip",
    ),

    replacement(
        KEY_IDENTITY_TEST,
        KEY_IDENTITY_BOOK_OLD,
        KEY_IDENTITY_BOOK_NEW,
        "key identity tests: coordinates",
    ),
]


# ---------------------------------------------------------------------------
# Guard / apply
# ---------------------------------------------------------------------------

def main() -> None:
    print("=== STAGE 3 CORRECTION: TEXTBOOK TERM -> PHYSICAL PART ===")
    print()
    print("Workspace is EXCLUDED.")
    print("No git operations.")
    print("No /tmp.")
    print()

    # Read all files first.
    contents: dict[str, str] = {}
    for r in REPLACEMENTS:
        if r.path not in contents:
            contents[r.path] = read(ROOT / r.path)

    # Exact-match validation BEFORE any write.
    print("PRE-FLIGHT")
    print("----------")

    for r in REPLACEMENTS:
        count = contents[r.path].count(r.old)

        if count != 1:
            fail(
                f"{r.path}\n"
                f"Expected exactly one match for:\n"
                f"  {r.label}\n"
                f"Found: {count}\n\n"
                f"Expected block:\n{r.old}"
            )

        print(f"PASS  {r.label}")

    # Build resulting contents in memory first.
    updated = dict(contents)

    for r in REPLACEMENTS:
        updated[r.path] = updated[r.path].replace(r.old, r.new, 1)

    # Never touch Workspace.
    workspace_paths = [
        p for p in updated
        if "workspace" in p.lower()
    ]

    if workspace_paths:
        fail(
            "Workspace path accidentally entered migration set:\n"
            + "\n".join(workspace_paths)
        )

    # Backup only files actually modified.
    print()
    print("BACKUP")
    print("------")

    for path in sorted(updated):
        original = contents[path]
        new = updated[path]

        if original == new:
            continue

        target = BACKUP_ROOT / path
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / path, target)
        print(f"Backup: {target}")

    # Write only after every guard passed.
    print()
    print("APPLY")
    print("-----")

    changed = []

    for path in sorted(updated):
        original = contents[path]
        new = updated[path]

        if original == new:
            continue

        (ROOT / path).write_text(new, encoding="utf-8")
        changed.append(path)
        print(f"Changed: {path}")

    print()
    print("SUMMARY")
    print("-------")
    print(f"Files changed: {len(changed)}")
    print(f"Backup: {BACKUP_ROOT}")
    print()
    print("No git operations performed.")
    print()
    print("IMPORTANT:")
    print("Run Stage 4 after this script.")
    print("Do NOT commit/push until Stage 4 passes.")


if __name__ == "__main__":
    main()
