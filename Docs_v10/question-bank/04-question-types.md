# Question types and evaluator contracts

Supported QuestionTypes
- MCQ_SINGLE
- MCQ_MULTI
- TRUE_FALSE
- NUMERIC
- SHORT_TEXT
- FILL_BLANK
- MATCHING
- ORDERING
- ESSAY

For each type we define:
1. JSON Schema for answerData (PHASE 1 will include full JSON Schema files).
2. Client <-> Server NormalizedAnswer structure.
3. Evaluator contract (functions the server must implement).

Evaluator contract (interface)
- validateCanonicalQuestion(question: CanonicalQuestion): ValidationResult
- normalizeAnswer(input: any): NormalizedAnswer
- evaluate(question: CanonicalQuestion, normalizedAnswer: NormalizedAnswer): { verdict: Verdict, pointsAwarded: number, meta: object }

Verdict values (reuse existing enums where possible)
- CORRECT, INCORRECT, PARTIALLY_CORRECT, SKIPPED, INVALID, UNGRADABLE, REQUIRES_MANUAL_REVIEW

Type-specific notes
- MCQ_MULTI: baseline behaviour in v1 is full credit only unless AnswerKey.allowPartialCredit is explicitly provided. We will default to full-credit to keep evaluation deterministic and simple.
- NUMERIC: numericMin/numericMax provide inclusive range; if only one bound is provided, treat as tolerance around a target if agreed in PHASE 1.
- SHORT_TEXT: normalise (trim, unicode normalize, lower-case when not caseSensitive) before matching against accepted list. Optionally support fuzzy matching later.
- MATCHING: compare sets of pairs by left/right ids. Partial credit per-pair allowed.
- ORDERING: compare sequences; scoring options: full-match only (baseline) or position-based partial scoring (optional later).
- ESSAY: requires manual review. The evaluator sets verdict = REQUIRES_MANUAL_REVIEW and stores rubric metadata.

Client NormalizedAnswer examples
- MCQ_SINGLE: { selectedOptionId: "A" }
- MCQ_MULTI: { selectedOptionIds: ["A","C"] }
- NUMERIC: { value: 12.5 }
- SHORT_TEXT: { text: "answer" }
- MATCHING: { pairs: [{leftId:"L1", rightId:"R2"}, ...] }
- ORDERING: { orderedItemIds: ["I2","I1","I3"] }

PHASE 1 deliverable: full JSON Schemas per type and unit test vectors for evaluators.
