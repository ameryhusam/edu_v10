/**
 * Which book am I working in?
 *
 * Rendered only when the learner actually has more than one. A picker with a
 * single option is a decision the interface is pretending to offer.
 *
 * A radiogroup rather than a `<select>`: the choice is persistent context for
 * the whole screen rather than a form value, and on a phone the options stay
 * visible instead of hiding behind a native picker.
 */

import type { ReactNode } from 'react';
import { useI18n } from '../../shared/i18n/i18n';
import { cn } from '../../design-system/ui/cn';
import { textbookSubtitleParts } from '../../design-system/patterns/textbook-label';
import type { LearnerTextbook } from './learning.api';

export interface TextbookPickerProps {
  readonly books: readonly LearnerTextbook[];
  readonly selected: string | null;
  readonly onSelect: (key: string) => void;
}

export function TextbookPicker({ books, selected, onSelect }: TextbookPickerProps): ReactNode {
  const { t } = useI18n();

  return (
    <div role="radiogroup" aria-label={t('learning.chooseTextbook')} className="flex flex-wrap gap-2">
      {books.map((book) => {
        const isSelected = book.key === selected;
        return (
          <button
            key={book.key}
            type="button"
            role="radio"
            aria-checked={isSelected}
            onClick={() => onSelect(book.key)}
            className={cn(
              'min-h-11 rounded-xl border px-3.5 py-2 text-start transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-canvas',
              isSelected
                ? 'border-accent bg-accent-subtle text-text'
                : 'border-border bg-surface text-text-muted hover:border-border-strong',
            )}
          >
            <span className="block text-sm font-semibold sm:font-bold">{book.title}</span>
            {/* Subject, grade, active term and year disambiguate two editions. */}
            <span className="block text-2xs leading-relaxed text-text-muted">
              {textbookSubtitleParts({
                title: book.title,
                subjectName: book.subjectName,
                gradeName: book.gradeName,
                termName: book.termName,
                extra: [book.academicYearKey],
              }).join(' · ')}
            </span>
          </button>
        );
      })}
    </div>
  );
}
