/**
 * A user's roles and their school scope, with grant and revoke.
 *
 * Roles are scoped by the domain: a TEACHER at school A is not a TEACHER at
 * school B, and the grant row — not a field on the user — is what carries the
 * scope. This section renders grants, not role names flattened away, so the
 * difference between a platform-wide grant and a school-scoped one is visible
 * instead of guessed.
 */

import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '../../design-system/ui/button';
import { Badge } from '../../design-system/ui/badge';
import { ConfirmDialog } from '../../design-system/patterns/confirm-dialog';
import { peopleApi as adminApi, ALL_ROLES, type RoleName, type UserDetail } from './people.api';
import { schoolsApi } from '../schools/schools.api';
import { queryKeys } from '../../shared/api/query-keys';
import { useI18n } from '../../shared/i18n/i18n';
import type { MessageKey } from '../../shared/i18n/messages';

export function UserRolesSection({ user }: { readonly user: UserDetail }): ReactNode {
  const { t } = useI18n();
  const queryClient = useQueryClient();

  const [granting, setGranting] = useState(false);
  const [role, setRole] = useState<RoleName>('TEACHER');
  const [schoolKey, setSchoolKey] = useState('');
  const [revoking, setRevoking] = useState<{ role: RoleName; schoolKey: string | null } | null>(
    null,
  );

  const schools = useQuery({
    queryKey: queryKeys.administration.schools(),
    queryFn: () => schoolsApi.list(),
  });

  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.provisioning.all });
  };

  const grant = useMutation({
    mutationFn: () =>
      adminApi.grantRole({
        userKey: user.key,
        role,
        ...(schoolKey ? { schoolKey } : {}),
      }),
    onSuccess: async () => {
      await refresh();
      setGranting(false);
    },
  });

  const revoke = useMutation({
    mutationFn: (input: { role: RoleName; schoolKey: string | null }) =>
      adminApi.revokeRole({ userKey: user.key, ...input }),
    onSuccess: refresh,
  });

  const schoolNameOf = (key: string | null): string =>
    key ? (schools.data?.find((school) => school.key === key)?.name ?? key) : t('userDetail.noSchool');

  const heldRoles = new Set(user.roles.map((grant) => grant.role));

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-text">{t('userDetail.rolesSection')}</h3>
        <Button variant="secondary" size="sm" onClick={() => setGranting((v) => !v)}>
          {t('userDetail.grantRole')}
        </Button>
      </div>

      {granting ? (
        <div className="space-y-3 rounded-xl border border-border bg-surface-sunken p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1.5">
              <span className="block text-xs font-medium text-text-muted">
                {t('admin.role')}
              </span>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as RoleName)}
                className="h-11 w-full rounded-lg border border-border bg-surface-raised px-3 text-sm text-text"
              >
                {ALL_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {t(`role.${r}` as MessageKey)}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1.5">
              <span className="block text-xs font-medium text-text-muted">
                {t('userForm.school')}
              </span>
              <select
                value={schoolKey}
                onChange={(e) => setSchoolKey(e.target.value)}
                className="h-11 w-full rounded-lg border border-border bg-surface-raised px-3 text-sm text-text"
              >
                <option value="">{t('userForm.noSchool')}</option>
                {(schools.data ?? []).map((school) => (
                  <option key={school.key} value={school.key}>
                    {school.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setGranting(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" size="sm" disabled={grant.isPending} onClick={() => grant.mutate()}>
              {grant.isPending ? t('common.working') : t('userDetail.grantRole')}
            </Button>
          </div>
          {grant.isError ? (
            <p className="text-xs text-danger">{String(grant.error)}</p>
          ) : null}
        </div>
      ) : null}

      <ul className="space-y-1.5">
        {user.roles.map((grant) => (
          <li
            key={`${grant.role}-${grant.schoolKey ?? 'platform'}`}
            className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface px-3 py-2"
          >
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="accent">{t(`role.${grant.role}` as MessageKey)}</Badge>
              <span className="text-xs text-text-muted">{schoolNameOf(grant.schoolKey)}</span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setRevoking({ role: grant.role, schoolKey: grant.schoolKey })}
            >
              {t('userDetail.revoke')}
            </Button>
          </li>
        ))}
      </ul>

      {/* The roles not held — context for the grant form, not decoration. */}
      {heldRoles.size < ALL_ROLES.length && !granting ? (
        <p className="text-2xs text-text-muted">
          {ALL_ROLES.filter((r) => !heldRoles.has(r))
            .map((r) => t(`role.${r}` as MessageKey))
            .join(' · ')}
        </p>
      ) : null}

      {revoking ? (
        <ConfirmDialog
          title={t('userDetail.rolesSection')}
          body={t('userDetail.confirmRevoke', {
            role: t(`role.${revoking.role}` as MessageKey),
          })}
          confirmLabel={t('userDetail.revoke')}
          pending={revoke.isPending}
          destructive
          onConfirm={() => {
            revoke.mutate(revoking);
            setRevoking(null);
          }}
          onCancel={() => setRevoking(null)}
        />
      ) : null}
    </section>
  );
}
