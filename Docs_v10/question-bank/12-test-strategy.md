# Test strategy for Question Bank

This document defines the minimum testing strategy for the bank.

Unit tests
- Question validators for every question type
- Answer normalization per type
- Grading logic for MCQ, NUMERIC, MATCHING, ORDERING, SHORT_TEXT, FILL_BLANK
- Duplicate detection fingerprint tests
- Deterministic rule-based exam selection with a fixed seed
- Adaptive selection ranking tests based on previous attempts

Integration tests
- JSON import pipeline happy path
- Excel import pipeline happy path
- Invalid import row rejects with validation errors
- Duplicate import does not create a second question
- Fixed exam creation
- Rule-based exam creation
- Student practice exam creation
- Start exam → answer items → submit → review
- Security test: in-progress exam route must not expose answerData or explanation

Android tests
- Verify MatchingRenderer emits expected payload structure
- Verify OrderingRenderer emits selected order array
- Verify Review screen shows explanation only after submission

Recommended acceptance checks
- Deterministic exam generation with same seed yields same question IDs
- Dedupe detection yields same fingerprint for equivalent normalized questions
- Grading is idempotent for the same attempt snapshot

