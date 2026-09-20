/**
 * The journey service — path, progress and completion over fake content.
 *
 * The claims worth testing are the ones where a plausible-looking shortcut
 * gives a wrong answer a human would not notice:
 *
 *  · a locked concept is LOCKED, not STRUGGLING (it was never reachable)
 *  · locked concepts stay in the denominator (or progress goes backwards)
 *  · a lesson is gated by its WEAKEST concept, not the average
 *  · "where am I" skips mastered and locked work, in textbook order
 */

import { describe, expect, it } from 'vitest';
import { JourneyService } from '../../src/contexts/learning/application/journey.service.js';
import type {
  ConceptDescriptor,
  ContentReader,
  MasteryReader,
} from '../../src/contexts/learning/application/ports.js';
import type { PrerequisiteEdge } from '../../src/contexts/learning/domain/prerequisite-graph.js';

const TB = 'EDU-MATH-G07-T1-ED2026';
const U1 = `${TB}-U-SETS`;
const L1 = `${U1}-L-BASICS`;
const L2 = `${U1}-L-OPERATIONS`;

function concept(slug: string, lessonKey: string, orderIndex: number, threshold = 0.8): ConceptDescriptor {
  return {
    conceptKey: `${lessonKey}-C-${slug}`,
    name: slug,
    lessonKey,
    unitKey: U1,
    orderIndex,
    masteryThreshold: threshold,
    isCore: true,
    lessonName: 'الدرس',
    unitName: 'الوحدة',
  };
}

class FakeContent implements ContentReader {
  concepts: ConceptDescriptor[] = [];
  edges: PrerequisiteEdge[] = [];

  async conceptsInLesson(lessonKey: string) {
    return this.concepts.filter((c) => c.lessonKey === lessonKey);
  }
  async conceptsInTextbook() {
    return this.concepts;
  }
  async prerequisitesFor(conceptKeys: readonly string[]) {
    return this.edges.filter((e) => conceptKeys.includes(e.conceptKey));
  }
  async lessonExists() {
    return true;
  }
  async lessonView() {
    return null;
  }
  async lessonShelf() {
    return [];
  }
}

class FakeMastery implements MasteryReader {
  rows = new Map<string, { effectiveMastery: number; attemptsCount: number }>();

  set(conceptKey: string, effectiveMastery: number, attemptsCount: number) {
    this.rows.set(conceptKey, { effectiveMastery, attemptsCount });
  }

  async profileFor(_learnerKey: string, conceptKeys: readonly string[]) {
    const out = new Map<
      string,
      {
        mastery: number;
        effectiveMastery: number;
        confidence: number;
        retrievability: number;
        attemptsCount: number;
      }
    >();
    for (const key of conceptKeys) {
      const row = this.rows.get(key);
      if (!row) continue;
      out.set(key, {
        mastery: row.effectiveMastery,
        effectiveMastery: row.effectiveMastery,
        confidence: 0.8,
        retrievability: 1,
        attemptsCount: row.attemptsCount,
      });
    }
    return out;
  }
}

function setup() {
  const content = new FakeContent();
  const mastery = new FakeMastery();
  content.concepts = [
    concept('SET', L1, 1),
    concept('ELEMENT', L1, 2),
    concept('UNION', L2, 1),
  ];
  return { content, mastery, service: new JourneyService(content, mastery) };
}

const LEARNER = 'lrn_demo_student';

describe('the path', () => {
  it('returns the whole book in textbook order', async () => {
    const s = setup();
    const view = await s.service.path({ learnerKey: LEARNER, textbookKey: TB });
    expect(view.ok).toBe(true);
    if (!view.ok) return;

    expect(view.value.path.map((n) => n.name)).toEqual(['SET', 'ELEMENT', 'UNION']);
  });

  it('refuses an unknown or unpublished textbook instead of reporting an empty book', async () => {
    const s = setup();
    s.content.concepts = [];

    const view = await s.service.path({ learnerKey: LEARNER, textbookKey: 'NOPE' });
    expect(view.ok).toBe(false);
    if (view.ok) return;
    expect(view.error.code).toBe('learning.textbook_not_available');
  });

  it('marks an untouched concept NOT_STARTED, not STRUGGLING', async () => {
    const s = setup();
    const view = await s.service.path({ learnerKey: LEARNER, textbookKey: TB });
    if (!view.ok) return;

    expect(view.value.path[0]?.state).toBe('NOT_STARTED');
  });

  it('locks a concept behind an unmet hard prerequisite', async () => {
    const s = setup();
    s.content.edges = [
      {
        conceptKey: `${L2}-C-UNION`,
        prerequisiteKey: `${L1}-C-SET`,
        strength: 0.9,
        requiredMastery: 0.7,
      },
    ];
    s.mastery.set(`${L2}-C-UNION`, 0.1, 4);

    const view = await s.service.path({ learnerKey: LEARNER, textbookKey: TB });
    if (!view.ok) return;

    const union = view.value.path.find((n) => n.name === 'UNION');
    // Not STRUGGLING: the learner was never allowed to reach it, and sending
    // them to remediation for a concept they could not attempt is the wrong
    // answer to the right observation.
    expect(union?.state).toBe('LOCKED');
    expect(union?.blockedBy).toEqual([`${L1}-C-SET`]);
  });

  it('does not lock a concept behind a weak (advisory) prerequisite', async () => {
    const s = setup();
    s.content.edges = [
      {
        conceptKey: `${L2}-C-UNION`,
        prerequisiteKey: `${L1}-C-SET`,
        strength: 0.3,
        requiredMastery: 0.7,
      },
    ];

    const view = await s.service.path({ learnerKey: LEARNER, textbookKey: TB });
    if (!view.ok) return;
    expect(view.value.path.find((n) => n.name === 'UNION')?.state).not.toBe('LOCKED');
  });

  it('points at the first concept that is neither mastered nor locked', async () => {
    const s = setup();
    s.mastery.set(`${L1}-C-SET`, 0.95, 6);

    const view = await s.service.path({ learnerKey: LEARNER, textbookKey: TB });
    if (!view.ok) return;
    expect(view.value.currentConceptKey).toBe(`${L1}-C-ELEMENT`);
  });

  it('reports a finished book as finished rather than as missing', async () => {
    const s = setup();
    for (const c of s.content.concepts) s.mastery.set(c.conceptKey, 0.99, 8);

    const view = await s.service.path({ learnerKey: LEARNER, textbookKey: TB });
    if (!view.ok) return;
    expect(view.value.currentConceptKey).toBeNull();
    expect(view.value.progress.overall.completion).toBe(1);
  });
});

describe('progress roll-up', () => {
  it('counts locked concepts in the denominator', async () => {
    // Excluding them would make progress fall as prerequisites unlock and new
    // work appears — the learner would be punished for advancing.
    const s = setup();
    s.content.edges = [
      {
        conceptKey: `${L2}-C-UNION`,
        prerequisiteKey: `${L1}-C-SET`,
        strength: 0.9,
        requiredMastery: 0.7,
      },
    ];

    const view = await s.service.path({ learnerKey: LEARNER, textbookKey: TB });
    if (!view.ok) return;
    expect(view.value.progress.overall.total).toBe(3);
    expect(view.value.progress.overall.locked).toBe(1);
  });

  it('rolls up by unit and by lesson', async () => {
    const s = setup();
    s.mastery.set(`${L1}-C-SET`, 0.95, 6);

    const view = await s.service.path({ learnerKey: LEARNER, textbookKey: TB });
    if (!view.ok) return;

    expect(view.value.progress.units).toHaveLength(1);
    expect(view.value.progress.lessons).toHaveLength(2);
    const basics = view.value.progress.lessons.find((l) => l.key === L1);
    expect(basics?.mastered).toBe(1);
    expect(basics?.total).toBe(2);
  });
});

describe('lesson completion', () => {
  it('is gated by the weakest concept, not the average', async () => {
    // Four mastered and one never touched must not average into a pass: that
    // gap resurfaces two lessons later as an unexplained collapse.
    const s = setup();
    s.mastery.set(`${L1}-C-SET`, 0.99, 10);
    s.mastery.set(`${L1}-C-ELEMENT`, 0.05, 3);

    const done = await s.service.lessonCompletion({ learnerKey: LEARNER, lessonKey: L1 });
    expect(done.ok).toBe(true);
    if (!done.ok) return;

    expect(done.value.result.allowedNext).toBe(false);
    expect(done.value.result.decision).toBe('REMEDIAL');
  });

  it('allows the next lesson when every concept clears its own threshold', async () => {
    const s = setup();
    s.mastery.set(`${L1}-C-SET`, 0.9, 6);
    s.mastery.set(`${L1}-C-ELEMENT`, 0.85, 6);

    const done = await s.service.lessonCompletion({ learnerKey: LEARNER, lessonKey: L1 });
    if (!done.ok) return;
    expect(done.value.result.allowedNext).toBe(true);
  });

  it('reports every concept, so the learner sees WHICH one blocked them', async () => {
    const s = setup();
    s.mastery.set(`${L1}-C-SET`, 0.99, 10);

    const done = await s.service.lessonCompletion({ learnerKey: LEARNER, lessonKey: L1 });
    if (!done.ok) return;
    expect(done.value.concepts).toHaveLength(2);
  });

  it('refuses a lesson with no published concepts', async () => {
    const s = setup();
    const done = await s.service.lessonCompletion({ learnerKey: LEARNER, lessonKey: 'NOPE' });
    expect(done.ok).toBe(false);
    if (done.ok) return;
    expect(done.error.code).toBe('learning.lesson_not_available');
  });

  it('does not treat an unattempted concept as passed', async () => {
    // evaluateCompletion gates on `attempted` before mastery; a learner with no
    // evidence at all must not fall through to "allowed".
    const s = setup();
    const done = await s.service.lessonCompletion({ learnerKey: LEARNER, lessonKey: L1 });
    if (!done.ok) return;
    expect(done.value.result.allowedNext).toBe(false);
  });
});
