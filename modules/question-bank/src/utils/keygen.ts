import { slugify } from './string-utils';

export function generateSubjectKey(name: string): string {
  return (name || 'SUBJECT').toUpperCase().replace(/\s+/g, '_');
}

export function generateGradeKey(name: string): string {
  // Expect names like "Grade 5" or "G05"; normalize to G05
  if (!name) return 'G00';
  const m = name.match(/G?0*([0-9]+)/i);
  if (m) return `G${m[1].padStart(2, '0')}`;
  const s = slugify(name).toUpperCase();
  return s.startsWith('G') ? s : `G_${s}`;
}

export function generateUnitKey(subjectKey: string, gradeKey: string, indexOrTitle: string | number): string {
  const idx = typeof indexOrTitle === 'number' ? String(indexOrTitle).padStart(2, '0') : slugify(String(indexOrTitle)).toUpperCase();
  return `${subjectKey}-${gradeKey}-U${idx}`;
}

export function generateLessonKey(unitKey: string, indexOrTitle: string | number): string {
  const idx = typeof indexOrTitle === 'number' ? String(indexOrTitle).padStart(2, '0') : slugify(String(indexOrTitle)).toUpperCase();
  return `${unitKey}-L${idx}`;
}

export function generateQuestionKey(subjectKey: string, gradeKey: string, unitKey: string, lessonKey: string, seqOrShort: string | number) {
  const s = typeof seqOrShort === 'number' ? String(seqOrShort).padStart(3, '0') : slugify(String(seqOrShort)).toUpperCase();
  return `${subjectKey}-${gradeKey}-${unitKey.split('-').pop() ?? unitKey}-${lessonKey.split('-').pop() ?? lessonKey}-Q${s}`;
}
