"""Rebuild derived PDFs from the canonical lesson-PDF workspace.

Workspace persists lesson PDFs only. Unit/book PDFs are reproducible derivatives
and are assembled on demand in deterministic manifest order.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Iterable


def _read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _lesson_paths(book_dir: Path, lesson_dirs: Iterable[Path]) -> list[Path]:
    result = []
    for lesson_dir in lesson_dirs:
        manifest_path = lesson_dir / "lesson_manifest.json"
        if not manifest_path.exists():
            continue
        manifest = _read_json(manifest_path)
        rel = manifest.get("pdfFile")
        if not rel:
            continue
        pdf = book_dir / Path(rel).relative_to(book_dir)
        if not pdf.exists():
            raise FileNotFoundError(f"Lesson PDF missing: {pdf}")
        result.append(pdf)
    return result


def find_lesson(book_dir: Path, lesson_ref: str) -> Path:
    index = _read_json(book_dir / "index.json")
    for unit in index.get("units", []):
        for lesson in unit.get("lessons", []):
            if lesson.get("lessonSlug") == lesson_ref or lesson.get("lessonId") == lesson_ref:
                path = book_dir / Path(lesson["pdfFile"])
                if not path.exists():
                    raise FileNotFoundError(f"Lesson PDF missing: {path}")
                return path
    raise KeyError(f"Lesson not found: {lesson_ref}")


def _unit_lesson_dirs(book_dir: Path, unit: dict) -> list[Path]:
    return [
        book_dir / Path(lesson["pdfFile"]).parent
        for lesson in unit.get("lessons", [])
        if lesson.get("pdfFile")
    ]


def _ordered_lesson_dirs(book_dir: Path) -> list[Path]:
    index = _read_json(book_dir / "index.json")
    dirs = []
    for unit in sorted(index.get("units", []), key=lambda x: x.get("orderIndex", x.get("number", 0))):
        lessons = sorted(unit.get("lessons", []), key=lambda x: x.get("orderIndex", x.get("lessonNumber", 0)))
        dirs.extend(book_dir / Path(lesson["pdfFile"]).parent for lesson in lessons if lesson.get("pdfFile"))
    return dirs


def _merge_pdfs(inputs: list[Path], output: Path) -> Path:
    if not inputs:
        raise ValueError("No lesson PDFs selected for reconstruction.")
    try:
        from pypdf import PdfWriter
    except ImportError as exc:
        raise RuntimeError("pypdf is required for PDF reconstruction.") from exc

    output.parent.mkdir(parents=True, exist_ok=True)
    writer = PdfWriter()
    for pdf in inputs:
        writer.append(str(pdf))
    with output.open("wb") as handle:
        writer.write(handle)
    return output


def rebuild_lesson(book_dir: Path, lesson_ref: str, output: Path) -> Path:
    source = find_lesson(book_dir, lesson_ref)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(source.read_bytes())
    return output


def rebuild_unit(book_dir: Path, unit_ref: str, output: Path) -> Path:
    index = _read_json(book_dir / "index.json")
    for unit in index.get("units", []):
        if unit.get("unitSlug") == unit_ref or unit.get("unitId") == unit_ref:
            return _merge_pdfs(_lesson_paths(book_dir, _unit_lesson_dirs(book_dir, unit)), output)
    raise KeyError(f"Unit not found: {unit_ref}")


def rebuild_book(book_dir: Path, output: Path) -> Path:
    return _merge_pdfs(_lesson_paths(book_dir, _ordered_lesson_dirs(book_dir)), output)
