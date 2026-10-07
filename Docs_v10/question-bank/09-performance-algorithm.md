# Performance and lesson analytics

This document defines how student performance is calculated for Subject / Unit / Lesson.

Required metrics
For each student and each subject/unit/lesson, calculate:
- questionsAttempted
- correct
- incorrect
- skipped
- score
- maxPossible
- percentage
- averageTime

Data basis
- Use `Attempt` + `AttemptItem` / answer storage derived from the exam lifecycle.
- Analytics must be computed from the stored `question_snapshot` so the result remains stable even if the original question changes later.

Aggregation formula
- attempted = count of answered or attempted items in the target scope
- correct = count of items with verdict = CORRECT
- incorrect = count of items with verdict = INCORRECT
- skipped = count of items with no submitted answer or empty payload
- score = sum(pointsAwarded)
- maxPossible = sum(question_snapshot.points) for relevant items
- percentage = score / maxPossible * 100 if maxPossible > 0
- averageTime = average of responseTimeMs for relevant responses

Scope by hierarchy
- Subject aggregate: merge all lessons under that subject
- Unit aggregate: merge all lessons under that unit
- Lesson aggregate: compute directly for each lesson

Use in adaptive selection
- A lesson with poor performance (low success rate) becomes a higher-priority candidate in the next adaptive exam.
- Performance is not treated as mastery or concept mastery; it is a simple question/lesson performance metric.

