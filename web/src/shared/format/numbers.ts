/**
 * Number and date formatting.
 *
 * The only place in the frontend allowed to do arithmetic on a displayed
 * value, and even here it is presentation arithmetic — `0.333 → "33%"` — never
 * educational arithmetic. FE8 exempts this directory for exactly that reason,
 * so nothing that decides anything may live here.
 *
 * Digits are Western (`latn`) in both locales. Every key, score and page
 * number in the product is Western, and mixing numeral systems inside one
 * Arabic sentence is harder to read than either alone. One place to reverse it
 * if that judgement turns out wrong.
 */

import type { Locale } from '../i18n/messages';

const LOCALE_TAG: Record<Locale, string> = { ar: 'ar-YE', en: 'en-GB' };

function intl(locale: Locale, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  return new Intl.NumberFormat(LOCALE_TAG[locale], { numberingSystem: 'latn', ...options });
}

/**
 * A server-computed 0..1 ratio as a percentage.
 *
 * Takes a ratio the server already decided and rounds it for display. It does
 * not compute a ratio from parts — a component holding `mastered` and `total`
 * must ask the server for the completion, because the server's definition of
 * completion is not always `mastered / total`.
 */
export function formatRatioAsPercent(locale: Locale, ratio: number): string {
  return intl(locale, { style: 'percent', maximumFractionDigits: 0 }).format(ratio);
}

/** A value the server already expressed as 0..100. */
export function formatPercentValue(locale: Locale, value: number): string {
  return `${intl(locale, { maximumFractionDigits: 0 }).format(value)}%`;
}

export function formatCount(locale: Locale, value: number): string {
  return intl(locale, { maximumFractionDigits: 0 }).format(value);
}

/**
 * An ISO timestamp as a date.
 *
 * **Gregorian, in both locales.** `ar-YE` would otherwise be free to resolve
 * to the Islamic calendar, and a school's academic year, term dates and exam
 * schedule are all administered in Gregorian dates. A history list showing
 * Hijri dates against a Gregorian timetable is not localisation, it is a
 * mismatch the learner has to convert in their head.
 *
 * Time of day is omitted: no screen in the product has needed it, and a
 * timestamp implies a precision the attempt record does not really carry.
 */
export function formatDate(locale: Locale, iso: string): string {
  return new Intl.DateTimeFormat(LOCALE_TAG[locale], {
    calendar: 'gregory',
    numberingSystem: 'latn',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(iso));
}
