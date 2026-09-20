/**
 * One user, in full: identity, status actions, scoped roles, and the sections
 * their profiles imply — enrolments for a learner, guardianship for a child,
 * staff details for an educator.
 *
 * The profiles are extensions of the person, never separate accounts: the
 * drawer renders EducatorProfile/LearnerProfile/GuardianProfile as fields on
 * the user it is already showing. There is no second authentication surface
 * here and no second user record behind it.
 */

import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { EntityDrawer } from '../../design-system/patterns/entity-drawer';
import { ConfirmDialog } from '../../design-system/patterns/confirm-dialog';
import { Button } from '../../design-system/ui/button';
import { LoadingState, ErrorState } from '../../design-system/patterns/data-states';
import { RecordEditor, type FieldSpec } from '../../design-system/patterns/record-editor';
import { UserRolesSection } from './user-roles-section';
import { UserEnrollmentsSection } from './user-enrollments-section';
import { UserGuardiansSection } from './user-guardians-section';
import { UserStatusBadge } from './user-status-badge';
import { peopleApi as adminApi, type UserDetail, type UserStatus } from './people.api';
import { queryKeys } from '../../shared/api/query-keys';
import { useI18n } from '../../shared/i18n/i18n';
import { ApiError } from '../../shared/api/errors';
import { describeApiError } from '../../shared/api/error-messages';

function ProfileFields({
  user,
  onEdit,
}: {
  readonly user: UserDetail;
  readonly onEdit: () => void;
}): ReactNode {
  const { t } = useI18n();
  const rows: ReadonlyArray<[string, string]> = [
    [t('userForm.username'), user.username],
    [t('userForm.fullName'), user.fullName],
    [t('userForm.email'), user.email ?? '—'],
    [t('userForm.phone'), user.phone ?? '—'],
  ];

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-text">{t('userDetail.profile')}</h3>
        <Button variant="ghost" size="sm" onClick={onEdit}>
          {t('userDetail.edit')}
        </Button>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-xl border border-border bg-surface-sunken p-4 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="col-span-2 grid grid-cols-subgrid">
            <dt className="text-xs font-medium text-text-muted">{label}</dt>
            <dd className="truncate text-text">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function EducatorFields({ user }: { readonly user: UserDetail }): ReactNode {
  const { t } = useI18n();
  if (!user.educatorKey) return null;
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold text-text">{t('userDetail.educatorSection')}</h3>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-xl border border-border bg-surface-sunken p-4 text-sm">
        <div className="col-span-2 grid grid-cols-subgrid">
          <dt className="text-xs font-medium text-text-muted">{t('userDetail.employeeCode')}</dt>
          <dd className="text-text">{user.employeeCode ?? '—'}</dd>
        </div>
        <div className="col-span-2 grid grid-cols-subgrid">
          <dt className="text-xs font-medium text-text-muted">{t('userDetail.specialty')}</dt>
          <dd className="text-text">
            {user.subjectSpecialties.length > 0
              ? user.subjectSpecialties.map((subject) => subject.subjectName).join(' · ')
              : (user.specialty ?? '—')}
          </dd>
        </div>
      </dl>
    </section>
  );
}

export function UserDetailDrawer({
  userKey,
  onClose,
}: {
  readonly userKey: string;
  readonly onClose: () => void;
}): ReactNode {
  const { t, locale } = useI18n();
  const queryClient = useQueryClient();

  const [editing, setEditing] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const user = useQuery({
    queryKey: queryKeys.provisioning.user(userKey),
    queryFn: () => adminApi.user(userKey),
  });

  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.provisioning.all });
  };

  const describe = (cause: unknown): string =>
    cause instanceof ApiError ? describeApiError(cause, locale, t).title : t('catalogue.saveFailed');

  const save = useMutation({
    mutationFn: (values: Record<string, string>) =>
      adminApi.updateUser({
        userKey,
        ...(values.fullName ? { fullName: values.fullName } : {}),
        ...(values.email ? { email: values.email } : {}),
        ...(values.phone ? { phone: values.phone } : {}),
      }),
    onSuccess: async () => {
      await refresh();
      setEditing(false);
      setFailure(null);
    },
    onError: (cause) => setFailure(describe(cause)),
  });

  const changeStatus = useMutation({
    mutationFn: (status: UserStatus) => adminApi.changeStatus({ userKey, status }),
    onSuccess: async () => {
      await refresh();
      setArchiving(false);
    },
    onError: (cause) => {
      setFailure(describe(cause));
      setArchiving(false);
    },
  });

  if (user.isPending) {
    return (
      <EntityDrawer title={t('common.working')} onClose={onClose}>
        <LoadingState />
      </EntityDrawer>
    );
  }
  if (user.isError || !user.data) {
    return (
      <EntityDrawer title={t('state.error.title')} onClose={onClose}>
        <ErrorState error={user.error} onRetry={() => user.refetch()} />
      </EntityDrawer>
    );
  }

  const detail = user.data;

  const editFields: readonly FieldSpec[] = [
    { id: 'fullName', label: t('userForm.fullName'), kind: 'text', required: true },
    { id: 'email', label: t('userForm.email'), kind: 'text' },
    { id: 'phone', label: t('userForm.phone'), kind: 'text' },
  ];

  return (
    <EntityDrawer
      title={detail.fullName}
      subtitle={`@${detail.username}`}
      badges={<UserStatusBadge status={detail.status} />}
      onClose={onClose}
    >
      <ProfileFields user={detail} onEdit={() => setEditing(true)} />

      <div className="flex flex-wrap items-center gap-2">
        {detail.status !== 'SUSPENDED' && detail.status !== 'ARCHIVED' ? (
          <Button
            variant="secondary"
            size="sm"
            disabled={changeStatus.isPending}
            onClick={() => changeStatus.mutate('SUSPENDED')}
          >
            {t('admin.suspend')}
          </Button>
        ) : null}
        {detail.status === 'SUSPENDED' ? (
          <Button
            variant="secondary"
            size="sm"
            disabled={changeStatus.isPending}
            onClick={() => changeStatus.mutate('ACTIVE')}
          >
            {t('admin.reinstate')}
          </Button>
        ) : null}
        {detail.status !== 'ARCHIVED' ? (
          <Button variant="secondary" size="sm" onClick={() => setArchiving(true)}>
            {t('admin.archive')}
          </Button>
        ) : null}
        {detail.status === 'ARCHIVED' ? (
          <Button
            variant="secondary"
            size="sm"
            disabled={changeStatus.isPending}
            onClick={() => changeStatus.mutate('ACTIVE')}
          >
            {t('admin.reinstate')}
          </Button>
        ) : null}
      </div>

      {failure ? <p className="text-xs text-danger">{failure}</p> : null}

      <UserRolesSection user={detail} />

      {detail.learnerKey ? <UserEnrollmentsSection learnerKey={detail.learnerKey} /> : null}
      {detail.learnerKey ? <UserGuardiansSection learnerKey={detail.learnerKey} /> : null}
      <EducatorFields user={detail} />

      {editing ? (
        <RecordEditor
          title={t('userDetail.edit')}
          fields={editFields}
          initial={{
            fullName: detail.fullName,
            email: detail.email ?? '',
            phone: detail.phone ?? '',
          }}
          isNew={false}
          saving={save.isPending}
          errorText={failure}
          onSave={(values) => save.mutate(values)}
          onClose={() => {
            setEditing(false);
            setFailure(null);
          }}
        />
      ) : null}

      {archiving ? (
        <ConfirmDialog
          title={t('admin.archiveConfirm')}
          body={t('userDetail.confirmArchiveBody', { name: detail.fullName })}
          confirmLabel={t('admin.archive')}
          pending={changeStatus.isPending}
          destructive
          onConfirm={() => changeStatus.mutate('ARCHIVED')}
          onCancel={() => setArchiving(false)}
        />
      ) : null}
    </EntityDrawer>
  );
}
