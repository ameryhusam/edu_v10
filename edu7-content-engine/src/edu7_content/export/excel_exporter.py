from typing import Dict, Any, List
from pathlib import Path
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from ..content.models import LessonAnalysisResult

class Edu7ExcelExporter:
    """
    Produces Zero-Key Standard Excel Workbook with:
    Lessons, Concepts, Questions, Evidence sheets.
    """
    def export(self, book_manifest: Dict[str, Any], lesson_results: List[LessonAnalysisResult], output_path: Path) -> Path:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        wb = openpyxl.Workbook()

        # Styles
        hdr_fill = PatternFill(start_color="1E3A8A", end_color="1E3A8A", fill_type="solid")
        hdr_font = Font(name="Segoe UI", size=11, bold=True, color="FFFFFF")
        align_center = Alignment(horizontal="center", vertical="center", wrap_text=True)
        align_right = Alignment(horizontal="right", vertical="center", wrap_text=True)

        # 1. Sheet 1: الهيكل والمفاهيم
        ws1 = wb.active
        ws1.title = "01_الهيكل_والمفاهيم"
        ws1.views.sheetView[0].rightToLeft = True

        headers1 = ["رقم الوحدة", "اسم الوحدة", "رقم الدرس", "اسم الدرس", "المفهوم", "الشرح", "الصفحة المطبوعة", "صفحة PDF", "حالة الاعتماد"]
        ws1.append(headers1)
        for col in range(1, len(headers1) + 1):
            cell = ws1.cell(row=1, column=col)
            cell.fill = hdr_fill
            cell.font = hdr_font
            cell.alignment = align_center

        results_by_key = {f"{r.unit_number}-{r.lesson_number}": r for r in lesson_results}

        for u in book_manifest.get("units", []):
            for les in u.get("lessons", []):
                l_res = results_by_key.get(f"{u['number']}-{les['number']}")
                p_print = les.get("startPage", "")
                p_pdf = les.get("pdfPages", [""])[0] if les.get("pdfPages") else ""

                if l_res and l_res.concepts:
                    for c in l_res.concepts:
                        ws1.append([u['number'], u['title'], les['number'], les['title'], c.name, c.description, p_print, p_pdf, c.status])
                else:
                    ws1.append([u['number'], u['title'], les['number'], les['title'], "", "", p_print, p_pdf, "PENDING"])

        # 2. Sheet 2: الأسئلة والتقييم
        ws2 = wb.create_sheet(title="02_الأسئلة_والتقييم")
        ws2.views.sheetView[0].rightToLeft = True
        headers2 = ["رقم الوحدة", "رقم الدرس", "المفهوم", "نوع السؤال", "نص السؤال", "الخيارات", "الإجابة الصحيحة", "التفسير", "الدليل النصي"]
        ws2.append(headers2)
        for col in range(1, len(headers2) + 1):
            cell = ws2.cell(row=1, column=col)
            cell.fill = hdr_fill
            cell.font = hdr_font
            cell.alignment = align_center

        for l_res in lesson_results:
            for q in l_res.questions:
                opts = " | ".join([f"{ch.id}:{ch.text}" for ch in q.choices])
                correct = next((ch.text for ch in q.choices if ch.is_correct), "")
                ws2.append([l_res.unit_number, l_res.lesson_number, q.concept_name, q.type, q.text, opts, correct, q.explanation or "", q.evidence])

        # 3. Sheet 3: البطاقات التعليمية
        ws3 = wb.create_sheet(title="03_البطاقات_التعليمية")
        ws3.views.sheetView[0].rightToLeft = True
        headers3 = ["رقم الوحدة", "رقم الدرس", "المفهوم", "وجه البطاقة (المصطلح/السؤال)", "ظهر البطاقة (التعريف/الإجابة)", "الدليل النصي"]
        ws3.append(headers3)
        for col in range(1, len(headers3) + 1):
            cell = ws3.cell(row=1, column=col)
            cell.fill = hdr_fill
            cell.font = hdr_font
            cell.alignment = align_center

        for l_res in lesson_results:
            for fc in getattr(l_res, "flashcards", []):
                ws3.append([l_res.unit_number, l_res.lesson_number, fc.concept_name, fc.front, fc.back, fc.evidence])

        wb.save(str(output_path))
        return output_path
