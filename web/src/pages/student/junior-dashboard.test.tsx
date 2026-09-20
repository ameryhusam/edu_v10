/**
 * The junior board.
 *
 * The rules worth defending: a station never invents work (the lesson
 * station turns green when the engine says nothing is due), the treasure
 * opens the server's deck for the current concept and cannot record a
 * review, and a badge is earned exactly when the ledger's stars have paid
 * its price. XP numbers come from the Engagement summary untouched.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { useEffect, type ReactNode } from 'react';
import { I18nProvider, useI18n } from '../../shared/i18n/i18n';
import { JuniorDashboardPage } from './junior-dashboard';
import { useJourney, useLearnerTextbooks, useNextStep } from '../../education/learning/use-learning';
import { engagementApi } from '../../education/engagement/engagement.api';
import { learningApi } from '../../education/learning/learning.api';
import type { LearnerTextbook } from '../../education/learning/learning.api';
import type { XpSummary } from '../../education/engagement/engagement.api';

vi.mock('../../education/learning/use-learning', () => ({
  useLearnerTextbooks: vi.fn(),
  useJourney: vi.fn(),
  useNextStep: vi.fn(),
  useSelectedTextbook: vi.fn(() => ({ selected: 'tb_math', select: vi.fn() })),
}));

vi.mock('../../shared/auth/session', () => ({
  useSession: () => ({
    status: 'authenticated',
    user: { userKey: 'u', username: 'sara', fullName: 'سارة', roles: [], learnerKey: 'lrn_sara' },
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
    title: 'الرياضيّات',
    subjectKey: 'MATH',
    subjectName: 'الرياضيّات',
    gradeKey: 'G03',
    gradeName: 'الصف الثالث',
    termKey: '2026-2027-T01',
    termName: 'Term 1',
    academicYearKey: '2026-2027',
    edition: 'ed-1',
    totalPages: 90,
  },
];

/**
 * 550 XP at level 3 (50/400 into it) — the server says 5 stars, so the first
 * two badges (1 and 5 stars) are earned and the third (7) is not.
 */
const XP: XpSummary = {
  learnerKey: 'lrn_sara',
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

function renderPage(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <I18nProvider>
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <Arabic>
            <JuniorDashboardPage />
          </Arabic>
        </MemoryRouter>
      </QueryClientProvider>
    </I18nProvider>,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.mocked(useLearnerTextbooks).mockReturnValue({
    isPending: false,
    isError: false,
    error: null,
    data: { learnerKey: 'lrn_sara', textbooks: TEXTBOOKS },
  } as never);
  vi.mocked(useJourney).mockReturnValue({
    isPending: false,
    isError: false,
    error: null,
    data: {
      textbookKey: 'tb_math',
      progress: { overall: { completion: 0.2, mastered: 2, inProgress: 1, struggling: 0, total: 10 } },
      path: [],
      currentConceptKey: 'c-adding',
    },
    refetch: vi.fn(),
  } as never);
  vi.mocked(useNextStep).mockReturnValue({
    isPending: false,
    isError: false,
    error: null,
    data: {
      step: {
        activity: 'LEARN',
        conceptKey: 'c-adding',
        conceptName: 'الجمع',
        rule: 'no_evidence_yet',
        rationale: '',
      },
      decision: 'learn',
      progress: { completion: 0.2, mastered: 2, inProgress: 1, struggling: 0, total: 10 },
    },
    refetch: vi.fn(),
  } as never);
  vi.spyOn(engagementApi, 'xp').mockResolvedValue(XP);
});

describe('the hero capsule', () => {
  it("shows the server's level, streak and stars, never its own math", async () => {
    renderPage();

    expect(await screen.findByText('أهلًا سارة!')).toBeInTheDocument();
    // The medallion is named for assistive tech; the streak and star counts
    // sit under their unit labels.
    expect(screen.getByLabelText(/المستوى/)).toHaveTextContent('3');
    expect(screen.getByText('4')).toBeInTheDocument(); // streak days
    expect(screen.getByText('5')).toBeInTheDocument(); // stars from 550 XP
  });
});

describe('the mission board', () => {
  it("offers the engine's next step as the lesson station", async () => {
    renderPage();

    expect(await screen.findByText('مهمة الدرس')).toBeInTheDocument();
    expect(screen.getByText('الجمع')).toBeInTheDocument(); // the concept, not a key
    expect(screen.getByText('انطلق للدرس!')).toBeInTheDocument();
  });

  it('turns the lesson station green when nothing is due', async () => {
    vi.mocked(useNextStep).mockReturnValue({
      isPending: false,
      isError: false,
      error: null,
      data: { step: null, decision: 'all_done', progress: { completion: 1, mastered: 10, inProgress: 0, struggling: 0, total: 10 } },
      refetch: vi.fn(),
    } as never);
    renderPage();

    // The station keeps its name and says, in green, that nothing is due —
    // it does not invent work to stay orange.
    expect(await screen.findByText('وقت مثالي للتعلّم الحرّ!')).toBeInTheDocument();
    expect(screen.getByText('أحسنت! أنجزتها!')).toBeInTheDocument();
    expect(screen.queryByText('انطلق للدرس!')).toBeNull();
  });

  it('opens the treasure for the current concept, and flipping is all it does', async () => {
    const deck = vi
      .spyOn(learningApi, 'flashcardDeck')
      .mockResolvedValue({
        scope: { conceptKey: 'c-adding' },
        byTier: { low_mastery: 2 },
        cards: [
          { front: '٢ + ٣', back: '٥', conceptKey: 'c-adding', tier: 't2', reason: 'low_mastery' },
          { front: '٤ + ١', back: '٥', conceptKey: 'c-adding', tier: 't2', reason: 'low_mastery' },
        ],
      });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByText('افتح البطاقات!'));
    expect(deck).toHaveBeenCalledWith(expect.objectContaining({ conceptKey: 'c-adding' }));

    // The card shows its front first; flipping is a view change, never an
    // answer the server is told about.
    expect(await screen.findByText('٢ + ٣')).toBeInTheDocument();
    await user.click(screen.getByText('اقلب البطاقة'));
    expect(screen.getByText('٥')).toBeInTheDocument();
    // Still the first card: flipping and moving on are separate acts.
    expect(screen.getByText('1 من 2')).toBeInTheDocument();
  });

  it('says "answer some questions first" when there is no current concept', async () => {
    vi.mocked(useJourney).mockReturnValue({
      isPending: false,
      isError: false,
      error: null,
      data: {
        textbookKey: 'tb_math',
        progress: { overall: { completion: 0, mastered: 0, inProgress: 0, struggling: 0, total: 10 } },
        path: [],
        currentConceptKey: null,
      },
      refetch: vi.fn(),
    } as never);
    vi.mocked(useNextStep).mockReturnValue({
      isPending: false,
      isError: false,
      error: null,
      data: { step: null, decision: 'no_evidence', progress: { completion: 0, mastered: 0, inProgress: 0, struggling: 0, total: 10 } },
      refetch: vi.fn(),
    } as never);
    renderPage();

    expect(
      await screen.findByText('ابدأ خطوتك الأولى في المسار لتظهر بطاقاتك.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('افتح البطاقات!')).toBeNull();
  });
});

describe('the trophy shelf', () => {
  it("earns exactly the badges the ledger's stars have paid for", async () => {
    renderPage();

    // 5 stars: أوّل درس (1) and بطل الاختبار (5) earned; محارب الأسبوع (7) not.
    expect(await screen.findAllByText('مكتسب!')).toHaveLength(2);
    expect(screen.getByText('محارب الأسبوع')).toBeInTheDocument();
    expect(screen.getByText('7 نجمة')).toBeInTheDocument();
  });
});
