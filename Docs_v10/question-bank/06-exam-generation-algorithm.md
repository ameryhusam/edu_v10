# Exam Generation Algorithm

This document defines the exam generation rules for the Question Bank product.

Scope
- The product supports Fixed, Rule-Based, Student Practice and Simple Adaptive strategies.
- All strategies share the same canonical `Exam` + `ExamItem` model.
- No Concepts, Mastery, Learner Profiles or LMS workflows are used.

Canonical exam model (logical)
- Exam:
  - id
  - title
  - subjectId
  - gradeId
  - part (nullable string, content context only)
  - durationSeconds
  - passingScore
  - totalPoints
  - strategy (FIXED | RULE_BASED | ADAPTIVE)
  - criteria (jsonb, optional)
  - creatorUserId (admin or student-generated)
  - createdAt / updatedAt
- ExamItem:
  - id
  - examId
  - questionId
  - questionSnapshot (jsonb)
  - orderIndex
  - points

Strategy 1: Fixed Exam
Input
- explicit questionIds[]

Algorithm
1. Validate each question exists and is PUBLISHED.
2. Validate all questions belong to the same subject/grade or are explicitly permitted by policy.
3. Create exam row.
4. For each question, create ExamItem with stored `question_snapshot`.
5. Calculate totalPoints.
6. Save exam.

Determinism
- If a fixed exam is created from a list, the order remains deterministic by the provided list order unless an explicit shuffle flag is set.

Strategy 2: Rule-based Exam
Input
- subjectId
- gradeId
- part (optional)
- units[]
- lessons[]
- questionTypes[]
- difficultyDistribution: { easy, medium, hard }
- count
- seed (optional)

Algorithm
1. Query candidate questions:
   - status = PUBLISHED
   - subject/grade/lesson scope matches
   - question type in list
   - difficulty in selected set (if requested)
2. Filter out unavailable / archived questions.
3. Deduplicate by fingerprint (same normalized question content + lesson).
4. Apply quotas by lesson or unit if provided.
5. Balance requested difficulty distribution.
6. If insufficient valid questions remain: return an error listing missing counts.
7. Use deterministic RNG with `seed`.
8. Shuffle final candidate list using the seed.
9. Select the target count.
10. Create exam and exam items with `question_snapshot`.

Strategy 3: Student Practice Exam
Input
- studentId
- subjectId
- gradeId (inferred from student grade)
- part (optional)
- scope = WHOLE_BOOK | UNITS | LESSONS
- count
- seed (optional)

Algorithm
1. Resolve current student grade from student record.
2. Generate candidate question pool based on subject + grade + selected lesson/unit scope.
3. Use rule-based engine with count and selected scope.
4. Create Exam row with strategy = RULE_BASED or PRACTICE.
5. Store `criteria` json with the chosen scope and filters.

Strategy 4: Simple Adaptive Exam
Input
- studentId
- subjectId
- count
- seed (optional)

Rule
- Adaptive selection is based only on last attempts and lesson performance, not concepts.

Algorithm
1. Query previous attempts for this student in the same subject.
2. Aggregate by lesson:
   - attempted
   - correct
   - incorrect
   - skipped
   - successRate = correct / attempted
3. Rank lessons by lowest successRate first.
4. Candidate lessons with poor performance become priority pool.
5. For each priority lesson, gather candidate questions not recently attempted by the student.
6. Select from same lesson first with different question IDs when possible.
7. If insufficient pool in priority lessons, expand to next lessons.
8. Apply same difficulty / question type balancing as rule-based generation where provided.
9. Shuffle with a seed for deterministic results.
10. Save exam with strategy = ADAPTIVE and `criteria` containing lesson priorities.

Safety guardrail
- Do not reuse the same question repeatedly in the same adaptive exam.
- Do not pick from lessons with no attempts unless necessary after all lesson pools are exhausted.

