/**
 * The three student shelf pages: subjects, review, progress.
 *
 * What is worth defending is the same rule on all three: the page shows what
 * the server sent. Subjects groups an entitlement list without reordering it,
 * review filters the journey's own states without re-grading them, and
 * progress reads the roll-ups and the ledger without multiplying anything.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { useEffect, type ReactNode } from 'react';
import { I18nProvider, useI18n } from '../../shared/i18n/i18n';
import { SubjectsPage } from './subjects';
import { ReviewPage } from './review';
import { ProgressPage } from './progress';
import { useJourney, useLearnerTextbooks } from '../../education/learning/use-learning';
import { assessmentApi } from '../../education/assessment/assessment.api';
import { engagementApi } from '../../education/engagement/engagement.api';
import { learningApi } from '../../education/learning/learning.api';
import type { LearnerTextbook, PathNode } from '../../education/learning/learning.api';
import type { XpSummary } from '../../education/engagement/engagement.api';

vi.mock('../../education/learning/use-learning', () => ({
  useLearnerTextbooks: vi.fn(),
  useJourney: vi.fn(),
  useSelectedTextbook: vi.fn(() => ({ selected: 'tb_math', select: vi.fn() })),
  useSubjects: vi.fn(),
  useLesson: vi.fn(),
}));

vi.mock('../../shared/auth/session', () => ({
  useSession: () => ({
    status: 'authenticated',
    user: { userKey: 'u', username: 'student', fullName: 'طالب', roles: [], learnerKey: 'lrn_x' },
    hasRole: () => false,
    signIn: vi.fn(),
    adoptSession: vi.fn(),
    signOut: vi.fn(),
    schoolIds: [],
  }),
}));

const TEXTBOOKS: readonly LearnerTextbook[] = [
  {
    key: 'tb_math',
    title: 'الرياضيّات — الفصل الأول',
    subjectKey: 'MATH',
    subjectName: 'الرياضيّات',
    gradeKey: 'G07',
    gradeName: 'الصف السابع',
    termKey: '2026-2027-T01',
    termName: 'Term 1',
    academicYearKey: '2026-2027',
    edition: 'ed-1',
    totalPages: 120,
  },
  {
    key: 'tb_science',
    title: 'العلوم — الفصل الأول',
    subjectKey: 'SCI',
    subjectName: 'العلوم',
    gradeKey: 'G07',
    gradeName: 'الصف السابع',
    termKey: '2026-2027-T01',
    termName: 'Term 1',
    academicYearKey: '2026-2027',
    edition: 'ed-1',
    totalPages: 100,
  },
];

const NODE = (key: string, name: string, state: PathNode['state'], mastery: number | null): PathNode => ({
  conceptKey: key,
  name,
  lessonKey: 'l-1',
  lessonName: 'المجموعة والعنصر',
  unitKey: 'u-1',
  unitName: 'المجموعات والعلاقات',
  state,
  effectiveMastery: mastery,
  masteryThreshold: 0.75,
  attemptsCount: 2,
  blockedBy: [],
});

/** A journey with one concept in every state the page must distinguish. */
const JOURNEY = {
  textbookKey: 'tb_math',
  progress: {
    overall: { completion: 0.4, mastered: 1, inProgress: 1, struggling: 1, total: 4 },
    units: [{ key: 'u-1', completion: 0.4, mastered: 1, total: 4 }],
    lessons: [{ key: 'l-1', completion: 0.4, mastered: 1, total: 4 }],
    concepts: [],
  },
  units: [{ key: 'u-1', name: 'المجموعات والعلاقات', order: 1 }],
  lessons: [
    { key: 'l-1', name: 'المجموعة والعنصر', unitKey: 'u-1', order: 1, startPage: 9, endPage: 12, estimatedMins: 45 },
  ],
  path: [
    NODE('c-1', 'المفهوم المتقَن', 'MASTERED', 0.9),
    NODE('c-2', 'المفهوم الجاري', 'IN_PROGRESS', 0.4),
    NODE('c-3', 'المفهوم المتعثّر', 'STRUGGLING', 0.2),
    NODE('c-4', 'المفهوم المقفل', 'LOCKED', null),
  ],
  currentConceptKey: 'c-2',
};

const XP: XpSummary = {
  learnerKey: 'lrn_x',
  totalXp: 550,
  level: 3,
  intoLevel: 50,
  toNextLevel: 150,
  levelCompletion: 0.125,
  stars: 5,
  currentStreak: 4,
  recent: [],
};

function Arabic({ children }: { readonly children: ReactNode }): ReactNode {
  const { setLocale } = useI18n();
  useEffect(() => setLocale('ar'), [setLocale]);
  return <>{children}</>;
}

function renderPage(node: ReactNode): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <I18nProvider>
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <Arabic>{node}</Arabic>
        </MemoryRouter>
      </QueryClientProvider>
    </I18nProvider>,
  );
}

beforeEach(async () => {
  vi.mocked(useLearnerTextbooks).mockReturnValue({
    isPending: false,
    isError: false,
    error: null,
    data: { learnerKey: 'lrn_x', textbooks: TEXTBOOKS },
  } as never);
  vi.mocked(useJourney).mockReturnValue({
    isPending: false,
    isError: false,
    error: null,
    data: JOURNEY,
    refetch: vi.fn(),
  } as never);
  vi.spyOn(assessmentApi, 'history').mockResolvedValue({ attempts: [] });
  vi.spyOn(engagementApi, 'xp').mockResolvedValue(XP);
  const { useSubjects } = await import('../../education/learning/use-learning');
  vi.mocked(useSubjects).mockReturnValue({
    isPending: false,
    isError: false,
    error: null,
    data: {
      subjects: [
        {
          subjectKey: 'MATH',
          subjectName: 'الرياضيّات',
          total: 4,
          mastered: 1,
          completion: 0.25,
          textbooks: [
            { key: 'tb_math', title: 'الرياضيّات — الفصل الأول', total: 4, mastered: 1, completion: 0.25 },
          ],
        },
        {
          subjectKey: 'SCI',
          subjectName: 'العلوم',
          total: 2,
          mastered: 2,
          completion: 1,
          textbooks: [
            { key: 'tb_science', title: 'العلوم — الفصل الأول', total: 2, mastered: 2, completion: 1 },
          ],
        },
      ],
    },
  } as never);
});

describe('subjects', () => {
  it('shelves the entitlement by subject, each book linking to its path', async () => {
    renderPage(<SubjectsPage />);

    expect(await screen.findByText('الرياضيّات')).toBeInTheDocument();
    expect(screen.getByText('العلوم')).toBeInTheDocument();
    // Two subjects, one book each — the count appears on both shelves.
    expect(screen.getAllByText('1 كتاب')).toHaveLength(2);
    // The subject's own mastery, as the server rolled it up: 1 of 4 for
    // maths, 2 of 2 for science.
    expect(screen.getByText('إتقان المادة: 1 من 4 مفهومًا')).toBeInTheDocument();
    expect(screen.getByText('إتقان المادة: 2 من 2 مفهومًا')).toBeInTheDocument();

    const math = screen.getByText('الرياضيّات — الفصل الأول').closest('a')!;
    expect(math).toHaveAttribute('href', '/path?textbook=tb_math');
  });
});

describe('review', () => {
  it('lists the open and struggling concepts, and only those', async () => {
    renderPage(<ReviewPage />);

    expect((await screen.findAllByText('المفهوم الجاري')).length).toBeGreaterThan(0);
    expect(screen.getByText('المفهوم المتعثّر')).toBeInTheDocument();
    // Mastered is not review work; locked is not offered.
    expect(screen.queryByText('المفهوم المتقَن')).toBeNull();
    expect(screen.queryByText('المفهوم المقفل')).toBeNull();

    // The treasure hangs off the CURRENT concept: once as the review row,
    // once as the deck card's subject line.
    expect(screen.getAllByText('المفهوم الجاري')).toHaveLength(2);
  });

  it('opens the deck for the current concept on demand', async () => {
    const deck = vi.spyOn(learningApi, 'flashcardDeck').mockResolvedValue({
        scope: { conceptKey: 'c-2' },
        byTier: {},
        cards: [{ front: '٢ + ٣', back: '٥', conceptKey: 'c-2', tier: 't2', reason: 'low_mastery' }],
      });
    const user = userEvent.setup();
    renderPage(<ReviewPage />);

    await user.click(await screen.findByText('افتح البطاقات!'));
    expect(deck).toHaveBeenCalledWith(expect.objectContaining({ conceptKey: 'c-2' }));
    expect(await screen.findByText('٢ + ٣')).toBeInTheDocument();
  });
});

describe('progress', () => {
  it('reads the ledger and the roll-ups without doing its own math', async () => {
    renderPage(<ProgressPage />);

    // The ledger's own numbers: 550 XP at level 3, 4-day streak, 5 stars.
    expect(await screen.findByText('550')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getAllByText('4').length).toBeGreaterThan(0);
    expect(screen.getByText('5')).toBeInTheDocument();

    // One card per book from the entitlement.
    expect(screen.getByText('الرياضيّات — الفصل الأول')).toBeInTheDocument();
    expect(screen.getByText('العلوم — الفصل الأول')).toBeInTheDocument();
  });
});
