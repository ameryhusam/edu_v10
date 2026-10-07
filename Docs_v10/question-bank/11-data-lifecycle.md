# Data lifecycle and question review rules

This document defines how student answers and question edits are stored and how review results are built.

Core rules
- Questions are never deleted when they are used in historical attempts.
- Historical attempts must remain consistent even if a question later changes.
- Every exam item must keep a snapshot of the canonical question state at the time the exam is created.

Important lifecycle
1. Question created or published
2. Exam built from question set
3. ExamItem stores questionSnapshot
4. Student answers question
5. Attempt is submitted and evaluated
6. Review page reads from stored snapshot and answer payload
7. If question content later changes, historical exam data remains intact

Question review model
A review item contains:
- question: canonical question stem and options
- studentAnswer: answer payload submitted by student
- correctAnswer: the canonical correct answer from the snapshot
- verdict: CORRECT | INCORRECT | PARTIALLY_CORRECT | REQUIRES_MANUAL_REVIEW
- pointsAwarded
- explanation: optional; only shown after submission

Example review flow
- Start exam
- Answer question(s)
- Submit exam
- Evaluate all answers
- Persist results
- Allow GET /attempts/:id/review

This output is only valid after submission. Before that, the backend must prevent any route from exposing correct answers or explanations.

