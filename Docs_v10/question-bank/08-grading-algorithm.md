# Grading and evaluation algorithm

This document defines how the system evaluates student answers.

Design principle
- The backend is the only authority for evaluation.
- Clients never evaluate answers; they only capture and send answers.

Question evaluator interface
- validateCanonicalQuestion(question)
- normalizeAnswer(input)
- evaluate(question, normalizedAnswer) -> { verdict, pointsAwarded, meta }

Evaluation flow
1. Student submits an attempt.
2. For each ExamItem, read the stored `question_snapshot`.
3. Normalize the answer payload from the client into the server canonical format.
4. Evaluate according to question type.
5. Save verdict, pointsAwarded, and evaluation metadata.
6. Sum totals to compute attempt result.

Type-specific grading rules
- MCQ_SINGLE:
  - exact match to correct option id
- MCQ_MULTI:
  - compare sets; baseline full credit on exact set match; partial credit optional with config flag
- TRUE_FALSE:
  - exact boolean comparison
- NUMERIC:
  - compare to numericMin / numericMax or tolerance rule
- SHORT_TEXT:
  - normalize text, compare against accepted answers list
- FILL_BLANK:
  - evaluate blanks individually and sum points
- MATCHING:
  - compare `(leftId,rightId)` pairs; partial credit per correct pair
- ORDERING:
  - compare array positions; full match or partial position-based scoring
- ESSAY:
  - set `REQUIRES_MANUAL_REVIEW`, no automatic correctness

Attempt scoring
- totalScore = sum pointsAwarded
- pass/fail determined by `passingScore` in the Exam definition
- mark attempt as `SUBMITTED` and `evaluated = true`

Result security rule
- During the exam, the system must not reveal the correct answer or explanations.
- Only after submission and evaluation can the review endpoint expose them.

