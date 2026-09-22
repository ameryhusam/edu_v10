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

TARGETS = [
    "src/shared/kernel/identifiers.ts",
    "src/contexts/content/application/ports.ts",
    "src/contexts/content/application/authoring.service.ts",
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
    raise SystemExit("\nMIGRATION STOPPED\n" + "=" * 72 + "\n" +
                     message + "\nNO FILES WERE WRITTEN.\n")

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

def isbn_lines(text: str) -> dict[int, str]:
    return {i: line for i, line in enumerate(text.splitlines(keepends=True), 1)
            if ISBN.search(line)}

def guard_isbn(before: str, after: str, path: str) -> None:
    if isbn_lines(before) != isbn_lines(after):
        stop("ISBN line changed in " + path)

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
        out = one(out,
"""    termKey: string;
    title: string;
""",
"""    part: 'PART_1' | 'PART_2' | 'BOTH';
    title: string;
""", path)

    elif path.endswith("authoring.service.ts"):
        out = one(out,
"""      subjectKey: string;
      gradeKey: string;
      termKey: string;
      title: string;
      edition: string;
""",
"""      subjectKey: string;
      gradeKey: string;
      part: 'PART_1' | 'PART_2' | 'BOTH';
      title: string;
      edition: string;
""", path)
        if re.search(r"term\.ordinal.*PART_|PART_.*term\.ordinal", out):
            stop(path + ": forbidden part/academic-term derivation found")
        out = out.replace("term: term.ordinal,", "part: input.part,")
        out = out.replace("term ordinal and", "physical part and")

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
        out = one(out, "  readonly term: string;\n",
                  "  readonly part: string;\n", path)

    elif path.endswith("workspace-manager.ts"):
        out = one(out, "  readonly term: string;\n",
                  "  readonly part: string;\n", path)
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
        out = one(out, "    termId: string;\n    title: string;\n",
                  "    part: 'PART_1' | 'PART_2' | 'BOTH';\n    title: string;\n", path)
        out = one(out, "        termId: input.termId,\n",
                  "        part: input.part,\n", path)

    elif path.endswith("textbook-administration.repository.ts"):
        if re.search(r"textbook:\s*\{[^}]*term", out, re.S):
            stop(path + ": Textbook/Term relation found; explicit physical-part rewrite required")

    elif "edu7-content-engine" in path and path.endswith(".py"):
        out = out.replace(
            "def textbook_key(subject: str, grade: int, term: int, edition: str)",
            "def textbook_key(subject: str, grade: int, part: str, edition: str)")
        out = out.replace(
            "def book_workspace(subject: str, grade: int, term: int, edition: str)",
            "def book_workspace(subject: str, grade: int, part: str, edition: str)")
        out = out.replace(
            'f"EDU-{subject}-G{grade:02d}-T{term}-ED{edition}"',
            'f"EDU-{subject}-G{grade:02d}-{part}-ED{edition}"')
        out = out.replace(
            'metadata.get("termKey", metadata.get("term", "2026-2027-T01"))',
            'metadata.get("part", "P1")')
        out = out.replace('"termKey": term', '"part": part')
        out = out.replace('term = coords.get("term", "T1")',
                          'part = coords.get("part", "P1")')
        out = out.replace('"term": term', '"part": part')

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
    if "createTextbook(input: {" not in combined or \
       "part: 'PART_1' | 'PART_2' | 'BOTH';" not in combined:
        stop("Physical createTextbook part contract is missing")
    for marker in ["readonly term: string;", "readonly termKey: string;",
                   "input.term", '"termKey": term']:
        if marker in combined:
            stop("Physical migration residue remains: " + marker)
    if re.search(r"buildTextbookKey\([\s\S]{0,400}?term\s*:", combined):
        stop("A physical textbook key is still built from term")
    if re.search(r"EDU-[^\n]*-T[12]-ED", combined, re.I):
        stop("A T1/T2 physical-key compatibility path remains")
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
    proposed = {p: (before, transform(p, before)) for p, before in original.items()}
    validate(proposed)
    show_diff(proposed)
    if MODE == "audit":
        print("\nAUDIT PASS")
        print("No files were written.")
        print("The local migration script itself was ignored by preflight.")
        return
    apply(proposed)

if __name__ == "__main__":
    main()
