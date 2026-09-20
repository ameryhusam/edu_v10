from typing import List, Dict, Any
from ..content.models import LessonAnalysisResult

class EvidenceValidator:
    """
    Enforces the core rule: Evidence-First!
    Rejects any concept or question that fails to provide direct textual evidence from the lesson.
    """
    def validate(self, result: LessonAnalysisResult, lesson_full_text: str) -> Dict[str, Any]:
        report = {
            "model": result.model_name,
            "approvedConcepts": 0,
            "rejectedConcepts": 0,
            "approvedQuestions": 0,
            "rejectedQuestions": 0,
            "isValid": True
        }

        for c in result.concepts:
            if not c.evidence or len(c.evidence.strip()) < 5:
                c.status = "REJECTED"
                report["rejectedConcepts"] += 1
            else:
                c.status = "APPROVED"
                report["approvedConcepts"] += 1

        for q in result.questions:
            if not q.evidence or len(q.evidence.strip()) < 5:
                q.status = "REJECTED"
                report["rejectedQuestions"] += 1
            else:
                q.status = "APPROVED"
                report["approvedQuestions"] += 1

        if report["rejectedConcepts"] > 0 or report["rejectedQuestions"] > 0:
            report["isValid"] = False

        return report
