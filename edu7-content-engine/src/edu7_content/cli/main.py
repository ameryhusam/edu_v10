"""
cli/main.py — Edu7 Content Engine CLI
======================================
Usage examples:

  # Prepare a book with Gemini-assisted TOC/range detection:
  python -m edu7_content.cli.main prepare

  # Prepare a specific PDF:
  python -m edu7_content.cli.main prepare books_input/<book>.pdf

  # Optional future/local Ollama support (explicit opt-in):
  python -m edu7_content.cli.main prepare books_input/book1.pdf --ollama --model llava:7b

  # Use Gemini Vision:
  python -m edu7_content.cli.main prepare books_input/book1.pdf --model gemini

  # Analyze a lesson with Gemini:
  python -m edu7_content.cli.main analyze workspace/P1/G07/MATH/<textbookKey>/unit_01_<slug>/lesson_01_<slug> --model gemini

  # Export workspace:
  python -m edu7_content.cli.main export workspace/P1/G07/MATH/<textbookKey> --format all
"""
import sys
import os
import argparse
import json
import re
import shutil
import tempfile
from pathlib import Path
from typing import List

from ..pdf.reader import PdfReader
from ..pdf.page_mapping import PageMappingEngine
from ..pdf.toc import TocExtractor
from ..pdf.vision_ocr import (
    is_image_based_pdf,
    extract_toc_via_vision,
    extract_edition_from_cover,
    extract_book_front_matter,
)
from ..pdf.segmentation import LessonSegmenter, compute_sha256
from ..ai.registry import AIProviderRegistry
from ..ai.content_service import ContentAIService
from ..validation.evidence_validator import EvidenceValidator
from ..export.json_exporter import Edu7JsonExporter
from ..export.excel_exporter import Edu7ExcelExporter
from ..ai.gemini import _load_env_file
from ..workspace_layout import books_input_root, book_workspace, normalize_grade, normalize_subject, project_root, textbook_key, workspace_root, finalize_book_workspace
from ..pdf.part_detection import detect_combined_part_boundary, split_combined_source, build_local_page_mapping
from ..workspace_rebuild import rebuild_lesson, rebuild_unit, rebuild_book


def main():
    _load_env_file()
    parser = argparse.ArgumentParser(
        prog="edu7-content",
        description="Edu7 Content Engine — Arabic Textbook Extraction & Ingestion"
    )
    sub = parser.add_subparsers(dest="command")

    # ── prepare ──────────────────────────────────────────────────────────────
    p_prep = sub.add_parser("prepare", help="Ingest PDF: detect TOC, map pages, segment lessons")
    p_prep.add_argument("pdf_path", nargs="?", default=None,
                        help="Path to PDF; relative paths resolve from repository-root books_input/")
    p_prep.add_argument("--workspace", default=None,
                        help="Output workspace dir (default: workspace/T01/G04/MATH/<textbookKey>)")
    p_prep.add_argument("--subject", required=True, help="Database Subject.key (e.g. MATH, SCI, ARAB)")
    p_prep.add_argument("--grade", required=True, help="Grade code/number (e.g. G04, 07)")
    p_prep.add_argument("--part", default=None, choices=["PART_1", "PART_2", "BOTH"],
                        help="Physical textbook part: PART_1, PART_2, or BOTH")
    p_prep.add_argument("--edition", default=None,
                        help="Printed textbook edition; if omitted, extract from the initial analysis window")
    p_prep.add_argument("--title", default=None, help="Textbook title")
    p_prep.add_argument("--model", default=None,
                        help=(
                            "AI model for vision TOC extraction when rule-based fails.\n"
                            "Gemini: gemini-3.8-flash | gemini-3.7-flash | gemini-3.6-flash | gemini-3.5-flash\n"
                            "Ollama: optional future/local adapter; requires --ollama and EDU7_ENABLE_OLLAMA=true\n"
                            "Default: Gemini when configured; Ollama is never used implicitly"
                        ))
    p_prep.add_argument("--analysis-pages", type=int, default=15,\n                        help="Initial PDF analysis window for identity/TOC and combined-part detection (default: 15)")
    p_prep.add_argument("--vision-pages", type=int, default=15,
                        help="Pages to render for vision analysis (default: 10)")
    p_prep.add_argument("--dpi", type=int, default=150,
                        help="Render DPI for vision analysis (default: 150, higher=better quality)")
    p_prep.add_argument("--ollama", action="store_true",
                        help="Explicitly enable optional Ollama vision support (disabled by default)")
    p_prep.add_argument("--no-ollama", action="store_true",
                        help="Deprecated compatibility flag; Ollama is already disabled by default")
    p_prep.add_argument("--no-gemini", action="store_true",
                        help="Skip Gemini API even if GEMINI_API_KEYS are configured")
    p_prep.add_argument("--force-vision", action="store_true",
                        help="Force vision extraction even for text-based PDFs")

    # ── analyze ──────────────────────────────────────────────────────────────
    p_analyze = sub.add_parser("analyze", help="Analyze lesson content with AI (single lesson dir or full workspace dir)")
    p_analyze.add_argument("target", help="Lesson directory (units/XX/lessons/YY) OR full workspace directory")
    p_analyze.add_argument("--model", default="heuristic-micro-engine",
                           help="Model: heuristic-micro-engine | gemini | gemini-3.6-flash | gemini-3.5-flash | ollama-qwen2.5:7b | ...")
    p_analyze.add_argument("--delay", type=float, default=4.0,
                           help="Delay in seconds between lessons to pace Gemini requests (default: 4.0s)")

    # ── ai-task ─────────────────────────────────────────────────────────────
    p_ai = sub.add_parser("ai-task", help="Run one unified Gemini content task and write a draft JSON result")
    p_ai.add_argument("task", choices=["SEGMENT_RANGES", "LESSON_ANALYSIS", "QUESTION_REFRESH", "EXPLANATION", "PREREQUISITES"])
    p_ai.add_argument("pdf", help="Lesson/textbook PDF path")
    p_ai.add_argument("--prompt", required=True, help="Author prompt/instruction")
    p_ai.add_argument("--context", default=None, help="Optional JSON context file")
    p_ai.add_argument("--out", default=None, help="Optional output JSON path")
    p_ai.add_argument("--model", default=None, help="Gemini model: gemini-3.8-flash, gemini-3.7-flash, gemini-3.6-flash, or gemini-3.5-flash")

    # ── rebuild ─────────────────────────────────────────────────────────────
    p_rebuild = sub.add_parser("rebuild", help="Rebuild a lesson, unit, or book PDF from lesson PDFs")
    p_rebuild.add_argument("workspace", help="Book workspace directory")
    p_rebuild.add_argument("--scope", choices=["lesson", "unit", "book"], required=True)
    p_rebuild.add_argument("--ref", default=None, help="Lesson/unit slug or ID; not required for book")
    p_rebuild.add_argument("--out", required=True, help="Output PDF path")

    # ── export ───────────────────────────────────────────────────────────────
    p_exp = sub.add_parser("export", help="Export workspace to JSON/Excel")
    p_exp.add_argument("workspace", help="Workspace path")
    p_exp.add_argument("--format", choices=["json", "xlsx", "all"], default="all")
    p_exp.add_argument("--out", default="./out")

    # ── info ─────────────────────────────────────────────────────────────────
    p_info = sub.add_parser("info", help="Show system capabilities (Tesseract, optional Ollama, Gemini)")

    args = parser.parse_args()
    if not args.command:
        parser.print_help()
        sys.exit(1)

    # =========================================================================
    if args.command == "info":
        _cmd_info()

    elif args.command == "prepare":
        _cmd_prepare(args)

    elif args.command == "analyze":
        _cmd_analyze(args)

    elif args.command == "ai-task":
        _cmd_ai_task(args)

    elif args.command == "benchmark":
        print(f"[*] Benchmark on: {args.lesson_dir}")
        print("[SUCCESS] Benchmark placeholder completed.")

    elif args.command == "rebuild":
        _cmd_rebuild(args)

    elif args.command == "export":
        _cmd_export(args)


# ─────────────────────────────────────────────────────────────────────────────
#  Command implementations
# ─────────────────────────────────────────────────────────────────────────────

def _cmd_ai_task(args):
    import json
    pdf = Path(args.pdf).expanduser().resolve()
    if not pdf.exists() or not pdf.is_file():
        print(f"Error: PDF not found: {pdf}")
        sys.exit(1)
    context = {}
    if args.context:
        context_path = Path(args.context).expanduser().resolve()
        if not context_path.exists():
            print(f"Error: context JSON not found: {context_path}")
            sys.exit(1)
        context = json.loads(context_path.read_text(encoding="utf-8"))
    if args.task == "SEGMENT_RANGES":
        reader = PdfReader(str(pdf))
        context.setdefault("pageCount", reader.page_count)
    service = ContentAIService(model_name=args.model)
    print(f"[*] AI task: {args.task}")
    print(f"[*] Provider: {service.provider_name}")
    result = service.request(
        args.task,
        args.prompt,
        service.lesson_schema() if args.task == "LESSON_ANALYSIS" else service.question_schema() if args.task == "QUESTION_REFRESH" else {
            "type": "object", "properties": {"result": {"type": "object"}}, "required": ["result"]
        },
        pdf_path=pdf,
        context=context,
        timeout=240,
    ) if args.task not in ("SEGMENT_RANGES", "EXPLANATION", "PREREQUISITES") else (
        service.segment_ranges(pdf, context.get("pageCount", 0), printed_page_map=context.get("printedPageMap"), prompt=args.prompt)
        if args.task == "SEGMENT_RANGES" else
        service.generate_explanation(pdf, args.prompt, context)
        if args.task == "EXPLANATION" else
        service.generate_prerequisites(pdf, args.prompt, context.get("candidateConcepts", []))
    )
    out = Path(args.out).expanduser().resolve() if args.out else pdf.with_suffix(".ai-draft.json")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[SUCCESS] Draft saved: {out}")


def _cmd_info():
    """Print system capabilities."""
    import shutil

    print("\n── Edu7 Content Engine — System Info ──────────────────")

    # PDF backend
    try:
        import pymupdf
        print(f"  PyMuPDF      : {pymupdf.__version__} (preferred)")
    except Exception:
        print("  PyMuPDF      : ✗ unavailable; using pypdf fallback")
        try:
            import pypdf
            print(f"  pypdf        : {pypdf.__version__}")
        except Exception:
            print("  pypdf        : ✗ unavailable")

    # Tesseract
    tess = shutil.which("tesseract")
    if tess:
        import subprocess
        r = subprocess.run(["tesseract", "--version"], capture_output=True, text=True)
        tver = r.stdout.split("\n")[0] if r.returncode == 0 else "unknown"
        print(f"  Tesseract    : {tver} ({tess})")
        # Check Arabic lang
        r2 = subprocess.run(["tesseract", "--list-langs"], capture_output=True, text=True)
        has_ara = "ara" in r2.stdout or "ara" in r2.stderr
        print(f"  Arabic OCR   : {'✓ ara.traineddata found' if has_ara else '✗ ara not found (install Arabic lang pack)'}")
    else:
        print("  Tesseract    : ✗ not installed")
        print("    → Install: https://github.com/UB-Mannheim/tesseract/wiki")

    # Ollama is retained but never enabled implicitly.
    try:
        from ..ai.ollama_vision import _ollama_available, _list_ollama_models
        ollama_enabled = os.environ.get("EDU7_ENABLE_OLLAMA", "").strip().lower() in {"1", "true", "yes", "on"}
        if _ollama_available():
            models = _list_ollama_models()
            print(f"  Ollama       : ✓ reachable | enabled={ollama_enabled} | models: {models}")
        else:
            print(f"  Ollama       : ✗ not reachable | enabled={ollama_enabled}")
    except Exception as err:
        print(f"  Ollama       : optional adapter unavailable ({err})")

    # Gemini — report configuration without exposing keys.
    api_keys = [
        k.strip()
        for k in os.environ.get("GEMINI_API_KEYS", "").replace(";", ",").split(",")
        if k.strip()
    ]
    if not api_keys and os.environ.get("GEMINI_API_KEY", "").strip():
        api_keys = [os.environ["GEMINI_API_KEY"].strip()]
    if api_keys:
        models = [
            m.strip()
            for m in os.environ.get("GEMINI_MODELS", os.environ.get("GEMINI_MODEL", "gemini-3.6-flash")).replace(";", ",").split(",")
            if m.strip()
        ]
        print(f"  Gemini       : ✓ configured ({len(api_keys)} API key(s); models: {', '.join(models)})")
    else:
        print("  Gemini       : ✗ API keys not set (optional)")
        print("    → Configure GEMINI_API_KEYS in .env")

    print("──────────────────────────────────────────────────────\n")


def _cmd_prepare(args):
    target_pdf = _resolve_pdf(args)
    try:
        grade_number, grade_key = normalize_grade(args.grade)
        supplied_part = str(args.part).strip().upper() if args.part else None
        if supplied_part and supplied_part not in {"PART_1", "PART_2", "BOTH"}:
            raise ValueError("part must be PART_1, PART_2 or BOTH")
        subject_key = normalize_subject(args.subject)
        supplied_edition = str(args.edition).strip() if args.edition else None
    except (TypeError, ValueError) as err:
        print(f"[invalid workspace coordinates] {err}")
        sys.exit(2)

    if not supplied_part:
        print("[invalid workspace coordinates] Physical part is required (--part PART_1|PART_2|BOTH).")
        sys.exit(2)

    print(f"[+] Workspace root: {workspace_root()}")
    print(f"[+] Coordinates: {grade_key}/{subject_key}")
    print(f"\n[*] Reading PDF: {target_pdf}")
    reader = PdfReader(str(target_pdf))
    print(f"[+] Pages: {reader.page_count}")

    # BOTH is a source-input mode only. It must be resolved before textbookKey
    # or Workspace identity is derived; PB must never reach segmentation.
    if supplied_part == "BOTH":
        print("\n[*] Detecting physical textbook parts in combined PDF...")
        boundary = detect_combined_part_boundary(
            reader,
            analysis_pages=getattr(args, "analysis_pages", 15),
        )
        print(
            f"[+] Part detection: {boundary['status']} "
            f"(confidence={boundary['confidence']}, "
            f"boundary PDF page={boundary.get('boundaryPdfPage')})"
        )
        if boundary.get("status") != "DETECTED":
            review_root = Path(args.workspace).expanduser().resolve() if args.workspace else workspace_root()
            review_root.mkdir(parents=True, exist_ok=True)
            review_path = review_root / "combined-part-review.json"
            review_path.write_text(
                json.dumps(
                    {
                        "schemaVersion": "1.0",
                        "mode": "BOTH",
                        "sourceFile": target_pdf.name,
                        "sourceSha256": compute_sha256(target_pdf),
                        "status": "NEEDS_REVIEW",
                        "boundaryProposal": boundary,
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )
            print(f"[REVIEW REQUIRED] Combined PDF boundary could not be established: {review_path}")
            sys.exit(3)

        # Edition/title are shared source metadata. Resolve them once.
        edition = supplied_edition or extract_edition_from_cover(
            reader,
            model_name=getattr(args, "model", None),
            use_gemini=not getattr(args, "no_gemini", False),
            dpi=getattr(args, "dpi", 150),
        )
        if not edition:
            print("[invalid workspace coordinates] Printed edition could not be established from the cover.")
            sys.exit(2)

        metadata_title = reader.get_metadata().get("title", "")
        book_title = args.title or metadata_title or _derive_book_title(target_pdf.stem)
        original_mapper = PageMappingEngine(reader)
        original_mapper.detect_mapping()

        print(
            f"[+] Combined source resolved: "
            f"P1 PDF pages {boundary['part1']['startPdfPage']}-{boundary['part1']['endPdfPage']}; "
            f"P2 PDF pages {boundary['part2']['startPdfPage']}-{boundary['part2']['endPdfPage']}"
        )

        # Split only into temporary processing PDFs. The source PDF is never
        # copied into Workspace and BOTH never becomes a canonical identity.
        part_inputs, temp_part_dir = split_combined_source(reader, boundary)
        try:
            for part_name, part_pdf in part_inputs:
                part_reader = PdfReader(str(part_pdf))
                source_start = int(
                    boundary["part1"]["startPdfPage"]
                    if part_name == "PART_1"
                    else boundary["part2"]["startPdfPage"]
                )
                local_mapper = PageMappingEngine(part_reader)
                local_mapper.detect_mapping()
                if not local_mapper.mapping:
                    local_mapper = build_local_page_mapping(
                        original_mapper,
                        source_start_pdf_page=source_start,
                    )
                part_book_key = textbook_key(subject_key, grade_number, part_name, edition)
                if args.workspace:
                    supplied_root = Path(args.workspace).expanduser().resolve()
                    ws_path = (
                        supplied_root / ("P1" if part_name == "PART_1" else "P2")
                        / grade_key / subject_key
                        / ("ED" + re.sub(r"[^A-Z0-9-]", "", str(edition).strip().upper().replace("_", "-")))
                    )
                else:
                    ws_path = book_workspace(subject_key, grade_number, part_name, edition)

                print(f"\n=== Preparing {part_name} ===")
                print(f"[+] Workspace: {ws_path}")
                print(f"[+] Book key: {part_book_key}")
                _prepare_single_reader(
                    part_reader,
                    local_mapper,
                    part_name,
                    part_book_key,
                    ws_path,
                    subject_key,
                    grade_number,
                    grade_key,
                    edition,
                    book_title,
                    args,
                    source_pdf=target_pdf,
                    source_page_range=(boundary["part1"] if part_name == "PART_1" else boundary["part2"]),
                    source_boundary=boundary,
                )
                part_reader.close()
        finally:
            shutil.rmtree(temp_part_dir, ignore_errors=True)
            reader.close()

        print("\n[SUCCESS] Combined PDF prepared as independent P1 and P2 workspaces.")
        return

    # Single physical-part preparation retains the existing path.
    edition = supplied_edition
    if not edition:
        edition = extract_edition_from_cover(
            reader,
            model_name=getattr(args, "model", None),
            use_gemini=not getattr(args, "no_gemini", False),
            dpi=getattr(args, "dpi", 150),
        )
    if not edition:
        print("[invalid workspace coordinates] Printed edition could not be established from the cover.")
        sys.exit(2)

    book_key = textbook_key(subject_key, grade_number, supplied_part, edition)
    ws_path = (
        Path(args.workspace).expanduser().resolve()
        if args.workspace
        else book_workspace(subject_key, grade_number, supplied_part, edition)
    )
    if args.workspace:
        expected_edition_dir = "ED" + re.sub(
            r"[^A-Z0-9-]", "", str(edition).strip().upper().replace("_", "-")
        )
        if ws_path.name.upper() != expected_edition_dir:
            ws_path = ws_path / expected_edition_dir

    metadata_title = reader.get_metadata().get("title", "")
    book_title = args.title or metadata_title or _derive_book_title(target_pdf.stem)
    mapper = PageMappingEngine(reader)
    mapper.detect_mapping()
    _prepare_single_reader(
        reader,
        mapper,
        supplied_part,
        book_key,
        ws_path,
        subject_key,
        grade_number,
        grade_key,
        edition,
        book_title,
        args,
        source_pdf=target_pdf,
    )
    reader.close()


def _prepare_single_reader(
    reader,
    mapper,
    part,
    book_key,
    ws_path,
    subject_key,
    grade_number,
    grade_key,
    edition,
    book_title,
    args,
    *,
    source_pdf,
    source_page_range=None,
    source_boundary=None,
):
    print(f"[+] Edition: {edition}")
    print(f"[+] Book key: {book_key}")

    pdf_is_image = is_image_based_pdf(reader, sample_pages=8)
    if pdf_is_image:
        print("[*] Detected: IMAGE-based PDF (scanned / no selectable Arabic text)")
    else:
        print("[*] Detected: TEXT-based PDF (has Arabic text layer)")

    print("[*] Running Page Mapping Engine...")
    print(
        f"[+] Page offset: {mapper.detected_offset}  "
        f"(local PDF page = printed page + {mapper.detected_offset})"
    )

    units = []
    print("\n[*] Extracting Table of Contents from the first analysis pages...")

    model_arg = getattr(args, "model", None)
    use_ollama = bool(getattr(args, "ollama", False)) and not getattr(args, "no_ollama", False)
    use_gemini = not getattr(args, "no_gemini", False)
    analysis_pages = min(getattr(args, "analysis_pages", 15), 15)
    dpi = getattr(args, "dpi", 150)

    if model_arg and str(model_arg).startswith("gemini"):
        use_ollama = False
    elif model_arg and (
        str(model_arg).startswith("ollama-")
        or str(model_arg) in {"ollama", "llava:7b", "llava:13b", "minicpm-v:8b", "qwen2.5vl:7b"}
    ):
        use_ollama = True
        use_gemini = False

    toc = TocExtractor(reader)
    toc_pages = toc.find_toc_pages(max_search=analysis_pages)
    if toc_pages and not pdf_is_image:
        units = toc.extract_hierarchy(toc_pages)
        print(f"[+] Rule-based TOC pages: {[p + 1 for p in toc_pages]}")
        print(
            f"[+] Segmentation source: deterministic TOC parser "
            f"({len(units)} units, {sum(len(u.get('lessons', [])) for u in units)} lessons)."
        )
    else:
        print(
            "[*] Using Gemini Vision for scanned TOC."
            if pdf_is_image
            else "[*] Deterministic TOC unavailable; using AI as fallback."
        )
        ai_units = extract_toc_via_vision(
            reader,
            max_pages=analysis_pages,
            dpi=dpi,
            api_key=None,
            model_name=model_arg,
            use_ollama=use_ollama,
            use_gemini=use_gemini,
            force_vision=getattr(args, "force_vision", False),
        )
        if ai_units:
            units = ai_units
            print("[+] Segmentation source: AI TOC proposal.")
        elif toc_pages:
            units = toc.extract_hierarchy(toc_pages)
            print(
                f"[+] Deterministic TOC fallback: {len(units)} units, "
                f"{sum(len(u.get('lessons', [])) for u in units)} lessons."
            )

    _finalize_toc_page_bounds(units, mapper, reader.page_count)

    total_lessons = sum(len(u.get("lessons", [])) for u in units)
    if units:
        print(f"\n[+] Final TOC: {len(units)} units, {total_lessons} lessons")
        for u in units:
            print(f"    Unit {u['number']}: {u['title']} ({len(u['lessons'])} lessons)")
    else:
        print("\n[!] No TOC found. Workspace will have empty structure.")
        _print_help_tips()

    print(f"\n[*] Segmenting into packages: {ws_path}")
    segmenter = LessonSegmenter(reader, mapper)
    coordinates = {
        "subject": subject_key,
        "grade": grade_number,
        "part": part,
        "edition": edition,
        "title": book_title,
    }
    segmenter.segment_book(units, ws_path, coordinates=coordinates)
    finalize_book_workspace(ws_path, book_key, subject_key)

    # Combined-source provenance is retained in each independent workspace.
    if source_page_range is not None:
        import json
        source_manifest = ws_path / "book-source-manifest.json"
        data = json.loads(source_manifest.read_text(encoding="utf-8"))
        original_sha256 = compute_sha256(source_pdf)
        data["sourceInput"]["sha256"] = original_sha256
        data["sourceInput"]["originalSourceFile"] = source_pdf.name
        data["sourceInput"]["originalSourceSha256"] = original_sha256
        data["sourceInput"]["combinedSource"] = True
        data["sourceInput"]["originalPdfPageRange"] = {
            "start": int(source_page_range["startPdfPage"]),
            "end": int(source_page_range["endPdfPage"]),
        }
        data["sourceInput"]["physicalPart"] = part
        data["sourceInput"]["boundaryStatus"] = "DETECTED"
        data["sourceInput"]["combinedBoundaryEvidence"] = source_boundary
        source_manifest.write_text(
            json.dumps(data, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    print(f"[SUCCESS] {part} book prepared at: {ws_path}\n")

def _finalize_toc_page_bounds(units, mapper, pdf_page_count):
    """Turn TOC start pages into deterministic printed-page ranges.

    The TOC is authoritative for starts. End pages are derived only from the
    next lesson/unit boundary; the final lesson ends at the last physical PDF
    page converted back to the printed-page numbering.
    """
    flat = [
        lesson
        for unit in units
        for lesson in unit.get("lessons", [])
    ]
    for idx, lesson in enumerate(flat):
        start = int(lesson.get("startPage", 1))
        if idx + 1 < len(flat):
            next_start = int(flat[idx + 1].get("startPage", start))
            lesson["endPage"] = max(start, next_start - 1)
        else:
            final_printed = mapper.get_printed_page(pdf_page_count)
            lesson["endPage"] = max(start, final_printed)

    for unit in units:
        lessons = unit.get("lessons", [])
        if lessons:
            unit["startPage"] = min(int(l["startPage"]) for l in lessons)
            unit["endPage"] = max(int(l["endPage"]) for l in lessons)
        else:
            start = int(unit.get("startPage", 1))
            unit["startPage"] = start
            unit["endPage"] = start

def _find_lesson_dirs(target_path: Path) -> List[Path]:
    """Find all lesson directories in workspace supporting both new and legacy layouts."""
    # Standard format: unit_01_*/lesson_01_*
    standard = sorted([d for d in target_path.glob("unit_*/lesson_*") if d.is_dir()])
    if standard:
        return standard
    # Legacy format: units/*/lessons/*
    legacy = sorted([d for d in target_path.glob("units/*/lessons/*") if d.is_dir()])
    return legacy


def _cmd_analyze(args):
    import json
    import time
    from dataclasses import asdict

    target_path = Path(args.target)
    if not target_path.exists():
        print(f"Error: Target path not found: {target_path}")
        sys.exit(1)

    registry = AIProviderRegistry()
    provider = registry.get(args.model)
    validator = EvidenceValidator()

    # Case 1: Workspace mode (contains index.json, edu7-content-package.json, or book-manifest.json)
    is_ws = (
        (target_path / "index.json").exists()
        or (target_path / "edu7-content-package.json").exists()
        or (target_path / "book-manifest.json").exists()
    )

    if is_ws:
        lesson_dirs = _find_lesson_dirs(target_path)
        print(f"\n[*] Workspace Mode: Found {len(lesson_dirs)} lesson(s) to analyze in {target_path}")
        print(f"[*] Provider: {provider.provider_name}")

        for idx, l_dir in enumerate(lesson_dirs, start=1):
            m_file = l_dir / "lesson_manifest.json" if (l_dir / "lesson_manifest.json").exists() else l_dir / "manifest.json"
            t_file = l_dir / "lesson_full_text.txt"
            if not m_file.exists():
                continue
            manifest = json.loads(m_file.read_text(encoding="utf-8"))
            text = t_file.read_text(encoding="utf-8") if t_file.exists() else ""

            print(f"\n[{idx}/{len(lesson_dirs)}] Analyzing: {manifest.get('title', l_dir.name)}...")
            res = _analyze_with_temporary_page_bundle(provider, manifest, text, l_dir)
            report = validator.validate(res, text)
            print(f"    [+] Concepts: {len(res.concepts)} | Questions: {len(res.questions)} | Flashcards: {len(res.flashcards)}")
            print(f"    [*] Evidence verified: concepts={report['verifiedEvidenceConcepts']} questions={report['verifiedEvidenceQuestions']}")
            print("    [!] AI output remains PROPOSED/NEEDS_REVIEW; human approval is required before import.")

            out_dir = l_dir / "analysis" / provider.provider_name
            out_dir.mkdir(parents=True, exist_ok=True)
            out_file = out_dir / "normalized.json"
            out_file.write_text(json.dumps(asdict(res), ensure_ascii=False, indent=2), encoding="utf-8")
            report_file = out_dir / "validation-report.json"
            report_file.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
            analysis_manifest = {
                "schemaVersion": "1.0",
                "mode": "ANALYZE",
                "status": "DRAFT",
                "provider": provider.provider_name,
                "lessonManifest": str(l_dir / "lesson_manifest.json"),
                "groundingManifest": str(l_dir / "grounding_manifest.json"),
                "normalizedOutput": str(out_file),
                "validationReport": str(report_file),
                "databaseWrite": False,
                "humanApprovalRequired": True,
            }
            (out_dir / "analysis-manifest.json").write_text(
                json.dumps(analysis_manifest, ensure_ascii=False, indent=2), encoding="utf-8"
            )
            print(f"    [✓] Saved draft analysis to: {out_file}")

            # Polite pacing between Gemini lesson requests
            if "gemini" in provider.provider_name.lower() and idx < len(lesson_dirs):
                delay = getattr(args, "delay", 4.0)
                print(f"    [*] Pacing delay: {delay}s between Gemini requests...")
                time.sleep(delay)

        print(f"\n[SUCCESS] Completed analysis for all {len(lesson_dirs)} lesson(s) in {target_path}")

    # Case 2: Single lesson mode (contains lesson_manifest.json or manifest.json)
    elif (target_path / "lesson_manifest.json").exists() or (target_path / "manifest.json").exists():
        l_dir = target_path
        m_file = l_dir / "lesson_manifest.json" if (l_dir / "lesson_manifest.json").exists() else l_dir / "manifest.json"
        manifest = json.loads(m_file.read_text(encoding="utf-8"))
        t_file = l_dir / "lesson_full_text.txt"
        text = t_file.read_text(encoding="utf-8") if t_file.exists() else ""

        print(f"\n[*] Analyzing single lesson: {manifest.get('title', l_dir.name)}")
        print(f"[*] Provider: {provider.provider_name}")
        res = _analyze_with_temporary_page_bundle(provider, manifest, text, l_dir)

        print("[*] Validating Evidence-First compliance...")
        report = validator.validate(res, text)
        print(f"[+] Concepts: {len(res.concepts)} proposed | Questions: {len(res.questions)} proposed | Flashcards: {len(res.flashcards)}")
        print(f"[*] Evidence verified: concepts={report['verifiedEvidenceConcepts']} questions={report['verifiedEvidenceQuestions']}")
        print("[!] AI output remains PROPOSED/NEEDS_REVIEW; human approval is required before import.")

        out_dir = l_dir / "analysis" / provider.provider_name
        out_dir.mkdir(parents=True, exist_ok=True)
        out_file = out_dir / "normalized.json"
        out_file.write_text(json.dumps(asdict(res), ensure_ascii=False, indent=2), encoding="utf-8")
        report_file = out_dir / "validation-report.json"
        report_file.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        (out_dir / "analysis-manifest.json").write_text(
            json.dumps({
                "schemaVersion": "1.0",
                "mode": "ANALYZE",
                "status": "DRAFT",
                "provider": provider.provider_name,
                "lessonManifest": str(l_dir / "lesson_manifest.json"),
                "groundingManifest": str(l_dir / "grounding_manifest.json"),
                "normalizedOutput": str(out_file),
                "validationReport": str(report_file),
                "databaseWrite": False,
                "humanApprovalRequired": True,
            }, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(f"[SUCCESS] Draft analysis saved to: {out_file}")

    else:
        print(f"Error: '{target_path}' is neither a workspace nor a valid lesson directory.")
        sys.exit(1)


def _cmd_rebuild(args):
    target = Path(args.workspace).expanduser().resolve()
    output = Path(args.out).expanduser().resolve()
    if not (target / "index.json").exists():
        print(f"Error: book workspace index.json not found: {target}")
        sys.exit(1)

    try:
        if args.scope == "lesson":
            if not args.ref:
                raise ValueError("--ref is required for --scope lesson")
            result = rebuild_lesson(target, args.ref, output)
        elif args.scope == "unit":
            if not args.ref:
                raise ValueError("--ref is required for --scope unit")
            result = rebuild_unit(target, args.ref, output)
        else:
            result = rebuild_book(target, output)
    except (KeyError, FileNotFoundError, ValueError, RuntimeError) as err:
        print(f"Error: {err}")
        sys.exit(1)

    print(f"[SUCCESS] Rebuilt {args.scope} PDF: {result}")


def _cmd_export(args):
    import json
    ws = Path(args.workspace)
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    manifest_file = ws / "index.json" if (ws / "index.json").exists() else ws / "book-manifest.json"
    if not manifest_file.exists():
        print(f"Error: Neither index.json nor book-manifest.json found in {ws}. Run 'prepare' first.")
        sys.exit(1)

    b_manifest = json.loads(manifest_file.read_text(encoding="utf-8"))
    registry = AIProviderRegistry()
    heuristic_fallback = registry.get("heuristic-micro-engine")
    results = []

    lesson_dirs = _find_lesson_dirs(ws)
    for l in lesson_dirs:
        m_file = l / "lesson_manifest.json" if (l / "lesson_manifest.json").exists() else l / "manifest.json"
        t_file = l / "lesson_full_text.txt"
        if not m_file.exists():
            continue
        m = json.loads(m_file.read_text(encoding="utf-8"))
        txt = t_file.read_text(encoding="utf-8") if t_file.exists() else ""

        # Check if an analysis already exists on disk
        analysis_base = l / "analysis"
        loaded = False
        if analysis_base.exists():
            candidates = list(analysis_base.glob("*/normalized.json"))
            if candidates:
                # Prefer gemini analysis if exists
                gemini_c = [c for c in candidates if "gemini" in c.parent.name]
                target_cand = gemini_c[0] if gemini_c else candidates[0]
                try:
                    d = json.loads(target_cand.read_text(encoding="utf-8"))
                    res = _dict_to_analysis_result(d)
                    results.append(res)
                    loaded = True
                except Exception as err:
                    print(f"[!] Could not load {target_cand}: {err}")

        if not loaded:
            results.append(heuristic_fallback.analyze_lesson(m, txt, l))

    if args.format in ["json", "all"]:
        j_path = out_dir / "edu7-content-package.json"
        Edu7JsonExporter().export(b_manifest, results, j_path, workspace_dir=ws)
        print(f"[+] JSON: {j_path}")

    if args.format in ["xlsx", "all"]:
        x_path = out_dir / "edu7_lesson_import.xlsx"
        Edu7ExcelExporter().export(b_manifest, results, x_path)
        print(f"[+] Excel: {x_path}")

    print("[SUCCESS] Export complete.")


def _analyze_with_temporary_page_bundle(provider, manifest, lesson_text: str, lesson_dir: Path):
    """Send a temporary page-image bundle to AI; never make the bundle canonical."""
    source_pages = lesson_dir / "pages"
    if not source_pages.exists():
        return provider.analyze_lesson(manifest, lesson_text, lesson_dir=lesson_dir)

    with tempfile.TemporaryDirectory(prefix="edu7-ai-pages-") as tmp:
        request_dir = Path(tmp)
        request_pages = request_dir / "pages"
        request_pages.mkdir(parents=True, exist_ok=True)
        max_images = max(1, int(os.environ.get("GEMINI_MAX_LESSON_IMAGES", "30")))
        images = sorted(
            p for p in source_pages.iterdir()
            if p.is_file() and p.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"}
        )[:max_images]
        for image in images:
            shutil.copy2(image, request_pages / image.name)
        return provider.analyze_lesson(manifest, lesson_text, lesson_dir=request_dir)

def _dict_to_analysis_result(d: dict):
    """Reconstruct LessonAnalysisResult dataclass from saved JSON dict."""
    from ..content.models import (
        LessonAnalysisResult, ExtractedConcept, ExtractedObjective,
        ExtractedMisconception, ExtractedFlashcard, ExtractedQuestion, QuestionChoice
    )
    res = LessonAnalysisResult(
        lesson_id=d.get("lesson_id", ""),
        lesson_title=d.get("lesson_title", ""),
        unit_number=d.get("unit_number", 1),
        lesson_number=d.get("lesson_number", 1),
        printed_pages=d.get("printed_pages", []),
        pdf_pages=d.get("pdf_pages", []),
        model_name=d.get("model_name", "")
    )
    for c in d.get("concepts", []):
        res.concepts.append(ExtractedConcept(**c))
    for obj in d.get("objectives", []):
        res.objectives.append(ExtractedObjective(**obj))
    for mis in d.get("misconceptions", []):
        res.misconceptions.append(ExtractedMisconception(**mis))
    for fc in d.get("flashcards", []):
        res.flashcards.append(ExtractedFlashcard(**fc))
    for q in d.get("questions", []):
        choices = [QuestionChoice(**ch) for ch in q.get("choices", [])]
        q_copy = dict(q)
        q_copy["choices"] = choices
        res.questions.append(ExtractedQuestion(**q_copy))
    return res


# ─────────────────────────────────────────────────────────────────────────────
#  Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _derive_book_title(stem: str) -> str:
    """Create a human-readable fallback title from a PDF filename.

    The filename is never treated as the canonical Edu7 textbook identity.
    It is only a fallback display title when PDF metadata and --title are absent.
    """
    value = re.sub(r"[_-]+", " ", stem).strip()
    value = re.sub(r"\\s+", " ", value)
    return value or "Untitled textbook"


def _resolve_pdf(args) -> Path:
    input_root = books_input_root()
    input_root.mkdir(parents=True, exist_ok=True)

    if getattr(args, "pdf_path", None):
        p = Path(args.pdf_path).expanduser()
        candidates = [p]
        if not p.is_absolute():
            candidates.extend([project_root() / p, input_root / p])
        for candidate in candidates:
            if candidate.exists() and candidate.is_file():
                return candidate.resolve()
        print(f"Error: PDF not found: {args.pdf_path}")
        print(f"Expected repository input directory: {input_root}")
        sys.exit(1)

    pdfs = sorted(p for p in input_root.glob("*.pdf") if p.is_file())
    if not pdfs:
        print(f"Error: No PDFs in {input_root}")
        print("Put the source PDF in repository-root books_input/ or provide an exact path.")
        sys.exit(1)
    if len(pdfs) > 1:
        print("Error: Multiple PDFs found in repository-root books_input; refusing to guess.")
        for p in pdfs:
            print(f"  - {p.name}")
        print("Run: edu7-content prepare books_input/<exact-file-name>.pdf")
        sys.exit(2)

    p = pdfs[0].resolve()
    print(f"[*] Auto-selected: {p.name}")
    return p


def _print_help_tips():
    print("""
  ── How to enable TOC extraction for scanned PDFs ──────────────────
  Option A — Ollama (100% free, local, no internet):
    1. Install Ollama: https://ollama.ai
    2. Pull a vision model:
         ollama pull llava:7b          (4 GB, general purpose)
         ollama pull minicpm-v:8b      (5 GB, good Arabic)
         ollama pull llava-llama3:8b   (5 GB, best quality)
    3. Run: edu7-content prepare books_input/book1.pdf

  Option B — Gemini Vision (configured free tier, needs internet):
    1. Get free API key: https://aistudio.google.com/apikey
    2. Set GEMINI_API_KEYS in edu7-content-engine/.env (comma-separated keys).
    3. Run: edu7-content prepare books_input/book1.pdf

  Option C — Tesseract OCR (free, offline, for text-extractable PDFs):
    1. Install Tesseract: https://github.com/UB-Mannheim/tesseract/wiki
    2. Add Arabic lang pack (ara.traineddata)
    3. PyMuPDF will auto-detect and use it
  ────────────────────────────────────────────────────────────────────
""")


if __name__ == "__main__":
    main()
