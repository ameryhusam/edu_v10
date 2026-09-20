/**
 * SubjectsOverview — the shelf rolled up by subject.
 *
 * The two rules under test, both stated in the use-case header:
 *   · every per-book number is the journey's own roll-up, unchanged;
 *   · the subject's completion is mastered ÷ total across books, never an
 *     average of percentages — the case below finishes a 2-concept book and
 *     never touches a 6-concept one, and the subject must say 2/8, not 50%.
 */

import { describe, expect, it } from 'vitest';
import { JourneyService } from '../../src/contexts/learning/application/journey.service.js';
import { SubjectsOverviewUseCase } from '../../src/contexts/learning/application/subjects-overview.use-case.js';
import type {
  ContentReader,
  ConceptDescriptor,
  LearnerEntitlementReader,
  LearnerTextbook,
  MasteryReader,
} from '../../src/contexts/learning/application/ports.js';
import type { PrerequisiteEdge } from '../../src/contexts/learning/domain/prerequisite-graph.js';

const LEARNER = 'lrn_demo_student';

function concept(
  key: string,
  lessonKey: string,
  orderIndex: number,
  mastered: boolean,
): { descriptor: ConceptDescriptor; mastery: number } {
  return {
    descriptor: {
      conceptKey: key,
      name: key,
      lessonKey,
      lessonName: `درس ${lessonKey}`,
      unitKey: `${lessonKey}-u`,
      unitName: `وحدة ${lessonKey}`,
      orderIndex,
      masteryThreshold: 0.75,
      isCore: true,
    },
    mastery: mastered ? 0.9 : 0,
  };
}

function build(): {
  overview: SubjectsOverviewUseCase;
  entitlements: LearnerTextbook[];
} {
  // A maths book with 2 concepts (both mastered) and a science book with 6
  // concepts (none mastered): the subject picture every dashboard wants.
  const rows = [
    concept('M1', 'l-m', 1, true),
    concept('M2', 'l-m', 2, true),
    ...[1, 2, 3, 4, 5, 6].map((i) => concept(`S${i}`, 'l-s', i, false)),
  ];

  const content: ContentReader = {
    async conceptsInTextbook(textbookKey) {
      return rows
        .filter((r) =>
          textbookKey === 'tb_math'
            ? r.descriptor.conceptKey.startsWith('M')
            : r.descriptor.conceptKey.startsWith('S'),
        )
        .map((r) => r.descriptor);
    },
    async conceptsInLesson() {
      return [];
    },
    async prerequisitesFor(): Promise<PrerequisiteEdge[]> {
      return [];
    },
    async lessonExists() {
      return true;
    },
    async lessonView() {
      return null;
    },
    async lessonShelf() {
      return [];
    },
  };

  const mastery: MasteryReader = {
    async profileFor(_learnerKey: string, conceptKeys: readonly string[]) {
      return new Map(
        rows
          .filter((r) => conceptKeys.includes(r.descriptor.conceptKey))
          .map((r) => [
            r.descriptor.conceptKey,
            {
              mastery: r.mastery,
              effectiveMastery: r.mastery,
              confidence: 1,
              retrievability: 1,
              attemptsCount: r.mastery > 0 ? 2 : 0,
            },
          ]),
      );
    },
  };

  const entitlements: LearnerTextbook[] = [
    {
      key: 'tb_math',
      title: 'الرياضيّات',
      subjectKey: 'MATH',
      subjectName: 'الرياضيّات',
      gradeKey: 'G07',
      gradeName: 'الصف السابع',
      termKey: '2026-2027-T01',
      termName: 'الفصل الأول',
      academicYearKey: '2026-2027',
      edition: 'ed-1',
      totalPages: 100,
    },
    {
      key: 'tb_sci',
      title: 'العلوم',
      subjectKey: 'SCI',
      subjectName: 'العلوم',
      gradeKey: 'G07',
      gradeName: 'الصف السابع',
      termKey: '2026-2027-T01',
      termName: 'الفصل الأول',
      academicYearKey: '2026-2027',
      edition: 'ed-1',
      totalPages: 171,
    },
  ];

  const reader: LearnerEntitlementReader = {
    async textbooksFor() {
      return entitlements;
    },
  };

  const journey = new JourneyService(content, mastery);
  return { overview: new SubjectsOverviewUseCase(reader, journey), entitlements };
}

describe('the subject shelf', () => {
  it('sums concept counts across books, never averages percentages', async () => {
    const { overview } = build();
    const result = await overview.execute({ learnerKey: LEARNER });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const science = result.value.subjects.find((s) => s.subjectKey === 'SCI')!;
    // 2 mastered of 2 in maths, 0 of 6 in science. A subject-level average
    // of percentages would say 50%; the honest count says 2/8.
    expect(science.total).toBe(6);
    expect(science.mastered).toBe(0);

    const maths = result.value.subjects.find((s) => s.subjectKey === 'MATH')!;
    expect(maths.mastered).toBe(2);
    expect(maths.total).toBe(2);
    expect(maths.completion).toBe(1);

    const allTotal = result.value.subjects.reduce((acc, s) => acc + s.total, 0);
    expect(allTotal).toBe(8);
  });

  it('carries each book own roll-up, straight from the journey', async () => {
    const { overview } = build();
    const result = await overview.execute({ learnerKey: LEARNER });
    if (!result.ok) return;

    const science = result.value.subjects.find((s) => s.subjectKey === 'SCI')!;
    expect(science.textbooks).toHaveLength(1);
    expect(science.textbooks[0]).toMatchObject({
      key: 'tb_sci',
      total: 6,
      mastered: 0,
      completion: 0,
    });
  });
});
