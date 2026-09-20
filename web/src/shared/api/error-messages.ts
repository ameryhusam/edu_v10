/**
 * Turn a backend error code into something a person should read.
 *
 * The backend returns stable codes precisely so the UI can do this. Its
 * `message` field is English and developer-facing — "Learner is not accessible
 * to this actor" is a correct sentence to log and a poor one to show a parent.
 *
 * An unmapped code falls back to a generic sentence **plus the code and the
 * request id**. Silently swallowing it would make the one report a user files
 * unactionable.
 */

import { MESSAGES, type Locale, type MessageKey } from '../i18n/messages';
import type { ApiError } from './errors';

/** Is there a translation for this exact code? */
function messageKeyFor(code: string, locale: Locale): MessageKey | null {
  const key = `error.${code}` as MessageKey;
  return key in MESSAGES[locale] ? key : null;
}

export function describeApiError(
  error: ApiError,
  locale: Locale,
  t: (key: MessageKey, values?: Record<string, string | number>) => string,
): { title: string; requestId: string | null; code: string } {
  const key = messageKeyFor(error.code, locale);

  return {
    title: key ? t(key) : t('error.unknownWithCode', { code: error.code }),
    requestId: error.requestId,
    code: error.code,
  };
}
