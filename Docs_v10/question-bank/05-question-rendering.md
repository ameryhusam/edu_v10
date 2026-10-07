# Question rendering contract (frontend / Android)

Principles
- Single canonical model (CanonicalQuestion) drives rendering across Import previews, Admin UI, API and Android.
- Clients must NOT implement grading/evaluation logic. Client responsibilities:
  - present the question and media
  - capture user responses and serialize to NormalizedAnswer
  - basic input validation only (numeric format, required fields)
  - support interactive UI for Matching and Ordering (drag/drop or touch based)

Renderers required
- MultipleChoiceRenderer (single, multi)
- TrueFalseRenderer
- NumericRenderer
- ShortTextRenderer
- FillBlankRenderer (multiple inputs per blank)
- MatchingRenderer (interactive drag/drop pairing)
- OrderingRenderer (interactive reorder)
- EssayRenderer (rich text optional)

Android-specific guidance (for later implementation)
- The Android app will request exam items one at a time or in pages. Each item payload contains: examItemId, questionSnapshot (CanonicalQuestion without `explanation`), timeLimit per item (optional).
- MatchingRenderer must send pairs in canonical form: { pairs: [{leftId,rightId}, ...] }
- OrderingRenderer must send orderedItemIds array.

Security
- The questionSnapshot returned to the client MUST NOT include fields that reveal the correct answer or explanation while the attempt is IN_PROGRESS. The server must strip `answerData.correctOptions`, `answerData.expectedOrder`, `answerData.expectedPairs` etc. until submission/evaluation.

PHASE 1 deliverable: concrete example payloads for each renderer and normalized answer samples.
