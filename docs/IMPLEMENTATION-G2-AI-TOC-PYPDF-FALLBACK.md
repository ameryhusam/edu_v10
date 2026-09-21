# G2 — AI-assisted TOC extraction and PDF backend fallback

## Scope

G2 makes the textbook preparation flow use the **first ten PDF pages as the TOC
inspection window**, with AI attempted before deterministic parsing. The selected
TOC becomes the input to physical unit/lesson segmentation.

Pipeline:

```
PDF
  -> first 10 pages
  -> AI TOC extraction (Vision when rendering is available; Gemini text when pypdf fallback is active)
  -> printed-page TOC
  -> printed/PDF page mapping
  -> unit/lesson segmentation
  -> Workspace
```

## Page-number contract

- The page number written in the textbook/TOC is the **canonical printed page**.
- PDF page is the physical 1-based page index inside the source file.
- Mapping is:

```
pdfPage = printedPage + detectedOffset
```

- Workspace manifests now expose both `printedPageStart/End` and
  `pdfPageStart/End`.
- The final lesson boundary is derived from the next TOC lesson; the last lesson
  ends at the last physical PDF page converted back to printed numbering.
- No segmentation is performed from arbitrary fixed lesson lengths.

## AI behavior

The preparation command always inspects at most the first ten pages for TOC
extraction.

1. Ollama local vision is attempted when enabled and rendering is available.
2. Gemini Vision is attempted when enabled and rendering is available.
3. If PyMuPDF cannot be loaded, the reader switches to pypdf and Gemini receives
   extracted text from the first ten pages.
4. If AI cannot produce a usable TOC, the existing deterministic TOC parser is
   used as fallback.
5. Segmentation uses the resulting TOC, not the AI provider directly.

AI output is therefore a **TOC proposal**, not a database write.

## PyMuPDF / pypdf

`PdfReader` now provides one stable API:

- PyMuPDF: preferred; text, geometry and PNG rendering.
- pypdf: fallback; text extraction and PDF page slicing.
- Rendering-dependent features are skipped when only pypdf is available.
- pypdf is already a declared project dependency.

This specifically supports environments such as Android/Termux where PyMuPDF
may fail to install.

## Evidence and safety

The AI prompt explicitly requires printed page numbers and forbids inventing
page numbers not visible in the supplied first-ten-page evidence.

The preparation process remains filesystem-only. It does not write directly to
PostgreSQL.

## Validation status

GitHub changes were committed on:

`feature/content-ai-g2-smart-toc-pypdf-fallback`

Local TypeScript/Python execution has not been run from this environment, so
this gate must still be validated with the repository's normal typecheck and
Python checks before merging.
