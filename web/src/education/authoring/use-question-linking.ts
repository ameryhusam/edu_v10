/**
 * State for the question ↔ concept re-linking screen.
 *
 * Kept out of the component so the modal stays presentational and well under
 * the FE12 size limits. The editing rule that matters lives here: links are
 * edited as a local draft and only sent on save, so a reviewer can change
 * their mind mid-edit without writing three times.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  questionLinkingApi,
  type BankQuestion,
  type ConceptLink,
  type LessonQuestionBank,
} from './question-linking.api';

type Status = 'loading' | 'ready' | 'failed';

export interface DraftLink {
  readonly conceptKey: string;
  readonly isPrimary: boolean;
}

export function useLessonBank(lessonKey: string | null): {
  status: Status;
  bank: LessonQuestionBank | null;
  reload: () => void;
} {
  const [status, setStatus] = useState<Status>('loading');
  const [bank, setBank] = useState<LessonQuestionBank | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!lessonKey) return;
    let cancelled = false;
    setStatus('loading');

    questionLinkingApi
      .bank(lessonKey)
      .then((data) => {
        if (cancelled) return;
        setBank(data);
        setStatus('ready');
      })
      .catch(() => {
        if (cancelled) return;
        setStatus('failed');
      });

    return () => {
      cancelled = true;
    };
  }, [lessonKey, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { status, bank, reload };
}

/**
 * The draft links for one question.
 *
 * `toggle` and `makePrimary` are separate because they are different
 * intentions: removing a concept is not the same as demoting it, and a single
 * click handler that guessed between them would get it wrong half the time.
 */
export function useDraftLinks(question: BankQuestion | null): {
  draft: readonly DraftLink[];
  toggle: (conceptKey: string) => void;
  makePrimary: (conceptKey: string) => void;
  clear: () => void;
  hasPrimary: boolean;
  isDirty: boolean;
  toPayload: () => readonly ConceptLink[];
} {
  const initial = useMemo<readonly DraftLink[]>(
    () =>
      (question?.concepts ?? []).map((c) => ({
        conceptKey: c.conceptKey,
        isPrimary: c.isPrimary,
      })),
    [question],
  );

  const [draft, setDraft] = useState<readonly DraftLink[]>(initial);
  useEffect(() => setDraft(initial), [initial]);

  const toggle = useCallback((conceptKey: string) => {
    setDraft((current) => {
      const existing = current.find((l) => l.conceptKey === conceptKey);
      if (existing) return current.filter((l) => l.conceptKey !== conceptKey);
      // First concept added becomes primary: exactly one primary is required,
      // and making the reviewer perform a second click to state the obvious is
      // how a form ends up refusing to save for no visible reason.
      return [...current, { conceptKey, isPrimary: current.length === 0 }];
    });
  }, []);

  const makePrimary = useCallback((conceptKey: string) => {
    setDraft((current) =>
      current.map((l) => ({ ...l, isPrimary: l.conceptKey === conceptKey })),
    );
  }, []);

  const clear = useCallback(() => setDraft([]), []);

  const hasPrimary = draft.filter((l) => l.isPrimary).length === 1;

  const isDirty = useMemo(() => {
    if (draft.length !== initial.length) return true;
    return draft.some((l) => {
      const before = initial.find((i) => i.conceptKey === l.conceptKey);
      return !before || before.isPrimary !== l.isPrimary;
    });
  }, [draft, initial]);

  // Weight is not editable here on purpose. It is a measurement decision, and
  // a slider offered next to a checkbox invites guessing; existing weights are
  // preserved and new links start at full weight.
  const toPayload = useCallback(
    () =>
      draft.map((l) => ({
        conceptKey: l.conceptKey,
        weight: question?.concepts.find((c) => c.conceptKey === l.conceptKey)?.weight ?? 1,
        isPrimary: l.isPrimary,
      })),
    [draft, question],
  );

  return { draft, toggle, makePrimary, clear, hasPrimary, isDirty, toPayload };
}
