from typing import Any, Dict
from ..content.models import LessonAnalysisResult


def _normalize(value: str) -> str:
    """Normalize whitespace and Arabic letter variants for evidence comparison."""
    return (
        " ".join(value.casefold().split())
        .replace("أ", "ا")
        .replace("إ", "ا")
        .replace("آ", "ا")
        .replace("ٱ", "ا")
        .replace("ى", "ي")
        .replace("ة", "ه")
    )


def _contains_evidence(evidence: str, source: str) -> bool:
    compact_evidence = _normalize(evidence)
    compact_source = _normalize(source)
    return bool(compact_evidence) and compact_evidence in compact_source


class EvidenceValidator:
    """Validate evidence without ever granting human approval.

    AI output remains PROPOSED when its evidence is present. Missing or
    unverifiable evidence is marked NEEDS_REVIEW. APPROVED is reserved for
    the canonical authoring workflow after a human decision.
    """

    def validate(self, result: LessonAnalysisResult, lesson_full_text: str) -> Dict[str, Any]:
        report = {
            "schemaVersion": "1.0",
            "model": result.model_name,
            "approvedConcepts": 0,
            "rejectedConcepts": 0,
            "approvedQuestions": 0,
            "rejectedQuestions": 0,
            "verifiedEvidenceConcepts": 0,
            "verifiedEvidenceQuestions": 0,
            "isValid": True,
            "humanApprovalRequired": True,
        }

        for concept in result.concepts:
            if len(concept.evidence.strip()) < 5 or not _contains_evidence(concept.evidence, lesson_full_text):
                concept.status = "NEEDS_REVIEW"
                report["rejectedConcepts"] += 1
            else:
                concept.status = "PROPOSED"
                report["verifiedEvidenceConcepts"] += 1

        for question in result.questions:
            if len(question.evidence.strip()) < 5 or not _contains_evidence(question.evidence, lesson_full_text):
                question.status = "NEEDS_REVIEW"
                report["rejectedQuestions"] += 1
            else:
                question.status = "PROPOSED"
                report["verifiedEvidenceQuestions"] += 1

        # These counters are retained for backward-compatible report consumers.
        # They intentionally remain zero: validation is not approval.
        report["approvedConcepts"] = 0
        report["approvedQuestions"] = 0
        report["isValid"] = (
            report["rejectedConcepts"] == 0
            and report["rejectedQuestions"] == 0
        )
        return report
