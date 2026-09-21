"""Canonical filesystem contract for Edu7 content preparation.

The Python engine is code-only. Source PDFs and generated workspaces live at
repository root so the engine cannot accidentally treat its package directory
as the content store.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
from pathlib import Path
from typing import Any, Dict


def project_root() -> Path:
    explicit = os.environ.get("EDU7_PROJECT_ROOT")
    if explicit:
        return Path(explicit).expanduser().resolve()

    here = Path(__file__).resolve()
    for candidate in [here, *here.parents]:
        if (candidate / "edu7-content-engine").is_dir() and (candidate / "prisma").is_dir():
            return candidate

    try:
        result = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            capture_output=True, text=True, check=True,
        )
        return Path(result.stdout.strip()).resolve()
    except Exception:
        # Package-local fallback for editable/isolated installs.
        return here.parents[4]


def books_input_root() -> Path:
    return project_root() / "books_input"


def workspace_root() -> Path:
    return project_root() / "workspace"


def normalize_grade(raw: str | int) -> tuple[int, str]:
    value = str(raw).strip().upper().replace("GRADE", "").replace("G", "")
    number = int(value)
    if not 1 <= number <= 12:
        raise ValueError("Grade must be between 1 and 12.")
    return number, f"G{number:02d}"


def normalize_term(raw: str | int) -> tuple[int, str]:
    value = str(raw).strip().upper().replace("TERM", "").replace("T", "")
    number = int(value)
    if not 1 <= number <= 4:
        raise ValueError("Term must be between 1 and 4.")
    return number, f"T{number:02d}"


def normalize_subject(raw: str) -> str:
    value = re.sub(r"[^A-Z0-9]", "", str(raw).strip().upper())
    if not value:
        raise ValueError("Subject key is required.")
    if len(value) > 8:
        raise ValueError("Subject key must be 8 characters or fewer.")
    return value


def textbook_key(subject: str, grade: int, term: int, edition: str) -> str:
    """Mirror src/shared/kernel/identifiers.ts textbookKey exactly."""
    subject = normalize_subject(subject)
    edition = str(edition).strip()
    if re.fullmatch(r"\d{4}([/-]\d{4})?", edition):
        edition_key = "ED" + edition.replace("/", "-")
    else:
        edition_key = "ED" + re.sub(r"[^A-Z0-9-]", "", edition.upper().replace("_", "-"))
    if not edition_key or edition_key == "ED":
        raise ValueError("Printed edition is required.")
    return f"EDU-{subject}-G{grade:02d}-T{term}-{edition_key}"


def book_workspace(subject: str, grade: int, term: int, edition: str) -> Path:
    _, grade_key = normalize_grade(grade)
    term_number, term_key = normalize_term(term)
    key = textbook_key(subject, int(grade), term_number, edition)
    return workspace_root() / term_key / grade_key / normalize_subject(subject) / key


def _rewrite_json(path: Path, replacements: Dict[str, str]) -> None:
    if not path.exists():
        return
    data = json.loads(path.read_text(encoding="utf-8"))
    raw = json.dumps(data, ensure_ascii=False, indent=2)
    for old, new in replacements.items():
        raw = raw.replace(old, new)
    path.write_text(raw, encoding="utf-8")


def finalize_book_workspace(book_dir: Path, book_key: str, subject_key: str) -> None:
    """Convert segmenter's internal textbook artifact into the public layout.

    The segmenter remains the single PDF slicing implementation. This finalizer
    only moves/renames its book-level artifact and creates the stable import
    manifest; it never changes lesson/unit semantics.
    """
    internal = book_dir / "textbook"
    source = book_dir / "source"
    if internal.exists():
        source.mkdir(parents=True, exist_ok=True)
        pdf = internal / "textbook.pdf"
        if pdf.exists():
            pdf.rename(source / f"{book_key}.pdf")
        manifest = internal / "textbook_manifest.json"
        if manifest.exists():
            manifest.rename(source / "book-source-manifest.json")
        try:
            internal.rmdir()
        except OSError:
            pass

    replacements = {
        "textbook/textbook.pdf": f"source/{book_key}.pdf",
        "textbook_manifest.json": "source/book-source-manifest.json",
    }
    for name in ("index.json", "edu7-content-package.json"):
        _rewrite_json(book_dir / name, replacements)

    index_path = book_dir / "index.json"
    package_path = book_dir / "edu7-content-package.json"
    if index_path.exists():
        index = json.loads(index_path.read_text(encoding="utf-8"))
        index["schemaVersion"] = "2.0"
        index["textbookKey"] = book_key
        index.setdefault("metadata", {})["subjectKey"] = subject_key
        index["workspacePath"] = str(book_dir.relative_to(project_root()))
        index_path.write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")

    if package_path.exists():
        package = json.loads(package_path.read_text(encoding="utf-8"))
        package["meta"]["profileVersion"] = "1.2"
        package["textbook"]["key"] = book_key
        package["textbook"]["subjectKey"] = subject_key
        package["textbook"]["workspacePath"] = str(book_dir.relative_to(project_root()))
        package_path.write_text(json.dumps(package, ensure_ascii=False, indent=2), encoding="utf-8")

    book_manifest = {
        "schemaVersion": "2.0",
        "textbookKey": book_key,
        "subjectKey": subject_key,
        "workspacePath": str(book_dir.relative_to(project_root())),
        "indexFile": "index.json",
        "contentPackageFile": "edu7-content-package.json",
        "sourcePdf": f"source/{book_key}.pdf",
        "unitsPath": ".",
        "databaseImport": {
            "identity": "Textbook.key",
            "subjectKey": subject_key,
            "textbookKey": book_key,
            "writePath": "Node ContentImportService",
            "pythonDatabaseWrite": False,
        },
    }
    (book_dir / "book-manifest.json").write_text(
        json.dumps(book_manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
