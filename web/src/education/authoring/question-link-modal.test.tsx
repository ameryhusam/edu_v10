/**
 * The re-linking dialog.
 *
 * The tests are about the rules a reviewer can break, not about markup:
 * unlinking must be possible without inventing a replacement, an ambiguous
 * set of links must not be savable, and a wrongly-linked item must stay
 * visible rather than being filtered out of the list that is supposed to
 * surface problems.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, type ReactNode } from 'react';
import { I18nProvider, useI18n } from '../../shared/i18n/i18n';
import { QuestionLinkModal } from './question-link-modal';
import { questionLinkingApi, type LessonQuestionBank } from './question-linking.api';

const LESSON = 'EDU-MATH-G07-T1-EDNAT2026-U-NUMBERS-L-SETS';
const C1 = `${LESSON}-C-SET-MEMBER`;
const C2 = `${LESSON}-C-SET-NOTATION`;

function bank(overrides: Partial<LessonQuestionBank> = {}): LessonQuestionBank {
  return {
    lessonKey: LESSON,
    unlinkedCount: 1,
    concepts: [
      { key: C1, name: 'Membership' },
      { key: C2, name: 'Notation' },
    ],
    questions: [
      {
        key: `${LESSON}-Qaaaaaaaa`,
        lessonKey: LESSON,
        text: 'Which of these belongs to the set?',
        status: 'DRAFT',
        origin: 'TEXTBOOK',
        textbookRole: 'OTHER',
        concepts: [],
      },
      {
        key: `${LESSON}-Qbbbbbbbb`,
        lessonKey: LESSON,
        text: 'Write the set in roster notation.',
        status: 'DRAFT',
        origin: 'TEXTBOOK',
        textbookRole: 'OTHER',
        concepts: [{ conceptKey: C1, weight: 1, isPrimary: true }],
      },
    ],
    ...overrides,
  };
}

/**
 * Arabic is the source language and the default, so a test asserting English
 * strings has to ask for English rather than assume it.
 */
function EnglishModal(): ReactNode {
  const { setLocale } = useI18n();
  useEffect(() => setLocale('en'), [setLocale]);
  return <QuestionLinkModal lessonKey={LESSON} onClose={() => {}} />;
}

function renderModal(): void {
  render(
    <I18nProvider>
      <EnglishModal />
    </I18nProvider>,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(questionLinkingApi, 'bank').mockResolvedValue(bank());
});

describe('the lesson bank', () => {
  it('shows linked questions too, not only the broken ones', async () => {
    renderModal();

    // A question pointed at the WRONG concept is the damaging case, and it
    // looks exactly like a correct one to any filter. Only a human reading the
    // stem can catch it, so every item stays on screen.
    expect(await screen.findByText('Which of these belongs to the set?')).toBeInTheDocument();
    expect(screen.getByText('Write the set in roster notation.')).toBeInTheDocument();
  });

  it('reports the unlinked count the server computed, not its own tally', async () => {
    vi.spyOn(questionLinkingApi, 'bank').mockResolvedValue(bank({ unlinkedCount: 7 }));
    renderModal();

    expect(await screen.findByText(/7/)).toBeInTheDocument();
  });
});

describe('saving links', () => {
  it('lets a reviewer detach a wrong link without inventing a replacement', async () => {
    const setConcepts = vi
      .spyOn(questionLinkingApi, 'setConcepts')
      .mockResolvedValue(bank().questions[1]!);
    const user = userEvent.setup();
    renderModal();

    await user.click(await screen.findByText('Write the set in roster notation.'));
    await user.click(screen.getByRole('checkbox', { name: 'Membership' }));
    await user.click(screen.getByRole('button', { name: /save links/i }));

    // An empty array is the whole point: the item keeps its lesson and loses
    // only the claim about what it measures.
    await waitFor(() => expect(setConcepts).toHaveBeenCalledWith(expect.any(String), []));
  });

  it('refuses to save links that name no single primary', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(await screen.findByText('Which of these belongs to the set?'));
    const save = screen.getByRole('button', { name: /save links/i });

    // Nothing selected yet and nothing changed — there is no edit to send.
    expect(save).toBeDisabled();

    // The first concept ticked becomes primary on its own, so this IS savable:
    // requiring a second click to state the only possible answer is how a form
    // ends up refusing for no visible reason.
    await user.click(screen.getByRole('checkbox', { name: 'Membership' }));
    expect(save).toBeEnabled();
  });

  it('warns that an unlinked question cannot be published', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(await screen.findByText('Which of these belongs to the set?'));

    // The rule is enforced server-side at APPROVE; the UI must say so before
    // the author walks away thinking the item is finished.
    expect(screen.getByText(/never published/i)).toBeInTheDocument();
  });
});
