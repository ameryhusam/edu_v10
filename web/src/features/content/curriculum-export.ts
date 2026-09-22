import { downloadJson } from '../../shared/platform/download';
import type { TextbookSummary, OutlineUnit } from './content.api';

export function exportCurriculumPackage(selected: TextbookSummary, units: readonly OutlineUnit[]): void {
  const pkg = {
    schemaVersion: '1.0',
    exportedAt: new Date().toISOString(),
    textbook: {
      key: selected.key,
      title: selected.title,
      subjectName: selected.subjectName,
      gradeName: selected.gradeName,
      part: selected.part,
      edition: selected.edition,
    },
    units: units.map((u) => ({
      name: u.name,
      orderIndex: u.orderIndex,
      lessons: u.lessons.map((l) => ({
        name: l.name,
        orderIndex: l.orderIndex,
        estimatedMins: l.estimatedMins,
        concepts: (l.concepts ?? []).map((c) => ({
          name: c.name,
          orderIndex: c.orderIndex,
        })),
      })),
    })),
  };

  downloadJson(`${selected.key}_curriculum.json`, pkg);
}
