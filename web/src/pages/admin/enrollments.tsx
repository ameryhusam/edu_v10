/**
 * Enrolment management — placing learners, moving the "current" flag, ending
 * placements (the audit's gap G4).
 *
 * Filters are coordinates, not text: the screen asks "which school, which
 * year, which term, which grade" because that is how placement is addressed
 * in the domain. `current=true` (the flag the teacher's cohort query reads)
 * and `current=false` (finished placements, kept for the record) are one
 * filter with three states.
 */

import { useState, type ReactNode } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '../../design-system/ui/button';
import { Badge } from '../../design-system/ui/badge';
import { EmptyState, ErrorState, LoadingState } from '../../design-system/patterns/data-states';
import { PageHeader } from '../../design-system/patterns/page-header';
import { Pager } from '../../design-system/patterns/pager';
import { DataTable, type Column } from '../../design-system/patterns/data-table';
import { ConfirmDialog } from '../../design-system/patterns/confirm-dialog';
import { RecordEditor, type FieldSpec } from '../../design-system/patterns/record-editor';
import { EnrollmentCoordinates } from '../../features/people/user-enrollments-section';
import { adminApi, type EnrollmentRow } from '../../features/people/people.api';
import { administrationApi } from '../../features/administration/administration.api';
import { schoolsApi } from '../../features/schools/schools.api';
import { queryKeys } from '../../shared/api/query-keys';
import { useI18n } from '../../shared/i18n/i18n';
import { ApiError } from '../../shared/api/errors';
import { describeApiError } from '../../shared/api/error-messages';

const PAGE_SIZE = 25;

export function EnrollmentsPage(): ReactNode {
  const { t, locale } = useI18n();
  const queryClient = useQueryClient();

  const [schoolKey, setSchoolKey] = useState('');
  const [gradeKey, setGradeKey] = useState('');
  const [current, setCurrent] = useState<'any' | 'current' | 'ended'>('any');
  const [offset, setOffset] = useState(0);

  const [creating, setCreating] = useState(false);
  const [cSchool, setCSchool] = useState('');
  const [cYear, setCYear] = useState('');
  const [cTerm, setCTerm] = useState('');
  const [cGrade, setCGrade] = useState('');
  const [ending, setEnding] = useState<EnrollmentRow | null>(null);
  const [makingCurrent, setMakingCurrent] = useState<EnrollmentRow | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const browserQuery = {
    ...(schoolKey ? { schoolKey } : {}),
    ...(gradeKey ? { gradeKey } : {}),
    ...(current === 'current' ? { current: true } : current === 'ended' ? { current: false } : {}),
    limit: PAGE_SIZE,
    offset,
  };

  const enrollments = useQuery({
    queryKey: queryKeys.provisioning.enrollments(browserQuery),
    queryFn: () => adminApi.enrollments(browserQuery),
    placeholderData: keepPreviousData,
  });

  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.provisioning.all });
    await queryClient.invalidateQueries({ queryKey: queryKeys.administration.all });
  };

  const describe = (cause: unknown): string =>
    cause instanceof ApiError ? describeApiError(cause, locale, t).title : t('catalogue.saveFailed');

  const enroll = useMutation({
    mutationFn: (learnerKey: string) =>
      adminApi.enroll({
        learnerKey,
        schoolKey: cSchool,
        academicYearKey: cYear,
        termKey: cTerm,
        gradeKey: cGrade,
      }),
    onSuccess: async () => {
      await refresh();
      setCreating(false);
      setFailure(null);
    },
    onError: (cause) => setFailure(describe(cause)),
  });

  const end = useMutation({
    mutationFn: (row: EnrollmentRow) => adminApi.endEnrollment(row.key),
    onSuccess: async () => {
      await refresh();
      setEnding(null);
    },
    onError: (cause) => {
      setFailure(describe(cause));
      setEnding(null);
    },
  });

  const makeCurrent = useMutation({
    mutationFn: (row: EnrollmentRow) => adminApi.makeEnrollmentCurrent(row.key),
    onSuccess: async () => {
      await refresh();
      setMakingCurrent(null);
    },
    onError: (cause) => {
      setFailure(describe(cause));
      setMakingCurrent(null);
    },
  });

  /** Filter changes reset paging; offset 3 of a narrower filter is nowhere. */
  function applyFilter(fn: () => void): void {
    fn();
    setOffset(0);
  }

  const columns: readonly Column<EnrollmentRow>[] = [
    {
      id: 'learner',
      label: t('enrollments.learner'),
      render: (row) => (
        <span>
          <span className="font-semibold text-text">{row.learnerName}</span>
          <span className="block text-xs text-text-muted">{row.learnerKey}</span>
        </span>
      ),
    },
    { id: 'school', label: t('enrollments.school'), render: (row) => row.schoolName },
    { id: 'year', label: t('enrollments.year'), render: (row) => row.academicYearKey },
    { id: 'term', label: t('enrollments.term'), render: (row) => row.termName },
    { id: 'grade', label: t('enrollments.grade'), render: (row) => row.gradeName },
    {
      id: 'current',
      label: t('enrollments.current'),
      render: (row) =>
        row.isCurrent ? (
          <Badge tone="success">{t('enrollments.current')}</Badge>
        ) : (
          <Badge tone="neutral">{t('enrollments.ended')}</Badge>
        ),
    },
    {
      id: 'created',
      label: t('enrollments.created'),
      render: (row) => new Date(row.createdAt).toLocaleDateString(locale === 'ar' ? 'ar' : 'en'),
    },
  ];

  const learnerField: readonly FieldSpec[] = [
    {
      id: 'learnerKey',
      label: t('enrollments.learnerKey'),
      kind: 'text',
      required: true,
      hint: t('enrollments.learnerHint'),
    },
  ];

  const canCreate = cSchool !== '' && cYear !== '' && cTerm !== '' && cGrade !== '';

  const selectClass =
    'h-11 min-w-36 rounded-lg border border-border bg-surface-raised px-3 text-sm text-text';

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('enrollments.title')}
        subtitle={t('enrollments.subtitle')}
        actions={
          <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
            {t('enrollments.create')}
          </Button>
        }
      />

      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1.5">
          <span className="block text-xs font-medium text-text-muted">{t('enrollments.school')}</span>
          <select value={schoolKey} onChange={(e) => applyFilter(() => setSchoolKey(e.target.value))} className={selectClass}>
            <option value="">{t('common.all')}</option>
            <SchoolOptions />
          </select>
        </label>
        <label className="space-y-1.5">
          <span className="block text-xs font-medium text-text-muted">{t('enrollments.grade')}</span>
          <select value={gradeKey} onChange={(e) => applyFilter(() => setGradeKey(e.target.value))} className={selectClass}>
            <option value="">{t('common.all')}</option>
            <GradeOptions />
          </select>
        </label>
        <label className="space-y-1.5">
          <span className="block text-xs font-medium text-text-muted">{t('enrollments.current')}</span>
          <select
            value={current}
            onChange={(e) => applyFilter(() => setCurrent(e.target.value as 'any' | 'current' | 'ended'))}
            className={selectClass}
          >
            <option value="any">{t('common.all')}</option>
            <option value="current">{t('enrollments.currentOnly')}</option>
            <option value="ended">{t('enrollments.ended')}</option>
          </select>
        </label>
      </div>

      {failure ? <p className="text-xs text-danger">{failure}</p> : null}

      {enrollments.isPending ? (
        <LoadingState />
      ) : enrollments.isError ? (
        <ErrorState error={enrollments.error} onRetry={() => enrollments.refetch()} />
      ) : enrollments.data.rows.length === 0 ? (
        <EmptyState title={t('enrollments.emptyTitle')} body={t('enrollments.emptyBody')} />
      ) : (
        <>
          <DataTable
            rows={enrollments.data.rows}
            columns={columns}
            keyOf={(row) => row.key}
            caption={t('enrollments.title')}
            rowActions={(row) =>
              row.isCurrent ? (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={end.isPending}
                  onClick={() => setEnding(row)}
                >
                  {t('userDetail.endEnrollment')}
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={makeCurrent.isPending}
                  onClick={() => setMakingCurrent(row)}
                >
                  {t('userDetail.makeCurrent')}
                </Button>
              )
            }
          />
          <Pager
            total={enrollments.data.total}
            limit={PAGE_SIZE}
            offset={offset}
            onOffsetChange={setOffset}
          />
        </>
      )}

      {ending ? (
        <ConfirmDialog
          title={t('enrollments.confirmEndTitle')}
          body={t('enrollments.confirmEndBody', { name: ending.learnerName })}
          confirmLabel={t('userDetail.endEnrollment')}
          pending={end.isPending}
          destructive
          onConfirm={() => end.mutate(ending)}
          onCancel={() => setEnding(null)}
        />
      ) : null}

      {makingCurrent ? (
        <ConfirmDialog
          title={t('enrollments.confirmCurrentTitle')}
          body={t('enrollments.confirmCurrentBody')}
          confirmLabel={t('userDetail.makeCurrent')}
          pending={makeCurrent.isPending}
          onConfirm={() => makeCurrent.mutate(makingCurrent)}
          onCancel={() => setMakingCurrent(null)}
        />
      ) : null}

      {creating ? (
        <RecordEditor
          title={t('enrollments.createTitle')}
          fields={learnerField}
          initial={{ learnerKey: '' }}
          isNew
          saving={enroll.isPending}
          errorText={failure}
          onSave={(values) => {
            if (canCreate) enroll.mutate(values.learnerKey ?? '');
            else setFailure(t('error.request.invalid_input'));
          }}
          onClose={() => {
            setCreating(false);
            setFailure(null);
          }}
        >
          <EnrollmentCoordinates
            schoolKey={cSchool}
            yearKey={cYear}
            termKey={cTerm}
            gradeKey={cGrade}
            onChange={(next) => {
              if (next.schoolKey !== undefined) setCSchool(next.schoolKey);
              if (next.yearKey !== undefined) setCYear(next.yearKey);
              if (next.termKey !== undefined) setCTerm(next.termKey);
              if (next.gradeKey !== undefined) setCGrade(next.gradeKey);
            }}
            t={t}
          />
        </RecordEditor>
      ) : null}
    </div>
  );
}

/** Filter options fetched where they are used, so the page body stays flat. */
function SchoolOptions(): ReactNode {
  const schools = useQuery({
    queryKey: queryKeys.administration.schools(),
    queryFn: () => schoolsApi.list(),
  });
  return (
    <>
      {(schools.data ?? []).map((school) => (
        <option key={school.key} value={school.key}>
          {school.name}
        </option>
      ))}
    </>
  );
}

function GradeOptions(): ReactNode {
  const grades = useQuery({
    queryKey: queryKeys.administration.catalogue('grades'),
    queryFn: () => administrationApi.grades.list(),
  });
  return (
    <>
      {(grades.data ?? []).map((grade) => (
        <option key={grade.key} value={grade.key}>
          {grade.name}
        </option>
      ))}
    </>
  );
}
