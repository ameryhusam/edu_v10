from typing import List, Dict, Any
from ..content.models import LessonAnalysisResult, ExtractedConcept
from .normalizer import compute_similarity

class ConsensusEngine:
    """
    Compares analysis results across multiple models:
    Clusters concepts, computes agreement score, flags DISAGREEMENT and NEEDS_REVIEW.
    """
    def compare_runs(self, results: List[LessonAnalysisResult]) -> Dict[str, Any]:
        if not results:
            return {"clusters": [], "status": "EMPTY"}

        all_concepts: List[ExtractedConcept] = []
        for r in results:
            all_concepts.extend(r.concepts)

        clusters = []
        for c in all_concepts:
            matched_cluster = None
            for cl in clusters:
                sim = compute_similarity(c.name, cl["canonicalName"])
                if sim >= 0.65:
                    matched_cluster = cl
                    break

            if matched_cluster:
                matched_cluster["items"].append(c)
                matched_cluster["models"].add(c.model_name)
            else:
                clusters.append({
                    "clusterId": f"concept-cluster-{len(clusters)+1:02d}",
                    "canonicalName": c.name,
                    "canonicalDescription": c.description,
                    "items": [c],
                    "models": {c.model_name}
                })

        # Calculate consensus metrics
        total_models = len(results)
        consensus_concepts = []
        disagreements = []

        for cl in clusters:
            agreement_rate = len(cl["models"]) / total_models
            cl["agreement"] = round(agreement_rate, 2)
            if agreement_rate >= 0.5 or total_models == 1:
                cl["status"] = "APPROVED"
                consensus_concepts.append(cl)
            else:
                cl["status"] = "NEEDS_REVIEW"
                disagreements.append(cl)

        return {
            "totalModels": total_models,
            "consensusConcepts": consensus_concepts,
            "disagreements": disagreements,
            "agreementScore": round(len(consensus_concepts) / max(1, len(clusters)), 2)
        }
