/**
 * Teachers as staff: who they are, which school scopes their grant, their
 * employee code and subject specialisations (the audit's gap G8).
 *
 * This screen reads the educators query — the EducatorProfile extension of a
 * person — rather than a directory filtered to TEACHER, because the profile
 * fields are the point. Subject specialties are structured catalogue links and
 * may contain more than one subject. They are not class sections: the model
 * still scopes a teacher by school until real teaching assignments are added.
 */

import { useState, type ReactNode } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Input } from '../../design-system/ui/input';
import { Badge } from '../../design-system/ui/badge';
import { Button } from '../../design-system/ui/button';
import { EmptyState, ErrorState, LoadingState } from '../../design-system/patterns/data-states';
import { PageHeader } from '../../design-system/patterns/page-header';
import { Pager } from '../../design-system/patterns/pager';
import { DataTable, type Column } from '../../design-system/patterns/data-table';
import { RecordEditor, type FieldSpec } from '../../design-system/patterns/record-editor';
import { UserDetailDrawer } from '../../features/people/user-detail-drawer';
import { adminApi, type EducatorRow, type DirectoryUser, type UserDetail } from '../../features/people/people.api';
import { schoolsApi } from '../../features/schools/schools.api';
import { administrationApi } from '../../features/administration/administration.api';
import { queryKeys } from '../../shared/api/query-keys';
import { useI18n } from '../../shared/i18n/i18n';

const PAGE_SIZE = 25;
const splitKeys = (value: string | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

export function TeachersPage(): ReactNode {
  const { t } = useI18n();

  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [openUser, setOpenUser] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [teacherSearch, setTeacherSearch] = useState('');
  const [selectedTeacherUser, setSelectedTeacherUser] = useState<UserDetail | null>(null);
  const [linking, setLinking] = useState<EducatorRow | null>(null);
  const [specialising, setSpecialising] = useState<EducatorRow | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const queryClient = useQueryClient();
  const schools = useQuery({
    queryKey: queryKeys.administration.schools(),
    queryFn: () => schoolsApi.list(),
  });
  const subjects = useQuery({
    queryKey: queryKeys.administration.catalogue('subjects'),
    queryFn: () => administrationApi.subjects.list(),
  });

  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.provisioning.all });
    await queryClient.invalidateQueries({ queryKey: queryKeys.administration.all });
  };

  /** Existing user -> TEACHER role/profile -> school scope and specialties. */
  const create = useMutation({
    mutationFn: async (values: Record<string, string>) => {
      if (!selectedTeacherUser) throw new Error('No user selected');
      const schoolKey = values.schoolKey!;
      const user = selectedTeacherUser.educatorKey
        ? selectedTeacherUser
        : await adminApi.grantRole({ userKey: selectedTeacherUser.key, role: 'TEACHER', schoolKey });
      return administrationApi.educators.update({
        userKey: user.key,
        schoolKey,
        employeeCode: values.employeeCode || null,
        specialty: values.specialty || null,
        subjectKeys: splitKeys(values.subjectKeys),
      });
    },
    onSuccess: async () => {
      await refresh(); setCreating(false); setSelectedTeacherUser(null); setTeacherSearch(''); setFailure(null);
    },
    onError: () => setFailure(t('teachers.createFailed')),
  });

  /** The school link: moved, never duplicated — one school at a time. */
  const link = useMutation({
    mutationFn: (input: { userKey: string; schoolKey: string }) =>
      administrationApi.educators.update(input),
    onSuccess: async () => {
      await refresh();
      setLinking(null);
      setFailure(null);
    },
    onError: () => setFailure(t('teachers.linkFailed')),
  });

  const updateSubjects = useMutation({
    mutationFn: (input: { userKey: string; subjectKeys: readonly string[] }) =>
      administrationApi.educators.update(input),
    onSuccess: async () => {
      await refresh();
      setSpecialising(null);
      setFailure(null);
    },
    onError: () => setFailure(t('teachers.subjectsFailed')),
  });

  const educators = useQuery({
    queryKey: queryKeys.provisioning.educators({
      ...(search.trim() ? { search: search.trim() } : {}),
      limit: PAGE_SIZE,
      offset,
    }),
    queryFn: () =>
      adminApi.educators({
        ...(search.trim() ? { search: search.trim() } : {}),
        limit: PAGE_SIZE,
        offset,
      }),
    placeholderData: keepPreviousData,
  });

  const rows = educators.data?.rows ?? [];
  const subjectOptions = (subjects.data ?? []).map((subject) => ({
    value: subject.key,
    label: subject.name,
  }));

  const columns: readonly Column<EducatorRow>[] = [
    {
      id: 'name',
      label: t('userForm.fullName'),
      render: (row) => (
        <span>
          <span className="font-semibold text-text">{row.fullName}</span>
          <span className="block text-xs text-text-muted">@{row.username}</span>
        </span>
      ),
    },
    {
      id: 'scope',
      label: t('teachers.scope'),
      render: (row) =>
        row.schools.length > 0
          ? row.schools.map((school) => school.schoolName).join(' · ')
          : t('teachers.noScope'),
      sortBy: (row) => row.schools.map((school) => school.schoolName).join(','),
    },
    {
      id: 'employeeCode',
      label: t('teachers.employeeCode'),
      render: (row) => row.employeeCode ?? '—',
    },
    {
      id: 'specialty',
      label: t('teachers.subjectSpecialties'),
      render: (row) =>
        row.subjectSpecialties.length > 0
          ? row.subjectSpecialties.map((subject) => subject.subjectName).join(' · ')
          : (row.specialty ?? '—'),
      sortBy: (row) => row.subjectSpecialties.map((subject) => subject.subjectName).join(','),
    },
    {
      id: 'link',
      label: t('common.actions'),
      render: (row) => (
        <div className="flex flex-wrap gap-1.5">
          <Button
            variant="secondary"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              setLinking(row);
            }}
          >
            {t('teachers.linkSchool')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              setSpecialising(row);
            }}
          >
            {t('teachers.editSubjects')}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('teachers.title')}
        subtitle={t('teachers.subtitle')}
        actions={
          <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
            {t('teachers.add')}
          </Button>
        }
      />

      {failure ? <p className="text-xs text-danger">{failure}</p> : null}

      <p className="rounded-xl border border-dashed border-border px-4 py-3 text-xs text-text-muted">
        {t('teachers.assignmentsNote')}
      </p>

      <label className="block max-w-md space-y-1.5">
        <span className="block text-xs font-medium text-text-muted">{t('admin.search')}</span>
        <Input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setOffset(0);
          }}
          placeholder={t('teachers.searchPlaceholder')}
        />
      </label>

      {educators.isPending ? <LoadingState /> : null}
      {educators.isError ? (
        <ErrorState error={educators.error} onRetry={() => educators.refetch()} />
      ) : null}

      {educators.isSuccess && rows.length === 0 ? (
        <EmptyState title={t('teachers.emptyTitle')} body={t('teachers.emptyBody')} />
      ) : null}

      {educators.isSuccess && rows.length > 0 ? (
        <>
          <DataTable
            rows={rows}
            columns={columns}
            keyOf={(row) => row.userKey}
            onRowClick={(row) => setOpenUser(row.userKey)}
            emptyTitle={t('teachers.emptyTitle')}
            caption={t('teachers.title')}
          />
          <Pager
            total={educators.data.total}
            limit={PAGE_SIZE}
            offset={offset}
            onOffsetChange={setOffset}
          />
        </>
      ) : null}

      {openUser !== null ? (
        <UserDetailDrawer userKey={openUser} onClose={() => setOpenUser(null)} />
      ) : null}

      {creating ? (
        <div className="space-y-4 rounded-2xl border border-accent/30 bg-surface p-4 sm:p-5">
          <div><h2 className="text-sm font-extrabold text-text">{t('teachers.add')}</h2><p className="mt-1 text-xs text-text-muted">{t('teachers.selectExistingUserHint')}</p></div>
          <label className="block space-y-1.5"><span className="block text-xs font-medium text-text-muted">{t('admin.search')}</span><Input value={teacherSearch} onChange={(event) => { setTeacherSearch(event.target.value); setSelectedTeacherUser(null); }} placeholder={t('teachers.searchPlaceholder')} /></label>
          {teacherSearch.trim().length >= 2 ? <TeacherUserResults search={teacherSearch} selected={selectedTeacherUser} onSelect={setSelectedTeacherUser} onError={(cause) => setFailure(cause instanceof Error ? cause.message : t('teachers.createFailed'))} /> : null}
          {selectedTeacherUser ? <div className="rounded-xl border border-border bg-surface-raised p-3"><p className="text-sm font-bold text-text">{selectedTeacherUser.fullName}</p><p className="text-xs text-text-muted">@{selectedTeacherUser.username}</p><p className="mt-2 text-xs text-text-muted">{selectedTeacherUser.educatorKey ? t('teachers.profileReady') : t('teachers.profileProvisionRequired')}</p></div> : null}
          {selectedTeacherUser ? <RecordEditor
            title={t('teachers.staffDetails')}
            fields={[
              { id: 'schoolKey', label: t('userForm.school'), kind: 'select', required: true, options: (schools.data ?? []).map((school) => ({ value: school.key, label: school.name })) },
              { id: 'employeeCode', label: t('teachers.employeeCode'), kind: 'text' },
              { id: 'subjectKeys', label: t('teachers.subjectSpecialties'), kind: 'multiselect', required: true, options: subjectOptions, hint: t('teachers.subjectSpecialtiesHint') },
              { id: 'specialty', label: t('teachers.specialtyNote'), kind: 'text' },
            ] satisfies readonly FieldSpec[]}
            initial={{ schoolKey: schools.data?.[0]?.key ?? '', employeeCode: '', subjectKeys: subjectOptions[0]?.value ?? '', specialty: '' }}
            isNew={false} saving={create.isPending} errorText={failure}
            onSave={(values) => create.mutate(values)}
            onClose={() => { setCreating(false); setSelectedTeacherUser(null); setTeacherSearch(''); setFailure(null); }}
          /> : null}
        </div>
      ) : null}

      {linking ? (
        <RecordEditor
          title={t('teachers.linkSchool')}
          fields={[
            {
              id: 'schoolKey',
              label: t('userForm.school'),
              kind: 'select',
              required: true,
              options: (schools.data ?? []).map((school) => ({ value: school.key, label: school.name })),
            },
          ] satisfies readonly FieldSpec[]}
          initial={{ schoolKey: linking.schools[0]?.schoolKey ?? '' }}
          isNew={false}
          saving={link.isPending}
          errorText={failure}
          onSave={(values) => link.mutate({ userKey: linking.userKey, schoolKey: values.schoolKey! })}
          onClose={() => {
            setLinking(null);
            setFailure(null);
          }}
        />
      ) : null}

      {specialising ? (
        <RecordEditor
          title={t('teachers.editSubjects')}
          fields={[
            {
              id: 'subjectKeys',
              label: t('teachers.subjectSpecialties'),
              kind: 'multiselect',
              required: true,
              options: subjectOptions,
              hint: t('teachers.subjectSpecialtiesHint'),
            },
          ] satisfies readonly FieldSpec[]}
          initial={{
            subjectKeys: specialising.subjectSpecialties
              .map((subject) => subject.subjectKey)
              .join(','),
          }}
          isNew={false}
          saving={updateSubjects.isPending}
          errorText={failure}
          onSave={(values) =>
            updateSubjects.mutate({ userKey: specialising.userKey, subjectKeys: splitKeys(values.subjectKeys) })
          }
          onClose={() => {
            setSpecialising(null);
            setFailure(null);
          }}
        />
      ) : null}
    </div>
  );

function TeacherUserResults({
  search,
  selected,
  onSelect,
  onError,
}: {
  readonly search: string;
  readonly selected: UserDetail | null;
  readonly onSelect: (user: UserDetail) => void;
  readonly onError: (cause: unknown) => void;
}): ReactNode {
  const { t } = useI18n();
  const users = useQuery({
    queryKey: queryKeys.provisioning.users({ search: search.trim(), limit: 20, offset: 0 }),
    queryFn: () => adminApi.users({ search: search.trim(), limit: 20, offset: 0 }),
    enabled: search.trim().length >= 2,
  });
  if (users.isPending) return <LoadingState />;
  if (users.isError) return <ErrorState error={users.error} onRetry={() => users.refetch()} />;
  if (selected || users.data.rows.length === 0) return null;
  return (
    <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface-raised">
      {users.data.rows.map((user: DirectoryUser) => (
        <button key={user.key} type="button" className="flex min-h-12 w-full items-center justify-between gap-3 px-3 text-start hover:bg-surface-subtle"
          onClick={() => adminApi.user(user.key).then(onSelect).catch(onError)}>
          <span><span className="block text-sm font-semibold text-text">{user.fullName}</span><span className="block text-xs text-text-muted">@{user.username}</span></span>
          <Badge tone="neutral">{user.roles.map((role) => t(('role.' + role) as never)).join(', ')}</Badge>
        </button>
      ))}
    </div>
  );
}

}
