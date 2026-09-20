""" 
cli/main.py — Edu7 Content Engine CLI
======================================
Usage examples:

  # Auto-detect PDF in books_input/ and prepare (rule-based only):
  python -m edu7_content.cli.main prepare

  # Prepare specific PDF (auto-fallback to Ollama if image-based):
  python -m edu7_content.cli.main prepare books_input/book1.pdf

  # Force Ollama vision extraction with specific model:
  python -m edu7_content.cli.main prepare books_input/book1.pdf --model llava:7b

  # Use Gemini Vision (free tier):
  python -m edu7_content.cli.main prepare books_input/book1.pdf --model gemini

  # Analyze a lesson with Gemini:
  python -m edu7_content.cli.main analyze workspaces/book1/units/01/lessons/01 --model gemini

  # Export workspace:
  python -m edu7_content.cli.main export workspaces/book1 --format all
"""
import sys
import os
import argparse
from pathlib import Path
from typing import List

from ..pdf.reader import PdfReader
from ..pdf.page_mapping import PageMappingEngine
from ..pdf.toc import TocExtractor
from ..pdf.vision_ocr import is_image_based_pdf, extract_toc_via_vision
from ..pdf.segmentation import LessonSegmenter
from ..ai.registry import AIProviderRegistry
from ..validation.evidence_validator import EvidenceValidator
from ..export.json_exporter import Edu7JsonExporter
from ..export.excel_exporter import Edu7ExcelExporter
from ..ai.gemini import _load_env_file
