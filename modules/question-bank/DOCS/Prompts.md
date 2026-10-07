# AI Prompt Templates for generating question files and Excel rows

This file contains ready-to-use prompt templates you can send to an LLM to generate question banks, Excel rows, or JSON files matching the canonical schema used by the import pipeline.

1) Prompt: Generate MCQ Excel rows (Arabic)

Goal:
Generate N multiple-choice questions in Arabic suitable for upload as an Excel file. Output must be a CSV (or Excel-ready) with headers exactly matching the DOCS/Excel_format.md

Prompt:
```
You are a content generator. Produce 50 MCQ_SINGLE questions in Arabic about basic arithmetic for Grade 5.
Output format: CSV with header row EXACTLY:
subjectKey,subjectName,gradeKey,gradeName,unitKey,unitTitle,lessonKey,lessonTitle,questionKey,type,text,points,difficulty,hint,explanation,answerData

For each row:
- subjectKey: MATH
- subjectName: Mathematics
- gradeKey: G05
- gradeName: Grade 5
- unitKey, unitTitle, lessonKey, lessonTitle: create reasonable keys/titles (e.g., MATH-G05-U01,U01 etc.)
- questionKey: unique key per question
- type: MCQ_SINGLE
- text: question text in Arabic
- points: 1
- difficulty: easy|medium|hard
- hint: short hint or empty
- explanation: short explanation in Arabic
- answerData: JSON string with structure: {"options":[{"id":"A","text":"...","isCorrect":false},...],"correctIds":["B"]}

Do NOT include any other columns. Ensure answerData is valid JSON and properly escaped for CSV.
```

2) Prompt: Generate JSON canonical file (English)

Prompt:
```
Generate a JSON array of 30 canonical questions for Grade 3 English reading comprehension.
Each item must follow this canonical shape:
{
  "subject": { "key": "ENG", "name": "English" },
  "grade": { "key": "G03", "name": "Grade 3" },
  "unit": { "title": "..." },
  "lesson": { "title": "..." },
  "type": "MCQ_SINGLE|MCQ_MULTI|SHORT_TEXT|TRUE_FALSE|NUMERIC",
  "text": "...",
  "points": 1,
  "answerData": { ... }
}

Return only valid JSON (no markdown, no commentary).
```

3) Prompt: Transform a single question into Excel row

Prompt:
```
Given the following canonical question JSON, output a single CSV row using the exact headers:
(subjectKey,subjectName,gradeKey,gradeName,unitKey,unitTitle,lessonKey,lessonTitle,questionKey,type,text,points,difficulty,hint,explanation,answerData)
Question JSON:
<PASTE_JSON_HERE>

Return only the CSV row (no header). Ensure answerData is valid JSON string.
```

Use these prompts with any modern LLM (GPT-4/plus) to rapidly generate question banks ready for import into the system.
