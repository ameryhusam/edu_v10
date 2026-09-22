# Domain Boundaries and Ownership

Status: ADOPTED
Last reviewed: 2026-09-22

| Context | Owns | Must not own |
|---|---|---|
| Identity | users, sessions, roles, access boundary, guardian links | pedagogy |
| Content | textbook hierarchy, concepts, questions, answer keys, resources, readiness | learner mastery |
| Assessment | attempts, grading, evidence production | mastery |
| Mastery | mastery computation and learner state | grading |
| Learning | progression, next activity, completion, remediation, learning-path eligibility | content writes |
| Instruction | plans, obligations, assignments, interventions | grading, mastery, adaptive next-step |
| Tutoring | grounded tutoring/refusal | canonical authoring |
| Engagement | XP, streaks, badges, challenges | mastery/evidence/progression |
| Analytics | reporting/read models | transactional source facts |
| Administration | school/grade/subject/term institutional setup | learner pedagogy |

Before changing behavior, identify the owner, layer, existing canonical implementation, contract to call, and whether the change creates a second source of truth.

React is not a domain decision owner. Assignment/due-work state does not become a hidden adaptive-learning authority.
