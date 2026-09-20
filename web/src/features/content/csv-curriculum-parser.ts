/**
 * csv-curriculum-parser.ts
 *
 * Lightweight, zero-dependency CSV parser for simplified curriculum imports:
 * - Requires ONLY the textbook key (textbookKey).
 * - All unit, lesson, and concept keys are deterministically generated based on orderIndex.
 * - Performs line-by-line comparison with the system outline to identify:
 *   1. Identical records (automatically skipped to prevent unnecessary writes).
 *   2. New records (to be created).
 *   3. Conflicting records (detected for user preview and resolution).
 */

import type { OutlineUnit, OutlineLesson, OutlineConcept } from './content.api';

export interface ParsedConcept {
  readonly slug: string;
  readonly name: string;
  readonly orderIndex: number;
  readonly reading?: string | undefined;
}

export interface ParsedLesson {
  readonly slug: string;
  readonly name: string;
  readonly orderIndex: number;
  readonly concepts: ParsedConcept[];
}

export interface ParsedUnit {
  readonly slug: string;
  readonly name: string;
  readonly orderIndex: number;
  readonly startPage?: number | undefined;
  readonly endPage?: number | undefined;
  readonly lessons: ParsedLesson[];
}

export interface ParsedCurriculumPackage {
  readonly textbookKey: string;
  readonly units: ParsedUnit[];
}

export interface ConflictItem {
  readonly id: string;
  readonly type: 'unit' | 'lesson' | 'concept';
  readonly path: string;
  readonly orderIndex: number;
  readonly field: string;
  readonly systemValue: string;
  readonly fileValue: string;
  choice: 'FILE' | 'SYSTEM';
}

export interface ComparisonResult {
  readonly newCount: number;
  readonly identicalCount: number;
  readonly conflicts: ConflictItem[];
  readonly resolvedPackage: ParsedCurriculumPackage;
}

export const EXCEL_TEMPLATE_CSV = `\uFEFFtextbookKey,unitName,unitOrderIndex,lessonName,lessonOrderIndex,conceptName,conceptOrderIndex,reading,startPage,endPage
tb_g07_sci_t1,الوحدة الأولى: طبيعة المادة,1,الدرس الأول: حالات المادة,1,مفهوم حالات المادة الثلاث,1,توجد المادة في ثلاث حالات رئيسية: صلبة وسائلة وغازية,10,18
tb_g07_sci_t1,الوحدة الأولى: طبيعة المادة,1,الدرس الأول: حالات المادة,1,التغيرات الفيزيائية والكيميائية,2,التغير الفيزيائي لا ينتج مواد جديدة بينما الكيميائي يغير التركيب,19,25
tb_g07_sci_t1,الوحدة الأولى: طبيعة المادة,1,الدرس الثاني: بنية الذرة,2,العناصر والمركبات الكيميائية,1,العنصر مادة نقية لا يمكن تجزئتها بينما المركب اتحاد عنصرين أو أكثر,26,34
tb_g07_sci_t1,الوحدة الثانية: القوة والحركة,2,الدرس الأول: مفهوم الحركة والسرعة,1,السرعة والتسارع,1,السرعة هي المسافة المقطوعة في وحدة الزمن,35,42
`;

/** Split a CSV line respecting quoted columns */
function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim().replace(/^"|"$/g, '').replace(/""/g, '"'));
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim().replace(/^"|"$/g, '').replace(/""/g, '"'));
  return result;
}

/**
 * Parse curriculum CSV string.
 * Uses orderIndex to deterministically generate slugs/keys:
 * Unit: U{orderIndex}
 * Lesson: L{orderIndex}
 * Concept: C{orderIndex}
 */
export function parseCurriculumCsv(
  csvText: string,
  defaultTextbookKey?: string,
): ParsedCurriculumPackage {
  const lines = csvText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const unitMap = new Map<number, ParsedUnit>();
  const lessonsByUnit = new Map<number, Map<number, ParsedLesson>>();
  let detectedTextbookKey = defaultTextbookKey || '';

  let headerPassed = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const cols = splitCsvLine(line);
    if (!headerPassed) {
      if (cols[0]?.toLowerCase().includes('textbook') || cols[1]?.includes('unit') || cols[1]?.includes('الوحدة')) {
        headerPassed = true;
        continue;
      }
      headerPassed = true;
    }

    const [
      rowTbKey,
      unitName,
      unitOrderStr,
      lessonName,
      lessonOrderStr,
      conceptName,
      conceptOrderStr,
      reading,
      startPageStr,
      endPageStr,
    ] = cols;

    if (!detectedTextbookKey && rowTbKey?.trim()) {
      detectedTextbookKey = rowTbKey.trim();
    }

    const unitOrder = parseInt(unitOrderStr || '', 10) || 1;
    const lessonOrder = parseInt(lessonOrderStr || '', 10) || 1;
    const conceptOrder = parseInt(conceptOrderStr || '', 10) || 1;
    const startPage = startPageStr ? parseInt(startPageStr, 10) : undefined;
    const endPage = endPageStr ? parseInt(endPageStr, 10) : undefined;

    // 1. Ensure Unit exists
    if (!unitMap.has(unitOrder)) {
      unitMap.set(unitOrder, {
        slug: `U${unitOrder}`,
        name: unitName?.trim() || `الوحدة ${unitOrder}`,
        orderIndex: unitOrder,
        startPage,
        endPage,
        lessons: [],
      });
      lessonsByUnit.set(unitOrder, new Map());
    }

    const unitLessons = lessonsByUnit.get(unitOrder)!;

    // 2. Ensure Lesson exists
    if (!unitLessons.has(lessonOrder)) {
      unitLessons.set(lessonOrder, {
        slug: `L${lessonOrder}`,
        name: lessonName?.trim() || `الدرس ${lessonOrder}`,
        orderIndex: lessonOrder,
        concepts: [],
      });
    }

    // 3. Add Concept
    const currentLesson = unitLessons.get(lessonOrder)!;
    if (conceptName?.trim()) {
      currentLesson.concepts.push({
        slug: `C${conceptOrder}`,
        name: conceptName.trim(),
        orderIndex: conceptOrder,
        reading: reading?.trim() || undefined,
      });
    }
  }

  // Assemble hierarchical tree
  const units: ParsedUnit[] = Array.from(unitMap.values())
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .map((unit) => {
      const lessonsMap = lessonsByUnit.get(unit.orderIndex);
      const lessons = lessonsMap
        ? Array.from(lessonsMap.values()).sort((a, b) => a.orderIndex - b.orderIndex)
        : [];
      return {
        ...unit,
        lessons,
      };
    });

  return {
    textbookKey: detectedTextbookKey,
    units,
  };
}

/**
 * Compare imported package against existing system outline.
 * Identifies identical items (skipped), new items (created), and conflicts.
 */
export function compareWithOutline(
  imported: ParsedCurriculumPackage,
  existingUnits: readonly OutlineUnit[] = [],
): ComparisonResult {
  const conflicts: ConflictItem[] = [];
  let identicalCount = 0;
  let newCount = 0;

  const existingUnitsByOrder = new Map<number, OutlineUnit>();
  for (const u of existingUnits) {
    existingUnitsByOrder.set(u.orderIndex, u);
  }

  for (const impUnit of imported.units) {
    const sysUnit = existingUnitsByOrder.get(impUnit.orderIndex);
    if (!sysUnit) {
      newCount += 1;
      newCount += impUnit.lessons.length;
      for (const l of impUnit.lessons) newCount += l.concepts.length;
      continue;
    }

    // Unit comparison
    if (sysUnit.name.trim() === impUnit.name.trim()) {
      identicalCount += 1;
    } else {
      conflicts.push({
        id: `conflict-unit-${impUnit.orderIndex}`,
        type: 'unit',
        path: impUnit.name,
        orderIndex: impUnit.orderIndex,
        field: 'اسم الوحدة',
        systemValue: sysUnit.name,
        fileValue: impUnit.name,
        choice: 'FILE',
      });
    }

    const existingLessonsByOrder = new Map<number, OutlineLesson>();
    for (const l of sysUnit.lessons) {
      existingLessonsByOrder.set(l.orderIndex, l);
    }

    for (const impLesson of impUnit.lessons) {
      const sysLesson = existingLessonsByOrder.get(impLesson.orderIndex);
      if (!sysLesson) {
        newCount += 1;
        newCount += impLesson.concepts.length;
        continue;
      }

      // Lesson comparison
      if (sysLesson.name.trim() === impLesson.name.trim()) {
        identicalCount += 1;
      } else {
        conflicts.push({
          id: `conflict-lesson-${impUnit.orderIndex}-${impLesson.orderIndex}`,
          type: 'lesson',
          path: `${impUnit.name} > ${impLesson.name}`,
          orderIndex: impLesson.orderIndex,
          field: 'اسم الدرس',
          systemValue: sysLesson.name,
          fileValue: impLesson.name,
          choice: 'FILE',
        });
      }

      const existingConceptsByOrder = new Map<number, OutlineConcept>();
      for (const c of sysLesson.concepts ?? []) {
        existingConceptsByOrder.set(c.orderIndex, c);
      }

      for (const impConcept of impLesson.concepts) {
        const sysConcept = existingConceptsByOrder.get(impConcept.orderIndex);
        if (!sysConcept) {
          newCount += 1;
          continue;
        }

        // Concept comparison
        if (sysConcept.name.trim() === impConcept.name.trim()) {
          identicalCount += 1;
        } else {
          conflicts.push({
            id: `conflict-concept-${impUnit.orderIndex}-${impLesson.orderIndex}-${impConcept.orderIndex}`,
            type: 'concept',
            path: `${impUnit.name} > ${impLesson.name} > ${impConcept.name}`,
            orderIndex: impConcept.orderIndex,
            field: 'اسم المفهوم',
            systemValue: sysConcept.name,
            fileValue: impConcept.name,
            choice: 'FILE',
          });
        }
      }
    }
  }

  return {
    newCount,
    identicalCount,
    conflicts,
    resolvedPackage: imported,
  };
}

/** Parse plain-text hierarchical outline into structured curriculum package */
export function parseTextOutline(
  rawText: string,
  targetKey = '',
): ParsedCurriculumPackage {
  const lines = rawText.split('\n').map((l) => l.trim()).filter(Boolean);
  const units: ParsedUnit[] = [];
  let currentUnit: ParsedUnit | null = null;
  let currentLesson: ParsedLesson | null = null;

  lines.forEach((line) => {
    if (line.startsWith('الوحدة') || line.startsWith('#')) {
      currentUnit = {
        slug: `U${units.length + 1}`,
        name: line.replace(/^[#\s]+/, ''),
        orderIndex: units.length + 1,
        lessons: [],
      };
      units.push(currentUnit);
      currentLesson = null;
    } else if (line.startsWith('الدرس') || line.startsWith('##') || line.startsWith('-')) {
      if (!currentUnit) {
        currentUnit = { slug: 'U1', name: 'الوحدة الأولى', orderIndex: 1, lessons: [] };
        units.push(currentUnit);
      }
      currentLesson = {
        slug: `L${currentUnit.lessons.length + 1}`,
        name: line.replace(/^[#\-\s]+/, ''),
        orderIndex: currentUnit.lessons.length + 1,
        concepts: [],
      };
      currentUnit.lessons.push(currentLesson);
    } else if (currentLesson) {
      currentLesson.concepts.push({
        slug: `C${currentLesson.concepts.length + 1}`,
        name: line.replace(/^[\*\-\s]+/, ''),
        orderIndex: currentLesson.concepts.length + 1,
      });
    }
  });

  return { textbookKey: targetKey, units };
}

