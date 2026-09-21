# Unified Content AI Contract

## Purpose
Edu7 content preparation uses one generative AI service: `ContentAIService` backed by the existing `GeminiClient` / `GeminiFreeProvider`. Ollama and other generative providers are not part of the active pipeline.

Python never writes Prisma or Edu7 database rows.

## Operations
| Operation | Input | Output | Write |
|---|---|---|---|
| `SEGMENT_RANGES` | textbook PDF + page map/preview | units, lessons, printed ranges | workspace only |
| `LESSON_ANALYSIS` | lesson PDF + custom prompt + context | concepts, objectives, misconceptions, flashcards, question drafts | draft only |
| `QUESTION_REFRESH` | lesson PDF + custom prompt + existing questions | append-only new question candidates | draft only |
| `EXPLANATION` | lesson PDF + custom prompt | text/image-ready resource candidates | draft only |
| `PREREQUISITES` | lesson PDF + candidate concepts from same/previous books | prerequisite candidates | draft only |

## Grounding
Every generated result carries provider, model, promptVersion, source file and source SHA-256. Generated educational records remain `PROPOSED` until a human review/import operation.

The frontend may send additional context such as:
- current lesson key
- current concept keys
- existing questions
- concepts from earlier lessons
- concepts from a previous grade/textbook
- requested question types
- requested quantity
- the author prompt

The AI may suggest relationships but never creates canonical Edu7 keys.

## Question refresh
Refresh is append-only. Existing questions are supplied to the service and always win. Candidates are normalized for Arabic text and deduplicated by question type, normalized stem and answer structure. Semantic similarity can be added later as a review hint, but it must not replace canonical identity.

Supported question types include `MCQ_SINGLE`, `MCQ_MULTI`, `TRUE_FALSE`, `NUMERIC`, `SHORT_TEXT`, `FILL_BLANK`, `MATCHING`, `ORDERING`, `ESSAY`.

## Frontend integration boundary
Recommended flow:

`Content Management UI → Node content/AI endpoint → ContentAIService → GeminiClient → draft package → review → ContentImportService/ItemBankService`

The browser must not call Gemini directly, must not receive or store API keys, and must not write generated content directly to Prisma.

The Python engine remains responsible for PDF reading, page mapping, slicing, rendering and draft generation. Node remains responsible for canonical identity, authorization, validation and database writes.
