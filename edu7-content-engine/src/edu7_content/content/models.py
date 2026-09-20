from typing import List, Dict, Any, Optional
from dataclasses import dataclass, field

@dataclass
class EvidenceRef:
    page_number: int
    pdf_page_number: int
    text_snippet: str
    confidence: float = 1.0

@dataclass
class ExtractedConcept:
    name: str
    description: str
    difficulty: float
    is_core: bool
    source_pages: List[int]
    evidence: str
    confidence: float
    model_name: str
    status: str = "PROPOSED"  # APPROVED, NEEDS_REVIEW, REJECTED

@dataclass
class QuestionChoice:
    id: str
    text: str
    is_correct: bool
    distractor_rationale: Optional[str] = None

@dataclass
class ExtractedQuestion:
    type: str  # MCQ_SINGLE, TRUE_FALSE, SHORT_TEXT, ESSAY
    text: str
    concept_name: str
    hint: Optional[str]
    explanation: Optional[str]
    difficulty01: float
    choices: List[QuestionChoice]
    source_pages: List[int]
    evidence: str
    confidence: float
    model_name: str
    status: str = "PROPOSED"

@dataclass
class ExtractedObjective:
    text: str
    bloom_level: str  # REMEMBER, UNDERSTAND, APPLY, ANALYZE
    source_pages: List[int]
    evidence: str
    confidence: float
    model_name: str

@dataclass
class ExtractedMisconception:
    concept_name: str
    name: str
    description: str
    correction: str
    source_pages: List[int]
    evidence: str
    confidence: float
    model_name: str

@dataclass
class ExtractedFlashcard:
    concept_name: str
    front: str
    back: str
    source_pages: List[int]
    evidence: str
    confidence: float
    model_name: str
    status: str = "PROPOSED"

@dataclass
class LessonAnalysisResult:
    lesson_id: str
    lesson_title: str
    unit_number: int
    lesson_number: int
    printed_pages: List[int]
    pdf_pages: List[int]
    concepts: List[ExtractedConcept] = field(default_factory=list)
    objectives: List[ExtractedObjective] = field(default_factory=list)
    misconceptions: List[ExtractedMisconception] = field(default_factory=list)
    questions: List[ExtractedQuestion] = field(default_factory=list)
    flashcards: List[ExtractedFlashcard] = field(default_factory=list)
    model_name: str = "heuristic"
