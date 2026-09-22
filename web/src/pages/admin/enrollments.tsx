/** 
 * Administration enrolment workspace.
 *
 * Creating a placement is an explicit workflow: choose an existing person,
 * inspect the learner-profile state, use canonical role provisioning when the
 * profile is missing, then submit business-key coordinates to the enrolment
 * capability.
 */
import { useState, type ReactNode } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, UserPlus } from 'lucide-react';
import { Button } from '../../design-system/ui/button';
import { Badge } from '../../design-system/ui/badge';
import { Input } from '../../design-system/ui/input';
import { EmptyState, ErrorState, LoadingState } from '../../design-system/patterns/data-states';
import { PageHeader } from '../../design-system/patterns/page-header';
import { Pager } from '../../design-system/patterns/pager';
import { type Column } from '../../design-system/patterns/data-table';
import { ResponsiveDataView } from '../../design-system/patterns/responsive-data-view';
import { FilterBar } from '../../design-system/patterns/filter-bar';
import { ConfirmDialog } from '../../design-system/patterns/confirm-dialog';
import { ActionStepCard } from '../../design-system/patterns/action-modal';
import { adminApi, type DirectoryUser, type EnrollmentRow, type UserDetail } from '../../features/people/people.api';
import { administrationApi } from '../../features/administration/administration.api';
import { schoolsApi } from '../../features/schools/schools.api';
import { queryKeys } from '../../shared/api/query-keys';
import { useI18n } from '../../shared/i18n/i18n';
import { ApiError } from '../../shared/api/errors';
import { describeApiError } from '../../shared/api/error-messages';

const PAGE_SIZE = 25;
const selectClass = 'h-11 min-w-36 rounded-lg border border-border bg-surface-raised px-3 text-sm text-text';
type CurrentFilter = 'any' | 'current' | 'ended';

export function EnrollmentsPage(): ReactNode {
  const { t, locale } = useI18n();
  const queryClient = useQueryClient();
  const [schoolKey, setSchoolKey] = useState('');
  const [academicYearKey, setAcademicYearKey] = useState('');
  const [termKey, setTermKey] = useState('');
  const [gradeKey, setGradeKey] = useState('');
  const [current, setCurrent] = useState<CurrentFilter>('any');
  const [offset, setOffset] = useState(0);
  const [creating, setCreating] = useState(false);
  const [userSearch, setUserSearch] = useState('');
  const [selectedUser, setSelectedUser] = useState<UserDetail | null>(null);
  const [ending, setEnding] = useState<EnrollmentRow | null>(null);
  const [makingCurrent, setMakingCurrent] = useState<EnrollmentRow | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const schools = useQuery({ queryKey: queryKeys.administration.schools(), queryFn: () => schoolsApi.list() });
  const years = useQuery({ queryKey: queryKeys.administration.catalogue('academicYears'), queryFn: () => administrationApi.academicYears.list() });
  const terms = useQuery({
    queryKey: queryKeys.administration.catalogue('terms', academicYearKey),
    queryFn: () => administrationApi.terms.list(academicYearKey || undefined),
    enabled: Boolean(academicYearKey),
  });
  const grades = useQuery({ queryKey: queryKeys.administration.catalogue('grades'), queryFn: () => administrationApi.grades.list() });
  const userResults = useQuery({
    queryKey: queryKeys.provisioning.users({ search: userSearch.trim(), limit: 20, offset: 0 }),
    queryFn: () => adminApi.users({ search: userSearch.trim(), limit: 20, offset: 0 }),
    enabled: creating && userSearch.trim().length >= 2,
  });

  const browserQuery = {
    ...(schoolKey ? { schoolKey } : {}),
    ...(academicYearKey ? { academicYearKey } : {}),
    ...(termKey ? { termKey } : {}),
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

  const provisionLearner = useMutation({
    mutationFn: async () => {
      if (!selectedUser || !schoolKey) throw new Error('Incomplete learner provisioning context');
      if (selectedUser.learnerKey) return selectedUser;
      return adminApi.grantRole({ userKey: selectedUser.key, role: 'STUDENT', schoolKey });
    },
  });

  const enroll = useMutation({
    mutationFn: async () => {
      if (!selectedUser || !schoolKey || !academicYearKey || !termKey || !gradeKey) {
        throw new Error('Incomplete enrolment coordinates');
      }
      const learner = selectedUser.learnerKey ? selectedUser : await provisionLearner.mutateAsync();
      if (!learner.learnerKey) throw new Error('Learner profile was not provisioned');
      return adminApi.enroll({ learnerKey: learner.learnerKey, schoolKey, academicYearKey, termKey, gradeKey, isCurrent: true });
    },
    onSuccess: async () => {
      await refresh();
      setCreating(false);
      setSelectedUser(null);
      setUserSearch('');
      setFailure(null);
    },
    onError: (cause) => setFailure(describe(cause)),
  });

  const end = useMutation({
    mutationFn: (row: EnrollmentRow) => adminApi.endEnrollment(row.key),
    onSuccess: async () => { await refresh(); setEnding(null); },
    onError: (cause) => { setFailure(describe(cause)); setEnding(null); },
  });
  const makeCurrent = useMutation({
    mutationFn: (row: EnrollmentRow) => adminApi.makeEnrollmentCurrent(row.key),
    onSuccess: async () => { await refresh(); setMakingCurrent(null); },
    onError: (cause) => { setFailure(describe(cause)); setMakingCurrent(null); },
  });

  const applyFilter = (fn: () => void): void => { fn(); setOffset(0); };
  const closeCreate = (): void => {
    if (enroll.isPending || provisionLearner.isPending) return;
    setCreating(false);
    setSelectedUser(null);
    setUserSearch('');
  };

  const columns: readonly Column<EnrollmentRow>[] = [
    { id: 'learner', label: t('enrollments.learner'), render: (row) => <span className="font-semibold text-text">{row.learnerName}</span> },
    { id: 'school', label: t('enrollments.school'), render: (row) => row.schoolName },
    { id: 'year', label: t('enrollments.year'), render: (row) => row.academicYearKey },
    { id: 'term', label: t('enrollments.term'), render: (row) => row.termName },
    { id: 'grade', label: t('enrollments.grade'), render: (row) => row.gradeName },
    { id: 'current', label: t('enrollments.current'), render: (row) => <Badge tone={row.isCurrent ? 'success' : 'neutral'}>{row.isCurrent ? t('enrollments.current') : t('enrollments.ended')}</Badge> },
    { id: 'created', label: t('enrollments.created'), render: (row) => new Date(row.createdAt).toLocaleDateString(locale === 'ar' ? 'ar' : 'en') },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={t('enrollments.title')} subtitle={t('enrollments.subtitle')}
        actions={<Button variant="primary" size="sm" onClick={() => setCreating(true)}><UserPlus aria-hidden="true" />{t('enrollments.create')}</Button>} />

      {creating ? (
        <section className="space-y-4 rounded-2xl border border-accent/30 bg-surface p-4 sm:p-5">
          <div><h2 className="text-sm font-extrabold text-text">{t('enrollments.createTitle')}</h2><p className="mt-1 text-xs text-text-muted">{t('enrollments.modalHint')}</p></div>

          <ActionStepCard step={1} title={t('enrollments.selectUser')}>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-text-muted">{t('admin.search')}</span>
              <div className="relative"><Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" aria-hidden="true" />
                <Input value={userSearch} onChange={(event) => { setUserSearch(event.target.value); setSelectedUser(null); }} placeholder={t('enrollments.userSearchPlaceholder')} className="ps-9" />
              </div>
            </label>
            {userResults.isFetching ? <LoadingState /> : null}
            {userResults.isSuccess && userResults.data.rows.length > 0 && !selectedUser ? (
              <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface-raised">
                {userResults.data.rows.map((user: DirectoryUser) => (
                  <button key={user.key} type="button" className="flex min-h-12 w-full items-center justify-between gap-3 px-3 text-start hover:bg-surface-subtle"
                    onClick={() => adminApi.user(user.key).then(setSelectedUser).catch((cause) => setFailure(describe(cause)))}>
                    <span><span className="block text-sm font-semibold text-text">{user.fullName}</span><span className="block text-xs text-text-muted">@{user.username}</span></span>
                    <Badge tone="neutral">{user.roles.map((role) => t(('role.' + role) as never)).join(', ')}</Badge>
                  </button>
                ))}
              </div>
            ) : null}
            {selectedUser ? (
              <div className="rounded-xl border border-border bg-surface-raised p-3">
                <p className="text-sm font-bold text-text">{selectedUser.fullName}</p>
                <p className="text-xs text-text-muted">@{selectedUser.username}</p>
                <p className="mt-2 text-xs text-text-muted">{selectedUser.learnerKey ? t('enrollments.learnerProfileReady') : t('enrollments.learnerProfileProvisionRequired')}</p>
              </div>
            ) : null}
          </ActionStepCard>

          <ActionStepCard step={2} title={t('enrollments.placementContext')}>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <SelectField label={t('enrollments.school')} value={schoolKey} onChange={setSchoolKey} options={(schools.data ?? []).map((item) => ({ value: item.key, label: item.name }))} />
              <SelectField label={t('enrollments.year')} value={academicYearKey} onChange={(value) => { setAcademicYearKey(value); setTermKey(''); }} options={(years.data ?? []).map((item) => ({ value: item.key, label: item.key }))} />
              <SelectField label={t('enrollments.term')} value={termKey} onChange={setTermKey} options={(terms.data ?? []).map((item) => ({ value: item.key, label: item.name }))} disabled={!academicYearKey} />
              <SelectField label={t('enrollments.grade')} value={gradeKey} onChange={setGradeKey} options={(grades.data ?? []).map((item) => ({ value: item.key, label: item.name }))} />
            </div>
          </ActionStepCard>

          {failure ? <p className="text-xs text-danger">{failure}</p> : null}
          <div className="flex flex-wrap justify-end gap-2"><Button variant="ghost" onClick={closeCreate}>{t('common.cancel')}</Button>
            <Button variant="primary" disabled={!selectedUser || !schoolKey || !academicYearKey || !termKey || !gradeKey || enroll.isPending || provisionLearner.isPending} onClick={() => enroll.mutate()}>{t('enrollments.create')}</Button>
          </div>
        </section>
      ) : null}

      <FilterBar actions={<Button variant="ghost" size="sm" onClick={() => { setSchoolKey(''); setAcademicYearKey(''); setTermKey(''); setGradeKey(''); setCurrent('any'); setOffset(0); }}>{t('textbookAdmin.clearFilters')}</Button>}>
        <SelectField label={t('enrollments.school')} value={schoolKey} onChange={(value) => applyFilter(() => setSchoolKey(value))} options={[{ value: '', label: t('common.all') }, ...(schools.data ?? []).map((item) => ({ value: item.key, label: item.name }))]} />
        <SelectField label={t('enrollments.year')} value={academicYearKey} onChange={(value) => applyFilter(() => { setAcademicYearKey(value); setTermKey(''); })} options={[{ value: '', label: t('common.all') }, ...(years.data ?? []).map((item) => ({ value: item.key, label: item.key }))]} />
        <SelectField label={t('enrollments.term')} value={termKey} onChange={(value) => applyFilter(() => setTermKey(value))} options={[{ value: '', label: t('common.all') }, ...(terms.data ?? []).map((item) => ({ value: item.key, label: item.name }))]} disabled={!academicYearKey} />
        <SelectField label={t('enrollments.grade')} value={gradeKey} onChange={(value) => applyFilter(() => setGradeKey(value))} options={[{ value: '', label: t('common.all') }, ...(grades.data ?? []).map((item) => ({ value: item.key, label: item.name }))]} />
        <SelectField label={t('enrollments.current')} value={current} onChange={(value) => applyFilter(() => setCurrent(value as CurrentFilter))} options={[{ value: 'any', label: t('common.all') }, { value: 'current', label: t('enrollments.currentOnly') }, { value: 'ended', label: t('enrollments.ended') }]} />
      </FilterBar>

      {failure && !creating ? <p className="text-xs text-danger">{failure}</p> : null}
      {enrollments.isPending ? <LoadingState /> : null}
      {enrollments.isError ? <ErrorState error={enrollments.error} onRetry={() => enrollments.refetch()} /> : null}
      {enrollments.isSuccess && enrollments.data.rows.length === 0 ? <EmptyState title={t('enrollments.emptyTitle')} body={t('enrollments.emptyBody')} /> : null}
      {enrollments.isSuccess && enrollments.data.rows.length > 0 ? (
        <>
          <ResponsiveDataView
            rows={enrollments.data.rows}
            columns={columns}
            keyOf={(row) => row.key}
            caption={t('enrollments.title')}
            renderCompactRow={(row) => (
              <div className="space-y-2"><div className="flex items-start justify-between gap-3"><p className="font-semibold text-text">{row.learnerName}</p><Badge tone={row.isCurrent ? 'success' : 'neutral'}>{row.isCurrent ? t('enrollments.current') : t('enrollments.ended')}</Badge></div>
                <p className="text-xs text-text-muted">{row.schoolName} · {row.academicYearKey} · {row.termName} · {row.gradeName}</p>
              </div>
            )}
            rowActions={(row) => row.isCurrent ? <Button variant="ghost" size="sm" disabled={end.isPending} onClick={(event) => { event.stopPropagation(); setEnding(row); }}>{t('userDetail.endEnrollment')}</Button> :
              <Button variant="ghost" size="sm" disabled={makeCurrent.isPending} onClick={(event) => { event.stopPropagation(); setMakingCurrent(row); }}>{t('userDetail.makeCurrent')}</Button>}
          />
          <Pager total={enrollments.data.total} limit={PAGE_SIZE} offset={offset} onOffsetChange={setOffset} />
        </>
      ) : null}

      {ending ? <ConfirmDialog title={t('enrollments.confirmEndTitle')} body={t('enrollments.confirmEndBody', { name: ending.learnerName })} confirmLabel={t('userDetail.endEnrollment')} pending={end.isPending} destructive onConfirm={() => end.mutate(ending)} onCancel={() => setEnding(null)} /> : null}
      {makingCurrent ? <ConfirmDialog title={t('enrollments.confirmCurrentTitle')} body={t('enrollments.confirmCurrentBody')} confirmLabel={t('userDetail.makeCurrent')} pending={makeCurrent.isPending} onConfirm={() => makeCurrent.mutate(makingCurrent)} onCancel={() => setMakingCurrent(null)} /> : null}
    </div>
  );
}

function SelectField({ label, value, onChange, options, disabled = false }: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly options: readonly { value: string; label: string }[];
  readonly disabled?: boolean;
}): ReactNode {
  return <label className="min-w-36 flex-1 space-y-1.5"><span className="block text-xs font-medium text-text-muted">{label}</span>
    <select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} className={selectClass}>
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  </label>;
}
