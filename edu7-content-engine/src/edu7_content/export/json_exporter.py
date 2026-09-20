import json
from typing import Dict, Any, List
from pathlib import Path
from ..content.models import LessonAnalysisResult

class Edu7JsonExporter:
    """
    Produces ContentPackage v1.2 JSON directly ready for Edu7 Import Modal.
    """
    def export(self, book_manifest: Dict[str, Any], lesson_results: List[LessonAnalysisResult], output_path: Path) -> Path:
        output_path.parent.mkdir(parents=True, exist_ok=True)

        package = {
            "schemaVersion": "1.2",
            "textbookKey": book_manifest.get("metadata", {}).get("title", "EDU7-TEXTBOOK"),
            "units": []
        }

        results_by_key = {f"{r.unit_number}-{r.lesson_number}": r for r in lesson_results}

        for u in book_manifest.get("units", []):
            u_num = u["number"]
            unit_dto = {
                "orderIndex": u_num,
                "name": u["title"],
                "lessons": []
            }

            for les in u.get("lessons", []):
                l_num = les["number"]
                l_res = results_by_key.get(f"{u_num}-{l_num}")

                lesson_dto = {
                    "orderIndex": l_num,
                    "name": les["title"],
                    "startPage": les.get("startPage"),
                    "endPage": les.get("endPage"),
                    "concepts": [],
                    "questions": []
                }

                if l_res:
                    for c_idx, c in enumerate(l_res.concepts, start=1):
                        if c.status == "APPROVED":
                            lesson_dto["concepts"].append({
                                "orderIndex": c_idx,
                                "name": c.name,
                                "description": c.description,
                                "difficulty": c.difficulty,
                                "isCore": c.is_core
                            })

                    for q_idx, q in enumerate(l_res.questions, start=1):
                        if q.status == "APPROVED":
                            lesson_dto["questions"].append({
                                "type": q.type,
                                "text": q.text,
                                "conceptName": q.concept_name,
                                "hint": q.hint,
                                "explanation": q.explanation,
                                "difficulty01": q.difficulty01,
                                "choices": [
                                    {
                                        "id": ch.id,
                                        "text": ch.text,
                                        "isCorrect": ch.is_correct,
                                        "distractorRationale": ch.distractor_rationale
                                    }
                                    for ch in q.choices
                                ]
                            })

                    lesson_dto["flashcards"] = [
                        {
                            "orderIndex": fc_idx,
                            "conceptName": fc.concept_name,
                            "front": fc.front,
                            "back": fc.back
                        }
                        for fc_idx, fc in enumerate(l_res.flashcards, start=1)
                    ]

                    lesson_dto["objectives"] = [
                        {
                            "orderIndex": ob_idx,
                            "text": ob.text,
                            "bloomLevel": ob.bloom_level
                        }
                        for ob_idx, ob in enumerate(l_res.objectives, start=1)
                    ]

                unit_dto["lessons"].append(lesson_dto)

            package["units"].append(unit_dto)

        output_path.write_text(json.dumps(package, ensure_ascii=False, indent=2), encoding="utf-8")
        return output_path
