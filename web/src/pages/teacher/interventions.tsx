/**
 * Teacher interventions.
 *
 * The remediation tracker lists evidence-open gaps. It does not let a teacher
 * close one manually; the next learner evidence resolves or confirms it.
 */

import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '../../design-system/ui/badge';
import { Button } from '../../design-system/ui/button';
import { Card, CardContent } from '../../design-system/ui/card';
import { EmptyState, ErrorState, LoadingState } from '../../design-system/patterns/data-states';
import { PageHeader } from '../../design-system/patterns/page-header';
import { administrationApi } from '../../features/administration/administration.api';
import { schoolsApi } from '../../features/schools/schools.api';
import { remediationApi } from '../../education/remediation/remediation.api';
import { queryKeys } from '../../shared/api/query-keys';
import { useSession } from '../../shared/auth/session';
import { useI18n } from '../../shared/i18n/i18n';
import type { MessageKey } from '../../shared/i18n/messages';
import { formatCount } from '../../shared/format/numbers';

export function TeacherInterventionsPage(): ReactNode {
  const { t, locale } = useI18n();
  const { schoolIds } = useSession();
  const [schoolId, setSchoolId] = useState(schoolIds[0] ?? '');
  const [gradeId, setGradeId] = useState('');
  const [termId, setTermId] = useState('');

  const grades = useQuery({
    queryKey: queryKeys.administration.catalogue('grades'),
    queryFn: () => administrationApi.grades.list(),
  });
  const terms = useQuery({
    queryKey: queryKeys.administration.catalogue('terms'),
    queryFn: () => administrationApi.terms.list(),
  });
  // Resolve the raw school id the session carries into a display name — the
  // school picker must not show a bare UUID (G1, §2.1).
  const schools = useQuery({
    queryKey: queryKeys.administration.schools(),
    queryFn: () => schoolsApi.list(),
  });
  const schoolName = new Map((schools.data ?? []).map((school) => [school.key, school.name]));
  const scope = {
    schoolId,
    ...(gradeId ? { gradeId } : {}),
    ...(termId ? { termId } : {}),
  };
  const tracker = useQuery({
    queryKey: queryKeys.remediation.tracker(scope),
    queryFn: () => remediationApi.tracker(scope),
    enabled: Boolean(schoolId),
  });

  if (schoolIds.length === 0) {
    return <EmptyState title={t('teacher.noSchool')} body={t('teacher.noSchoolHint')} />;
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t('interventions.title')} subtitle={t('interventions.subtitle')} />

      <div className="flex flex-wrap gap-3">
        <label className="space-y-1.5">
          <span className="block text-xs font-medium text-text-muted">{t('teacherAssignments.schoolScope')}</span>
          <select
            value={schoolId}
            onChange={(event) => setSchoolId(event.target.value)}
            className="h-11 min-w-48 rounded-lg border border-border bg-surface-raised px-3 text-sm text-text"
          >
            {schoolIds.map((id) => (
              <option key={id} value={id}>{schoolName.get(id) ?? id}</option>
            ))}
          </select>
        </label>
        <label className="space-y-1.5">
          <span className="block text-xs font-medium text-text-muted">{t('collection.grades')}</span>
          <select
            value={gradeId}
            onChange={(event) => setGradeId(event.target.value)}
            className="h-11 min-w-40 rounded-lg border border-border bg-surface-raised px-3 text-sm text-text"
          >
            <option value="">{t('common.all')}</option>
            {(grades.data ?? []).map((grade) => (
              <option key={grade.key} value={grade.key}>{grade.name}</option>
            ))}
          </select>
        </label>
        <label className="space-y-1.5">
          <span className="block text-xs font-medium text-text-muted">{t('collection.terms')}</span>
          <select
            value={termId}
            onChange={(event) => setTermId(event.target.value)}
            className="h-11 min-w-40 rounded-lg border border-border bg-surface-raised px-3 text-sm text-text"
          >
            <option value="">{t('common.all')}</option>
            {(terms.data ?? []).map((term) => (
              <option key={term.key} value={term.key}>{term.name}</option>
            ))}
          </select>
        </label>
      </div>

      {tracker.isPending ? (
        <LoadingState />
      ) : tracker.isError ? (
        <ErrorState error={tracker.error} onRetry={() => void tracker.refetch()} />
      ) : tracker.data.learners.length === 0 ? (
        <EmptyState title={t('interventions.emptyTitle')} body={t('interventions.emptyBody')} />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            <Metric label={t('interventions.open')} value={formatCount(locale, tracker.data.summary.open)} />
            <Metric label={t('interventions.resolved')} value={formatCount(locale, tracker.data.summary.resolved)} />
            <Metric label={t('interventions.stale')} value={formatCount(locale, tracker.data.summary.stale.length)} />
            <Metric
              label={t('interventions.misconceptions')}
              value={formatCount(locale, tracker.data.summary.byTrigger.MISCONCEPTION)}
            />
          </div>
          <ul className="space-y-3">
            {tracker.data.learners.map((learner) => (
              <li key={learner.learnerKey}>
                <Card elevation="default">
                  <CardContent className="space-y-3 py-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h2 className="text-sm font-bold text-text">{learner.learnerKey}</h2>
                      <Badge tone={learner.openCount > 0 ? 'warning' : 'success'}>
                        {t('interventions.openCount', { count: formatCount(locale, learner.openCount) })}
                      </Badge>
                    </div>
                    <ul className="space-y-2">
                      {learner.episodes.slice(0, 4).map((episode) => (
                        <li key={episode.episodeKey} className="rounded-xl border border-border bg-surface-raised p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-sm font-medium text-text">{episode.conceptKey}</p>
                            <Badge tone={episode.status === 'OPEN' ? 'warning' : 'neutral'}>
                              {t(`interventions.trigger.${episode.trigger}` as MessageKey)}
                            </Badge>
                          </div>
                          <p className="mt-1 text-2xs text-text-muted">
                            {t('interventions.ageDays', { count: formatCount(locale, episode.ageDays) })}
                          </p>
                        </li>
                      ))}
                    </ul>
                    <Button variant="secondary" size="sm" onClick={() => void tracker.refetch()}>
                      {t('common.refresh')}
                    </Button>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function Metric({ label, value }: { readonly label: string; readonly value: string }): ReactNode {
  return (
    <span className="rounded-xl border border-border bg-surface px-4 py-3">
      <span className="block text-2xs text-text-muted">{label}</span>
      <span className="text-xl font-extrabold tabular-nums text-text">{value}</span>
    </span>
  );
}
