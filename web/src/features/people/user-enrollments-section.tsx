/**
 * A learner's enrolments: history, current placement, and the acts on them.
 *
 * The list carries keys for actions and names for people. Showing gradeKey or
 * schoolKey in a detail drawer is a debugging surface, not an admin surface.
 * Every guard is the server's — duplicate enrolment, term-year mismatch,
 * inactive school or grade — and each refusal arrives as a named error the
 * form surfaces verbatim.
 */

import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '../../design-system/ui/button';
import { Badge } from '../../design-system/ui/badge';
import { ConfirmDialog } from '../../design-system/patterns/confirm-dialog';
import { ErrorState, LoadingState } from '../../design-system/patterns/data-states';
import { peopleApi as adminApi } from './people.api';
import { schoolsApi } from '../schools/schools.api';
import {
  catalogueApi as administrationApi,
  type AcademicYearRecord,
  type GradeRecord,
} from '../catalogue/catalogue.api';
import { queryKeys } from '../../shared/api/query-keys';
import { useI18n } from '../../shared/i18n/i18n';
import { ApiError } from '../../shared/api/errors';
import { describeApiError } from '../../shared/api/error-messages';

type Translate = ReturnType<typeof useI18n>['t'];

/** The coordinate selects a new enrolment needs, minus the learner. */
export function EnrollmentCoordinates({
  schoolKey,
  yearKey,
  termKey,
  gradeKey,
  onChange,
  t,
}: {
  readonly schoolKey: string;
  readonly yearKey: string;
  readonly termKey: string;
  readonly gradeKey: string;
  readonly onChange: (next: {
    schoolKey?: string;
    yearKey?: string;
    termKey?: string;
    gradeKey?: string;
  }) => void;
  readonly t: Translate;
}): ReactNode {
  const schools = useQuery({ queryKey: queryKeys.administration.schools(), queryFn: () => schoolsApi.list() });
  const years = useQuery({
    queryKey: queryKeys.administration.catalogue('academicYears'),
    queryFn: () => administrationApi.academicYears.list(),
  });
  // Terms follow the chosen year — a term outside its year is a refused
  // enrolment, so the form never offers the combination.
  const terms = useQuery({
    queryKey: queryKeys.administration.catalogue('terms'),
    queryFn: () => administrationApi.terms.list(yearKey || undefined),
    enabled: yearKey !== '',
  });
  const grades = useQuery({
    queryKey: queryKeys.administration.catalogue('grades'),
    queryFn: () => administrationApi.grades.list(),
  });

  const selectClass =
    'h-11 w-full rounded-lg border border-border bg-surface-raised px-3 text-sm text-text';

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="space-y-1.5">
        <span className="block text-xs font-medium text-text-muted">{t('enrollments.school')}</span>
        <select
          value={schoolKey}
          onChange={(e) => onChange({ schoolKey: e.target.value })}
          className={selectClass}
        >
          <option value="">—</option>
          {(schools.data ?? []).map((school) => (
            <option key={school.key} value={school.key}>
              {school.name}
            </option>
          ))}
        </select>
      </label>

      <label className="space-y-1.5">
        <span className="block text-xs font-medium text-text-muted">{t('enrollments.year')}</span>
        <select
          value={yearKey}
          onChange={(e) => onChange({ yearKey: e.target.value, termKey: '' })}
          className={selectClass}
        >
          <option value="">—</option>
          {(years.data ?? []).map((year: AcademicYearRecord) => (
            <option key={year.key} value={year.key}>
              {year.key}
            </option>
          ))}
        </select>
      </label>

      <label className="space-y-1.5">
        <span className="block text-xs font-medium text-text-muted">{t('enrollments.term')}</span>
        <select
          value={termKey}
          onChange={(e) => onChange({ termKey: e.target.value })}
          disabled={yearKey === ''}
          className={`${selectClass} disabled:opacity-50`}
        >
          <option value="">—</option>
          {(terms.data ?? []).map((term) => (
            <option key={term.key} value={term.key}>
              {term.name}
            </option>
          ))}
        </select>
      </label>

      <label className="space-y-1.5">
        <span className="block text-xs font-medium text-text-muted">{t('enrollments.grade')}</span>
        <select
          value={gradeKey}
          onChange={(e) => onChange({ gradeKey: e.target.value })}
          className={selectClass}
        >
          <option value="">—</option>
          {(grades.data ?? []).map((grade: GradeRecord) => (
            <option key={grade.key} value={grade.key} disabled={!grade.isActive}>
              {grade.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

export function UserEnrollmentsSection({ learnerKey }: { readonly learnerKey: string }): ReactNode {
  const { t, locale } = useI18n();
  const queryClient = useQueryClient();

  const [creating, setCreating] = useState(false);
  const [schoolKey, setSchoolKey] = useState('');
  const [yearKey, setYearKey] = useState('');
  const [termKey, setTermKey] = useState('');
  const [gradeKey, setGradeKey] = useState('');
  const [ending, setEnding] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const enrollments = useQuery({
    queryKey: queryKeys.provisioning.learnerEnrollments(learnerKey),
    queryFn: () => adminApi.learnerEnrollments(learnerKey),
  });

  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.provisioning.all });
    await queryClient.invalidateQueries({ queryKey: queryKeys.administration.all });
  };

  const describe = (cause: unknown): string =>
    cause instanceof ApiError ? describeApiError(cause, locale, t).title : t('catalogue.saveFailed');

  const enroll = useMutation({
    mutationFn: () =>
      adminApi.enroll({ learnerKey, schoolKey, academicYearKey: yearKey, termKey, gradeKey }),
    onSuccess: async () => {
      await refresh();
      setCreating(false);
      setSchoolKey('');
      setYearKey('');
      setTermKey('');
      setGradeKey('');
      setFailure(null);
    },
    onError: (cause) => setFailure(describe(cause)),
  });

  const makeCurrent = useMutation({
    mutationFn: (enrollmentKey: string) => adminApi.makeEnrollmentCurrent(enrollmentKey),
    onSuccess: refresh,
    onError: (cause) => setFailure(describe(cause)),
  });

  const end = useMutation({
    mutationFn: (enrollmentKey: string) => adminApi.endEnrollment(enrollmentKey),
    onSuccess: async () => {
      await refresh();
      setEnding(null);
    },
    onError: (cause) => {
      setFailure(describe(cause));
      setEnding(null);
    },
  });

  const complete = schoolKey !== '' && yearKey !== '' && termKey !== '' && gradeKey !== '';

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-text">{t('userDetail.learnerSection')}</h3>
        <Button variant="secondary" size="sm" onClick={() => setCreating(true)}>
          {t('userDetail.enroll')}
        </Button>
      </div>

      {creating ? (
        <LearnerEnrollmentModal
          schoolKey={schoolKey}
          yearKey={yearKey}
          termKey={termKey}
          gradeKey={gradeKey}
          complete={complete}
          saving={enroll.isPending}
          failure={failure}
          onChange={(next) => {
            if (next.schoolKey !== undefined) setSchoolKey(next.schoolKey);
            if (next.yearKey !== undefined) setYearKey(next.yearKey);
            if (next.termKey !== undefined) setTermKey(next.termKey);
            if (next.gradeKey !== undefined) setGradeKey(next.gradeKey);
          }}
          onCancel={() => setCreating(false)}
          onSave={() => enroll.mutate()}
        />
      ) : null}

      {enrollments.isPending ? <LoadingState /> : null}
      {enrollments.isError ? (
        <ErrorState error={enrollments.error} onRetry={() => enrollments.refetch()} />
      ) : null}

      {enrollments.isSuccess ? (
        enrollments.data.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-text-muted">
            {t('userDetail.noEnrollments')}
          </p>
        ) : (
          <ul className="space-y-1.5">
            {enrollments.data.map((enrollment) => (
              <li
                key={enrollment.key}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2"
              >
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  {enrollment.isCurrent ? (
                    <Badge tone="success">{t('enrollments.current')}</Badge>
                  ) : (
                    <Badge tone="neutral">{t('enrollments.ended')}</Badge>
                  )}
                  <span className="text-text">{enrollment.gradeName}</span>
                  <span className="text-xs text-text-muted">
                    {enrollment.schoolName} · {enrollment.academicYearKey} · {enrollment.termName}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  {!enrollment.isCurrent ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={makeCurrent.isPending}
                      onClick={() => makeCurrent.mutate(enrollment.key)}
                    >
                      {t('userDetail.makeCurrent')}
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={end.isPending}
                      onClick={() => setEnding(enrollment.key)}
                    >
                      {t('userDetail.endEnrollment')}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )
      ) : null}

      {!creating && failure ? <p className="text-xs text-danger">{failure}</p> : null}

      {ending !== null ? (
        <ConfirmDialog
          title={t('enrollments.confirmEndTitle')}
          body={t('userDetail.confirmEnd')}
          confirmLabel={t('userDetail.endEnrollment')}
          pending={end.isPending}
          destructive
          onConfirm={() => end.mutate(ending)}
          onCancel={() => setEnding(null)}
        />
      ) : null}
    </section>
  );
}

function LearnerEnrollmentModal({
  schoolKey,
  yearKey,
  termKey,
  gradeKey,
  complete,
  saving,
  failure,
  onChange,
  onCancel,
  onSave,
}: {
  readonly schoolKey: string;
  readonly yearKey: string;
  readonly termKey: string;
  readonly gradeKey: string;
  readonly complete: boolean;
  readonly saving: boolean;
  readonly failure: string | null;
  readonly onChange: (next: {
    schoolKey?: string;
    yearKey?: string;
    termKey?: string;
    gradeKey?: string;
  }) => void;
  readonly onCancel: () => void;
  readonly onSave: () => void;
}): ReactNode {
  const { t } = useI18n();
  return (
    <div className="fixed inset-0 z-modal flex items-center justify-center bg-scrim p-4" onClick={onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('enrollments.createTitle')}
        className="w-full max-w-lg space-y-4 rounded-xl border border-border bg-surface-raised p-5 shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <div>
          <h2 className="text-base font-semibold text-text">{t('enrollments.createTitle')}</h2>
          <p className="text-sm text-text-muted">{t('enrollments.modalHint')}</p>
        </div>
        <EnrollmentCoordinates
          schoolKey={schoolKey}
          yearKey={yearKey}
          termKey={termKey}
          gradeKey={gradeKey}
          onChange={onChange}
          t={t}
        />
        {failure ? <p className="text-xs text-danger">{failure}</p> : null}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" size="sm" disabled={!complete || saving} onClick={onSave}>
            {saving ? t('common.working') : t('enrollments.create')}
          </Button>
        </div>
      </div>
    </div>
  );
}
