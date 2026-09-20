/**
 * Offline attempt recovery.
 *
 * This is not a local grading engine. It stores the learner's pending answer so
 * a transient connection loss does not erase work, then replays the exact same
 * submission to the canonical backend when the learner retries. The server
 * still grades, emits evidence and advances mastery.
 */

import { storage } from '../../shared/platform/storage';

const INDEX_KEY = 'edu7.assessment.pendingAnswerKeys';
const PREFIX = 'edu7.assessment.pendingAnswer.';

export interface PendingAnswerDraft {
  readonly attemptKey: string;
  readonly questionKey: string;
  readonly choiceIds: readonly string[];
  readonly savedAt: string;
}

function draftKey(attemptKey: string, questionKey: string): string {
  return `${PREFIX}${attemptKey}:${questionKey}`;
}

function readIndex(): string[] {
  const raw = storage.get(INDEX_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function writeIndex(keys: readonly string[]): void {
  storage.set(INDEX_KEY, JSON.stringify([...new Set(keys)]));
}

export const offlineAttemptStore = {
  save(draft: Omit<PendingAnswerDraft, 'savedAt'>): PendingAnswerDraft {
    const full: PendingAnswerDraft = { ...draft, savedAt: new Date().toISOString() };
    const key = draftKey(draft.attemptKey, draft.questionKey);
    storage.set(key, JSON.stringify(full));
    writeIndex([...readIndex(), key]);
    return full;
  },

  get(attemptKey: string, questionKey: string): PendingAnswerDraft | null {
    const raw = storage.get(draftKey(attemptKey, questionKey));
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as PendingAnswerDraft;
      return parsed.attemptKey === attemptKey && parsed.questionKey === questionKey ? parsed : null;
    } catch {
      return null;
    }
  },

  remove(attemptKey: string, questionKey: string): void {
    const key = draftKey(attemptKey, questionKey);
    storage.remove(key);
    writeIndex(readIndex().filter((candidate) => candidate !== key));
  },

  listForAttempt(attemptKey: string): PendingAnswerDraft[] {
    return readIndex()
      .map((key) => storage.get(key))
      .flatMap((raw) => {
        if (!raw) return [];
        try {
          const parsed = JSON.parse(raw) as PendingAnswerDraft;
          return parsed.attemptKey === attemptKey ? [parsed] : [];
        } catch {
          return [];
        }
      });
  },
};
