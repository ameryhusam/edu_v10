# Mobile profile

This is a 14-model persistence core: User, ParentChildLink, Grade, Subject, GradeSubject, Book, Unit, Lesson, Concept, ConceptPrerequisite, Question, QuestionConcept, Attempt, ConceptState.

Excluded by design: Workspace, Python, PDFs/resources, schools, teachers, authors, reviewers, curriculum provisioning, adoption, content workflow and psychometric engines.

Android calls REST. Server state is authoritative. JSON is a controlled import contract. Adaptive v1 selects the weakest lesson concept and a question near theta + 0.15; attempts update ConceptState. Prerequisites are available for recovery-question selection without introducing a full psychometric engine.