/**
 * Learning queries.
 *
 * Thin on purpose. Each hook is a query key plus a fetcher — no derived
 * educational state, no merging of two endpoints into a shape neither returned.
 *
 * The selected textbook is remembered per learner, because the alternative is
 * re-picking a book on every page load, and for a learner with one book the
 * pick should not exist at all.
 */

import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { queryKeys } from '../../shared/api/query-keys';
import { storage } from '../../shared/platform/storage';
import { learningApi } from './learning.api';

export function useLearnerTextbooks(learnerKey?: string) {
  return useQuery({
    queryKey: queryKeys.learning.textbooks({ ...(learnerKey ? { learnerKey } : {}) }),
    queryFn: () => learningApi.textbooks(learnerKey),
  });
}

export function useNextStep(scope: { textbookKey?: string; learnerKey?: string }) {
  return useQuery({
    queryKey: queryKeys.learning.nextStep(scope),
    queryFn: () => learningApi.nextStep(scope),
    enabled: Boolean(scope.textbookKey),
  });
}

export function useJourney(scope: { textbookKey: string | null; learnerKey?: string }) {
  const { textbookKey } = scope;
  return useQuery({
    queryKey: queryKeys.learning.path({
      textbookKey: textbookKey ?? '',
      ...(scope.learnerKey ? { learnerKey: scope.learnerKey } : {}),
    }),
    // `learnerKey` must be forwarded, not merely keyed on. Dropping it here
    // was a real bug: a parent's request asked for their *own* journey, and a
    // parent is not a learner, so the card fell back to "unavailable" while
    // the endpoint itself was working.
    queryFn: () =>
      learningApi.path({
        textbookKey: textbookKey!,
        ...(scope.learnerKey ? { learnerKey: scope.learnerKey } : {}),
      }),
    enabled: Boolean(textbookKey),
  });
}

export function useDiagnosticPlacement(scope: { textbookKey: string | null; learnerKey?: string }) {
  const { textbookKey } = scope;
  return useQuery({
    queryKey: queryKeys.learning.diagnosticPlacement({
      textbookKey: textbookKey ?? '',
      ...(scope.learnerKey ? { learnerKey: scope.learnerKey } : {}),
    }),
    queryFn: () =>
      learningApi.diagnosticPlacement({
        textbookKey: textbookKey!,
        ...(scope.learnerKey ? { learnerKey: scope.learnerKey } : {}),
      }),
    enabled: Boolean(textbookKey),
  });
}

/** One lesson, opened. Re-read after any answer: the gate moves with evidence. */
export function useLesson(scope: { lessonKey: string | null; learnerKey?: string }) {
  const { lessonKey } = scope;
  return useQuery({
    queryKey: queryKeys.learning.lesson({
      lessonKey: lessonKey ?? '',
      ...(scope.learnerKey ? { learnerKey: scope.learnerKey } : {}),
    }),
    queryFn: () =>
      learningApi.lesson(
        lessonKey!,
        scope.learnerKey ? scope.learnerKey : undefined,
      ),
    enabled: Boolean(lessonKey),
  });
}

/** The shelf by subject. */
export function useSubjects(learnerKey?: string) {
  return useQuery({
    queryKey: queryKeys.learning.subjects({ ...(learnerKey ? { learnerKey } : {}) }),
    queryFn: () => learningApi.subjects(learnerKey),
  });
}

const SELECTED_TEXTBOOK_KEY = 'edu7.selectedTextbook';

/**
 * Which book is the learner looking at?
 *
 * Restored from storage, but only if it is still in the entitlement list — a
 * remembered key for a book the learner has since lost access to must not be
 * used, and asking the server for it would produce a refusal the learner
 * cannot act on.
 */
export function useSelectedTextbook(available: readonly { key: string }[] | undefined) {
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    if (!available || available.length === 0) return;

    const remembered = storage.get(SELECTED_TEXTBOOK_KEY);
    const isStillValid = remembered !== null && available.some((t) => t.key === remembered);

    setSelected((current) => {
      if (current !== null && available.some((t) => t.key === current)) return current;
      return isStillValid ? remembered : (available[0]?.key ?? null);
    });
  }, [available]);

  const select = useCallback((key: string) => {
    setSelected(key);
    storage.set(SELECTED_TEXTBOOK_KEY, key);
  }, []);

  return { selected, select };
}
