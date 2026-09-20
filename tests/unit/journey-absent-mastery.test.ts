/**
 * Absent mastery is null, not zero — but only where it is *displayed*.
 *
 * Found by reading a live path payload while building the learner UI: a LOCKED
 * concept with `attemptsCount: 0` came back with `effectiveMastery: 0`, so the
 * frontend's AbsentValue component — written precisely to stop "not measured"
 * rendering as "0%" — could never fire. The UI would have told a learner they
 * scored zero on a concept the system had deliberately never let them attempt.
 *
 * The subtlety, and the reason this test exists rather than a blanket rename:
 * the SAME value is used for two different purposes.
 *
 *   · **Gating** — an unmeasured prerequisite must count as 0, or an untouched
 *     concept would satisfy the `strength >= 0.7` check and unlock everything
 *     behind it. Absent-as-zero is correct here and must stay.
 *   · **Display** — absent-as-zero is a lie here.
 *
 * So the fix applies to the PathNode only, and this test pins both halves. A
 * future "cleanup" that makes the two consistent would reintroduce either the
 * lie or a security-shaped bug.
 */

import { describe, expect, it } from 'vitest';
import { JourneyService } from '../../src/contexts/learning/application/journey.service.js';
import type {
  ConceptDescriptor,
  ContentReader,
  MasteryReader,
} from '../../src/contexts/learning/application/ports.js';
import type { PrerequisiteEdge } from '../../src/contexts/learning/domain/prerequisite-graph.js';

const TEXTBOOK = 'EDU-T-G01-T1-ED2026';
const UNIT = `${TEXTBOOK}-U-U1`;
const LESSON = `${UNIT}-L-L1`;

function concept(slug: string, orderIndex: number): ConceptDescriptor {
  return {
    conceptKey: `${LESSON}-C-${slug}`,
    name: slug,
    lessonKey: LESSON,
    unitKey: UNIT,
    orderIndex,
    masteryThreshold: 0.75,
    isCore: true,
    lessonName: 'الدرس',
    unitName: 'الوحدة',
  };
}

const FIRST = concept('FIRST', 1);
const SECOND = concept('SECOND', 2);

function services(options: {
  mastery: ReadonlyMap<string, { effectiveMastery: number; attemptsCount: number; lastObservedAt: Date | null }>;
  edges?: readonly PrerequisiteEdge[];
}): JourneyService {
  const content: ContentReader = {
    async conceptsInTextbook() {
      return [FIRST, SECOND];
    },
    async conceptsInLesson() {
      return [FIRST, SECOND];
    },
    async prerequisitesFor() {
      return [...(options.edges ?? [])];
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
    async profileFor() {
      return options.mastery as never;
    },
  };

  return new JourneyService(content, mastery);
}

describe('path display value', () => {
  it('reports null for a concept with no mastery record', async () => {
    const service = services({ mastery: new Map() });

    const result = await service.path({ learnerKey: 'lrn_x', textbookKey: TEXTBOOK });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    for (const node of result.value.path) {
      // The whole point: not 0.
      expect(node.effectiveMastery).toBeNull();
      expect(node.attemptsCount).toBe(0);
    }
  });

  it('reports a real zero as zero', async () => {
    // A learner who attempted and genuinely scored nothing is a different
    // fact from a learner who never attempted, and both must be expressible.
    const service = services({
      mastery: new Map([
        [FIRST.conceptKey, { effectiveMastery: 0, attemptsCount: 4, lastObservedAt: new Date() }],
      ]),
    });

    const result = await service.path({ learnerKey: 'lrn_x', textbookKey: TEXTBOOK });
    if (!result.ok) throw new Error('expected ok');

    const first = result.value.path.find((n) => n.conceptKey === FIRST.conceptKey);
    expect(first?.effectiveMastery).toBe(0);
    expect(first?.attemptsCount).toBe(4);
  });
});

describe('gating still treats absent as zero', () => {
  it('keeps a concept locked when its prerequisite has never been measured', async () => {
    // The half that must NOT change. If absent became null here and null were
    // treated as "no constraint", an untouched prerequisite would unlock the
    // concept behind it.
    const service = services({
      mastery: new Map(),
      edges: [
        {
          conceptKey: SECOND.conceptKey,
          prerequisiteKey: FIRST.conceptKey,
          strength: 0.9,
          requiredMastery: 0.7,
        },
      ],
    });

    const result = await service.path({ learnerKey: 'lrn_x', textbookKey: TEXTBOOK });
    if (!result.ok) throw new Error('expected ok');

    const second = result.value.path.find((n) => n.conceptKey === SECOND.conceptKey);
    expect(second?.state).toBe('LOCKED');
    expect(second?.blockedBy).toContain(FIRST.conceptKey);
    // And it is still reported as unmeasured rather than as a zero score.
    expect(second?.effectiveMastery).toBeNull();
  });
});
