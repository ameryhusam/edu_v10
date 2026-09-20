/**
 * Student dashboard support panels.
 *
 * These components keep the page orchestration small while preserving the same
 * rule as the dashboard itself: all counts and statuses arrive already decided
 * by the backend; the widgets only choose where the learner can go next.
 */

import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Compass, ListChecks, RotateCcw } from 'lucide-react';
import { Card, CardContent } from '../../design-system/ui/card';
import { Badge } from '../../design-system/ui/badge';
import { Button } from '../../design-system/ui/button';
import { useI18n } from '../../shared/i18n/i18n';
import type { MessageKey } from '../../shared/i18n/messages';
import { formatCount } from '../../shared/format/numbers';
import type { DueWorkItem } from '../instruction/due-work.api';

export function DueWorkList({
  title,
  tone,
  items,
}: {
  readonly title: string;
  readonly tone: 'info' | 'advisory';
  readonly items: readonly DueWorkItem[];
}): ReactNode {
  const { t } = useI18n();

  return (
    <Card elevation="flat">
      <CardContent className="space-y-3 py-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-text">{title}</h3>
          <Badge tone={tone}>{items.length}</Badge>
        </div>
        {items.length === 0 ? (
          <p className="text-xs text-text-muted">{t('work.noneInLane')}</p>
        ) : (
          <ul className="space-y-2">
            {items.slice(0, 4).map((item) => (
              <li key={item.obligationKey} className="rounded-lg border border-border bg-surface-raised p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-text">{item.title}</p>
                  <Badge tone={item.isOverdue ? 'warning' : tone}>
                    {item.isOverdue ? t('work.overdue') : t(`obligation.status.${item.status}` as MessageKey)}
                  </Badge>
                </div>
                <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-2xs text-text-muted">
                  <span>{t(`teacherAssignments.activity.${item.activityType}` as MessageKey)}</span>
                  {item.activityType === 'EXAM' ? (
                    <Link className="font-semibold text-accent hover:underline" to={`/exams?exam=${encodeURIComponent(item.activityKey)}`}>
                      {t('work.openExam')}
                    </Link>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
        {tone === 'advisory' ? <p className="text-2xs text-advisory">{t('work.advisoryNote')}</p> : null}
      </CardContent>
    </Card>
  );
}

export function StudyPulse({
  outstanding,
  struggling,
  needsAttention,
  onDueWork,
  onReview,
}: {
  readonly outstanding: string;
  readonly struggling: string;
  readonly needsAttention: boolean;
  readonly onDueWork: () => void;
  readonly onReview: () => void;
}): ReactNode {
  const { t } = useI18n();
  return (
    <Card elevation="flat">
      <CardContent className="grid gap-3 py-4 md:grid-cols-[1fr_auto] md:items-center">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-advisory-subtle text-advisory">
            <ListChecks className="size-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-bold text-text">{t('student.pulseTitle')}</p>
            <p className="text-xs leading-relaxed text-text-muted">
              {t('student.pulseSummary', { outstanding, struggling })}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant={needsAttention ? 'primary' : 'secondary'} size="sm" onClick={onDueWork}>
            {t('student.viewDueWork')}
          </Button>
          <Button variant="secondary" size="sm" onClick={onReview}>
            {t('student.reviewNow')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function DashboardDiscovery({
  selected,
  strugglingCount,
  onPath,
  onSubjects,
  onReview,
}: {
  readonly selected: string | null;
  readonly strugglingCount: number;
  readonly onPath: () => void;
  readonly onSubjects: () => void;
  readonly onReview: () => void;
}): ReactNode {
  const { t, locale } = useI18n();
  return (
    <Card elevation="raised">
      <CardContent className="space-y-4 py-5">
        <div className="flex items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-accent-subtle text-accent">
            <Compass className="size-5" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-base font-extrabold text-text">{t('student.discoveryTitle')}</h2>
            <p className="mt-1 text-sm leading-relaxed text-text-muted">
              {t('student.discoveryBody', {
                book: selected ?? t('learning.myTextbooks'),
                count: formatCount(locale, strugglingCount),
              })}
            </p>
          </div>
        </div>
        <div className="grid gap-2 sm:flex sm:flex-wrap">
          <Button variant="primary" onClick={onPath}>
            <Compass className="size-4" aria-hidden="true" />
            {t('learning.viewPath')}
          </Button>
          <Button variant="secondary" onClick={onReview}>
            <RotateCcw className="size-4" aria-hidden="true" />
            {t('student.reviewNow')}
          </Button>
          <Button variant="secondary" onClick={onSubjects}>
            {t('nav.subjects')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
