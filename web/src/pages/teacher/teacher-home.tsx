/**
 * The teacher's home screen — the roster (gap G3), in the «Nebula» shape.
 *
 * Edu7 has no class or section model by decision: a class is a query over
 * current enrollments. So this screen asks for a *scope* and shows who it
 * resolves to. There is no class object to select, and the UI must not pretend
 * there is one.
 *
 * The school comes from the session's scoped roles, never from a parameter the
 * page invents — roles are school-scoped, and the server refuses a school the
 * actor does not hold a role in. A teacher with exactly one school sees no
 * picker, on the same principle as the textbook and child pickers.
 *
 * The four headline numbers come from the cohort report — every one of them
 * computed by the backend. Nothing here averages, filters or ranks mastery on
 * the client; the previous system did exactly that, and the same concept
 * showed two different numbers on two screens.
 *
 * **Honest limit, shown to the user, not just commented:** this roster is
 * school-and-grade scoped rather than teacher-and-subject scoped, because no
 * teaching-assignment model exists yet. Every teacher at a school sees the
 * same grade roster. Hiding that would let a teacher believe the list is
 * "my students" when it is "this grade".
 */

import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, ClipboardList, LifeBuoy, Users } from 'lucide-react';
import { Card, CardContent } from '../../design-system/ui/card';
import { MetricCard, MetricGrid } from '../../design-system/patterns/metric-grid';
import { PageHeader } from '../../design-system/patterns/page-header';
import { EmptyState, ErrorState, LoadingState } from '../../design-system/patterns/data-states';
import { rosterApi } from '../../education/roster/roster.api';
import { analyticsApi } from '../../education/analytics/analytics.api';
import { queryKeys } from '../../shared/api/query-keys';
import { useSession } from '../../shared/auth/session';
import { useI18n } from '../../shared/i18n/i18n';
import { formatCount, formatRatioAsPercent } from '../../shared/format/numbers';

export function TeacherHomePage(): ReactNode {
  const { t, locale } = useI18n();
  const { schoolIds } = useSession();
  const schoolId = schoolIds[0];

  const roster = useQuery({
    queryKey: queryKeys.analytics.roster({ schoolId: schoolId ?? '' }),
    queryFn: () => rosterApi.list({ schoolId: schoolId! }),
    // A staff account with no school scope cannot ask for a roster at all.
    enabled: Boolean(schoolId),
  });

  // The same scope the roster resolves to, summarised. Refuses with
  // `analytics.empty_cohort` when nobody is enrolled — in which case the
  // roster below is already showing its own empty state, and there is no
  // fourth card worth inventing numbers for.
  const cohort = useQuery({
    queryKey: queryKeys.analytics.cohort({ schoolId: schoolId ?? '' }),
    queryFn: () => analyticsApi.cohort({ schoolId: schoolId! }),
    enabled: Boolean(schoolId) && roster.isSuccess && (roster.data.learners.length ?? 0) > 0,
  });

  if (!schoolId) {
    return <EmptyState title={t('teacher.noSchool')} body={t('teacher.noSchoolHint')} />;
  }
  if (roster.isPending) return <LoadingState />;
  if (roster.isError) {
    return <ErrorState error={roster.error} onRetry={() => void roster.refetch()} />;
  }

  const learners = roster.data.learners;

  return (
    <div className="space-y-6">
      <PageHeader
        badge={t('teacher.badge')}
        title={t('teacher.rosterTitle')}
        subtitle={t('teacher.rosterCount', { count: formatCount(locale, learners.length) })}
      />

      {/* The scope limit, stated where it is acted on. */}
      <p className="rounded-xl border border-info-border bg-info-subtle px-3.5 py-2.5 text-2xs leading-relaxed text-info">
        {t('teacher.scopeNote')}
      </p>

      {/* The «Nebula» opening row, fed by the cohort report. Struggling means
          evidence below the threshold — the server counts learners with no
          evidence at all separately, and that number is deliberately not on
          this card: absence is not weakness. */}
      {cohort.isSuccess ? (
        <MetricGrid>
          <MetricCard
            title={t('teacher.metric.learners')}
            value={formatCount(locale, cohort.data.learners)}
            subtitle={t('teacher.rosterCount', { count: formatCount(locale, cohort.data.learners) })}
            icon={<Users className="size-5" />}
            tone="accent"
          />
          <MetricCard
            title={t('teacher.metric.active')}
            value={formatCount(locale, cohort.data.activity.activeLearners)}
            subtitle={t('teacher.metric.activeShare', {
              share: formatRatioAsPercent(locale, cohort.data.activity.activeShare),
            })}
            icon={<Activity className="size-5" />}
            tone="success"
          />
          <MetricCard
            title={t('teacher.metric.attempts')}
            value={formatCount(locale, cohort.data.activity.totalAttempts)}
            subtitle={t('attempt.historyTitle')}
            icon={<ClipboardList className="size-5" />}
            tone="info"
          />
          <MetricCard
            title={t('teacher.metric.struggling')}
            value={formatCount(locale, cohort.data.distribution.bands.struggling)}
            subtitle={t('teacher.metric.strugglingHint')}
            icon={<LifeBuoy className="size-5" />}
            tone="warning"
          />
        </MetricGrid>
      ) : null}

      {learners.length === 0 ? (
        <EmptyState title={t('teacher.noLearners')} body={t('teacher.noLearnersHint')} />
      ) : (
        <ul className="space-y-2">
          {learners.map((learner) => (
            <li key={learner.learnerKey}>
              <Card>
                <CardContent className="flex items-center justify-between gap-3 py-3.5">
                  <span className="flex min-w-0 items-center gap-2.5">
                    <span
                      className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent-subtle text-2xs font-extrabold text-accent ring-1 ring-accent-border"
                      aria-hidden="true"
                    >
                      {learner.fullName.trim().charAt(0)}
                    </span>
                    <span className="min-w-0 truncate text-sm font-bold">{learner.fullName}</span>
                  </span>
                  <span className="shrink-0 text-2xs text-text-muted">{learner.gradeName}</span>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
