import { Errors } from '../../../../shared/kernel/errors.js';
import { Err, Ok, type Result } from '../../../../shared/kernel/result.js';

export interface TextbookIndexDocument {
  readonly schemaVersion: '1.0';
  readonly stage: 'STRUCTURE_ONLY';

  readonly textbook: {
    readonly gradeKey: string;     // e.g. "G07"
    readonly subjectKey: string;   // e.g. "SCI", "MATH", "ENG"
    readonly part: 'P01' | 'P02' | 'BOTH' | 'unknown';
    readonly title: string;
    readonly edition: string;     // e.g. "2026"
  };

  readonly source: {
    readonly fileName: string;
    readonly sha256: string;
    readonly physicalPageCount: number;
  };

  readonly units: ReadonlyArray<TextbookIndexUnit>;

  readonly importScope: {
    readonly units: true;
    readonly lessons: true;
    readonly concepts: false;
    readonly questions: false;
    readonly resources: false;
  };
}

export interface TextbookIndexUnit {
  readonly number: number;
  readonly title: string;
  readonly slug: string;
  readonly orderIndex: number;
  readonly lessons: ReadonlyArray<TextbookIndexLesson>;
}

export interface TextbookIndexLesson {
  readonly number: number;
  readonly title: string;
  readonly slug: string;
  readonly orderIndex: number;
  readonly pages: {
    readonly physicalStartPage: number;
    readonly physicalEndPage: number;
    readonly printedStartPage?: number | null;
    readonly printedEndPage?: number | null;
  };
  readonly artifact?: {
    readonly relativePath: string; // e.g. "P01/units/U01/L01/lesson.pdf"
    readonly sha256: string;
  };
}

/**
 * Deterministic pre-slice and structure validator.
 * Ensures the index document strictly conforms to pedagogical and physical page rules.
 */
export function validateIndexDocument(doc: TextbookIndexDocument): Result<void> {
  if (doc.schemaVersion !== '1.0') {
    return Err(Errors.validation('index.invalid_schema', `Unsupported schemaVersion: ${doc.schemaVersion}`));
  }

  if (doc.stage !== 'STRUCTURE_ONLY') {
    return Err(Errors.validation('index.invalid_stage', `Stage must be STRUCTURE_ONLY in Phase 1.`));
  }

  if (!doc.textbook.gradeKey || !doc.textbook.subjectKey || !doc.textbook.title) {
    return Err(Errors.validation('index.missing_metadata', 'Textbook gradeKey, subjectKey, and title are required.'));
  }

  if (doc.source.physicalPageCount <= 0) {
    return Err(Errors.validation('index.invalid_page_count', 'physicalPageCount must be greater than 0.'));
  }

  if (!Array.isArray(doc.units) || doc.units.length === 0) {
    return Err(Errors.validation('index.empty_units', 'The index must contain at least one unit.'));
  }

  const seenUnitSlugs = new Set<string>();
  const seenUnitOrders = new Set<number>();

  for (const [uIdx, unit] of doc.units.entries()) {
    if (!unit.title || !unit.slug) {
      return Err(Errors.validation('index.invalid_unit', `Unit at position ${uIdx + 1} lacks title or slug.`));
    }
    if (seenUnitSlugs.has(unit.slug.toLowerCase())) {
      return Err(Errors.validation('index.duplicate_unit_slug', `Duplicate unit slug: ${unit.slug}`));
    }
    seenUnitSlugs.add(unit.slug.toLowerCase());

    if (seenUnitOrders.has(unit.orderIndex)) {
      return Err(Errors.validation('index.duplicate_unit_order', `Duplicate unit orderIndex: ${unit.orderIndex}`));
    }
    seenUnitOrders.add(unit.orderIndex);

    if (!Array.isArray(unit.lessons) || unit.lessons.length === 0) {
      return Err(Errors.validation('index.empty_lessons', `Unit "${unit.title}" must contain at least one lesson.`));
    }

    const seenLessonSlugs = new Set<string>();
    const seenLessonOrders = new Set<number>();
    let lastEndPage = 0;

    for (const [lIdx, lesson] of unit.lessons.entries()) {
      if (!lesson.title || !lesson.slug) {
        return Err(Errors.validation('index.invalid_lesson', `Lesson at unit ${unit.slug} position ${lIdx + 1} lacks title or slug.`));
      }
      if (seenLessonSlugs.has(lesson.slug.toLowerCase())) {
        return Err(Errors.validation('index.duplicate_lesson_slug', `Duplicate lesson slug "${lesson.slug}" in unit "${unit.slug}".`));
      }
      seenLessonSlugs.add(lesson.slug.toLowerCase());

      if (seenLessonOrders.has(lesson.orderIndex)) {
        return Err(Errors.validation('index.duplicate_lesson_order', `Duplicate lesson orderIndex: ${lesson.orderIndex}`));
      }
      seenLessonOrders.add(lesson.orderIndex);

      const { physicalStartPage, physicalEndPage } = lesson.pages;
      if (typeof physicalStartPage !== 'number' || typeof physicalEndPage !== 'number') {
        return Err(Errors.validation('index.invalid_pages', `Lesson "${lesson.slug}" pages must be numbers.`));
      }

      if (physicalStartPage < 1 || physicalEndPage > doc.source.physicalPageCount) {
        return Err(Errors.validation('index.page_out_of_bounds', `Lesson "${lesson.slug}" pages [${physicalStartPage}, ${physicalEndPage}] out of bounds (1..${doc.source.physicalPageCount}).`));
      }

      if (physicalEndPage < physicalStartPage) {
        return Err(Errors.validation('index.negative_range', `Lesson "${lesson.slug}" end page ${physicalEndPage} is before start page ${physicalStartPage}.`));
      }

      // Check monotonicity within unit
      if (lastEndPage > 0 && physicalStartPage < lastEndPage) {
        return Err(Errors.validation('index.page_overlap', `Lesson "${lesson.slug}" starts at page ${physicalStartPage} before previous lesson end page ${lastEndPage}.`));
      }
      lastEndPage = physicalEndPage;
    }
  }

  return Ok(undefined);
}

/**
 * Normalizes user-specified or extracted part strings into canonical domain representation.
 */
export function normalizePart(part?: string | null): 'PART_1' | 'PART_2' | 'BOTH' | 'unknown' {
  if (!part) return 'unknown';
  const clean = part.trim().toUpperCase();
  if (clean === 'P01' || clean === 'P1' || clean === 'PART_1' || clean === 'TERM_1' || clean === '1') return 'PART_1';
  if (clean === 'P02' || clean === 'P2' || clean === 'PART_2' || clean === 'TERM_2' || clean === '2') return 'PART_2';
  if (clean === 'BOTH' || clean === 'PB' || clean === 'FULL') return 'BOTH';
  return 'unknown';
}

export function formatPartCode(part: 'PART_1' | 'PART_2' | 'BOTH' | 'unknown'): 'P01' | 'P02' | 'BOTH' | 'unknown' {
  if (part === 'PART_1') return 'P01';
  if (part === 'PART_2') return 'P02';
  if (part === 'BOTH') return 'BOTH';
  return 'unknown';
}
