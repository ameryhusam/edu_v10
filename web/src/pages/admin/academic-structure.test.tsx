/**
 * Administering the academic structure.
 *
 * The rules worth defending: a referenced row cannot be deleted from here, a
 * key cannot be rewritten once other rows point at it, and a SCHOOL_ADMIN is
 * shown the structure but not the controls that only a SYSTEM_ADMIN may use.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { useEffect, type ReactNode } from 'react';
import { I18nProvider, useI18n } from '../../shared/i18n/i18n';
import { AcademicStructurePage } from './academic-structure';
import { administrationApi, type TermRecord } from '../../features/administration/administration.api';
import type { RoleName, ScopedRole } from '../../shared/types/roles';

const SUBJECTS = [
  {
    key: 'MATH',
    name: 'الرياضيّات',
    nameEn: 'Mathematics',
    isActive: true,
    textbookCount: 2,
    defaultTextbookTitle: 'كتاب الرياضيّات',
  },
  {
    key: 'ART',
    name: 'الفنون',
    nameEn: 'Art',
    isActive: true,
    textbookCount: 0,
    defaultTextbookTitle: 'كتاب الفنون',
  },
];

/** Only the role matters to this screen, so the rest of the session is stubbed. */
vi.mock('../../shared/auth/session', () => ({
  useSession: () => ({
    status: 'authenticated',
    user: { userKey: 'u', username: 'a', fullName: 'A', roles: currentRoles, learnerKey: null },
    hasRole: (...roles: readonly RoleName[]) =>
      currentRoles.some((grant) => roles.includes(grant.role)),
    signIn: vi.fn(),
    adoptSession: vi.fn(),
    signOut: vi.fn(),
    schoolIds: [],
  }),
}));

let currentRoles: readonly ScopedRole[] = [{ role: 'SYSTEM_ADMIN', schoolId: null }];

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
            <AcademicStructurePage />
          </English>
        </MemoryRouter>
      </QueryClientProvider>
    </I18nProvider>,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  currentRoles = [{ role: 'SYSTEM_ADMIN', schoolId: null }];
  vi.spyOn(administrationApi.subjects, 'list').mockResolvedValue(SUBJECTS);
});

describe('deleting reference data', () => {
  it('refuses a row that other records point at, and says why', async () => {
    renderPage();

    await screen.findByText('Mathematics');
    const mathRow = screen.getByText('Mathematics').closest('tr')!;

    // Two textbooks use this subject. The server would refuse with
    // catalogue.in_use; saying so up front beats a failed click.
    expect(within(mathRow, /used by 2/i)).toBe(true);
    const del = [...mathRow.querySelectorAll('button')].find((b) =>
      /delete/i.test(b.textContent ?? ''),
    );
    expect(del).toBeDisabled();
  });

  it('allows an unreferenced row, behind a confirmation', async () => {
    const remove = vi.spyOn(administrationApi.subjects, 'remove').mockResolvedValue({});
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Art');
    const artRow = screen.getByText('Art').closest('tr')!;
    const del = [...artRow.querySelectorAll('button')].find((b) =>
      /delete/i.test(b.textContent ?? ''),
    )!;
    expect(del).toBeEnabled();
    await user.click(del);

    // Reference data is deleted by name across the system and this is not
    // undoable here, so the click asks first.
    const dialog = await screen.findByRole('alertdialog');
    // The record's own name, not a translated label: 'الفنون' is the datum.
    // An English UI still names the row the way the row is named.
    expect(dialog).toHaveTextContent('الفنون');
    expect(remove).not.toHaveBeenCalled();

    await user.click(
      [...dialog.querySelectorAll('button')].find((b) => /delete/i.test(b.textContent ?? ''))!,
    );
    await waitFor(() => expect(remove).toHaveBeenCalledWith('ART'));
  });
});

describe('who may edit', () => {
  it('shows a school administrator the structure but not the controls', async () => {
    currentRoles = [{ role: 'SCHOOL_ADMIN', schoolId: 'sch_demo' }];
    renderPage();

    // Reading is allowed — a school admin needs to see the calendar.
    expect(await screen.findByText('Mathematics')).toBeInTheDocument();
    // Writing is platform-wide and belongs to SYSTEM_ADMIN.
    expect(screen.queryByRole('button', { name: /^add$/i })).toBeNull();
    expect(screen.getByText(/only a system administrator/i)).toBeInTheDocument();
  });
});

describe('editing within the freeze rules', () => {
  const TERMS: TermRecord[] = [
    {
      key: '2026-2027-T01',
      academicYearKey: '2026-2027',
      ordinal: 1,
      name: 'Term 1',
      textbookCount: 0,
      enrollmentCount: 0,
    },
  ];

  beforeEach(() => {
    vi.spyOn(administrationApi.terms, 'list').mockResolvedValue(TERMS);
  });

  async function openTerms(): Promise<void> {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('tab', { name: 'Terms' }));
    await screen.findByText('Term 1');
  }

  function rowButtons(row: HTMLElement): HTMLElement[] {
    return [...row.querySelectorAll('button')];
  }

  it('hides, on edit, the fields the save call would ignore', async () => {
    const update = vi.spyOn(administrationApi.terms, 'update').mockResolvedValue(TERMS[0]!);
    const user = userEvent.setup();
    await openTerms();

    const row = screen.getByText('Term 1').closest('tr')!;
    await user.click(rowButtons(row).find((b) => /edit/i.test(b.textContent ?? ''))!);

    // The dialog is a role=dialog named by its title; only the name is
    // patchable, so only the name is offered. Key, ordinal and year are
    // encoded in the key — an input for them would silently do nothing.
    const dialog = await screen.findByRole('dialog');
    const labels = [...dialog.querySelectorAll('label')].map((l) => l.textContent);
    expect(labels).toContain('Name');
    expect(labels).not.toContain('Key');
    expect(labels).not.toContain('Order');
    expect(labels).not.toContain('Academic year');

    // Changing the name and saving sends exactly the patch the server takes.
    const nameLabel = [...dialog.querySelectorAll('label')].find((l) =>
      /^Name$/.test((l.textContent ?? '').trim()),
    )!;
    const nameInput = nameLabel.querySelector('input') as HTMLInputElement;
    await user.clear(nameInput);
    await user.type(nameInput, 'First term');
    await user.click(
      [...dialog.querySelectorAll('button')].find((b) => /save/i.test(b.textContent ?? ''))!,
    );
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith('2026-2027-T01', { name: 'First term' }),
    );
  });

  it('offers the frozen fields at creation, flagged as fixed', async () => {
    await openTerms();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /^add$/i }));
    const dialog = await screen.findByRole('dialog');

    // At creation every column is writable — including the key, the ordinal
    // and the year the key is built from. (A label's first span is its name;
    // the rest can be the hint.)
    const labels = [...dialog.querySelectorAll('label')].map(
      (l) => l.querySelector('span')?.textContent ?? l.textContent ?? '',
    );
    expect(labels).toContain('Key');
    expect(labels).toContain('Academic year');
    expect(labels).toContain('Order');
    // ...and the form says up front that they will not change later, rather
    // than letting the administrator discover it on the second edit.
    expect(dialog).toHaveTextContent(/fixed at creation/i);
  });
});

/** Small helper: does this row contain text matching the pattern? */
function within(row: HTMLElement, pattern: RegExp): boolean {
  return pattern.test(row.textContent ?? '');
}
