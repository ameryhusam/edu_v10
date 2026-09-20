/**
 * The administrator's people screen — the user directory (gap G6) grown into
 * the full management surface: search, create, inspect, edit, act.
 *
 * Searching and filtering happen on the **server**. A client that fetched
 * every user and filtered in memory would be fast on the demo database and
 * unusable on a real school's, and it would quietly cap the directory at
 * whatever one page happened to hold.
 *
 * Row actions are deliberately minimal in the table (open the record) — the
 * acts that change a person live behind the drawer, where the consequences
 * (a suspended user, an archived account) are spelled out next to the roles
 * and history they apply to. There is no delete, by design: a person who has
 * answered a question is part of the evidence record.
 */

import { useState, type ReactNode } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '../../design-system/ui/button';
import { Input } from '../../design-system/ui/input';
import { Badge } from '../../design-system/ui/badge';
import { EmptyState, ErrorState, LoadingState } from '../../design-system/patterns/data-states';
import { PageHeader } from '../../design-system/patterns/page-header';
import { Pager } from '../../design-system/patterns/pager';
import { DataTable, type Column } from '../../design-system/patterns/data-table';
import { RecordEditor, type FieldSpec } from '../../design-system/patterns/record-editor';
import { UserDetailDrawer } from '../../features/people/user-detail-drawer';
import { UserStatusBadge } from '../../features/people/user-status-badge';
import { adminApi, ALL_ROLES, ALL_STATUSES, type DirectoryUser, type RoleName, type UserStatus } from '../../features/people/people.api';
import { schoolsApi } from '../../features/schools/schools.api';
import { queryKeys } from '../../shared/api/query-keys';
import { useI18n } from '../../shared/i18n/i18n';
import { formatCount } from '../../shared/format/numbers';
import { ApiError } from '../../shared/api/errors';
import { describeApiError } from '../../shared/api/error-messages';
import type { MessageKey } from '../../shared/i18n/messages';

const PAGE_SIZE = 25;

export function UserDirectoryPage(): ReactNode {
  const { t, locale } = useI18n();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [role, setRole] = useState<RoleName | ''>('');
  const [status, setStatus] = useState<UserStatus | ''>('');
  const [offset, setOffset] = useState(0);
  const [openUser, setOpenUser] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const query = {
    ...(search.trim() ? { search: search.trim() } : {}),
    ...(role ? { role } : {}),
    ...(status ? { status } : {}),
    limit: PAGE_SIZE,
    offset,
  };

  const directory = useQuery({
    queryKey: queryKeys.provisioning.users(query),
    queryFn: () => adminApi.users(query),
    // Keeps the previous page visible while the next one loads, so paging does
    // not flash an empty list.
    placeholderData: keepPreviousData,
  });

  const schools = useQuery({
    queryKey: queryKeys.administration.schools(),
    queryFn: () => schoolsApi.list(),
    // The create form needs it; a directory with no create button does not.
    enabled: creating,
  });

  const create = useMutation({
    mutationFn: (values: Record<string, string>) =>
      adminApi.createUser({
        username: values.username!,
        fullName: values.fullName!,
        password: values.password!,
        email: values.email || null,
        phone: values.phone || null,
        roles: (values.roles ?? '').split(',').filter(Boolean),
        schoolKey: values.schoolKey || null,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.provisioning.all });
      await queryClient.invalidateQueries({ queryKey: queryKeys.administration.all });
      setCreating(false);
      setFailure(null);
    },
    onError: (cause) =>
      setFailure(
        cause instanceof ApiError ? describeApiError(cause, locale, t).title : t('catalogue.saveFailed'),
      ),
  });

  /** Any filter change resets to the first page — page 3 of a new filter is nowhere. */
  function applyFilter(fn: () => void): void {
    fn();
    setOffset(0);
  }

  const selectClass =
    'h-11 min-w-40 rounded-lg border border-border bg-surface-raised px-3 text-sm text-text';

  const columns: readonly Column<DirectoryUser>[] = [
    {
      id: 'name',
      label: t('userForm.fullName'),
      render: (user) => <span className="font-semibold text-text">{user.fullName}</span>,
    },
    { id: 'username', label: t('userForm.username'), render: (user) => user.username },
    { id: 'email', label: t('userForm.email'), render: (user) => user.email ?? '—' },
    {
      id: 'roles',
      label: t('userForm.roles'),
      render: (user) => (
        <span className="flex flex-wrap gap-1">
          {user.roles.map((r) => (
            <Badge key={r} tone="neutral">
              {t(`role.${r}` as MessageKey)}
            </Badge>
          ))}
        </span>
      ),
    },
    {
      id: 'status',
      label: t('admin.status'),
      render: (user) => <UserStatusBadge status={user.status} />,
    },
  ];

  const createFields: readonly FieldSpec[] = [
    { id: 'username', label: t('userForm.username'), kind: 'text', required: true },
    { id: 'fullName', label: t('userForm.fullName'), kind: 'text', required: true },
    { id: 'password', label: t('userForm.password'), kind: 'password', required: true, hint: t('userForm.passwordHint') },
    { id: 'email', label: t('userForm.email'), kind: 'text' },
    { id: 'phone', label: t('userForm.phone'), kind: 'text' },
    {
      id: 'roles',
      label: t('userForm.roles'),
      kind: 'multiselect',
      required: true,
      hint: t('userForm.rolesHint'),
      options: ALL_ROLES.map((r) => ({ value: r, label: t(`role.${r}` as MessageKey) })),
    },
    {
      id: 'schoolKey',
      label: t('userForm.school'),
      kind: 'select',
      options: [
        { value: '', label: t('userForm.noSchool') },
        ...(schools.data ?? []).map((school) => ({ value: school.key, label: school.name })),
      ],
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('admin.usersTitle')}
        subtitle={t('admin.usersSubtitle')}
        actions={
          <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
            {t('admin.createUser')}
          </Button>
        }
      />

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex-1 basis-56 space-y-1.5">
          <span className="block text-xs font-medium text-text-muted">{t('admin.search')}</span>
          <Input
            value={search}
            onChange={(e) => applyFilter(() => setSearch(e.target.value))}
            placeholder={t('admin.searchPlaceholder')}
          />
        </label>

        <label className="space-y-1.5">
          <span className="block text-xs font-medium text-text-muted">{t('admin.role')}</span>
          <select
            value={role}
            onChange={(e) => applyFilter(() => setRole(e.target.value as RoleName | ''))}
            className={selectClass}
          >
            <option value="">{t('admin.anyRole')}</option>
            {ALL_ROLES.map((r) => (
              <option key={r} value={r}>
                {t(`role.${r}` as MessageKey)}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1.5">
          <span className="block text-xs font-medium text-text-muted">{t('admin.status')}</span>
          <select
            value={status}
            onChange={(e) => applyFilter(() => setStatus(e.target.value as UserStatus | ''))}
            className={selectClass}
          >
            <option value="">{t('admin.anyStatus')}</option>
            {ALL_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`userStatus.${s}` as MessageKey)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {directory.isPending ? (
        <LoadingState />
      ) : directory.isError ? (
        <ErrorState error={directory.error} onRetry={() => void directory.refetch()} />
      ) : directory.data.rows.length === 0 ? (
        <EmptyState title={t('admin.noUsers')} body={t('admin.noUsersHint')} />
      ) : (
        <>
          <p className="text-xs text-text-muted">
            {t('admin.resultCount', { count: formatCount(locale, directory.data.total) })}
          </p>

          <DataTable
            rows={directory.data.rows}
            columns={columns}
            keyOf={(user) => user.key}
            onRowClick={(user) => setOpenUser(user.key)}
            emptyTitle={t('admin.noUsers')}
            caption={t('admin.usersTitle')}
          />

          <Pager
            total={directory.data.total}
            limit={PAGE_SIZE}
            offset={offset}
            onOffsetChange={setOffset}
          />
        </>
      )}

      {openUser !== null ? (
        <UserDetailDrawer userKey={openUser} onClose={() => setOpenUser(null)} />
      ) : null}

      {creating ? (
        <RecordEditor
          title={t('admin.createUser')}
          fields={createFields}
          initial={{ username: '', fullName: '', password: '', email: '', phone: '', roles: '', schoolKey: '' }}
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
    </div>
  );
}
