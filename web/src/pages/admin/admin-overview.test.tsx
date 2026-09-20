/**
 * The administrator's landing screen.
 *
 * These test the judgements the screen makes, not its markup: which figures
 * count as problems, that an absent status still renders a number, and that
 * collections nobody should hand-edit are reported without being offered as
 * editable.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { useEffect, type ReactNode } from 'react';
import { I18nProvider, useI18n } from '../../shared/i18n/i18n';
import { AdminOverviewPage } from './admin-overview';
import { administrationApi, type AdminOverview } from '../../features/administration/administration.api';

function zeroAttention(): AdminOverview['attention'] {
  return {
    unlinkedQuestions: 0,
    suspendedUsers: 0,
    draftTextbooks: 0,
    inactiveSchools: 0,
    inactiveSubjects: 0,
    inactiveGrades: 0,
    learnersWithoutEnrollment: 0,
    unscopedTeacherGrants: 0,
  };
}

function overview(patch: Partial<AdminOverview> = {}): AdminOverview {
  return {
    collections: [
      { collection: 'users', total: 9 },
      { collection: 'questions', total: 113 },
      { collection: 'attempts', total: 0 },
    ],
    currentAcademicYear: null,
    usersByStatus: [{ status: 'ACTIVE', total: 9 }],
    textbooksByStatus: [{ status: 'DRAFT', total: 1 }],
    attention: {
      unlinkedQuestions: 0,
      suspendedUsers: 0,
      draftTextbooks: 0,
      inactiveSchools: 0,
      inactiveSubjects: 0,
      inactiveGrades: 0,
      learnersWithoutEnrollment: 0,
      unscopedTeacherGrants: 0,
    },
    ...patch,
  };
}

function English({ children }: { readonly children: ReactNode }): ReactNode {
  const { setLocale } = useI18n();
  useEffect(() => setLocale('en'), [setLocale]);
  return <>{children}</>;
}

function renderPage(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <I18nProvider>
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <English>
            <AdminOverviewPage />
          </English>
        </MemoryRouter>
      </QueryClientProvider>
    </I18nProvider>,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  // The activity feed renders beside the overview; its data is not under test
  // here, so it resolves empty rather than firing a request.
  vi.spyOn(administrationApi, 'activity').mockResolvedValue([]);
});

describe('the foundation banner', () => {
  it('opens the board with the current academic year', async () => {
    vi.spyOn(administrationApi, 'overview').mockResolvedValue(
      overview({
        currentAcademicYear: {
          key: '2026-2027',
          startsOn: '2026-08-01T00:00:00.000Z',
          endsOn: '2027-06-30T00:00:00.000Z',
          termCount: 3,
        },
      }),
    );
    renderPage();

    expect(await screen.findByText(/Master academic foundation/i)).toBeInTheDocument();
    // The year key, the calendar, and the term count — one sentence.
    expect(screen.getByText(/2026-2027/)).toBeInTheDocument();
    expect(screen.getByText(/3 terms/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /manage the foundation/i })).toHaveAttribute(
      'href',
      '/admin/structure',
    );
  });

  it('names a missing current year as the first job, not as a fault', async () => {
    vi.spyOn(administrationApi, 'overview').mockResolvedValue(overview());
    renderPage();

    expect(await screen.findByText(/no active academic year/i)).toBeInTheDocument();
    expect(screen.getByText(/define the year and its terms/i)).toBeInTheDocument();
  });
});

describe('the task map', () => {
  it('lists the six jobs in dependency order, each linking to its surface', async () => {
    vi.spyOn(administrationApi, 'overview').mockResolvedValue(overview());
    renderPage();

    const map = (await screen.findByText(/administration tasks/i)).closest('section')!;
    // Foundation first, enrolments last: enroling into a year that does not
    // exist is the classic fresh-install mistake.
    const titles = [...map.querySelectorAll('span')].map((s) => s.textContent);
    expect(titles.indexOf('Academic foundation')).toBeLessThan(titles.indexOf('Enrolments'));

    for (const destination of [
      '/admin/structure',
      '/admin/schools',
      '/admin/textbooks',
      '/admin/users',
      '/admin/teachers',
      '/admin/enrollments',
    ]) {
      expect(map.querySelector(`a[href="${destination}"]`)).not.toBeNull();
    }
  });
});

describe('the overview', () => {
  it('says so plainly when nothing needs attention', async () => {
    vi.spyOn(administrationApi, 'overview').mockResolvedValue(overview());
    renderPage();

    // An empty alerts area with no words reads as a broken panel.
    expect(await screen.findByText(/nothing needs attention/i)).toBeInTheDocument();
  });

  it('raises unlinked questions, because they fail silently', async () => {
    vi.spyOn(administrationApi, 'overview').mockResolvedValue(
      overview({
        attention: {
          ...zeroAttention(),
          unlinkedQuestions: 12,
        },
      }),
    );
    renderPage();

    expect(await screen.findByText(/questions with no concept/i)).toBeInTheDocument();
    // The consequence, not just the count: stored but unusable in an exam.
    expect(screen.getByText(/cannot be published/i)).toBeInTheDocument();
  });

  it('routes inactive schools to the schools screen', async () => {
    vi.spyOn(administrationApi, 'overview').mockResolvedValue(
      overview({ attention: { ...zeroAttention(), inactiveSchools: 2 } }),
    );
    renderPage();

    const card = await screen.findByText(/inactive schools/i);
    // The consequence is written next to the count, not just the number.
    expect(screen.getByText(/no new enrolments/i)).toBeInTheDocument();
    expect(card.closest('a')).toHaveAttribute('href', '/admin/schools');
  });

  it('reports history without offering to edit it', async () => {
    vi.spyOn(administrationApi, 'overview').mockResolvedValue(overview());
    renderPage();

    // Attempts are a record of what happened. An administrator editing them is
    // not administration, so the tile exists but is not a link.
    const attempts = await screen.findByText('Attempts');
    expect(attempts.closest('a')).toBeNull();

    // Users are editable, so that tile is a link. The KPI row above also says
    // "Users" now (the «Nebula» stat cards), so the records tiles are
    // distinguished by their count, which only they render.
    const usersTiles = await screen.findAllByText('Users');
    const usersTile = usersTiles.find((el) => el.textContent === 'Users' && el.closest('a'));
    expect(usersTile?.closest('a')).toHaveAttribute('href', '/admin/users');
  });
});
