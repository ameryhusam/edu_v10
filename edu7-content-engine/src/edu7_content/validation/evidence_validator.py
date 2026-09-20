from typing import Any, Dict
from ..content.models import LessonAnalysisResult


def _contains_evidence(evidence: str, source: str) -> bool:
    compact_evidence = " ".join(evidence.casefold().split())
    compact_source = " ".join(source.casefold().split())
    return bool(compact_evidence) and compact_evidence in compact_source


class EvidenceValidator:
    """Reject generated content whose evidence is absent from lesson text."""

    def validate(self, result: LessonAnalysisResult, lesson_full_text: str) -> Dict[str, Any]:
        report = {"model": result.model_name, "approvedConcepts": 0, "rejectedConcepts": 0, "approvedQuestions": 0, "rejectedQuestions": 0, "isValid": True}
        for concept in result.concepts:
            if len(concept.evidence.strip()) < 5 or not _contains_evidence(concept.evidence, lesson_full_text):
                concept.status = "NEEDS_REVIEW"
                report["rejectedConcepts"] += 1
            else:
                concept.status = "APPROVED"
                report["approvedConcepts"] += 1
        for question in result.questions:
            if len(question.evidence.strip()) < 5 or not _contains_evidence(question.evidence, lesson_full_text):
                question.status = "NEEDS_REVIEW"
                report["rejectedQuestions"] += 1
            else:
                question.status = "APPROVED"
                report["approvedQuestions"] += 1
        report["isValid"] = report["rejectedConcepts"] == 0 and report["rejectedQuestions"] == 0
        return report
