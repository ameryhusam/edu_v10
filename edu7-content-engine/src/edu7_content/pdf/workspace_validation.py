"""Validation gates for PDF -> Workspace preparation.

This module validates structural input before the segmenter writes any
Workspace artifact. It contains no filesystem or database I/O.
"""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from typing import Any


def _positive_int(value: Any, field: str) -> int:
    if isinstance(value, bool):
        raise ValueError(f"{field} must be a positive integer.")
    try:
        parsed = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{field} must be a positive integer.") from exc
    if parsed < 1:
        raise ValueError(f"{field} must be a positive integer.")
    return parsed


def _slug(value: str, fallback: str) -> str:
    return (
        re.sub(r"[^\w\u0600-\u06FF]+", "-", value.strip(), flags=re.UNICODE)
        .strip("-_")
        or fallback
    )


def validate_segmentation_input(
    *,
    units: Sequence[Mapping[str, Any]],
    subject: str,
    grade: str | int,
    part: str,
    edition: str,
    page_count: int,
    page_mapper: Any,
) -> None:
    """Fail closed when source structure cannot produce a complete Workspace."""
    subject_value = str(subject).strip().upper()
    if not re.fullmatch(r"[A-Z0-9]{1,8}", subject_value):
        raise ValueError("Subject key must be a non-empty 1-8 character A-Z/0-9 value.")

    grade_value = _positive_int(grade, "Grade")
    if grade_value > 12:
        raise ValueError("Grade must be between 1 and 12.")

    if str(part).strip().upper() not in {"PART_1", "PART_2"}:
        raise ValueError("Workspace segmentation requires PART_1 or PART_2.")

    if not str(edition).strip():
        raise ValueError("Printed edition is required.")
    if page_count < 1:
        raise ValueError("The source PDF contains no pages.")
    if not units:
        raise ValueError("At least one unit with at least one lesson is required.")

    unit_numbers: set[int] = set()
    unit_slugs: set[str] = set()
    lesson_paths: set[tuple[str, str]] = set()
    mapped_pdf_pages: dict[int, tuple[int, int, int]] = {}

    for unit_index, unit in enumerate(units, start=1):
        if not isinstance(unit, Mapping):
            raise ValueError(f"Unit {unit_index} is invalid.")

        unit_number = _positive_int(unit.get("number", unit_index), f"Unit {unit_index} number")
        if unit_number in unit_numbers:
            raise ValueError(f"Duplicate unit number: {unit_number}.")
        unit_numbers.add(unit_number)

        unit_title = str(unit.get("title", "")).strip()
        if not unit_title:
            raise ValueError(f"Unit {unit_number} title is required.")
        unit_slug = _slug(unit_title, f"UNIT-{unit_number:02d}")
        if unit_slug in unit_slugs:
            raise ValueError(f"Duplicate unit identity after normalization: {unit_slug}.")
        unit_slugs.add(unit_slug)

        lessons = unit.get("lessons")
        if not isinstance(lessons, Sequence) or isinstance(lessons, (str, bytes)) or not lessons:
            raise ValueError(f"Unit {unit_number} must contain at least one lesson.")

        lesson_numbers: set[int] = set()
        lesson_slugs: set[str] = set()

        for lesson_index, lesson in enumerate(lessons, start=1):
            if not isinstance(lesson, Mapping):
                raise ValueError(f"Unit {unit_number} lesson {lesson_index} is invalid.")

            lesson_number = _positive_int(
                lesson.get("number", lesson_index),
                f"Unit {unit_number} lesson {lesson_index} number",
            )
            if lesson_number in lesson_numbers:
                raise ValueError(
                    f"Duplicate lesson number {lesson_number} in unit {unit_number}."
                )
            lesson_numbers.add(lesson_number)

            lesson_title = str(lesson.get("title", "")).strip()
            if not lesson_title:
                raise ValueError(
                    f"Unit {unit_number} lesson {lesson_number} title is required."
                )
            lesson_slug = _slug(lesson_title, f"LESSON-{lesson_number:02d}")
            if lesson_slug in lesson_slugs:
                raise ValueError(
                    f"Duplicate lesson identity after normalization in unit {unit_number}: {lesson_slug}."
                )
            lesson_slugs.add(lesson_slug)

            start = _positive_int(
                lesson.get("startPage"),
                f"Unit {unit_number} lesson {lesson_number} startPage",
            )
            end = _positive_int(
                lesson.get("endPage"),
                f"Unit {unit_number} lesson {lesson_number} endPage",
            )
            if start > end:
                raise ValueError(
                    f"Unit {unit_number} lesson {lesson_number} has startPage after endPage."
                )

            path_key = (unit_slug, lesson_slug)
            if path_key in lesson_paths:
                raise ValueError(f"Duplicate lesson identity: {unit_slug}/{lesson_slug}.")
            lesson_paths.add(path_key)

            for printed_page in range(start, end + 1):
                pdf_page = int(page_mapper.get_pdf_page(printed_page))
                if not 1 <= pdf_page <= page_count:
                    raise ValueError(
                        f"Printed page {printed_page} in unit {unit_number} lesson "
                        f"{lesson_number} maps to PDF page {pdf_page}, outside 1..{page_count}."
                    )
                previous = mapped_pdf_pages.get(pdf_page)
                if previous is not None:
                    raise ValueError(
                        f"PDF page {pdf_page} is mapped more than once: "
                        f"unit {previous[0]} lesson {previous[1]} page {previous[2]} "
                        f"and unit {unit_number} lesson {lesson_number} page {printed_page}."
                    )
                mapped_pdf_pages[pdf_page] = (unit_number, lesson_number, printed_page)
