#!/usr/bin/env python3
"""Edu7 direct textbook physical-part migration. No compatibility layer."""

from __future__ import annotations
import datetime as dt
import difflib
import hashlib
import os
import re
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SELF = Path(__file__).resolve()
BRANCH = "03_build_algorithm_and_new_Docs"
MODE = os.environ.get("MODE", "audit").strip().lower()
BACKUPS = ROOT / ".local-migration-backups"

class MigrationIssue(Exception):
    """A migration/audit issue that can be collected without aborting the full audit."""

AUDIT_ISSUES: list[str] = []

TARGETS = [
    "prisma/schema.prisma",
    "src/shared/kernel/identifiers.ts",
    "src/contexts/content/application/ports.ts",
    "src/contexts/content/application/authoring.service.ts",
    "src/contexts/content/domain/authoring.ts",
    "src/contexts/content/application/content-asset.service.ts",
    "src/contexts/content/application/content-engine.port.ts",
    "src/contexts/content/application/workspace.ports.ts",
    "src/contexts/content/application/workspace-importer.service.ts",
    "src/contexts/content/application/workspace-archive.service.ts",
    "src/contexts/content/domain/export-profile.ts",
    "src/contexts/content/application/content-import.service.ts",
    "src/infrastructure/content/content-engine.service.ts",
    "src/infrastructure/storage/workspace-manager.ts",
    "src/infrastructure/database/content.repository.ts",
    "src/infrastructure/database/textbook-administration.repository.ts",
    "src/interface/http/content.routes.ts",
    "prisma/seed/load-textbook.ts",
    "prisma/seed/seed.ts",
    "prisma/seed/source-catalog.ts",
    "scripts/seed-helpers.mjs",
    "scripts/convert-legacy-curriculum.mjs",
    "scripts/extract_textbook_toc.py",
    "edu7-content-engine/src/edu7_content/workspace_layout.py",
    "edu7-content-engine/src/edu7_content/export/json_exporter.py",
    "edu7-content-engine/src/edu7_content/pdf/segmentation.py",
    "web/src/features/content/textbook-workspace-modal.tsx",
    "web/src/features/content/textbook-pdf-modal.tsx",
    "web/src/features/content/textbook-create-modal.tsx",
    "web/src/features/content/textbook-create-panel.tsx",
]

OLD_KEY = re.compile(r"EDU-[A-Z0-9]+-G\d{2}-T[12]-ED[A-Z0-9-]+", re.I)
ISBN = re.compile(r"\bisbn\b", re.I)

def stop(message: str) -> None:
    raise MigrationIssue(message)

def cmd(*args: str) -> str:
    p = subprocess.run(args, cwd=ROOT, text=True, stdout=subprocess.PIPE,
                       stderr=subprocess.PIPE)
    if p.returncode:
        stop("Command failed: " + " ".join(args) + "\n" + p.stderr.strip())
    return p.stdout.strip()

def preflight() -> None:
    if cmd("git", "branch", "--show-current") != BRANCH:
        stop("Wrong branch; expected " + BRANCH)
    self_rel = SELF.relative_to(ROOT).as_posix()
    bad = []
    for line in cmd("git", "status", "--short").splitlines():
        path = line[3:].strip().replace("\\", "/")
        if path == self_rel or path.startswith(".local-migration-backups/"):
            continue
        bad.append(line)
    if bad:
        stop("Working tree contains changes outside local migration area:\n" +
             "\n".join(bad))
    missing = [p for p in TARGETS if not (ROOT / p).is_file()]
    if missing:
        stop("Required target files are missing:\n" + "\n".join(missing))

def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")

def isbn_lines(text: str) -> list[str]:
    return [line for line in text.splitlines(keepends=True) if ISBN.search(line)]

def guard_isbn(before: str, after: str, path: str) -> None:
    if isbn_lines(before) != isbn_lines(after):
        stop("ISBN content changed in " + path)

def one(text: str, old: str, new: str, path: str) -> str:
    n = text.count(old)
    if n != 1:
        stop(f"{path}: exact anchor expected once, found {n}:\n{old}")
    return text.replace(old, new)

def transform(path: str, text: str) -> str:
    out = text

    if path.endswith("identifiers.ts"):
        out = out.replace("Subject + grade + term + printed edition.",
                          "Subject + grade + physical part + printed edition.")
        out = out.replace("EDU-MATH-G07-T1-ED2026", "EDU-MATH-G07-P1-ED2026")

    elif path.endswith("application/ports.ts"):
        out = one(out,
"""  createTextbook(input: {
    key: string;
    subjectId: string;
    gradeId: string;
    termId: string;
""",
"""  createTextbook(input: {
    key: string;
    subjectId: string;
    gradeId: string;
    part: 'PART_1' | 'PART_2' | 'BOTH';
""", path)
        # Academic coordinate resolution and academic filters keep termKey.
        # Physical textbook payloads expose part instead.
        export_anchor = """  readonly textbook: {
    key: string;
    subjectKey: string;
    gradeKey: string;
    termKey: string;"""
        if export_anchor in out:
            out = out.replace(export_anchor, """  readonly textbook: {
    key: string;
    subjectKey: string;
    gradeKey: string;
    part: 'PART_1' | 'PART_2' | 'BOTH';""")
        summary_anchor = """  readonly gradeName: string;
  readonly termKey: string;
  readonly termName: string;
  readonly edition: string;"""
        if summary_anchor in out:
            out = out.replace(summary_anchor, """  readonly gradeName: string;
  readonly part: 'PART_1' | 'PART_2' | 'BOTH';
  readonly edition: string;""")
        placement_marker = """  resolveTextbookCoordinates(input: {"""
        if placement_marker in out and "resolveTextbookPlacement(input:" not in out:
            out = out.replace(placement_marker, """  resolveTextbookPlacement(input: {
    subjectKey: string;
    gradeKey: string;
  }): Promise<{
    subject: { id: string; key: string; name: string } | null;
    grade: { id: string; key: string; ordinal: number; name: string } | null;
  }>;

  resolveTextbookCoordinates(input: {""")
    elif path.endswith("authoring.service.ts"):
        old_sig = """      subjectKey: string;
      gradeKey: string;
      termKey: string;
      title: string;
      edition: string;"""
        if old_sig not in out:
            stop(path + ": expected createTextbook signature not found")
        out = out.replace(old_sig, """      subjectKey: string;
      gradeKey: string;
      part: 'PART_1' | 'PART_2' | 'BOTH';
      title: string;
      edition: string;""")

        old_resolve = """    const resolved = await this.repo.resolveTextbookCoordinates({
      subjectKey: input.subjectKey,
      gradeKey: input.gradeKey,
      termKey: input.termKey,
    });"""
        if old_resolve not in out:
            stop(path + ": expected academic-term resolver block not found")
        out = out.replace(old_resolve, """    const resolved = await this.repo.resolveTextbookPlacement({
      subjectKey: input.subjectKey,
      gradeKey: input.gradeKey,
    });""")

        old_missing = """    if (!resolved.subject) missing.push('subjectKey');
    if (!resolved.grade) missing.push('gradeKey');
    if (!resolved.term) missing.push('termKey');"""
        if old_missing not in out:
            stop(path + ": expected missing-reference block not found")
        out = out.replace(old_missing, """  if (!resolved.subject) missing.push('subjectKey');
  if (!resolved.grade) missing.push('gradeKey');""")

        out = out.replace("""        termKey: input.termKey,
      },""", """      },""", 1)
        out = out.replace("  const term = resolved.term!;\n", "")

        old_check = """    const placementCheck = checkTitleDoesNotRepeatPlacement(title, {
      gradeName: grade.name,
      termName: term.name,
    });"""
        if old_check not in out:
            stop(path + ": expected title placement check not found")
        out = out.replace(old_check, """  const placementCheck = checkTitleDoesNotRepeatPlacement(title, {
    gradeName: grade.name,
    part: input.part,
  });""")

        old_part = """  const part =
    term.ordinal === 1
      ? 'PART_1'
      : term.ordinal === 2
        ? 'PART_2'
        : 'BOTH';

"""
        if old_part in out:
            out = out.replace(old_part, "")
        if "part: input.part" not in out:
            stop(path + ": explicit physical part was not wired into authoring")
        out = out.replace("termId: term.id,", "part: input.part,")
        out = out.replace("termId: resolved.term.id,", "part: input.part,")
    elif path.endswith("domain/authoring.ts"):
        old_sig = """export function checkTitleDoesNotRepeatPlacement(
  title: string,
  placement: { gradeName: string; termName: string },
): Result<void> {"""
        if old_sig not in out:
            stop(path + ": expected title-placement signature not found")
        out = out.replace(old_sig, """export function checkTitleDoesNotRepeatPlacement(
  title: string,
  placement: { gradeName: string; part: string },
): Result<void> {""")
        old_repeat = """  const repeated = [placement.gradeName, placement.termName].find(
    (name) => name.trim().length > 0 && haystack.includes(name.trim()),
  );"""
        if old_repeat not in out:
            stop(path + ": expected title-placement comparison not found")
        out = out.replace(old_repeat, """  const repeated = [placement.gradeName, placement.part].find(
    (name) => name.trim().length > 0 && haystack.includes(name.trim()),
  );""")
        out = out.replace(
            "The grade and term are shown automatically — do not repeat them in the title.",
            "The grade and physical part are shown automatically — do not repeat them in the title.",
        )

    elif path.endswith("content-asset.service.ts"):
        out = one(out, "  readonly term: string;\n",
                  "  readonly part: 'PART_1' | 'PART_2' | 'BOTH';\n", path)
        out = one(out,
"""    const termNum = parseInt(input.term.replace(/\\D/g, ''), 10) || 1;

    const tbKeyRes = buildTextbookKey({
      subject: input.subject,
      grade: gradeNum,
      term: termNum,
      edition,
    });
""",
"""    const tbKeyRes = buildTextbookKey({
      subject: input.subject,
      grade: gradeNum,
      part: input.part,
      edition,
    });
""", path)
        out = out.replace("input.term}.pdf", "input.part}.pdf")

    elif path.endswith("content-engine.port.ts"):
        out = one(out, "  readonly term: string;\n",
                  "  readonly part: 'PART_1' | 'PART_2' | 'BOTH';\n", path)

    elif path.endswith("content-engine.service.ts"):
        out = one(out, "        '--term',\n        input.term,\n",
                  "        '--part',\n        input.part,\n", path)

    elif path.endswith("workspace.ports.ts"):
        term_fields = out.count("  readonly term: string;\n")
        if term_fields != 1:
            stop(path + f": expected one workspace coordinate term field, found {term_fields}")
        out = out.replace("  readonly term: string;\n",
                          "  readonly part: string;\n")

    elif path.endswith("workspace-manager.ts"):
        term_fields = out.count("  readonly term: string;\n")
        if term_fields != 2:
            stop(path + f": expected two workspace term fields, found {term_fields}")
        out = out.replace("  readonly term: string;\n", "  readonly part: string;\n")
        out = out.replace("<term>/", "<part>/")
        out = out.replace("workspaces/T01/G07/MATH", "workspaces/P1/G07/MATH")
        out = one(out,
"""    const termNorm = coords.term.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    const gradeNorm = coords.grade.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    const subjectNorm = coords.subject.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    const base = path.join(this.workspaceBaseDir, termNorm, gradeNorm, subjectNorm);
""",
"""    const partNorm = coords.part.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    const canonicalPart =
      partNorm === 'PART_1' ? 'P1' :
      partNorm === 'PART_2' ? 'P2' :
      partNorm === 'BOTH' ? 'PB' :
      partNorm;
    if (!['P1', 'P2', 'PB'].includes(canonicalPart)) {
      throw new Error('Invalid physical textbook part: ' + coords.part);
    }
    const gradeNorm = coords.grade.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    const subjectNorm = coords.subject.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    const base = path.join(this.workspaceBaseDir, canonicalPart, gradeNorm, subjectNorm);
""", path)
        out = one(out,
            'const match = /^EDU-(.+?)-G(\\d+)-T(\\d+)-ED(.+)$/i.exec(textbookKey.trim());',
            'const match = /^EDU-(.+?)-G(\\d+)-(P1|P2|PB)-ED(.+)$/i.exec(textbookKey.trim());',
            path)
        out = out.replace("const [, subject, grade, term, edition] = match;",
                          "const [, subject, grade, part, edition] = match;")
        out = out.replace("!term || !edition", "!part || !edition")
        out = re.sub(r"term:\s*\x60T\$\{term\}\x60,", "part: part,", out)
        out = re.sub(r"workspaceId:\s*\x60[^\n]+\x60",
                      "workspaceId: coords.part + '-' + coords.grade + '-' + coords.subject", out)
        out = out.replace("term: coords.term,", "part: coords.part,")

    elif path.endswith("workspace-importer.service.ts"):
        out = out.replace("term: pkg.textbook.termKey,", "part: pkg.textbook.part,")

    elif path.endswith("workspace-archive.service.ts"):
        out = out.replace("term: pkg.textbook.termKey,", "part: pkg.textbook.part,")
        out = out.replace("term: Number(String(tb.termKey).replace(/\\D/g, '')),",
                          "part: tb.part,")
        if "tb.termKey" in out:
            stop(path + ": archive still resolves physical identity from termKey")

    elif path.endswith("export-profile.ts"):
        out = one(out, "  readonly termKey: string;\n",
                  "  readonly part: 'PART_1' | 'PART_2' | 'BOTH';\n", path)

    elif path.endswith("content.repository.ts"):
        old_contract = """    termId: string;
    title: string;"""
        if old_contract in out:
            out = out.replace(old_contract, """    part: 'PART_1' | 'PART_2' | 'BOTH';
    title: string;""")
        old_data = "        termId: input.termId,"
        if old_data in out:
            out = out.replace(old_data, "        part: input.part,")
        elif "        part: input.part," not in out and "async createTextbook" in out:
            stop(path + ": createTextbook persistence contract not migrated from termId to part")
    elif path.endswith("textbook-administration.repository.ts"):
        # Academic term remains an API filter. Resolve it to physical parts at
        # the repository boundary because Textbook has no academic-term relation.
        old_where = """    const where = {
      ...(search ? { title: { contains: search, mode: 'insensitive' as const } } : {}),
      ...(query.subjectKey ? { subject: { key: query.subjectKey } } : {}),
      ...(query.gradeKey ? { grade: { key: query.gradeKey } } : {}),
      ...(query.termKey ? { term: { key: query.termKey } } : {}),
      ...(query.status ? { status: query.status as never } : {}),
    };"""
        if old_where not in out:
            stop(path + ": textbook list where-clause changed; refusing unsafe semantic rewrite")
        new_where = """    const academicTerm = query.termKey
      ? await this.db.term.findUnique({ where: { key: query.termKey }, select: { ordinal: true } })
      : null;
    if (query.termKey && !academicTerm) return { total: 0, rows: [] };
    const physicalParts: Array<'PART_1' | 'PART_2' | 'BOTH'> = academicTerm
      ? academicTerm.ordinal === 1 ? ['PART_1', 'BOTH']
        : academicTerm.ordinal === 2 ? ['PART_2', 'BOTH']
        : ['BOTH']
      : ['PART_1', 'PART_2', 'BOTH'];

    const where = {
      ...(search ? { title: { contains: search, mode: 'insensitive' as const } } : {}),
      ...(query.subjectKey ? { subject: { key: query.subjectKey } } : {}),
      ...(query.gradeKey ? { grade: { key: query.gradeKey } } : {}),
      part: { in: physicalParts },
      ...(query.status ? { status: query.status as never } : {}),
    };"""
        out=out.replace(old_where,new_where)
        out=out.replace("        term: { select: { key: true, name: true } },", "        part: true,")
        out=out.replace("        termKey: row.term.key,\n        termName: row.term.name,", "        part: String(row.part),")

        old_method="""  async findTextbookByCoordinates(input: {
    subjectKey: string;
    gradeKey: string;
    termKey: string;
    edition: string;
  }) {
    const row = await this.db.textbook.findFirst({
      where: {
        subject: { key: input.subjectKey },
        grade: { key: input.gradeKey },
        term: { key: input.termKey },
        edition: input.edition,
      },
      select: { key: true, title: true, edition: true },
    });
    return row;
  }"""
        new_method="""  async findTextbookByCoordinates(input: {
    subjectKey: string;
    gradeKey: string;
    termKey: string;
    edition: string;
  }) {
    const academicTerm = await this.db.term.findUnique({
      where: { key: input.termKey },
      select: { ordinal: true },
    });
    if (!academicTerm) return null;
    const physicalParts: Array<'PART_1' | 'PART_2' | 'BOTH'> =
      academicTerm.ordinal === 1 ? ['PART_1', 'BOTH'] :
      academicTerm.ordinal === 2 ? ['PART_2', 'BOTH'] :
      ['BOTH'];
    return this.db.textbook.findFirst({
      where: {
        subject: { key: input.subjectKey },
        grade: { key: input.gradeKey },
        part: { in: physicalParts },
        edition: input.edition,
      },
      select: { key: true, title: true, edition: true },
      orderBy: { part: 'asc' },
    });
  }"""
        if old_method not in out: stop(path + ": academic coordinate lookup anchor not found")
        out=out.replace(old_method,new_method)

        old_grade="""  async textbooksForGrade(input: {
    gradeKey: string;
    termKey?: string | undefined;
  }): Promise<TextbookCoordinateMatch[]> {
    const rows = await this.db.textbook.findMany({
      where: {
        grade: { key: input.gradeKey },
        ...(input.termKey ? { term: { key: input.termKey } } : {}),
      },
      select: { key: true, title: true, edition: true },
      orderBy: { key: 'asc' },
    });
    return rows;
  }"""
        new_grade="""  async textbooksForGrade(input: {
    gradeKey: string;
    termKey?: string | undefined;
  }): Promise<TextbookCoordinateMatch[]> {
    const academicTerm = input.termKey
      ? await this.db.term.findUnique({ where: { key: input.termKey }, select: { ordinal: true } })
      : null;
    if (input.termKey && !academicTerm) return [];
    const physicalParts: Array<'PART_1' | 'PART_2' | 'BOTH'> = academicTerm
      ? academicTerm.ordinal === 1 ? ['PART_1', 'BOTH']
        : academicTerm.ordinal === 2 ? ['PART_2', 'BOTH']
        : ['BOTH']
      : ['PART_1', 'PART_2', 'BOTH'];
    return this.db.textbook.findMany({
      where: { grade: { key: input.gradeKey }, part: { in: physicalParts } },
      select: { key: true, title: true, edition: true },
      orderBy: { key: 'asc' },
    });
  }"""
        if old_grade not in out: stop(path + ": grade textbook lookup anchor not found")
        out=out.replace(old_grade,new_grade)
    elif "edu7-content-engine" in path and path.endswith(".py"):
        if path.endswith("workspace_layout.py"):
            # Replace the complete identity/workspace functions so no academic
            # term normalization survives in the Python canonical layout.
            old = out[out.find("def textbook_key("):out.find("\ndef _rewrite_json")]
            if not old:
                stop(path + ": workspace_layout identity functions not found")
            new = '''def normalize_part(raw: str) -> str:
    value = str(raw).strip().upper()
    mapping = {"PART_1": "P1", "PART_2": "P2", "BOTH": "PB"}
    value = mapping.get(value, value)
    if value not in {"P1", "P2", "PB"}:
        raise ValueError("Physical part must be P1, P2, or PB.")
    return value


def textbook_key(subject: str, grade: int, part: str, edition: str) -> str:
    """Mirror src/shared/kernel/identifiers.ts textbookKey exactly."""
    subject = normalize_subject(subject)
    part_key = normalize_part(part)
    edition = str(edition).strip()
    if re.fullmatch(r"\\d{4}([/-]\\d{4})?", edition):
        edition_key = "ED" + edition.replace("/", "-")
    else:
        edition_key = "ED" + re.sub(r"[^A-Z0-9-]", "", edition.upper().replace("_", "-"))
    if not edition_key or edition_key == "ED":
        raise ValueError("Printed edition is required.")
    return f"EDU-{subject}-G{grade:02d}-{part_key}-{edition_key}"


def book_workspace(subject: str, grade: int, part: str, edition: str) -> Path:
    _, grade_key = normalize_grade(grade)
    part_key = normalize_part(part)
    edition_segment = "ED" + re.sub(
        r"[^A-Z0-9-]", "", str(edition).strip().upper().replace("_", "-")
    )
    if edition_segment == "ED":
        raise ValueError("Printed edition is required.")
    return workspace_root() / part_key / grade_key / normalize_subject(subject) / edition_segment
'''
            out=out.replace(old,new)
        elif path.endswith("export/json_exporter.py"):
            out=out.replace('        term = metadata.get("termKey", metadata.get("term", "2026-2027-T01"))',
                            '        part = metadata.get("part", "P1")')
            out=out.replace('f"EDU-{subject}-{grade}-T1-ED{edition}"',
                            'f"EDU-{subject}-{grade}-{part}-ED{edition}"')
            out=out.replace('"termKey": term,', '"part": part,')
        else:
            out=out.replace('term = coords.get("term", "T1")', 'part = coords.get("part", "P1")')
            out=out.replace('"term": term', '"part": part')
            out=out.replace('"termKey": term', '"part": part')
            out=out.replace('-T1-ED', '-P1-ED')
    elif path.endswith(("textbook-workspace-modal.tsx",
                        "textbook-pdf-modal.tsx",
                        "textbook-create-modal.tsx",
                        "textbook-create-panel.tsx")):
        out = out.replace("termKey: textbook.termKey", "part: textbook.part")
        out = out.replace("term: textbook.termKey", "part: textbook.part")
        out = out.replace("term: manifest.term", "part: manifest.part")
        out = out.replace("termKey: manifest.term", "part: manifest.part")
        out = out.replace("term: T01", "part: P1")

    else:
        out = re.sub(
            r"(EDU-[A-Z0-9]+-G\d{2})-T([12])(-ED[A-Z0-9-]+)",
            lambda m: m.group(1) + ("-P1" if m.group(2) == "1" else "-P2") + m.group(3),
            out, flags=re.I)

    guard_isbn(text, out, path)
    return out

def validate(files: dict[str, tuple[str, str]]) -> None:
    combined = "\n".join(after for _, after in files.values())
    leftovers = sorted(set(OLD_KEY.findall(combined)))
    if leftovers:
        stop("Old physical textbook keys remain:\n" + "\n".join(leftovers[:20]))

    if "createTextbook(input: {" not in combined:
        stop("createTextbook contract is missing")
    if "part: 'PART_1' | 'PART_2' | 'BOTH';" not in combined:
        stop("Physical part type contract is missing")

    physical_residue = [
        "termId: input.termId",
        "termId: resolved.term.id",
        "readonly termKey: string;",
        "pkg.textbook.termKey",
        '"termKey": term',
    ]
    for marker in physical_residue:
        if marker in combined:
            stop("Physical migration residue remains: " + marker)

    if re.search(r"buildTextbookKey\([\s\S]{0,500}?term\s*:", combined):
        stop("A physical textbook key is still built from term")
    if re.search(r"EDU-[^\n]*-T[12]-ED", combined, re.I):
        stop("A T1/T2 physical-key compatibility path remains")
    if re.search(r"createTextbook[\s\S]{0,3000}?resolveTextbookCoordinates", combined):
        stop("Physical createTextbook still resolves academic term")
    if re.search(r"term\.ordinal\s*===\s*[12][\s\S]{0,120}?PART_", combined):
        stop("Physical part is still derived from academic term ordinal")

    workspace = "\n".join(
        after for path, (_, after) in files.items()
        if "workspace" in path.lower()
    )
    if workspace and ("T01" in workspace or re.search(r"\bT[12]\b", workspace)):
        stop("Workspace still contains a physical T1/T01 identity")

    for path, (before, after) in files.items():
        guard_isbn(before, after, path)

def show_diff(files: dict[str, tuple[str, str]]) -> None:
    changed = 0
    for path, (before, after) in files.items():
        if before == after:
            continue
        changed += 1
        print("".join(difflib.unified_diff(
            before.splitlines(keepends=True), after.splitlines(keepends=True),
            fromfile=path, tofile=path)))
    print(f"\nProposed changed files: {changed}")

def apply(files: dict[str, tuple[str, str]]) -> None:
    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup = BACKUPS / stamp
    backup.mkdir(parents=True, exist_ok=False)
    manifest = []
    for path, (before, after) in files.items():
        if before == after:
            continue
        b = backup / path
        b.parent.mkdir(parents=True, exist_ok=True)
        b.write_text(before, encoding="utf-8")
        manifest.append(path + "\t" + hashlib.sha256(before.encode()).hexdigest() + "\n")
    (backup / "MANIFEST.sha256").write_text("".join(manifest), encoding="utf-8")
    for path, (before, after) in files.items():
        if before == after:
            continue
        if read(path) != before:
            stop(path + " changed after preflight")
        target = ROOT / path
        with tempfile.NamedTemporaryFile("w", encoding="utf-8",
                                         dir=target.parent, delete=False) as f:
            f.write(after)
            tmp = Path(f.name)
        os.replace(tmp, target)
    p = subprocess.run(["git", "diff", "--check"], cwd=ROOT, text=True,
                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    if p.returncode:
        stop("git diff --check failed:\n" + p.stdout)
    print("\nAPPLY PASS")
    print("Backup:", backup)
    print("No commit or push was performed.")

def main() -> None:
    if MODE not in {"audit", "apply"}:
        stop("MODE must be audit or apply")
    print("=" * 72)
    print("EDU7 TEXTBOOK PHYSICAL-PART MIGRATION")
    print("=" * 72)
    print("Repository:", ROOT)
    print("Branch:    ", BRANCH)
    print("Mode:      ", MODE)
    preflight()
    original = {p: read(p) for p in TARGETS}
    proposed: dict[str, tuple[str, str]] = {}

    # Audit mode is deliberately non-blocking: inspect every target and collect
    # all migration blockers before presenting the final evaluation. Apply mode
    # remains fail-closed and is only reached after a clean audit.
    for path, before in original.items():
        try:
            proposed[path] = (before, transform(path, before))
        except MigrationIssue as exc:
            AUDIT_ISSUES.append(f"{path}: {exc}")
            proposed[path] = (before, before)
        except Exception as exc:
            AUDIT_ISSUES.append(f"{path}: unexpected migration error: {exc}")
            proposed[path] = (before, before)

    if MODE == "audit":
        if not AUDIT_ISSUES:
            try:
                validate(proposed)
            except MigrationIssue as exc:
                AUDIT_ISSUES.append(str(exc))
            except Exception as exc:
                AUDIT_ISSUES.append("validation: unexpected error: " + str(exc))
        show_diff(proposed)
        print("\n" + "=" * 72)
        print("FINAL AUDIT EVALUATION")
        print("=" * 72)
        if AUDIT_ISSUES:
            print("STATUS: BLOCKED")
            print(f"Blockers found: {len(AUDIT_ISSUES)}")
            for i, issue in enumerate(AUDIT_ISSUES, 1):
                print(f"\n[{i}] {issue}")
            print("\nNo files were written.")
            print("Fix the migration script blockers, then rerun audit.")
            return
        print("STATUS: PASS")
        print("All targets transformed and cross-file validation passed.")
        print("No files were written.")
        print("The local migration script itself was ignored by preflight.")
        return

    # Apply is fail-closed: never apply a partially audited migration.
    if AUDIT_ISSUES:
        stop("Apply refused because audit blockers were collected:\n" +
             "\n".join(AUDIT_ISSUES))
    validate(proposed)
    show_diff(proposed)
    apply(proposed)

if __name__ == "__main__":
    main()
