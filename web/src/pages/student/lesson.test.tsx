/**
 * The lesson screen — the reading, the options, the gate.
 *
 * The contract under test is the Yemeni textbook's own order of a lesson:
 * the text first, then the author's extra options, then questions that pass
 * the lesson. And the rule underneath: passing is the server's completion
 * gate reading graded evidence — this page never declares a lesson passed.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { useEffect, type ReactNode } from 'react';
import { I18nProvider, useI18n } from '../../shared/i18n/i18n';
import { LessonPage } from './lesson';
import { useJourney, useLesson } from '../../education/learning/use-learning';
import { ExamRunner } from '../../education/assessment/exam-runner';
import type { LessonDetailView, PathNode } from '../../education/learning/learning.api';

vi.mock('../../education/learning/use-learning', () => ({
  useLesson: vi.fn(),
  useJourney: vi.fn(),
}));

vi.mock('../../education/assessment/exam-runner', () => ({
  ExamRunner: vi.fn(() => <div data-testid="exam-runner-stub" />),
}));

vi.mock('../../education/junior/treasure-deck', () => ({
  TreasureDeck: vi.fn(() => <div data-testid="treasure-stub" />),
}));

const NODE = (key: string, name: string, state: PathNode['state']): PathNode => ({
  conceptKey: key,
  name,
  lessonKey: 'l-1',
  lessonName: 'درس الجزيء والذرة',
  unitKey: 'u-1',
  unitName: 'تركيب المادة',
  state,
  effectiveMastery: state === 'MASTERED' ? 0.9 : state === 'IN_PROGRESS' ? 0.4 : null,
  masteryThreshold: 0.75,
  attemptsCount: state === 'MASTERED' ? 2 : 0,
  blockedBy: [],
});

const CLOSED: LessonDetailView = {
  lesson: {
    key: 'l-1',
    name: 'درس الجزيء والذرة',
    startPage: 8,
    endPage: 11,
    estimatedMins: 45,
    unitKey: 'u-1',
    unitName: 'تركيب المادة',
    textbookKey: 'tb_sci',
    textbookTitle: 'العلوم — الصف السابع',
  },
  resources: [
    {
      key: 'res-1',
      kind: 'READING',
      title: 'درس الجزيء والذرة',
      body: 'كل ما يشغل حيزًا من الفراغ وله كتلة يُسمى مادة.',
      url: null,
      orderIndex: 1,
      estimatedMins: 45,
    },
    {
      key: 'res-2',
      kind: 'WORKED_EXAMPLE',
      title: 'مثال: من المادة إلى الذرة',
      body: 'قطرة ماء ← جزيئات ← ذرات.',
      url: null,
      orderIndex: 2,
      estimatedMins: 10,
    },
  ],
  concepts: [NODE('c-1', 'المادة', 'NOT_STARTED'), NODE('c-2', 'الجزيء', 'LOCKED')],
  progress: { key: 'l-1', total: 2, mastered: 0, inProgress: 0, struggling: 0, locked: 1, notStarted: 1, completion: 0, averageMastery: 0 },
  completion: {
    lessonKey: 'l-1',
    result: {
      decision: 'REVIEW',
      gate: 'NOT_ATTEMPTED',
      allowedNext: false,
      threshold: 0.75,
      mastery: 0,
      masteryDeficit: 0.75,
    },
  },
  currentConceptKey: 'c-1',
};

const OPEN: LessonDetailView = {
  ...CLOSED,
  concepts: [NODE('c-1', 'المادة', 'MASTERED'), NODE('c-2', 'الجزيء', 'MASTERED')],
  progress: { key: 'l-1', total: 2, mastered: 2, inProgress: 0, struggling: 0, locked: 0, notStarted: 0, completion: 1, averageMastery: 0.9 },
  completion: {
    lessonKey: 'l-1',
    result: {
      decision: 'ADVANCE',
      gate: 'SATISFIED',
      allowedNext: true,
      threshold: 0.75,
      mastery: 0.9,
      masteryDeficit: 0,
    },
  },
};

const JOURNEY = {
  textbookKey: 'tb_sci',
  progress: { overall: { completion: 0 }, units: [], lessons: [], concepts: [] },
  path: [],
  units: [{ key: 'u-1', name: 'تركيب المادة', order: 1 }],
  lessons: [
    { key: 'l-1', name: 'درس الجزيء والذرة', unitKey: 'u-1', order: 1, startPage: 8, endPage: 11, estimatedMins: 45 },
    { key: 'l-2', name: 'درس العناصر', unitKey: 'u-1', order: 2, startPage: 12, endPage: 19, estimatedMins: 45 },
  ],
  currentConceptKey: 'c-1',
};

function Arabic({ children }: { readonly children: ReactNode }): ReactNode {
  const { setLocale } = useI18n();
  useEffect(() => setLocale('ar'), [setLocale]);
  return <>{children}</>;
}

function renderAt(lessonKey: string | null): void {
  render(
    <I18nProvider>
      <MemoryRouter initialEntries={[lessonKey ? `/lesson?lesson=${lessonKey}` : '/lesson']}>
        <Arabic>
          <LessonPage />
        </Arabic>
      </MemoryRouter>
    </I18nProvider>,
  );
}

beforeEach(() => {
  vi.mocked(useJourney).mockReturnValue({
    isPending: false,
    isError: false,
    error: null,
    data: JOURNEY,
    refetch: vi.fn(),
  } as never);
});

describe('the lesson screen', () => {
  it('shows the reading first, then the author\u2019s options, then the concepts', () => {
    vi.mocked(useLesson).mockReturnValue({
      isPending: false,
      isError: false,
      error: null,
      data: CLOSED,
      refetch: vi.fn(),
    } as never);
    renderAt('l-1');

    expect(screen.getByText('كل ما يشغل حيزًا من الفراغ وله كتلة يُسمى مادة.')).toBeInTheDocument();
    expect(screen.getByText('مثال: من المادة إلى الذرة')).toBeInTheDocument();
    expect(screen.getByText('المادة')).toBeInTheDocument();
    expect(screen.getByText('الجزيء')).toBeInTheDocument();
  });

  it('keeps the gate shut and offers the check when the server says not passed', async () => {
    vi.mocked(useLesson).mockReturnValue({
      isPending: false,
      isError: false,
      error: null,
      data: CLOSED,
      refetch: vi.fn(),
    } as never);
    const user = userEvent.setup();
    renderAt('l-1');

    // The gate's own words: answer the questions to move on. No "next lesson".
    expect(screen.getByText(/أجب عن أسئلة التقويم/)).toBeInTheDocument();
    expect(screen.queryByText(/الدرس التالي/)).toBeNull();

    await user.click(screen.getByText('ابدأ تقويم الدرس'));
    const props = vi.mocked(ExamRunner).mock.calls[0]![0] as {
      exam: { lessonKey?: string; conceptKeys?: readonly string[] };
    };
    expect(props.exam.lessonKey).toBe('l-1');
    expect(props.exam.conceptKeys).toEqual(['c-1', 'c-2']);
  });

  it('opens the next lesson when the server\u2019s gate says allowed', () => {
    vi.mocked(useLesson).mockReturnValue({
      isPending: false,
      isError: false,
      error: null,
      data: OPEN,
      refetch: vi.fn(),
    } as never);
    renderAt('l-1');

    expect(screen.getByText(/أتقنت مفاهيم هذا الدرس/)).toBeInTheDocument();
    expect(screen.getByText(/درس العناصر/)).toBeInTheDocument();
  });

  it('says which lesson is missing when none is named', () => {
    vi.mocked(useLesson).mockReturnValue({
      isPending: false,
      isError: false,
      error: null,
      data: CLOSED,
      refetch: vi.fn(),
    } as never);
    renderAt(null);

    expect(screen.getByText('لم يُحدَّد درس')).toBeInTheDocument();
  });
});
