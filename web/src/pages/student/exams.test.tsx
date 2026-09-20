/**
 * My exams, and the runner that takes them.
 *
 * The rules worth defending: the page lists only the exams the catalogue
 * returned (never a local recomputation of entitlement), the runner shows the
 * question the engine served and sends the choice the learner made — nothing
 * more — and the score is read from the server's submit result. A wrong
 * verdict rendered locally would be two graders with one pencil.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { useEffect, type ReactNode } from 'react';
import { I18nProvider, useI18n } from '../../shared/i18n/i18n';
import { ExamsPage } from './exams';
import { attemptApi, type LearnerExam, type NextItem } from '../../education/assessment/attempt.api';
import { assessmentApi } from '../../education/assessment/assessment.api';

vi.mock('../../education/assessment/attempt.api', () => ({
  attemptApi: {
    exams: vi.fn(),
    start: vi.fn(),
    nextItem: vi.fn(),
    answer: vi.fn(),
    submit: vi.fn(),
  },
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

const EXAM: LearnerExam = {
  key: 'EXAM-MATH-G07-SETS-01',
  title: 'اختبار قصير: المجموعات',
  description: 'أسئلة تكيّفيّة على الوحدة الأولى.',
  isAdaptive: true,
  timeLimitMins: 10,
  passingScore: 0.5,
  textbookKey: 'EDU-MATH-G07-T1-ED2026',
  itemCount: 3,
  conceptKeys: ['C-SET', 'C-MEMBERSHIP', 'C-SUBSET'],
};

const QUESTION: NextItem = {
  finished: false,
  reason: 'CONTINUE',
  theta: 0,
  standardError: 1,
  itemsAdministered: 0,
  question: {
    key: 'Q-1',
    text: 'إذا كانت أ = {1, 2, 3} فهل 2 ∈ أ؟',
    type: 'MCQ_SINGLE',
    points: 1,
    choices: [
      { id: 'c1', text: 'نعم', orderIndex: 1 },
      { id: 'c2', text: 'لا', orderIndex: 2 },
    ],
  },
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
            <ExamsPage />
          </Arabic>
        </MemoryRouter>
      </QueryClientProvider>
    </I18nProvider>,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(attemptApi, 'exams').mockResolvedValue({ exams: [EXAM] });
  vi.spyOn(assessmentApi, 'history').mockResolvedValue({ attempts: [] });
});

describe('the catalogue', () => {
  it('lists the exam with the server\'s own meta', async () => {
    renderPage();

    expect(await screen.findByText('اختبار قصير: المجموعات')).toBeInTheDocument();
    expect(screen.getByText('تكيّفيّ')).toBeInTheDocument();
    expect(screen.getByText('10 دقيقة')).toBeInTheDocument();
    expect(screen.getByText('يقيس 3 مفاهيم')).toBeInTheDocument();
  });

  it('says so plainly when the catalogue is empty', async () => {
    vi.spyOn(attemptApi, 'exams').mockResolvedValue({ exams: [] });
    renderPage();

    expect(await screen.findByText('لا اختبارات متاحة بعد')).toBeInTheDocument();
  });
});

describe('the runner', () => {
  it('shows the engine\'s question, sends the choice, and reads the verdict back', async () => {
    const start = vi.spyOn(attemptApi, 'start').mockResolvedValue({
      attempt: { key: 'att_1' },
      resumed: false,
    });
    const nextItem = vi
      .spyOn(attemptApi, 'nextItem')
      .mockResolvedValueOnce(QUESTION)
      .mockResolvedValueOnce({
        finished: true,
        reason: 'PRECISION_REACHED',
        theta: 0.4,
        standardError: 0.29,
        itemsAdministered: 1,
        question: null,
      });
    const answer = vi
      .spyOn(attemptApi, 'answer')
      .mockResolvedValue({ feedback: { verdict: 'CORRECT', explanation: null, misconceptionKey: null } });
    vi.spyOn(attemptApi, 'submit').mockResolvedValue({
      totals: {
        score: 1,
        maxScore: 1,
        percentage: 1,
        answeredCount: 1,
        correctCount: 1,
        incorrectCount: 0,
        partiallyCorrectCount: 0,
        pendingReviewCount: 0,
      },
    });

    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByText('ابدأ الاختبار'));
    await user.click(await screen.findByText('ابدأ الاختبار')); // the runner's own start

    // The engine was asked with the scope the server attached to the exam —
    // unchanged, not recomputed.
    expect(start).toHaveBeenCalledWith({ kind: 'EXAM', examKey: EXAM.key });

    const questionText = await screen.findByText('إذا كانت أ = {1, 2, 3} فهل 2 ∈ أ؟');
    expect(questionText).toBeInTheDocument();

    await user.click(screen.getByText('نعم'));
    await user.click(screen.getByRole('button', { name: 'أجب' }));

    // The choice went to the server; the verdict came back from it.
    expect(answer).toHaveBeenCalledWith({
      attemptKey: 'att_1',
      questionKey: 'Q-1',
      choiceIds: ['c1'],
    });
    expect(await screen.findByText('إجابة صحيحة')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'التالي' }));

    // The engine stopped; closing is one deliberate click, then the totals.
    expect(await screen.findByText('انتهى الاختبار')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'أظهر النتيجة' }));

    expect(await screen.findByText('نتيجتك')).toBeInTheDocument();
    expect(screen.getByText('1 / 1')).toBeInTheDocument();
    expect(nextItem).toHaveBeenCalledTimes(2);
  });

  it('does not grade locally: an unanswered question cannot be submitted', async () => {
    vi.spyOn(attemptApi, 'start').mockResolvedValue({ attempt: { key: 'att_2' }, resumed: false });
    vi.spyOn(attemptApi, 'nextItem').mockResolvedValue(QUESTION);
    const answer = vi.spyOn(attemptApi, 'answer');

    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByText('ابدأ الاختبار'));
    await user.click(await screen.findByText('ابدأ الاختبار'));

    await screen.findByText('إذا كانت أ = {1, 2, 3} فهل 2 ∈ أ؟');
    // No choice picked: the answer button stays inert, and nothing was sent.
    expect(screen.getByRole('button', { name: 'أجب' })).toBeDisabled();
    expect(answer).not.toHaveBeenCalled();
  });
});
