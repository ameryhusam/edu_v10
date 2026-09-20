/**
 * The textbook label — one place that renders "title · subject · grade · term".
 *
 * Eight screens used to build this string by hand, each writing
 * `{book.title} · {book.subjectName} · {book.gradeName} · {book.termName}` (or
 * some subset of it) directly in JSX. That duplication is why a hand-typed
 * title such as "كتاب الرياضيات الصف السابع الفصل الأول" used to render
 * doubled — the composite label appended `gradeName`/`termName` again,
 * regardless of what `title` already said.
 *
 * The backend now refuses that title at creation time (see
 * `content.title_repeats_placement` in `authoring.service.ts`'s
 * `createTextbook`), but older rows and any future write paths outside that
 * one service are not proof against it — a display component that dedupes
 * defensively is the only fix that holds for every past and future title,
 * not just newly created ones. See docs/BACKEND-FINAL-AUDIT-AND-PRODUCTION-PLAN-2026-09-15.md §2.2.
 */

import type { ReactNode } from 'react';

export interface TextbookLabelProps {
  readonly title: string;
  readonly subjectName?: string | null | undefined;
  readonly gradeName?: string | null | undefined;
  readonly termName?: string | null | undefined;
  /** Extra trailing parts that are never dropped (e.g. the academic year key). */
  readonly extra?: readonly (string | null | undefined)[] | undefined;
  readonly separator?: string;
  readonly className?: string;
}

/**
 * Build the deduplicated list of parts: `title` first, then every one of
 * `subjectName`/`gradeName`/`termName`/`extra` that isn't already a substring
 * of `title` (or of a part already kept — so grade and term can't repeat one
 * another either).
 */
export function textbookLabelParts({
  title,
  subjectName,
  gradeName,
  termName,
  extra,
}: Pick<TextbookLabelProps, 'title' | 'subjectName' | 'gradeName' | 'termName' | 'extra'>): string[] {
  const kept: string[] = [];
  const trimmedTitle = title.trim();
  if (trimmedTitle) kept.push(trimmedTitle);

  const candidates = [subjectName, gradeName, termName, ...(extra ?? [])];
  for (const candidate of candidates) {
    const value = candidate?.trim();
    if (!value) continue;
    const alreadyPresent = kept.some((part) => part.includes(value));
    if (!alreadyPresent) kept.push(value);
  }

  return kept;
}

/**
 * The structural parts alone (subject/grade/term/extra), deduplicated against
 * `title` and each other, for screens that render `title` on its own line and
 * the rest as a subtitle underneath. Unlike `textbookLabelParts`, `title`
 * itself is never in the returned list — only used to decide what to drop.
 */
export function textbookSubtitleParts({
  title,
  subjectName,
  gradeName,
  termName,
  extra,
}: Pick<TextbookLabelProps, 'title' | 'subjectName' | 'gradeName' | 'termName' | 'extra'>): string[] {
  const withTitle = textbookLabelParts({ title, subjectName, gradeName, termName, extra });
  const trimmedTitle = title.trim();
  return trimmedTitle ? withTitle.filter((part) => part !== trimmedTitle) : withTitle;
}

/**
 * Renders the deduplicated label as `title · subject · grade · term`,
 * dropping any part already contained in an earlier one.
 */
export function TextbookLabel({
  title,
  subjectName,
  gradeName,
  termName,
  extra,
  separator = ' · ',
  className,
}: TextbookLabelProps): ReactNode {
  const parts = textbookLabelParts({ title, subjectName, gradeName, termName, extra });
  return <span className={className}>{parts.join(separator)}</span>;
}
