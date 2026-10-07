import type { CanonicalQuestion } from '../canonical';

export interface SelectionCriteria {
  subjectId?: string;
  gradeId?: string;
  part?: string | null;
  units?: string[];
  lessons?: string[];
  questionTypes?: string[];
  difficultyDistribution?: { easy?: number; medium?: number; hard?: number };
  count: number;
  seed?: number;
}

/**
 * Simple deterministic RNG (Mulberry32)
 */
function mulberry32(a: number) {
  return function() {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Rule-based selection that operates on an in-memory pool of CanonicalQuestion.
 * This is backend-agnostic and useful for tests and early wiring before DB is added.
 */
export function selectQuestions(pool: CanonicalQuestion[], criteria: SelectionCriteria): CanonicalQuestion[] {
  // Simple filter by subject/grade/part/units/lessons/type
  let candidates = pool.filter((q) => q.status === 'PUBLISHED');
  if (criteria.subjectId) candidates = candidates.filter((q) => q.subject.id === criteria.subjectId);
  if (criteria.gradeId) candidates = candidates.filter((q) => q.grade.id === criteria.gradeId);
  if (criteria.part) candidates = candidates.filter((q) => q.metadata?.['part'] === criteria.part);
  if (criteria.units && criteria.units.length) candidates = candidates.filter((q) => criteria.units!.includes(q.unit.id));
  if (criteria.lessons && criteria.lessons.length) candidates = candidates.filter((q) => criteria.lessons!.includes(q.lesson.id));
  if (criteria.questionTypes && criteria.questionTypes.length) candidates = candidates.filter((q) => criteria.questionTypes!.includes(q.type));

  // Deduplicate naive: fingerprint by text+type+lesson
  const seen = new Set<string>();
  const deduped: CanonicalQuestion[] = [];
  for (const c of candidates) {
    const key = `${c.type}|${c.lesson.id}|${c.text.trim().toLowerCase()}`;
    if (!seen.has(key)) { seen.add(key); deduped.push(c); }
  }

  // Simple difficulty bucketing (if distribution provided)
  const count = Math.max(1, criteria.count);
  const rng = mulberry32(criteria.seed ?? Date.now());

  // Shuffle deduped with seed
  for (let i = deduped.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [deduped[i], deduped[j]] = [deduped[j], deduped[i]];
  }

  // Take first `count` as selection for baseline
  return deduped.slice(0, count);
}
