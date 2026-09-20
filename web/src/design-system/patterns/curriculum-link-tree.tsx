/**
 * CurriculumLinkTree — «شجرة الربط التعليمي الذكي»: cascading
 * Subject/Book → Unit/Chapter → Lesson selection for pointing one piece of
 * content (a question, a resource) at its place in the curriculum.
 *
 * Three plain `Select`s, not a fancy tree widget: the author already thinks
 * in this order (which book, then which unit, then which lesson), and a
 * cascading select is the one control that structurally cannot let a lesson
 * outlive its unit selection — picking a new book or unit always clears what
 * was chosen below it, so the tree can never point at a lesson from a unit
 * that is no longer selected.
 *
 * `LinkDestinationBadge` is the "phosphorescent" confirmation: a lesson is
 * chosen or it is not, and the author should never have to re-read three
 * dropdowns to be sure where a question is about to land.
 */

import { useEffect, useMemo, type ReactNode } from 'react';
import { ChevronRight, Link2, MapPin } from 'lucide-react';
import { Select } from '../ui/select';
import { cn } from '../ui/cn';
import { useI18n } from '../../shared/i18n/i18n';
import { textbookLabelParts } from './textbook-label';

export interface CurriculumLinkValue {
  readonly textbookKey: string;
  readonly unitKey: string;
  readonly lessonKey: string;
}

export const EMPTY_CURRICULUM_LINK: CurriculumLinkValue = {
  textbookKey: '',
  unitKey: '',
  lessonKey: '',
};

/**
 * Structural types, not imported from `education/`: FE6 forbids the design
 * system depending on a product layer, so this shape is declared here and
 * happens to be satisfied by `TextbookSummary` / `OutlineUnit` in
 * `features/content/content.api.ts` — the caller passes those
 * straight through without a mapping step.
 */
export interface CurriculumLinkBook {
  readonly key: string;
  readonly title: string;
  readonly subjectName?: string | null;
  readonly gradeName?: string | null;
}

export interface CurriculumLinkUnit {
  readonly key: string;
  readonly name: string;
  readonly orderIndex: number;
  readonly lessons: readonly CurriculumLinkLesson[];
}

export interface CurriculumLinkLesson {
  readonly key: string;
  readonly name: string;
  readonly orderIndex: number;
  readonly concepts?: readonly { readonly key: string; readonly name: string }[];
}

export interface CurriculumLinkTreeProps {
  readonly value: CurriculumLinkValue;
  readonly onChange: (value: CurriculumLinkValue) => void;
  readonly textbooks: readonly CurriculumLinkBook[];
  /** The outline of `value.textbookKey`. Pass `[]` while it is loading. */
  readonly outline: readonly CurriculumLinkUnit[];
  readonly className?: string;
}

export function CurriculumLinkTree({
  value,
  onChange,
  textbooks,
  outline,
  className,
}: CurriculumLinkTreeProps): ReactNode {
  const { t } = useI18n();

  const selectedBook = textbooks.find((book) => book.key === value.textbookKey) ?? null;
  const units = [...outline].sort((a, b) => a.orderIndex - b.orderIndex);
  const selectedUnit = units.find((unit) => unit.key === value.unitKey) ?? null;
  const lessons = useMemo(
    () => [...(selectedUnit?.lessons ?? [])].sort((a, b) => a.orderIndex - b.orderIndex),
    [selectedUnit],
  );
  const selectedLesson = lessons.find((lesson) => lesson.key === value.lessonKey) ?? null;

  // A unit or lesson that no longer belongs to the current selection (the
  // book changed under it) is cleared rather than displayed stale — the
  // cascade's whole job is to make "pointing at the wrong branch" structurally
  // impossible, not just visually unlikely.
  useEffect(() => {
    if (value.unitKey && !selectedUnit) onChange({ ...value, unitKey: '', lessonKey: '' });
    else if (value.lessonKey && selectedUnit && !selectedLesson) onChange({ ...value, lessonKey: '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.textbookKey, value.unitKey, selectedUnit, selectedLesson]);

  return (
    <div className={cn('space-y-3', className)}>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="space-y-1.5">
          <span className="text-xs font-medium text-text-muted">{t('linkTree.subject')}</span>
          <Select
            value={value.textbookKey}
            onChange={(event) => onChange({ textbookKey: event.target.value, unitKey: '', lessonKey: '' })}
          >
            <option value="">{t('content.pickTextbook')}</option>
            {textbooks.map((book) => (
              <option key={book.key} value={book.key}>
                {textbookLabelParts({ title: book.title, subjectName: book.subjectName, gradeName: book.gradeName }).join(' · ')}
              </option>
            ))}
          </Select>
        </label>

        <label className="space-y-1.5">
          <span className="text-xs font-medium text-text-muted">{t('linkTree.unit')}</span>
          <Select
            value={value.unitKey}
            disabled={!value.textbookKey}
            onChange={(event) => onChange({ ...value, unitKey: event.target.value, lessonKey: '' })}
          >
            <option value="">
              {!value.textbookKey ? t('linkTree.pickSubjectFirst') : units.length === 0 ? t('linkTree.noUnits') : t('content.unit')}
            </option>
            {units.map((unit) => (
              <option key={unit.key} value={unit.key}>
                {unit.name}
              </option>
            ))}
          </Select>
        </label>

        <label className="space-y-1.5">
          <span className="text-xs font-medium text-text-muted">{t('linkTree.lesson')}</span>
          <Select
            value={value.lessonKey}
            disabled={!value.unitKey}
            onChange={(event) => onChange({ ...value, lessonKey: event.target.value })}
          >
            <option value="">
              {!value.unitKey ? t('linkTree.pickUnitFirst') : lessons.length === 0 ? t('linkTree.noLessons') : t('content.lesson')}
            </option>
            {lessons.map((lesson) => (
              <option key={lesson.key} value={lesson.key}>
                {lesson.name}
              </option>
            ))}
          </Select>
        </label>
      </div>

      <LinkDestinationBadge
        bookTitle={selectedBook?.title ?? null}
        unitName={selectedUnit?.name ?? null}
        lessonName={selectedLesson?.name ?? null}
      />
    </div>
  );
}

/**
 * The "phosphorescent" confirmation badge: an accent-lit strip naming the
 * exact book → unit → lesson chain a save is about to write to, or an
 * unmistakably muted placeholder when the chain is incomplete. Colour alone
 * never carries the state (§42) — the icon and the wording change too.
 */
export function LinkDestinationBadge({
  bookTitle,
  unitName,
  lessonName,
}: {
  readonly bookTitle: string | null;
  readonly unitName: string | null;
  readonly lessonName: string | null;
}): ReactNode {
  const { t } = useI18n();
  const complete = Boolean(bookTitle && unitName && lessonName);

  return (
    <div
      className={cn(
        'flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-xs font-semibold transition-colors duration-fast',
        complete
          ? 'border-accent-border bg-accent-subtle text-accent shadow-[0_0_0_1px_var(--color-accent-border),0_0_16px_-4px_var(--color-accent)]'
          : 'border-dashed border-border bg-surface-sunken text-text-muted',
      )}
    >
      {complete ? <Link2 aria-hidden="true" className="size-4 shrink-0" /> : <MapPin aria-hidden="true" className="size-4 shrink-0" />}
      {complete ? (
        <span className="flex min-w-0 items-center gap-1.5 truncate">
          <span className="shrink-0">{t('linkTree.destination')}:</span>
          <span className="truncate">{bookTitle}</span>
          <ChevronRight aria-hidden="true" className="rtl-mirror size-3 shrink-0 opacity-60" />
          <span className="truncate">{unitName}</span>
          <ChevronRight aria-hidden="true" className="rtl-mirror size-3 shrink-0 opacity-60" />
          <span className="truncate">{lessonName}</span>
        </span>
      ) : (
        <span className="truncate">{t('linkTree.destinationEmpty')}</span>
      )}
    </div>
  );
}
