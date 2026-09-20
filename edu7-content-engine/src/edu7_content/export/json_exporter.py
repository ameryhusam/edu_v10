import json
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

from ..content.models import LessonAnalysisResult


def _slug(value: str) -> str:
    value = value.strip().upper()
    value = re.sub(r"[^\w\u0600-\u06FF]+", "-", value, flags=re.UNICODE)
    return value.strip("-") or "ITEM"


class Edu7JsonExporter:
    """Export the engine result as the canonical Edu7 content package."""

    def export(
        self,
        book_manifest: Dict[str, Any],
        lesson_results: List[LessonAnalysisResult],
        output_path: Path,
        workspace_dir: Optional[Path] = None,
    ) -> Path:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        metadata = book_manifest.get("metadata", {})
        subject = metadata.get("subjectKey", metadata.get("subject", "GENERAL"))
        grade = metadata.get("gradeKey", metadata.get("grade", "G01"))
        term = metadata.get("termKey", metadata.get("term", "2026-2027-T01"))
        edition = str(metadata.get("edition", "2026"))
        textbook_key = metadata.get("textbookKey", f"EDU-{subject}-{grade}-T1-ED{edition}")

        units: Dict[str, Dict[str, Any]] = {}
        lessons: List[Dict[str, Any]] = []
        concepts: List[Dict[str, Any]] = []
        questions: List[Dict[str, Any]] = []
        misconceptions: List[Dict[str, Any]] = []

        for result in lesson_results:
            unit_slug = _slug(f"UNIT-{result.unit_number}")
            lesson_slug = _slug(result.lesson_title)
            units.setdefault(unit_slug, {
                "slug": unit_slug,
                "name": f"Unit {result.unit_number}",
                "orderIndex": result.unit_number,
                "parentUnitSlug": None,
            })
            lessons.append({
                "slug": lesson_slug,
                "unitSlug": unit_slug,
                "name": result.lesson_title,
                "description": None,
                "orderIndex": result.lesson_number,
                "estimatedMins": None,
                "startPage": min(result.printed_pages) if result.printed_pages else None,
                "endPage": max(result.printed_pages) if result.printed_pages else None,
                "isActive": True,
            })
            for index, concept in enumerate(result.concepts, start=1):
                concept_slug = _slug(concept.name)
                concepts.append({
                    "slug": concept_slug,
                    "unitSlug": unit_slug,
                    "lessonSlug": lesson_slug,
                    "name": concept.name,
                    "description": concept.description,
                    "orderIndex": index,
                    "difficulty": concept.difficulty,
                    "importance": 0.9,
                    "masteryThreshold": 0.7,
                    "isCore": concept.is_core,
                    "isActive": concept.status == "APPROVED",
                    "pageNumber": concept.source_pages[0] if concept.source_pages else None,
                })
            for question in result.questions:
                choices = [{
                    "id": choice.id,
                    "text": choice.text,
                    "orderIndex": index,
                    "misconceptionKey": None,
                    "feedback": choice.distractor_rationale,
                } for index, choice in enumerate(question.choices, start=1)]
                
                correct_ids = [c["id"] for c in choices if next((x.is_correct for x in question.choices if x.id == c["id"]), False)]
                questions.append({
                    "unitSlug": unit_slug,
                    "lessonSlug": lesson_slug,
                    "type": question.type,
                    "text": question.text,
                    "hint": question.hint,
                    "explanation": question.explanation,
                    "points": 1,
                    "difficulty01": question.difficulty01,
                    "origin": "TEXTBOOK",
                    "textbookRole": "EXERCISE",
                    "choices": choices,
                    "answerKey": {
                        "correctChoiceIds": correct_ids,
                        "acceptedTexts": [],
                        "numericMin": None,
                        "numericMax": None,
                        "caseSensitive": False,
                        "allowPartialCredit": False
                    },
                    "concepts": [{
                        "unitSlug": unit_slug,
                        "lessonSlug": lesson_slug,
                        "conceptSlug": _slug(question.concept_name),
                        "weight": 1.0,
                        "isPrimary": True
                    }],
                    "status": "DRAFT",
                })
            for misconception in result.misconceptions:
                misconceptions.append({
                    "slug": _slug(misconception.name),
                    "unitSlug": unit_slug,
                    "lessonSlug": lesson_slug,
                    "conceptSlug": _slug(misconception.concept_name),
                    "name": misconception.name,
                    "description": misconception.description,
                    "correction": misconception.correction
                })

        # Check if assets exist in existing package or workspace
        assets: List[Dict[str, Any]] = []
        if workspace_dir and (workspace_dir / "edu7-content-package.json").exists():
            try:
                prev_pkg = json.loads((workspace_dir / "edu7-content-package.json").read_text(encoding="utf-8"))
                assets = prev_pkg.get("assets", [])
            except Exception:
                assets = []

        package = {
            "meta": {
                "profile": "edu7.textbook-content",
                "profileVersion": "1.1",
                "scope": "FULL",
                "exportedAt": metadata.get("exportedAt", "2026-09-20T00:00:00.000Z")
            },
            "textbook": {
                "key": textbook_key,
                "subjectKey": subject,
                "gradeKey": grade,
                "termKey": term,
                "title": metadata.get("title", textbook_key),
                "edition": edition,
                "description": metadata.get("description"),
                "issuer": metadata.get("issuer"),
                "isbn": metadata.get("isbn"),
                "publishYear": metadata.get("publishYear"),
                "totalPages": metadata.get("totalPages"),
                "status": "DRAFT"
            },
            "units": list(units.values()),
            "lessons": lessons,
            "concepts": concepts,
            "prerequisites": [],
            "misconceptions": misconceptions,
            "learningResources": [],
            "questions": questions,
            "assets": assets,
        }
        output_path.write_text(json.dumps(package, ensure_ascii=False, indent=2), encoding="utf-8")
        return output_path
