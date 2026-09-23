# Mobile profile

This branch keeps the 14-model persistence core: User, ParentChildLink, Grade, Subject, GradeSubject, Book, Unit, Lesson, Concept, ConceptPrerequisite, Question, QuestionConcept, Attempt, ConceptState.

Excluded by design: Workspace, Python, PDFs/resources, schools, teachers, authors, reviewers, curriculum provisioning, adoption, content workflow and psychometric engines.

## JSON import

Book/index JSON files live in `seeding/question_bank/packages/`.
Run `npm run db:import` to import all packages, or pass one JSON path to import a single file.

The importer is transactional and idempotent. Prisma is the source of truth.

## Runtime

Android consumes REST. The server owns authentication, answer validation, attempts and concept state.

The Android shell now provides:
- login for the three roles
- parent child selection
- book/unit/lesson browsing
- next-question flow
- answer submission
- progress report

The development API base URL in Android is `http://10.0.2.2:3000/`, which targets the host machine from the Android Emulator. Production must use HTTPS and a real API host.
