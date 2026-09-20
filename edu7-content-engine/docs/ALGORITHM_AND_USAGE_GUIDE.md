# Edu7 Content Engine — دليل الاستخدام والخوارزمية (v1.1)

## نظرة عامة على المعالجة متعددة الطبقات

الأداة تعمل بنظام **طبقات متتالية** لاستخراج فهرس الكتاب المدرسي:

```
PDF ──► [Layer 1] PyMuPDF نص ──► وُجد فهرس؟ ──YES──► اكتمل ✓
         │
         NO
         ▼
        [Layer 2] PyMuPDF + Tesseract OCR (مجاني، بلا إنترنت)
         │                  └── يتطلب: تثبيت Tesseract + حزمة اللغة العربية
         NO
         ▼
        [Layer 3] Ollama Vision محلي (مجاني تماماً، بلا مفتاح API)
         │                  └── يتطلب: تثبيت Ollama + سحب نموذج مرئي
         NO
         ▼
        [Layer 4] Gemini Vision API (مجاني 15 طلب/دقيقة)
                           └── يتطلب: GEMINI_API_KEY
```

---

## تثبيت الأداة

```bash
cd d:/edu7-master/edu7-content-engine
pip install -e .
```

---

## أوامر الاستخدام

### 1. فحص النظام
```bash
edu7-content info
# أو:
python -m edu7_content.cli.main info
```
يُظهر: إصدار PyMuPDF، Tesseract، Ollama، مفتاح Gemini

---

### 2. تهيئة كتاب (prepare)

**الاستخدام الأبسط** (يحاول كل الطبقات تلقائياً):
```bash
edu7-content prepare books_input/book1.pdf
```

**تحديد نموذج Ollama محدد**:
```bash
edu7-content prepare books_input/book1.pdf --model llava:7b
edu7-content prepare books_input/book1.pdf --model minicpm-v:8b
edu7-content prepare books_input/book1.pdf --model llava-llama3:8b
```

**استخدام Gemini Vision (مع مفتاح API)**:
```bash
$env:GEMINI_API_KEY = "AIza..."
edu7-content prepare books_input/book1.pdf --model gemini
edu7-content prepare books_input/book1.pdf --model gemini-2.5-flash
```

**خيارات متقدمة**:
```bash
# رفع عدد الصفحات المرسلة للتحليل (افتراضي: 10)
edu7-content prepare book1.pdf --vision-pages 15

# رفع الدقة (افتراضي: 150 DPI)
edu7-content prepare book1.pdf --dpi 200

# إجبار الوضع المرئي حتى لو الكتاب يحتوي نصاً
edu7-content prepare book1.pdf --force-vision

# تجاهل Ollama واستخدام Gemini فقط
edu7-content prepare book1.pdf --no-ollama

# تجاهل Gemini واستخدام Ollama فقط
edu7-content prepare book1.pdf --no-gemini
```

---

### 3. تحليل درس (analyze)
```bash
# بالمحرك الهيوريستي (مجاني، بلا AI):
edu7-content analyze workspaces/book1/units/01/lessons/01

# بـ Gemini:
edu7-content analyze workspaces/book1/units/01/lessons/01 --model gemini

# بـ Ollama:
edu7-content analyze workspaces/book1/units/01/lessons/01 --model ollama-qwen2.5:7b
```

---

### 4. تصدير النتائج (export)
```bash
# JSON + Excel معاً:
edu7-content export workspaces/book1 --format all

# JSON فقط:
edu7-content export workspaces/book1 --format json --out ./output
```

---

## تثبيت أدوات الذكاء الاصطناعي المجانية

### Ollama (الخيار الأفضل — مجاني ومحلي بلا إنترنت)
```bash
# 1. تثبيت Ollama من: https://ollama.ai
# 2. سحب نموذج مرئي (اختر حسب ذاكرة GPU):
ollama pull llava:7b          # 4 GB VRAM — عام
ollama pull minicpm-v:8b      # 5 GB VRAM — جيد للعربية
ollama pull llava-llama3:8b   # 5 GB VRAM — الأفضل جودة
ollama pull qwen2.5vl:7b      # 4.5 GB VRAM — جيد للعربية

# 3. تشغيل Ollama (يبدأ تلقائياً عادةً):
ollama serve

# 4. تجربة الأداة:
edu7-content prepare books_input/book1.pdf
```

### Tesseract OCR (للكتب النصية المشفّرة)
```bash
# Windows: تحميل من https://github.com/UB-Mannheim/tesseract/wiki
# اختر النسخة مع حزمة Arabic (ara.traineddata)

# Linux:
sudo apt install tesseract-ocr tesseract-ocr-ara

# macOS:
brew install tesseract tesseract-lang
```

### Gemini Vision (خيار احتياطي، مجاني 15 طلب/دقيقة)
```bash
# 1. احصل على مفتاح مجاني: https://aistudio.google.com/apikey
# 2. ضعه في المتغير البيئي:
$env:GEMINI_API_KEY = "AIza..."   # PowerShell
# أو:
set GEMINI_API_KEY=AIza...         # CMD

# 3. شغّل الأداة:
edu7-content prepare books_input/book1.pdf --model gemini
```

---

## هيكل مجلد العمل (workspace)

```
workspaces/book1/
├── book-manifest.json          # بيانات الكتاب والوحدات والدروس
└── units/
    ├── 01/
    │   ├── unit-manifest.json
    │   └── lessons/
    │       ├── 01/
    │       │   ├── manifest.json        # بيانات الدرس
    │       │   ├── lesson_full_text.txt # نص الدرس (فارغ لصور PDF)
    │       │   ├── lesson.pdf           # صفحات الدرس مقطوعة
    │       │   └── analysis/            # نتائج AI (بعد analyze)
    │       └── 02/ ...
    └── 02/ ...
```

---

## كيفية اكتشاف صفحات الفهرس

الخوارزمية تعتمد على ثلاثة شروط مجتمعة:

1. **الكلمة الرئيسية**: الصفحة تحتوي على `المحتويات` أو `محتويات` أو `فهرس`
2. **الكلمات البنيوية**: تحتوي أيضاً على `الوحدة` أو `الدرس` أو مشتقاتها
3. **أرقام الصفحات**: تحتوي على أرقام (عربية أو هندية) تمثل أرقام الصفحات

إذا لم تُكتشف أي صفحة، يُفعَّل Fallback الهيوريستي:
- البحث عن صفحات تحتوي 3+ تكرارات لكلمات بنيوية

---

## دعم تنسيقات الكتب

| نوع الكتاب | Layer 1 | Layer 2 | Layer 3/4 |
|-----------|---------|---------|-----------|
| نص عربي قابل للنسخ | ✅ فوري | — | — |
| نص عربي بخطوط خاصة/Presentation Forms | ✅ بعد تطبيع NFKD | — | — |
| PDF مسح ضوئي (صور بحتة) | ❌ | ✅ Tesseract | ✅ Ollama/Gemini |
| PDF هجين (صور + watermark) | ❌ تلقائي | ✅ | ✅ |
| عمودان في صفحة واحدة | ✅ RTL sorting | ✅ | ✅ |
