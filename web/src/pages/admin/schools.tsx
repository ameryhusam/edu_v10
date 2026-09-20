/**
 * Schools: list, search, lifecycle, and the door to each school's details.
 *
 * Schools are reference data the server returns whole, so search and filter
 * are client-side — unlike the people directory, where server-side paging is
 * the difference between usable and unusable at a real school district. The
 * distinction is size: dozens of schools versus thousands of people.
 *
 * Deleting is guarded by reference counts the server computed (enrolments and
 * role grants); deactivating is the retire lever that keeps history intact.
 */

import { useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '../../design-system/ui/button';
import { Input } from '../../design-system/ui/input';
import { ErrorState, LoadingState } from '../../design-system/patterns/data-states';
import { PageHeader } from '../../design-system/patterns/page-header';
import { DataTable, type Column } from '../../design-system/patterns/data-table';
import { ConfirmDialog } from '../../design-system/patterns/confirm-dialog';
import { RecordEditor, type FieldSpec } from '../../design-system/patterns/record-editor';
import { ActiveBadge } from '../../design-system/patterns/active-badge';
import { schoolsApi, type SchoolRecord } from '../../features/schools/schools.api';
import { queryKeys } from '../../shared/api/query-keys';
import { useSession } from '../../shared/auth/session';
import { useI18n } from '../../shared/i18n/i18n';
import { ApiError } from '../../shared/api/errors';
import { describeApiError } from '../../shared/api/error-messages';

export function SchoolsPage(): ReactNode {
  const { t, locale } = useI18n();
  const { hasRole } = useSession();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [editing, setEditing] = useState<{ values: Record<string, string>; isNew: boolean } | null>(
    null,
  );
  const [confirming, setConfirming] = useState<SchoolRecord | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const canWrite = hasRole('SYSTEM_ADMIN');

  const schools = useQuery({
    queryKey: queryKeys.administration.schools(),
    queryFn: () => schoolsApi.list(),
  });

  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.administration.all });
  };

  const describe = (cause: unknown): string =>
    cause instanceof ApiError ? describeApiError(cause, locale, t).title : t('catalogue.saveFailed');

  const save = useMutation({
    mutationFn: (values: Record<string, string>) =>
      editing?.isNew
        ? schoolsApi.save({ key: values.key!, name: values.name!, city: values.city || null })
        : schoolsApi.update(values.key!, { name: values.name!, city: values.city || null }),
    onSuccess: async () => {
      await refresh();
      setEditing(null);
      setFailure(null);
    },
    onError: (cause) => setFailure(describe(cause)),
  });

  const remove = useMutation({
    mutationFn: (key: string) => schoolsApi.remove(key),
    onSuccess: async () => {
      await refresh();
      setConfirming(null);
    },
    onError: (cause) => {
      setFailure(describe(cause));
      setConfirming(null);
    },
  });

  const toggleActive = useMutation({
    mutationFn: (input: { key: string; next: boolean }) =>
      schoolsApi.update(input.key, { isActive: input.next }),
    onSuccess: refresh,
    onError: (cause) => setFailure(describe(cause)),
  });

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (schools.data ?? []).filter((school) => {
      if (statusFilter === 'active' && !school.isActive) return false;
      if (statusFilter === 'inactive' && school.isActive) return false;
      if (!needle) return true;
      return (
        school.name.toLowerCase().includes(needle) ||
        school.key.toLowerCase().includes(needle) ||
        (school.city ?? '').toLowerCase().includes(needle)
      );
    });
  }, [schools.data, search, statusFilter]);

  const columns: readonly Column<SchoolRecord>[] = [
    {
      id: 'name',
      label: t('catalogue.name'),
      render: (school) => <span className="font-semibold text-text">{school.name}</span>,
      sortBy: (school) => school.name,
    },
    { id: 'key', label: t('catalogue.key'), render: (school) => school.key, sortBy: (school) => school.key },
    { id: 'city', label: t('catalogue.city'), render: (school) => school.city ?? '—' },
    {
      id: 'state',
      label: t('catalogue.state'),
      render: (school) => <ActiveBadge isActive={school.isActive} />,
    },
    {
      id: 'enrollments',
      label: t('schools.enrollments'),
      numeric: true,
      render: (school) => school.enrollmentCount,
      sortBy: (school) => school.enrollmentCount,
    },
    {
      id: 'grants',
      label: t('schools.grants'),
      numeric: true,
      render: (school) => school.roleGrantCount,
      sortBy: (school) => school.roleGrantCount,
    },
  ];

  const fields: readonly FieldSpec[] = [
    { id: 'key', label: t('catalogue.key'), kind: 'text', required: true, visible: 'create', hint: t('catalogue.fixedAtCreation') },
    { id: 'name', label: t('catalogue.name'), kind: 'text', required: true },
    { id: 'city', label: t('catalogue.city'), kind: 'text' },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('schools.title')}
        subtitle={t('schools.subtitle')}
        actions={
          canWrite ? (
            <Button
              variant="primary"
              size="sm"
              onClick={() => setEditing({ values: { key: '', name: '', city: '' }, isNew: true })}
            >
              {t('catalogue.add')}
            </Button>
          ) : undefined
        }
      />

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex-1 basis-64 space-y-1.5">
          <span className="block text-xs font-medium text-text-muted">{t('admin.search')}</span>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('schools.search')}
          />
        </label>
        <label className="space-y-1.5">
          <span className="block text-xs font-medium text-text-muted">{t('catalogue.state')}</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'all' | 'active' | 'inactive')}
            className="h-11 min-w-40 rounded-lg border border-border bg-surface-raised px-3 text-sm text-text"
          >
            <option value="all">{t('common.all')}</option>
            <option value="active">{t('catalogue.active')}</option>
            <option value="inactive">{t('catalogue.inactive')}</option>
          </select>
        </label>
      </div>

      {failure ? <p className="text-xs text-danger">{failure}</p> : null}

      {schools.isPending ? <LoadingState /> : null}
      {schools.isError ? (
        <ErrorState error={schools.error} onRetry={() => schools.refetch()} />
      ) : null}

      {schools.isSuccess ? (
        <DataTable
          rows={filtered}
          columns={columns}
          keyOf={(school) => school.key}
          onRowClick={(school) => navigate(`/admin/schools/${school.key}`)}
          emptyTitle={t('schools.emptyTitle')}
          emptyBody={t('schools.emptyBody')}
          caption={t('schools.title')}
          rowActions={
            canWrite
              ? (school) => (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={toggleActive.isPending}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleActive.mutate({ key: school.key, next: !school.isActive });
                      }}
                    >
                      {school.isActive ? t('catalogue.deactivate') : t('catalogue.activate')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditing({
                          values: { key: school.key, name: school.name, city: school.city ?? '' },
                          isNew: false,
                        });
                      }}
                    >
                      {t('catalogue.edit')}
                    </Button>
                    {school.enrollmentCount + school.roleGrantCount === 0 ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirming(school);
                        }}
                      >
                        {t('catalogue.delete')}
                      </Button>
                    ) : null}
                    <Link
                      to={`/admin/schools/${school.key}`}
                      className="inline-flex h-9 items-center rounded-lg px-3 text-sm font-medium text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {t('schools.details')}
                    </Link>
                  </>
                )
              : undefined
          }
        />
      ) : null}

      {confirming ? (
        <ConfirmDialog
          title={t('catalogue.confirmDeleteTitle')}
          body={t('catalogue.confirmDelete', { name: confirming.name })}
          confirmLabel={t('catalogue.delete')}
          pending={remove.isPending}
          destructive
          onConfirm={() => remove.mutate(confirming.key)}
          onCancel={() => setConfirming(null)}
        />
      ) : null}

      {editing ? (
        <RecordEditor
          title={t('schools.title')}
          fields={fields}
          initial={editing.values}
          isNew={editing.isNew}
          saving={save.isPending}
          errorText={failure}
          onSave={(values) => save.mutate(values)}
          onClose={() => {
            setEditing(null);
            setFailure(null);
          }}
        />
      ) : null}
    </div>
  );
}
