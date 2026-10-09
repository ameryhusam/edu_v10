# Educational Structure Extraction v2

## Purpose

This document freezes the extraction pipeline for Yemeni school textbooks after
analysis of Arabic Language, Science, Geography, Islamic Education, Quran,
Social Studies, Mathematics, and English Pupil's Book samples.

The Python engine prepares evidence and Workspace artifacts. It does not write
canonical PostgreSQL state.

## Canonical processing order

```text
PDF input
  -> identity + physical-part evidence
  -> TOC detection (first 15 pages)
  -> TOC continuation + structured hierarchy
  -> printed <-> PDF mapping
  -> content/layout extraction
  -> unit boundary validation
  -> lesson boundary reconciliation
  -> semantic block segmentation
  -> question/assessment extraction
  -> cross-page continuity
  -> confidence/evidence/review
  -> Workspace
  -> Node canonical import after approval
```

### Identity rules

- `PART_1`, `PART_2`, and `BOTH` describe source-processing evidence.
- `BOTH` is never a Workspace or Textbook identity.
- Arabic `الجزء` and `الفصل الدراسي` are equivalent signals only when their
  surrounding structure identifies a physical/academic part.
- English `Pupil's Book 1` / `Book 1` is a weak-but-supported PART_1 signal;
  `Book 2` is the corresponding PART_2 signal.
- Absence of a marker is UNKNOWN, never evidence for BOTH.
- Paired first/second-part terms establish BOTH source evidence, but a physical
  split requires a later structural boundary. If no boundary is established,
  status is REVIEW.

## TOC algorithm

Search the first 15 PDF pages.

A TOC candidate gains evidence from:

1. `المحتويات`, `فهرس الكتاب`, `الفهرس` or equivalent.
2. Structural terms: unit, lesson, topic, assessment, domain.
3. At least three plausible page numbers / dotted leaders.
4. Repeated title-separator-page-number rows.
5. Early-page location.

Once a strong TOC page is found, consecutive pages are included as TOC
continuations when structural keywords and page-number density remain strong,
even if the title is absent.

TOC output is structured as:

- units
- lessons
- assessment entries
- printed page starts
- branch hints where explicit descriptors exist

TOC is a boundary proposal. Actual content validates it.

## Printed/PDF mapping

Printed page number is the educational identity. PDF page index is the
physical location.

`pdfPage = printedPage + detectedOffset` is only a default mapping.

The mapper records every observed pair and computes dominant-offset
consistency. If consistency falls below 0.75, Workspace preparation marks the
mapping for review rather than silently trusting one offset.

Page-number resets or multiple offsets are review conditions.

## Unit and lesson boundaries

### Unit start

Strong evidence:

- full-page unit title
- explicit unit heading
- TOC unit start matching the page
- layout/heading evidence

### Lesson start

Evidence precedence:

1. explicit lesson heading
2. exact/near TOC title match on the content page
3. compound numbering such as `2.1`
4. heading typography/position
5. continuation context

The TOC start is not silently replaced. The engine writes
`boundary_evidence.json` containing the TOC coordinate, content candidates,
next lesson coordinate, confidence and review reason.

Lesson end is derived from the next validated lesson start, unit assessment,
or next unit boundary. `نشاط` and `اختبر نفسك` do not end a lesson by
themselves.

## Semantic blocks

A PDF page is not forced into one educational type.

Each page may contain ordered semantic blocks with:

- stable segment id
- type
- text
- bbox
- printed page
- PDF page
- confidence
- evidence
- branch hint

Supported block roles include:

`UNIT_START`, `LESSON_TITLE`, `LESSON_BODY`, `HEADING_CANDIDATE`,
`QUESTION_BLOCK`, `EXERCISE`, `ACTIVITY`, `SELF_TEST`,
`LESSON_ASSESSMENT`, `UNIT_ASSESSMENT`, `OTHER`.

A page can therefore be:

```text
Page
  ├─ LESSON_BODY
  ├─ QUESTION_BLOCK
  └─ ACTIVITY
```

`MIXED` is a page-level summary, not the loss of semantic regions.

## Questions and assessments

Question evidence is extracted from semantic regions and retains bbox.

Deterministic patterns recognize:

- Arabic/Western numbering
- Arabic-letter sub-numbering
- `أجب`, `أكمل`, `اختر`, `صل`, `رتب`, `صح/خطأ`, `علل`, etc.

The engine distinguishes:

- QUESTION
- EXERCISE
- ACTIVITY
- SELF_ASSESSMENT
- LESSON_ASSESSMENT
- UNIT_ASSESSMENT
- CUMULATIVE_REVIEW

An activity is not converted into a Question merely because it contains an
instruction.

Cross-page question groups are linked only when numbering/continuity provides
evidence. A group records start/end pages and whether it crosses a page
boundary.

## Layout evidence

PyMuPDF is the preferred backend because geometry is required.

Blocks expose:

- bbox
- font size
- bold hint
- color hint
- position

Text-only fallback remains supported, but pages without geometry are lower
confidence and may require review/vision OCR.

OCR is a recovery/verification layer, not the primary source when a valid text
layer exists.

## AI role

AI may verify:

- non-standard lesson headings
- branch/type classification
- mixed-page semantic interpretation
- cross-page continuation
- TOC/content conflicts

AI output is proposal/evidence only. It never writes canonical database state.

## Workspace artifacts

At book level:

```text
identity.json
toc.json
printed_pdf_mapping.json
index.json
```

At lesson level:

```text
lesson_manifest.json
boundary_evidence.json
segments.json
questions.json
grounding_manifest.json
pages/
lesson PDF
```

No schema.prisma change is required by this extraction layer. Existing
`TextbookPage -> ContentChunk` remains available for canonical import; the
semantic segment files are evidence artifacts until the Node import contract
is explicitly finalized.

## Review gates

Preparation must surface REVIEW for:

- unresolved part/boundary
- inconsistent printed/PDF mapping
- missing lesson heading and weak TOC match
- TOC/content mismatch
- low-confidence semantic block
- mixed page whose regions cannot be separated
- question continuation with conflicting numbering
- multiple competing headings
- missing/invalid TOC where a structured import is required

## Important invariant

The engine must never manufacture a canonical lesson, question, unit, textbook
identity, or database relationship merely to make a PDF appear importable.
When evidence is insufficient, the correct output is explicit review evidence.
