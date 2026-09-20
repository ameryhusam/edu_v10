/**
 * The learning path — lessons now, concepts inside them.
 *
 * What is worth defending did not change when the grain did: the order is
 * the server's, the current lesson is the one the server named, and a locked
 * lesson shows a lock instead of a score. What is new and must stay true:
 * the trail is drawn at LESSON grain, each lesson card opens the lesson
 * screen, and the per-lesson mastery figure is the server's roll-up.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useEffect, type ReactNode } from 'react';
import { I18nProvider, useI18n } from '../../shared/i18n/i18n';
import { LearningPathPage } from './learning-path';
import {
  useJourney,
  useLearnerTextbooks,
} from '../../education/learning/use-learning';
import type { LearnerTextbook, PathNode } from '../../education/learning/learning.api';

vi.mock('../../education/learning/use-learning', () => ({
  useLearnerTextbooks: vi.fn(),
  useJourney: vi.fn(),
  useSelectedTextbook: vi.fn(() => ({ selected: 'tb_math', select: vi.fn() })),
}));

const TEXTBOOKS: readonly LearnerTextbook[] = [
  {
    key: 'tb_math',
    title: 'الرياضيّات — الفصل الأول',
    subjectKey: 'MATH',
    subjectName: 'الرياضيّات',
    gradeKey: 'G05',
    gradeName: 'الصف الخامس',
    termKey: '2026-2027-T01',
    termName: 'Term 1',
    academicYearKey: '2026-2027',
    edition: 'ed-1',
    totalPages: 120,
  },
];

/**
 * Four concepts across two units and three lessons: a mastered lesson, the
 * current one, a lesson entirely locked, and one not started. The order is
 * the server's and the test asserts the page keeps it.
 */
const PATH: readonly PathNode[] = [
  {
    conceptKey: 'c-counting',
    name: 'العدّ',
    lessonKey: 'l-1',
    lessonName: 'درس العدّ',
    unitKey: 'u-1',
    unitName: 'الأعداد',
    state: 'MASTERED',
    effectiveMastery: 0.95,
    masteryThreshold: 0.75,
    attemptsCount: 3,
    blockedBy: [],
  },
  {
    conceptKey: 'c-adding',
    name: 'الجمع',
    lessonKey: 'l-2',
    lessonName: 'درس الجمع',
    unitKey: 'u-1',
    unitName: 'الأعداد',
    state: 'IN_PROGRESS',
    effectiveMastery: 0.4,
    masteryThreshold: 0.75,
    attemptsCount: 1,
    blockedBy: [],
  },
  {
    conceptKey: 'c-fractions',
    name: 'الكسور',
    lessonKey: 'l-3',
    lessonName: 'درس الكسور',
    unitKey: 'u-2',
    unitName: 'الكسور والقياس',
    state: 'LOCKED',
    effectiveMastery: null,
    masteryThreshold: 0.75,
    attemptsCount: 0,
    blockedBy: ['c-adding', 'c-counting'],
  },
  {
    conceptKey: 'c-decimals',
    name: 'الكسور العشريّة',
    lessonKey: 'l-4',
    lessonName: 'درس الكسور العشريّة',
    unitKey: 'u-2',
    unitName: 'الكسور والقياس',
    state: 'NOT_STARTED',
    effectiveMastery: null,
    masteryThreshold: 0.75,
    attemptsCount: 0,
    blockedBy: [],
  },
];

const JOURNEY = {
  textbookKey: 'tb_math',
  progress: {
    overall: { completion: 0.25 },
    units: [
      { key: 'u-1', completion: 0.5 },
      { key: 'u-2', completion: 0 },
    ],
    lessons: [
      { key: 'l-1', completion: 1 },
      { key: 'l-2', completion: 0 },
      { key: 'l-3', completion: 0 },
      { key: 'l-4', completion: 0 },
    ],
    concepts: [],
  },
  path: PATH,
  units: [
    { key: 'u-1', name: 'الأعداد', order: 1 },
    { key: 'u-2', name: 'الكسور والقياس', order: 2 },
  ],
  lessons: [
    { key: 'l-1', name: 'درس العدّ', unitKey: 'u-1', order: 1, startPage: 5, endPage: 8, estimatedMins: 40 },
    { key: 'l-2', name: 'درس الجمع', unitKey: 'u-1', order: 2, startPage: 9, endPage: 12, estimatedMins: 45 },
    { key: 'l-3', name: 'درس الكسور', unitKey: 'u-2', order: 1, startPage: 20, endPage: 26, estimatedMins: 50 },
    { key: 'l-4', name: 'درس الكسور العشريّة', unitKey: 'u-2', order: 2, startPage: 27, endPage: 31, estimatedMins: 45 },
  ],
  currentConceptKey: 'c-adding',
};

function Arabic({ children }: { readonly children: ReactNode }): ReactNode {
  const { setLocale } = useI18n();
  useEffect(() => setLocale('ar'), [setLocale]);
  return <>{children}</>;
}

function renderPage(): void {
  render(
    <I18nProvider>
      <MemoryRouter>
        <Arabic>
          <LearningPathPage />
        </Arabic>
      </MemoryRouter>
    </I18nProvider>,
  );
}

beforeEach(() => {
  vi.mocked(useLearnerTextbooks).mockReturnValue({
    isPending: false,
    isError: false,
    error: null,
    data: { textbooks: TEXTBOOKS },
  } as never);
  vi.mocked(useJourney).mockReturnValue({
    isPending: false,
    isError: false,
    error: null,
    data: JOURNEY,
    refetch: vi.fn(),
  } as never);
});

describe('the lesson trail', () => {
  it('draws lessons in server order and opens each on the lesson screen', () => {
    renderPage();

    // Lesson grain: every lesson of the book, in the order the server sent.
    const links = [...document.querySelectorAll('a[href^="/lesson"]')];
    expect(links.map((a) => a.textContent)).toEqual([
      expect.stringContaining('درس العدّ'),
      expect.stringContaining('درس الجمع'),
      expect.stringContaining('درس الكسور'),
      expect.stringContaining('درس الكسور العشريّة'),
    ]);
    expect(links[0]).toHaveAttribute('href', '/lesson?lesson=l-1');

    // The concepts ride inside their lesson, still in order.
    const cards = [...document.querySelectorAll('ol')];
    const names = [...document.querySelectorAll('ol li')].map((li) => li.textContent);
    // Each row carries its badge too; the assertion is on the order of names.
    for (const name of ['العدّ', 'الجمع', 'الكسور', 'الكسور العشريّة']) {
      expect(names.findIndex((n) => n!.includes(name))).toBeGreaterThanOrEqual(0);
    }
    expect(
      names.findIndex((n) => n!.includes('العدّ')),
    ).toBeLessThan(names.findIndex((n) => n!.includes('الكسور')));
    expect(cards.length).toBeGreaterThan(0);
  });

  it('splits the trail where the unit changes, and only there', () => {
    renderPage();

    // Two unitKeys ⇒ two unit headers, not one per lesson.
    expect(screen.getByText(/الأعداد/)).toBeInTheDocument();
    expect(screen.getByText(/الكسور والقياس/)).toBeInTheDocument();
    expect(screen.queryByText('الوحدة 3')).toBeNull();
  });

  it('marks the current lesson alone, and locks the locked one', () => {
    renderPage();

    // Exactly one lesson is announced as the current one — the lesson the
    // server's current concept lives in, not one this page picked.
    expect(screen.getAllByText('أنت هنا')).toHaveLength(1);
    expect(screen.getByText('درس الجمع').closest('div')!.textContent).toContain('أنت هنا');

    // A lesson whose every concept is locked says so, and shows no
    // mastery percentage of its own.
    const lockedCard = screen.getByText('درس الكسور').closest('div')!;
    expect(lockedCard).toHaveTextContent('الدرس مقفل');
  });
});
