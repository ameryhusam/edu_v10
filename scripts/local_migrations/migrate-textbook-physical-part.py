#!/usr/bin/env python3
"""Edu7 direct textbook physical-part migration. No compatibility layer."""

from __future__ import annotations
import datetime as dt
import difflib
import json
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
    "src/contexts/content/application/textbook-administration.service.ts",
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
    "prisma/seed/data/external/yemen-moe-textbook-sources.json",
    "scripts/seed-helpers.mjs",
    "scripts/convert-legacy-curriculum.mjs",
    "scripts/extract_textbook_toc.py",
    "edu7-content-engine/src/edu7_content/workspace_layout.py",
    "edu7-content-engine/src/edu7_content/export/json_exporter.py",
    "edu7-content-engine/src/edu7_content/pdf/segmentation.py",
    "web/src/features/content/content.api.ts",
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
    elif path.endswith("source-catalog.ts"):
        # Source catalogue physical identity is explicit; never derive it from
        # AcademicYear/Term. The source data must carry the physical part.
        replacements = [
            (
                "  readonly termOrdinal: number;",
                "  readonly part: 'PART_1' | 'PART_2' | 'BOTH';",
            ),
            (
                "  const terms = await prisma.term.findMany({\n    where: { academicYear: { key: ctx.academicYearKey } },\n    select: { id: true, ordinal: true },\n  });\n\n",
                "",
            ),
            (
                "  const termByOrdinal = new Map(terms.map((term) => [term.ordinal, term]));",
                "",
            ),
            (
                "    const term = termByOrdinal.get(source.termOrdinal);\n    if (!grade || !subject || !term) {",
                "    if (!grade || !subject) {",
            ),
            (
                "    const part =\n      source.termOrdinal === 1\n        ? 'PART_1'\n        : source.termOrdinal === 2\n          ? 'PART_2'\n          : 'BOTH';\n\n",
                "    const part = source.part;\n\n",
            ),
            (
                "  return source.termOrdinal * 100 + base;",
                "  return source.part === 'PART_1' ? 100 + base : source.part === 'PART_2' ? 200 + base : 300 + base;",
            ),
            (
                "مقرر الفصل الدراسي " + "$" + "{source.termOrdinal}",
                "الجزء الفيزيائي " + "$" + "{source.part}",
            ),
            (
                "مصدر الفصل الدراسي " + "$" + "{source.termOrdinal}",
                "مصدر الجزء الفيزيائي " + "$" + "{source.part}",
            ),
        ]
        for old, new in replacements:
            if old not in out:
                stop(path + ": expected source-catalog anchor missing: " + old.splitlines()[0][:100])
            out = out.replace(old, new, 1)
        # Do not stop here. The global audit must inspect every transformed
        # target and report all remaining compatibility/term-derived patterns.

    elif path.endswith("yemen-moe-textbook-sources.json"):
        try:
            data = json.loads(out)
        except json.JSONDecodeError as exc:
            stop(path + ": invalid JSON: " + str(exc))
        sources = data.get("TextbookSource")
        if not isinstance(sources, list):
            stop(path + ": TextbookSource array missing")
        for item in sources:
            if not isinstance(item, dict):
                stop(path + ": invalid TextbookSource entry")
            if "termOrdinal" not in item:
                stop(path + ": TextbookSource entry missing termOrdinal")
            ordinal = item.pop("termOrdinal")
            if ordinal == 1:
                item["part"] = "PART_1"
            elif ordinal == 2:
                item["part"] = "PART_2"
            else:
                item["part"] = "BOTH"
        out = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
        if '"termOrdinal"' in out:
            stop(path + ": physical source catalogue still contains termOrdinal")

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
    elif path.endswith("textbook-administration.service.ts"):
        # Textbook administration is a physical-book capability.
        # Academic term is never converted into a physical part.
        out = out.replace("    termKey?: string | undefined;\n", "    part?: 'PART_1' | 'PART_2' | 'BOTH' | undefined;\n")
        out = out.replace("      termKey: string;\n", "      part: 'PART_1' | 'PART_2' | 'BOTH';\n")
        out = out.replace("      termKey?: string | undefined;\n", "      part?: 'PART_1' | 'PART_2' | 'BOTH' | undefined;\n")
        out = out.replace("        termKey: input.termKey,\n", "        part: input.part,\n")
        out = out.replace("      termKey: input.termKey,\n", "      part: input.part,\n")
        out = out.replace("...(query.termKey ? { termKey: query.termKey } : {}),", "...(query.part ? { part: query.part } : {}),")
        out = out.replace("termKey: input.termKey", "part: input.part")
        out = out.replace("termKey: query.termKey", "part: query.part")
        if "termKey" in out:
            stop(path + ": textbook administration still derives physical identity from academic term")
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

    elif path.endswith("content-import.service.ts"):
        out = out.replace("EDU-CUSTOM-G01-T1-ED2026", "EDU-CUSTOM-G01-P1-ED2026")
        out = out.replace("termKey: pkg.textbook.termKey,", "part: pkg.textbook.part,")
        out = out.replace("pkg.textbook.termKey", "pkg.textbook.part")

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
        # Workspace remains academic-term based:
        # Workspace/<term>/<grade>/<subject_part>/<edition>
        # Example: Workspace/T01/G07/SCI_P1/ED2026
        out = out.replace("  readonly term: string;\n  readonly grade: string;\n  readonly subject: string;\n  readonly edition?: string | undefined;",
                          "  readonly term: string;\n  readonly grade: string;\n  readonly subject: string;\n  readonly part?: 'PART_1' | 'PART_2' | 'BOTH';\n  readonly edition?: string | undefined;", 1)
        const_old = """    const termNorm = coords.term.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    const gradeNorm = coords.grade.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    const subjectNorm = coords.subject.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    const base = path.join(this.workspaceBaseDir, termNorm, gradeNorm, subjectNorm);"""
        if const_old not in out:
            stop(path + ": expected workspace path block not found")
        out = out.replace(const_old, """    const termNorm = coords.term.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    const gradeNorm = coords.grade.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    const subjectNorm = coords.subject.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    const partNorm = coords.part
      ? coords.part.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
      : '';
    const partSegment =
      partNorm === 'PART_1' ? 'P1' :
      partNorm === 'PART_2' ? 'P2' :
      partNorm === 'BOTH' ? 'PB' :
      '';
    const subjectSegment = partSegment ? subjectNorm + '_' + partSegment : subjectNorm;
    const base = path.join(this.workspaceBaseDir, termNorm, gradeNorm, subjectSegment);""", 1)
        const_old_key = 'const match = /^EDU-(.+?)-G\\d+?-T(\\d+)-ED(.+)$/i.exec(textbookKey.trim());'
        if const_old_key not in out:
            # accept the actual migration-script spelling
            const_old_key = 'const match = /^EDU-(.+?)-G(\\d+)-T(\\d+)-ED(.+)$/i.exec(textbookKey.trim());'
        if const_old_key not in out:
            stop(path + ": legacy textbook key resolver anchor not found")
        out = out.replace(const_old_key,
                          'const match = /^EDU-(.+?)-G(\\d+)-(P1|P2|PB)-ED(.+)$/i.exec(textbookKey.trim());', 1)
        out = out.replace("const [, subject, grade, term, edition] = match;",
                          "const [, subject, grade, part, edition] = match;", 1)
        out = out.replace("!term || !edition", "!part || !edition", 1)
        return_old = """    return this.getWorkspaceDir({
      subject,
      grade: `G${grade}`,
      term: `T${term}`,
      edition,
    });"""
        if return_old not in out:
            stop(path + ": textbook-key workspace return anchor not found")
        out = out.replace(return_old, """    throw new Error(
      'A textbook key does not contain academic term; use getWorkspaceDir with explicit term and physical part.',
    );""", 1)


    elif path.endswith("workspace-importer.service.ts"):
        old = """  async prepareWorkspace(input: {
    term: string;
    grade: string;
    subject: string;
    edition?: string;"""
        if old not in out:
            stop(path + ": expected workspace prepare signature not found")
        out = out.replace(old, """  async prepareWorkspace(input: {
    term: string;
    grade: string;
    subject: string;
    part: 'PART_1' | 'PART_2' | 'BOTH';
    edition?: string;""", 1)
        out = out.replace(
            "const coords = { term: input.term, grade: input.grade, subject: input.subject, ...(edition ? { edition } : {}) };",
            "const coords = { term: input.term, grade: input.grade, subject: input.subject, part: input.part, ...(edition ? { edition } : {}) };", 1)
        out = out.replace(
            "this.workspaceManager.getWorkspaceDir({ part: input.part, grade: input.grade, subject: input.subject })",
            "this.workspaceManager.getWorkspaceDir({ term: input.term, grade: input.grade, subject: input.subject, part: input.part })", 1)


    elif path.endswith("workspace-archive.service.ts"):
        out = out.replace("term: pkg.textbook.termKey,", "part: pkg.textbook.part,")
        out = out.replace("pkg.textbook.termKey", "pkg.textbook.part")
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
        # Keep repository documentation aligned with the new canonical physical key.
        out = out.replace("EDU-MATH-G07-T1-ED2026", "EDU-MATH-G07-P1-ED2026")
        old_where = """    const where = {
      ...(search ? { title: { contains: search, mode: 'insensitive' as const } } : {}),
      ...(query.subjectKey ? { subject: { key: query.subjectKey } } : {}),
      ...(query.gradeKey ? { grade: { key: query.gradeKey } } : {}),
      ...(query.termKey ? { term: { key: query.termKey } } : {}),
      ...(query.status ? { status: query.status as never } : {}),
    };"""
        if old_where not in out:
            stop(path + ": textbook list where-clause changed; refusing unsafe semantic rewrite")
        new_where = """    const where = {
      ...(search ? { title: { contains: search, mode: 'insensitive' as const } } : {}),
      ...(query.subjectKey ? { subject: { key: query.subjectKey } } : {}),
      ...(query.gradeKey ? { grade: { key: query.gradeKey } } : {}),
      ...(query.part ? { part: query.part } : {}),
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
    part: 'PART_1' | 'PART_2' | 'BOTH';
    edition: string;
  }) {
    return this.db.textbook.findFirst({
      where: {
        subject: { key: input.subjectKey },
        grade: { key: input.gradeKey },
        part: input.part,
        edition: input.edition,
      },
      select: { key: true, title: true, edition: true },
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
    part?: 'PART_1' | 'PART_2' | 'BOTH' | undefined;
  }): Promise<TextbookCoordinateMatch[]> {
    return this.db.textbook.findMany({
      where: { grade: { key: input.gradeKey }, ...(input.part ? { part: input.part } : {}) },
      select: { key: true, title: true, edition: true },
      orderBy: { key: 'asc' },
    });
  }"""
        if old_grade not in out: stop(path + ": grade textbook lookup anchor not found")
        out=out.replace(old_grade,new_grade)
        if "academicTerm" in out or "physicalParts" in out or "term.ordinal" in out:
            stop(path + ": physical textbook identity still depends on academic term")
    elif "edu7-content-engine" in path and path.endswith(".py"):
        if path.endswith("workspace_layout.py"):
            start = out.find("def textbook_key(")
            end = out.find("\ndef _rewrite_json", start)
            if start < 0 or end < 0:
                stop(path + ": workspace_layout identity functions not found")
            old = out[start:end]
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


def book_workspace(subject: str, grade: int, term: int, part: str, edition: str) -> Path:
    _, grade_key = normalize_grade(grade)
    _, term_key = normalize_term(term)
    part_key = normalize_part(part)
    edition_segment = "ED" + re.sub(
        r"[^A-Z0-9-]", "", str(edition).strip().upper().replace("_", "-")
    )
    if edition_segment == "ED":
        raise ValueError("Printed edition is required.")
    subject_segment = f"{normalize_subject(subject)}_{part_key}"
    return workspace_root() / term_key / grade_key / subject_segment / edition_segment
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
    elif path.endswith("content.routes.ts"):
        # Workspace/source-upload coordinates are physical textbook identity.
        out = out.replace("  const uploadTextbookSourceInput = z.object({\n    term: z.string().min(1),",
                          "  const uploadTextbookSourceInput = z.object({\n    part: z.enum(['PART_1', 'PART_2', 'BOTH']),", 1)
        out = out.replace("          term: z.string().min(1),\n          grade: z.string().min(1),\n          subject: z.string().min(1),",
                          "          part: z.enum(['PART_1', 'PART_2', 'BOTH']),\n          grade: z.string().min(1),\n          subject: z.string().min(1),", 1)
        out = out.replace("          term: query.data.term,\n          grade: query.data.grade,",
                          "          part: query.data.part,\n          grade: query.data.grade,", 1)
        out = out.replace("          term: input.term,\n          grade: input.grade,\n          subject: input.subject,\n          edition: input.edition,\n          title: input.title,\n          buffer,",
                          "          part: input.part,\n          grade: input.grade,\n          subject: input.subject,\n          edition: input.edition,\n          title: input.title,\n          buffer,", 1)
        out = out.replace("  const workspacePrepareInput = z.object({\n    term: z.string().min(1),",
                          "  const workspacePrepareInput = z.object({\n    part: z.enum(['PART_1', 'PART_2', 'BOTH']),", 1)
        out = out.replace("          term: input.term,\n          grade: input.grade,\n          subject: input.subject,",
                          "          part: input.part,\n          grade: input.grade,\n          subject: input.subject,", 1)

    elif path.endswith("content.api.ts"):
        # Physical textbook/workspace contracts expose part. Academic term
        # remains only in adoption/enrollment contracts.
        out = out.replace("  readonly termKey: string;\n  readonly termName: string;\n  readonly edition: string;",
                          "  readonly part: 'PART_1' | 'PART_2' | 'BOTH';\n  readonly edition: string;", 1)
        out = out.replace("  readonly subjectKey: string;\n  readonly gradeKey: string;\n  readonly termKey: string;\n  readonly title: string;",
                          "  readonly subjectKey: string;\n  readonly gradeKey: string;\n  readonly part: 'PART_1' | 'PART_2' | 'BOTH';\n  readonly title: string;", 1)
        out = out.replace("    termKey: string;\n    edition: string;",
                          "    part: 'PART_1' | 'PART_2' | 'BOTH';\n    edition: string;", 1)
        out = out.replace("    term?: string | undefined;\n    status?: PublicationStatus;",
                          "    part?: 'PART_1' | 'PART_2' | 'BOTH' | undefined;\n    status?: PublicationStatus;", 1)
        out = out.replace("    term: string;\n    grade: string;\n    subject: string;\n    edition?: string;",
                          "    part: 'PART_1' | 'PART_2' | 'BOTH';\n    grade: string;\n    subject: string;\n    edition?: string;", 1)
        out = out.replace("      term: input.term,\n      grade: input.grade,",
                          "      part: input.part,\n      grade: input.grade,", 1)
        out = out.replace("    term: string;\n    grade: string;\n    subject: string;\n    edition?: string;",
                          "    part: 'PART_1' | 'PART_2' | 'BOTH';\n    grade: string;\n    subject: string;\n    edition?: string;", 1)
        out = out.replace("      term: input.term,\n      grade: input.grade,",
                          "      part: input.part,\n      grade: input.grade,", 1)

    elif path.endswith(("textbook-workspace-modal.tsx",
                        "textbook-pdf-modal.tsx",
                        "textbook-create-modal.tsx",
                        "textbook-create-panel.tsx")):
        if path.endswith("textbook-workspace-modal.tsx"):
            out = out.replace("    term?: string | undefined;\n    grade?: string | undefined;",
                              "    part?: 'PART_1' | 'PART_2' | 'BOTH' | undefined;\n    grade?: string | undefined;", 1)
            out = out.replace("  const [term, setTerm] = useState(initialCoordinates?.term || 'T01');",
                              "  const [part, setPart] = useState<'PART_1' | 'PART_2' | 'BOTH'>(initialCoordinates?.part || 'PART_1');", 1)
            out = out.replace("        term: string;\n        grade: string;",
                              "        part: 'PART_1' | 'PART_2' | 'BOTH';\n        grade: string;", 1)
            out = out.replace("        term: term.trim(),\n        grade: grade.trim(),",
                              "        part,\n        grade: grade.trim(),", 1)
            out = out.replace("        term: payload.term,\n        grade: payload.grade,",
                              "        part: payload.part,\n        grade: payload.grade,", 1)
            out = out.replace("                        setTerm(ws.manifest?.term || 'T01');",
                              "                        setPart(ws.manifest?.part || 'PART_1');", 1)
            out = out.replace("{ws.manifest?.workspaceId || ws.manifest?.term}",
                              "{ws.manifest?.workspaceId || ws.manifest?.part}", 1)
            out = out.replace("                  <label className=\"text-xs font-medium text-text-muted\">الفصل الدراسي (Term)</label>",
                              "                  <label className=\"text-xs font-medium text-text-muted\">الجزء الفيزيائي (Part)</label>", 1)
            out = out.replace("                    value={term}", "                    value={part}", 1)
            out = out.replace("                    onChange={(e) => setTerm(e.target.value.toUpperCase())}",
                              "                    onChange={(e) => setPart(e.target.value.toUpperCase() as 'PART_1' | 'PART_2' | 'BOTH')}", 1)
            out = out.replace("                    placeholder=\"T01\"", "                    placeholder=\"PART_1\"", 1)
            out = out.replace("                    disabled={prepareMutation.isPending || !subject || !grade || !term}",
                              "                    disabled={prepareMutation.isPending || !subject || !grade || !part}", 1)
            out = out.replace("كتاب الرياضيات - الصف السابع - الفصل الأول",
                              "كتاب الرياضيات - الصف السابع - الجزء الأول", 1)
        else:
            out = out.replace("termKey: textbook.termKey", "part: textbook.part")
            out = out.replace("term: textbook.termKey", "part: textbook.part")
            out = out.replace("term: manifest.term", "part: manifest.part")
            out = out.replace("termKey: manifest.term", "part: manifest.part")
            out = out.replace("term: T01", "part: PART_1")


    else:
        out = re.sub(
            r"(EDU-[A-Z0-9]+-G\d{2})-T([12])(-ED[A-Z0-9-]+)",
            lambda m: m.group(1) + ("-P1" if m.group(2) == "1" else "-P2") + m.group(3),
            out, flags=re.I)

    guard_isbn(text, out, path)
    return out

def collect_physical_part_issues(files: dict[str, tuple[str, str]]) -> list[str]:
    issues: list[str] = []

    checks = [
        ("PHYSICAL_PART_DERIVED_FROM_TERM_ORDINAL",
         re.compile(r"term\\.ordinal\\s*===\\s*[12][\\s\\S]{0,180}?PART_(?:1|2|BOTH)")),
        ("PHYSICAL_PART_DERIVED_FROM_TERMORDINAL",
         re.compile(r"(?:source\\.)?termOrdinal\\s*===\\s*[12][\\s\\S]{0,180}?PART_(?:1|2|BOTH)")),
        ("PHYSICAL_PART_FROM_TERM_CONDITIONAL",
         re.compile(r"(?:termOrdinal|term\\.ordinal)[\\s\\S]{0,220}(?:PART_1|PART_2|PART_3|BOTH)")),
        ("OLD_PHYSICAL_T1_T2_KEY",
         re.compile(r"EDU-[A-Z0-9]+-G\\d{2}-T[12]-ED[A-Z0-9-]+", re.I)),
        ("PHYSICAL_CREATE_RESOLVES_ACADEMIC_TERM",
         re.compile(r"createTextbook[\\s\\S]{0,3000}?resolveTextbookCoordinates")),
    ]

    for path, (_, after) in files.items():
        for name, pattern in checks:
            for match in pattern.finditer(after):
                line = after.count("\\n", 0, match.start()) + 1
                start = max(0, match.start() - 160)
                end = min(len(after), match.end() + 160)
                snippet = after[start:end].replace("\\n", " ").strip()
                issues.append(f"{path}:{line}: {name}: {snippet}")

    # Workspace physical identity is allowed to mention academic terms only
    # when they are explicitly academic metadata. Block only legacy physical
    # coordinate/path/key forms, not legitimate prose or academic Term usage.
    workspace_files = {
        path: after
        for path, (_, after) in files.items()
        if "workspace" in path.lower()
    }

    workspace_patterns = [
        ("LEGACY_PHYSICAL_KEY", re.compile(r"EDU-[A-Z0-9]+-G\\d{2}-T[12]-ED[A-Z0-9-]+", re.I)),
    ]

    for path, text in workspace_files.items():
        for name, pattern in workspace_patterns:
            for match in pattern.finditer(text):
                line = text.count("\\n", 0, match.start()) + 1
                start = max(0, match.start() - 120)
                end = min(len(text), match.end() + 120)
                snippet = text[start:end].replace("\\n", " ").strip()
                issues.append(
                    f"{path}:{line}: WORKSPACE_{name}: {snippet}"
                )

    return issues


def validate(files: dict[str, tuple[str, str]]) -> None:
    issues: list[str] = []

    combined = "\\n".join(after for _, after in files.values())

    leftovers = sorted(set(OLD_KEY.findall(combined)))
    if leftovers:
        issues.append(
            "OLD_PHYSICAL_TEXTBOOK_KEYS: " + ", ".join(leftovers[:50])
        )

    if "createTextbook(input: {" not in combined:
        issues.append("Missing createTextbook contract")

    if "part: 'PART_1' | 'PART_2' | 'BOTH';" not in combined:
        issues.append("Missing physical part type contract")

    issues.extend(collect_physical_part_issues(files))

    for path, (before, after) in files.items():
        try:
            guard_isbn(before, after, path)
        except MigrationIssue as exc:
            issues.append(str(exc))

    if issues:
        for issue in issues:
            AUDIT_ISSUES.append(issue)
        raise MigrationIssue(f"{len(issues)} audit blocker(s) found")

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
        try:
            validate(proposed)
        except MigrationIssue:
            # validate() has already collected every discovered blocker.
            pass
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
