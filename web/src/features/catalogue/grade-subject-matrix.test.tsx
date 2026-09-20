/**
 * The curriculum matrix — the legacy studio's algorithm, defended.
 *
 * The rules worth testing are the ones the port promised: a toggle is a
 * pending override and nothing else, the save is one batch and only of the
 * touched cells, fill is a preview the administrator confirms before any
 * write, and the policy stays a hint (the dot) until someone acts.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, type ReactNode } from 'react';
import { I18nProvider, useI18n } from '../../shared/i18n/i18n';
import { GradeSubjectMatrix } from './grade-subject-matrix';
import { catalogueApi as administrationApi, type GradeSubjectMatrix as MatrixData } from './catalogue.api';

const MATRIX: MatrixData = {
  grades: [
    { key: 'G07', ordinal: 7, name: 'Grade 7', stage: 'preparatory', isActive: true },
    { key: 'G10', ordinal: 10, name: 'Grade 10', stage: 'secondary', isActive: true },
  ],
  subjects: [
    {
      key: 'MATH',
      name: 'Mathematics',
      isActive: true,
      standardGradeLevels: [7, 10],
    },
    {
      key: 'ART',
      name: 'Art',
      isActive: true,
      standardGradeLevels: [],
    },
  ],
  // Maths offered in G10 only; the G07 policy cell has no row yet.
  rows: [{ gradeKey: 'G10', subjectKey: 'MATH', isActive: true }],
};

function English({ children }: { readonly children: ReactNode }): ReactNode {
  const { setLocale } = useI18n();
  useEffect(() => setLocale('en'), [setLocale]);
  return <>{children}</>;
}

function renderMatrix(canWrite = true): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <I18nProvider>
      <QueryClientProvider client={client}>
        <English>
          <GradeSubjectMatrix canWrite={canWrite} />
        </English>
      </QueryClientProvider>
    </I18nProvider>,
  );
}

const get = vi.fn();
const save = vi.fn();
const fill = vi.fn();

beforeEach(() => {
  vi.restoreAllMocks();
  get.mockReset().mockResolvedValue(MATRIX);
  save.mockReset().mockResolvedValue([]);
  fill.mockReset();
  vi.spyOn(administrationApi.matrix, 'get').mockImplementation(get);
  vi.spyOn(administrationApi.matrix, 'save').mockImplementation(save);
  vi.spyOn(administrationApi.matrix, 'fill').mockImplementation(fill);
});

describe('the curriculum matrix', () => {
  it('renders the stored truth and the policy hint, never a guess', async () => {
    renderMatrix();

    // Stored cell: enabled.
    const mathG10 = await screen.findByRole('checkbox', { name: /Mathematics — 10/ });
    expect(mathG10).toHaveAttribute('aria-checked', 'true');
    // Policy says on, no stored row: a suggestion dot, not an enabled cell.
    const mathG07 = screen.getByRole('checkbox', { name: /Mathematics — 7/ });
    expect(mathG07).toHaveAttribute('aria-checked', 'false');
    expect(mathG07.textContent).toBe('·');
    expect(mathG07.title).toMatch(/policy suggests/i);
    // A subject without a claimed policy says so and stays a blank row.
    expect(screen.getByText('no standard policy')).toBeTruthy();
    const artG07 = screen.getByRole('checkbox', { name: /Art — 7/ });
    expect(artG07.textContent).toBe('');
  });

  it('holds toggles as pending overrides until the one save', async () => {
    renderMatrix();
    const user = userEvent.setup();

    const artG07 = await screen.findByRole('checkbox', { name: /Art — 7/ });
    await user.click(artG07);

    // Pending: the count appears, the save appears — and nothing was sent.
    expect(screen.getByText(/1 pending change/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /save distribution/i })).toBeTruthy();
    expect(save).not.toHaveBeenCalled();

    // Un-toggle back to stored: the override disappears with its UI. (The
    // legend also says "pending change" — match the counter, not the prose.)
    await user.click(artG07);
    expect(screen.queryByText(/pending change\(s\)/)).toBeNull();

    // Toggle again, then save: ONE batch with exactly the touched cell.
    await user.click(artG07);
    await user.click(screen.getByRole('button', { name: /save distribution/i }));

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save).toHaveBeenCalledWith([{ gradeKey: 'G07', subjectKey: 'ART', isActive: true }]);
  });

  it('fills only after the administrator confirms the preview', async () => {
    fill.mockResolvedValueOnce({ applied: false, toEnable: 2, toDisable: 1, unchanged: 5 });
    fill.mockResolvedValueOnce({ applied: true, toEnable: 2, toDisable: 1, unchanged: 5 });
    renderMatrix();
    const user = userEvent.setup();

    await screen.findByRole('checkbox', { name: /Mathematics — 10/ });
    await user.click(screen.getByRole('button', { name: /fill from curriculum policy/i }));

    // The preview ran with apply:false and wrote nothing.
    expect(fill).toHaveBeenCalledWith(false);
    const confirm = await screen.findByRole('button', { name: /^apply$/i });
    expect(screen.getByText(/2 cells will be enabled, 1 disabled/)).toBeTruthy();

    await user.click(confirm);

    await waitFor(() => expect(fill).toHaveBeenCalledWith(true));
    expect(fill).toHaveBeenCalledTimes(2);
  });

  it('keeps a reader reading: no controls, no writes', async () => {
    renderMatrix(false);

    const artG07 = await screen.findByRole('checkbox', { name: /Art — 7/ });
    expect((artG07 as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: /fill from curriculum policy/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /save distribution/i })).toBeNull();
  });
});
