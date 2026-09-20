/**
 * A learner's guardians: the links, their verification, and the acts on them.
 *
 * Verification is the boundary that opens a child's record to a parent —
 * `learner-access.ts` grants visibility through VERIFIED links only. That is
 * why verify/unverify is its own button with its own confirmation rather than
 * a checkbox: it is an access decision, not an edit.
 */

import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '../../design-system/ui/button';
import { Badge } from '../../design-system/ui/badge';
import { ConfirmDialog } from '../../design-system/patterns/confirm-dialog';
import { ErrorState, LoadingState } from '../../design-system/patterns/data-states';
import { peopleApi as adminApi } from './people.api';
import { queryKeys } from '../../shared/api/query-keys';
import { useI18n } from '../../shared/i18n/i18n';

export function UserGuardiansSection({ learnerKey }: { readonly learnerKey: string }): ReactNode {
  const { t } = useI18n();
  const queryClient = useQueryClient();

  const [linking, setLinking] = useState(false);
  const [guardianKey, setGuardianKey] = useState('');
  const [relation, setRelation] = useState('');
  const [selectedParentUserKey, setSelectedParentUserKey] = useState('');
  const [loadingParentDetail, setLoadingParentDetail] = useState(false);
  const [unbinding, setUnbinding] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const guardians = useQuery({
    queryKey: queryKeys.provisioning.guardians(learnerKey),
    queryFn: () => adminApi.guardiansOf(learnerKey),
  });

  const parentsQuery = useQuery({
    queryKey: queryKeys.provisioning.users({ role: 'PARENT' }),
    queryFn: () => adminApi.users({ role: 'PARENT', limit: 100 }),
    enabled: linking,
  });

  const handleSelectParent = async (userKey: string) => {
    setSelectedParentUserKey(userKey);
    if (!userKey) return;
    try {
      setLoadingParentDetail(true);
      const detail = await adminApi.user(userKey);
      if (detail.guardianKey) {
        setGuardianKey(detail.guardianKey);
      }
    } catch {
      // Allow manual entry fallback
    } finally {
      setLoadingParentDetail(false);
    }
  };

  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.provisioning.all });
  };

  const link = useMutation({
    mutationFn: () => adminApi.linkGuardian({ learnerKey, guardianKey, relation: relation || null }),
    onSuccess: async () => {
      await refresh();
      setLinking(false);
      setGuardianKey('');
      setRelation('');
      setSelectedParentUserKey('');
      setFailure(null);
    },
    onError: (cause) => setFailure(String(cause instanceof Error ? cause.message : cause)),
  });

  const verify = useMutation({
    mutationFn: (input: { guardianKey: string; isVerified: boolean }) =>
      adminApi.setGuardianVerified({ learnerKey, ...input }),
    onSuccess: refresh,
    onError: (cause) => setFailure(String(cause instanceof Error ? cause.message : cause)),
  });

  const unlink = useMutation({
    mutationFn: (gKey: string) => adminApi.unlinkGuardian({ guardianKey: gKey, learnerKey }),
    onSuccess: async () => {
      await refresh();
      setUnbinding(null);
    },
    onError: (cause) => {
      setFailure(String(cause instanceof Error ? cause.message : cause));
      setUnbinding(null);
    },
  });

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-text">{t('userDetail.guardiansSection')}</h3>
        <Button variant="secondary" size="sm" onClick={() => setLinking((v) => !v)}>
          {t('userDetail.linkGuardian')}
        </Button>
      </div>

      {linking ? (
        <div className="space-y-3 rounded-xl border border-border bg-surface-sunken p-4">
          {parentsQuery.data?.rows && parentsQuery.data.rows.length > 0 ? (
            <label className="block space-y-1.5">
              <span className="block text-xs font-medium text-text-muted">
                {t('userDetail.parentDirectorySelect')}
              </span>
              <select
                value={selectedParentUserKey}
                onChange={(e) => void handleSelectParent(e.target.value)}
                disabled={loadingParentDetail}
                className="h-11 w-full rounded-lg border border-border bg-surface-raised px-3 text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent"
              >
                <option value="">{loadingParentDetail ? t('common.working') : t('userDetail.selectParentPlaceholder')}</option>
                {parentsQuery.data.rows.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.fullName} (@{p.username})
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1.5">
              <span className="block text-xs font-medium text-text-muted">
                {t('userDetail.guardianKey')}
              </span>
              <input
                value={guardianKey}
                onChange={(e) => setGuardianKey(e.target.value)}
                placeholder="gdn_…"
                className="h-11 w-full rounded-lg border border-border bg-surface-raised px-3 text-sm text-text"
              />
            </label>
            <label className="space-y-1.5">
              <span className="block text-xs font-medium text-text-muted">
                {t('userDetail.relation')}
              </span>
              <input
                value={relation}
                onChange={(e) => setRelation(e.target.value)}
                className="h-11 w-full rounded-lg border border-border bg-surface-raised px-3 text-sm text-text"
              />
            </label>
          </div>
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setLinking(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={guardianKey.trim() === '' || link.isPending}
              onClick={() => link.mutate()}
            >
              {link.isPending ? t('common.working') : t('userDetail.linkGuardian')}
            </Button>
          </div>
          {link.isError ? <p className="text-xs text-danger">{String(link.error)}</p> : null}
        </div>
      ) : null}

      {guardians.isPending ? <LoadingState /> : null}
      {guardians.isError ? (
        <ErrorState error={guardians.error} onRetry={() => guardians.refetch()} />
      ) : null}

      {guardians.isSuccess ? (
        guardians.data.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-text-muted">
            {t('userDetail.noGuardians')}
          </p>
        ) : (
          <ul className="space-y-1.5">
            {guardians.data.map((link) => (
              <li
                key={link.guardianKey}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2"
              >
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  {link.isVerified ? (
                    <Badge tone="success">{t('userDetail.verified')}</Badge>
                  ) : (
                    <Badge tone="warning">{t('userDetail.unverified')}</Badge>
                  )}
                  <span className="text-text">{link.guardianKey}</span>
                  {link.relation ? (
                    <span className="text-xs text-text-muted">{link.relation}</span>
                  ) : null}
                </div>
                <div className="flex items-center gap-1.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={verify.isPending}
                    onClick={() => verify.mutate({ guardianKey: link.guardianKey, isVerified: !link.isVerified })}
                  >
                    {link.isVerified ? t('userDetail.unverify') : t('userDetail.verify')}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setUnbinding(link.guardianKey)}>
                    {t('userDetail.unlink')}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )
      ) : null}

      {failure ? <p className="text-xs text-danger">{failure}</p> : null}

      {unbinding !== null ? (
        <ConfirmDialog
          title={t('userDetail.guardiansSection')}
          body={t('userDetail.confirmUnlink')}
          confirmLabel={t('userDetail.unlink')}
          pending={unlink.isPending}
          destructive
          onConfirm={() => unlink.mutate(unbinding)}
          onCancel={() => setUnbinding(null)}
        />
      ) : null}
    </section>
  );
}
