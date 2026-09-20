/** Teacher exam results and performance view. */

import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart3 } from 'lucide-react';
import { Badge } from '../../design-system/ui/badge';
import { Card, CardContent } from '../../design-system/ui/card';
import { DataTable, type Column } from '../../design-system/patterns/data-table';
import { EmptyState, ErrorState, LoadingState } from '../../design-system/patterns/data-states';
import { PageHeader } from '../../design-system/patterns/page-header';
import { analyticsApi, type ExamResults, type SittingRow } from '../../education/analytics/analytics.api';
import { questionBankApi } from '../../education/authoring/question-bank.api';
import { schoolsApi } from '../../features/schools/schools.api';
import { rosterApi } from '../../education/roster/roster.api';
import { queryKeys } from '../../shared/api/query-keys';
import { useSession } from '../../shared/auth/session';
import { useI18n } from '../../shared/i18n/i18n';
import { formatCount, formatRatioAsPercent } from '../../shared/format/numbers';
import type { Locale, MessageKey } from '../../shared/i18n/messages';

export function TeacherResultsPage(): ReactNode {
  const { t, locale } = useI18n();
  const { schoolIds } = useSession();
  const [schoolId, setSchoolId] = useState(schoolIds[0] ?? '');
  const [examKey, setExamKey] = useState('');

  const exams = useQuery({
    queryKey: queryKeys.content.exams({ status: 'PUBLISHED', limit: 100 }),
    queryFn: () => questionBankApi.exams({ status: 'PUBLISHED', limit: 100 }),
  });
  // Resolve the raw school id the session carries into a display name — the
  // school picker must not show a bare UUID (G1, §2.1).
  const schools = useQuery({
    queryKey: queryKeys.administration.schools(),
    queryFn: () => schoolsApi.list(),
  });
  const schoolName = new Map((schools.data ?? []).map((school) => [school.key, school.name]));
  const roster = useQuery({
    queryKey: queryKeys.analytics.roster({ schoolId }),
    queryFn: () => rosterApi.list({ schoolId }),
    enabled: Boolean(schoolId),
  });
  const results = useQuery({
    queryKey: examKey && schoolId ? queryKeys.analytics.examResults({ examKey, schoolId }) : ['analytics', 'exam-results', 'none'],
    queryFn: () => analyticsApi.examResults({ examKey, schoolId }),
    enabled: Boolean(examKey && schoolId),
  });

  const learnerName = new Map((roster.data?.learners ?? []).map((learner) => [learner.learnerKey, learner.fullName]));
  const columns = resultColumns(t, locale, learnerName);

  if (schoolIds.length === 0) return <EmptyState title={t('teacher.noSchool')} body={t('teacher.noSchoolHint')} />;

  return (
    <div className="space-y-6">
      <PageHeader title={t('teacherResults.title')} subtitle={t('teacherResults.subtitle')} />
      <Card elevation="flat">
        <CardContent className="grid gap-3 py-4 md:grid-cols-2">
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-text-muted">{t('teacherAssignments.schoolScope')}</span>
            <select value={schoolId} onChange={(event) => setSchoolId(event.target.value)} className="h-11 w-full rounded-lg border border-border bg-surface-raised px-3 text-sm text-text">
              {schoolIds.map((id) => <option key={id} value={id}>{schoolName.get(id) ?? id}</option>)}
            </select>
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-text-muted">{t('teacherAssignments.examPicker')}</span>
            <select value={examKey} onChange={(event) => setExamKey(event.target.value)} className="h-11 w-full rounded-lg border border-border bg-surface-raised px-3 text-sm text-text">
              <option value="">—</option>
              {(exams.data?.rows ?? []).map((exam) => <option key={exam.key} value={exam.key}>{exam.title}</option>)}
            </select>
          </label>
        </CardContent>
      </Card>

      {exams.isError ? <ErrorState error={exams.error} onRetry={() => void exams.refetch()} /> : null}
      {!examKey ? <EmptyState title={t('teacherResults.pickExam')} body={t('teacherResults.pickExamHint')} /> : null}
      {results.isPending && examKey ? <LoadingState /> : null}
      {results.isError ? <ErrorState error={results.error} onRetry={() => void results.refetch()} /> : null}
      {results.isSuccess ? <ResultsBody results={results.data} columns={columns} learnerName={learnerName} /> : null}
    </div>
  );
}

function ResultsBody({
  results,
  columns,
  learnerName,
}: {
  readonly results: ExamResults;
  readonly columns: readonly Column<SittingRow>[];
  readonly learnerName: ReadonlyMap<string, string>;
}): ReactNode {
  const { t, locale } = useI18n();
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Metric label={t('teacherResults.assigned')} value={formatCount(locale, results.assigned)} />
        <Metric label={t('teacherResults.submitted')} value={formatCount(locale, results.submitted)} />
        <Metric label={t('teacherResults.inProgress')} value={formatCount(locale, results.inProgress)} />
        <Metric label={t('teacherResults.awaitingReview')} value={formatCount(locale, results.awaitingReview)} />
        <Metric label={t('teacherResults.mean')} value={results.meanPercentage === null ? t('value.notMeasured') : formatRatioAsPercent(locale, results.meanPercentage)} />
      </div>
      <Card elevation="default">
        <CardContent className="space-y-3 py-4">
          <div className="flex items-center gap-2">
            <BarChart3 className="size-4 text-accent" aria-hidden="true" />
            <h2 className="text-sm font-bold text-text">{t('teacherResults.distribution')}</h2>
          </div>
          <div className="space-y-2">
            {results.distribution.map((band) => <Band key={band.label} label={band.label} count={band.count} total={Math.max(1, results.assigned)} />)}
          </div>
        </CardContent>
      </Card>
      <DataTable rows={results.sittings} columns={columns} keyOf={(row) => row.attemptKey} caption={t('teacherResults.sittings')} emptyTitle={t('teacherResults.noAttempts')} />
      <Card elevation="flat">
        <CardContent className="space-y-2 py-4">
          <h2 className="text-sm font-bold text-text">{t('teacherResults.notStarted')}</h2>
          <div className="flex flex-wrap gap-2">
            {results.notStartedLearners.length === 0 ? <span className="text-xs text-text-muted">{t('teacherResults.everyoneStarted')}</span> : null}
            {results.notStartedLearners.map((learnerKey) => <Badge key={learnerKey} tone="warning">{learnerName.get(learnerKey) ?? t('teacherResults.unnamedLearner')}</Badge>)}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({ label, value }: { readonly label: string; readonly value: string }): ReactNode {
  return (
    <Card elevation="default">
      <CardContent className="py-4">
        <p className="text-2xs text-text-muted">{label}</p>
        <p className="text-xl font-bold text-text">{value}</p>
      </CardContent>
    </Card>
  );
}

function Band({ label, count, total }: { readonly label: string; readonly count: number; readonly total: number }): ReactNode {
  const percent = Math.round((count / total) * 100);
  return (
    <div className="grid grid-cols-[4rem_minmax(0,1fr)_3rem] items-center gap-2 text-xs">
      <span className="font-semibold text-text-muted">{label}</span>
      <span className="h-2 overflow-hidden rounded-full bg-surface-sunken"><span className="block h-full rounded-full bg-accent" style={{ width: `${percent}%` }} /></span>
      <span className="text-end tabular-nums text-text-muted">{count}</span>
    </div>
  );
}

function resultColumns(
  t: (key: MessageKey, values?: Record<string, string | number>) => string,
  locale: Locale,
  learnerName: ReadonlyMap<string, string>,
): readonly Column<SittingRow>[] {
  return [
    { id: 'learner', label: t('teacherResults.learner'), sortBy: (row) => learnerName.get(row.learnerKey) ?? row.learnerKey, render: (row) => learnerName.get(row.learnerKey) ?? t('teacherResults.unnamedLearner') },
    { id: 'status', label: t('catalogue.state'), render: (row) => <Badge tone={row.awaitingReview ? 'warning' : row.status === 'SUBMITTED' ? 'success' : 'info'}>{row.awaitingReview ? t('teacherResults.awaitingReview') : t(`attempt.status.${row.status}` as MessageKey)}</Badge> },
    { id: 'score', label: t('exams.score'), numeric: true, sortBy: (row) => row.percentage ?? -1, render: (row) => row.percentage === null ? t('value.notMeasured') : formatRatioAsPercent(locale, row.percentage) },
    { id: 'raw', label: t('teacherResults.rawScore'), numeric: true, render: (row) => row.score === null || row.maxScore === null ? '—' : `${row.score}/${row.maxScore}` },
  ];
}
