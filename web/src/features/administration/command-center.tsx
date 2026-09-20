/**
 * The command-centre sections of the admin overview.
 *
 * Cloned from the legacy «مركز القيادة والرقابة المؤسسية»: the master
 * foundation banner that opens the board (which year is current, or the fact
 * that none is), and the numbered task map that replaces "here are fifteen
 * equal tiles" with "here are the six jobs, in the order the institution
 * needs them done". Both show server numbers and link to the surface that
 * owns the work — this file decides nothing.
 */

import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CalendarRange, ChevronLeft, ChevronRight } from 'lucide-react';
import { Card, CardContent } from '../../design-system/ui/card';
import { Badge } from '../../design-system/ui/badge';
import { cn } from '../../design-system/ui/cn';
import { useI18n } from '../../shared/i18n/i18n';
import { formatCount } from '../../shared/format/numbers';
import type { MessageKey } from '../../shared/i18n/messages';
import type { AdminCollection } from './administration.api';

/** The year summary the overview payload carries, serialised over JSON. */
export interface CurrentAcademicYear {
  readonly key: string;
  readonly startsOn: string;
  readonly endsOn: string;
  readonly termCount: number;
}

/**
 * The master academic foundation banner. A current year is the system's
 * steady state and reads green; no current year is a fresh install's first
 * job and reads as one, not as a fault — the seed of every enrolment is the
 * year it belongs to.
 */
export function FoundationCard({ year }: { readonly year: CurrentAcademicYear | null }): ReactNode {
  const { t, locale, direction } = useI18n();
  const Arrow = direction === 'rtl' ? ChevronLeft : ChevronRight;

  return (
    <Card elevation="raised" className={cn(year ? 'border-success-border' : 'border-warning-border')}>
      <CardContent className="flex flex-wrap items-center justify-between gap-4 py-4">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <span
            aria-hidden="true"
            className={cn(
              'grid size-11 shrink-0 place-items-center rounded-xl',
              year ? 'bg-success-subtle text-success' : 'bg-warning-subtle text-warning',
            )}
          >
            <CalendarRange className="size-5" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-bold">{t('admin.foundationTitle')}</h2>
              {year ? (
                <Badge tone="success">{t('admin.foundationOperational')}</Badge>
              ) : (
                <Badge tone="warning">{t('admin.noCurrentYear')}</Badge>
              )}
            </div>
            {year ? (
              <p className="mt-1 text-xs text-text-muted">
                {/* The key is the year pair itself; dates follow for the calendar. */}
                {year.key} · {year.startsOn.slice(0, 10)} → {year.endsOn.slice(0, 10)} ·{' '}
                {t('admin.activeTerms', { n: formatCount(locale, year.termCount) })}
              </p>
            ) : (
              <p className="mt-1 text-xs text-text-muted">{t('admin.noCurrentYearHint')}</p>
            )}
          </div>
        </div>

        <Link
          to="/admin/structure"
          className="inline-flex h-9 shrink-0 items-center gap-1 rounded-lg border border-border bg-surface px-3 text-sm font-medium text-text transition-colors hover:bg-surface-hover"
        >
          {t('admin.manageFoundation')}
          <Arrow className="size-4" aria-hidden="true" />
        </Link>
      </CardContent>
    </Card>
  );
}

/** One job of the institution, its count, and the surface that owns it. */
interface TaskDefinition {
  readonly id: AdminCollection;
  readonly to: string;
  /** The collection whose total the badge shows — the task's own headline. */
  readonly countOf: AdminCollection;
}

/**
 * The six jobs in institutional order: describe the foundation, register the
 * schools, approve the books, then bring in the people. The order is the
 * order the dependencies run in — enrolments before a year exist is the
 * classic fresh-install mistake, and a numbered map says so without a modal.
 */
const TASKS: readonly TaskDefinition[] = [
  { id: 'academicYears', to: '/admin/structure', countOf: 'terms' },
  { id: 'schools', to: '/admin/schools', countOf: 'schools' },
  { id: 'textbooks', to: '/admin/textbooks', countOf: 'textbooks' },
  { id: 'users', to: '/admin/users', countOf: 'users' },
  { id: 'educators', to: '/admin/teachers', countOf: 'educators' },
  { id: 'enrollments', to: '/admin/enrollments', countOf: 'currentEnrollments' },
];

export function TaskMap({
  totals,
}: {
  /** Server counts keyed by collection — read, never computed here. */
  readonly totals: Readonly<Record<AdminCollection, number>>;
}): ReactNode {
  const { t, locale } = useI18n();

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-text-muted">{t('admin.taskMapTitle')}</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {TASKS.map((task, index) => (
          <Link key={task.id} to={task.to} className="block">
            <Card elevation="default" interactive className="h-full">
              <CardContent className="space-y-2 py-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    {/* رقم المهمة — the legacy board numbered its steps, and a
                        number says "do them in this order" better than a list. */}
                    <span className="grid size-7 place-items-center rounded-full bg-surface-sunken text-xs font-bold tabular-nums">
                      {formatCount(locale, index + 1)}
                    </span>
                    <span className="text-sm font-semibold text-text">
                      {t(`admin.task.${task.id}` as MessageKey)}
                    </span>
                  </div>
                  <Badge tone="accent">{formatCount(locale, totals[task.countOf] ?? 0)}</Badge>
                </div>
                <p className="text-xs leading-relaxed text-text-muted">
                  {t(`admin.task.${task.id}Hint` as MessageKey)}
                </p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </section>
  );
}
