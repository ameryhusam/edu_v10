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
import { Button } from '../../design-system/ui/button';
import { EmptyState, ErrorState, LoadingState } from '../../design-system/patterns/data-states';
import { PageHeader } from '../../design-system/patterns/page-header';
import { Pager } from '../../design-system/patterns/pager';
import { DataTable, type Column } from '../../design-system/patterns/data-table';
import { RecordEditor, type FieldSpec } from '../../design-system/patterns/record-editor';
import { UserDetailDrawer } from '../../features/people/user-detail-drawer';
import { adminApi, type EducatorRow } from '../../features/people/people.api';
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

  /** Hire: user + TEACHER grant at a school + staff profile, one act. */
  const create = useMutation({
    mutationFn: (values: Record<string, string>) =>
      administrationApi.educators.create({
        username: values.username!,
        fullName: values.fullName!,
        password: values.password!,
        email: values.email || null,
        phone: values.phone || null,
        schoolKey: values.schoolKey!,
        employeeCode: values.employeeCode || null,
        specialty: values.specialty || null,
        subjectKeys: splitKeys(values.subjectKeys),
      }),
    onSuccess: async () => {
      await refresh();
      setCreating(false);
      setFailure(null);
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
        <RecordEditor
          title={t('teachers.add')}
          fields={[
            { id: 'fullName', label: t('userForm.fullName'), kind: 'text', required: true },
            { id: 'username', label: t('userForm.username'), kind: 'text', required: true },
            {
              id: 'password',
              label: t('userForm.password'),
              kind: 'password',
              required: true,
              hint: t('userForm.passwordHint'),
            },
            { id: 'email', label: t('userForm.email'), kind: 'text' },
            { id: 'phone', label: t('userForm.phone'), kind: 'text' },
            {
              id: 'schoolKey',
              label: t('userForm.school'),
              kind: 'select',
              required: true,
              options: (schools.data ?? []).map((school) => ({ value: school.key, label: school.name })),
            },
            { id: 'employeeCode', label: t('teachers.employeeCode'), kind: 'text' },
            {
              id: 'subjectKeys',
              label: t('teachers.subjectSpecialties'),
              kind: 'multiselect',
              required: true,
              options: subjectOptions,
              hint: t('teachers.subjectSpecialtiesHint'),
            },
            { id: 'specialty', label: t('teachers.specialtyNote'), kind: 'text' },
          ] satisfies readonly FieldSpec[]}
          initial={{
            fullName: '',
            username: '',
            password: '',
            email: '',
            phone: '',
            schoolKey: schools.data?.[0]?.key ?? '',
            employeeCode: '',
            subjectKeys: subjectOptions[0]?.value ?? '',
            specialty: '',
          }}
          isNew
          saving={create.isPending}
          errorText={failure}
          onSave={(values) => create.mutate(values)}
          onClose={() => {
            setCreating(false);
            setFailure(null);
          }}
        />
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
}
