/**
 * A concept's authoring detail: its misconceptions and its prerequisite
 * graph, including a cross-grade prerequisite (a concept from another
 * textbook entirely — a real case the domain already supports, see
 * `content.prerequisite_out_of_scope`'s absence for edges the server accepts).
 *
 * Legacy UX reused: legacy/CrossGradePrerequisiteModal paired a "source
 * textbook" picker with its outline tree so an author could reach a
 * prerequisite outside the open book without memorising a key. The picker
 * here is the same two-step shape (pick a book, then a concept in it),
 * rebuilt against the current outline/concept-detail endpoints instead of the
 * legacy curriculum API.
 */

import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge } from '../../design-system/ui/badge';
import { Button } from '../../design-system/ui/button';
import { ErrorState, LoadingState } from '../../design-system/patterns/data-states';
import { ConfirmDialog } from '../../design-system/patterns/confirm-dialog';
import { queryKeys } from '../../shared/api/query-keys';
import { useI18n } from '../../shared/i18n/i18n';
import { ApiError } from '../../shared/api/errors';
import { describeApiError } from '../../shared/api/error-messages';
import { textbookAdministrationApi } from './content.api';
import { MisconceptionForm, PrerequisiteLinkForm } from './concept-detail-forms';

export function ConceptDetailDrawer({
  conceptKey,
  onClose,
}: {
  readonly conceptKey: string;
  readonly onClose: () => void;
}): ReactNode {
  const { t, locale } = useI18n();
  const queryClient = useQueryClient();

  const [addingMisconception, setAddingMisconception] = useState(false);
  const [addingPrerequisite, setAddingPrerequisite] = useState(false);
  const [unlinking, setUnlinking] = useState<{ conceptKey: string; name: string } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const detail = useQuery({
    queryKey: queryKeys.content.conceptDetail(conceptKey),
    queryFn: () => textbookAdministrationApi.conceptDetail(conceptKey),
  });

  const describe = (cause: unknown): string =>
    cause instanceof ApiError ? describeApiError(cause, locale, t).title : t('catalogue.saveFailed');

  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.content.conceptDetail(conceptKey) });
    await queryClient.invalidateQueries({ queryKey: queryKeys.content.all });
  };

  const unlink = useMutation({
    mutationFn: (prerequisiteKey: string) =>
      textbookAdministrationApi.unlinkPrerequisite({ conceptKey, prerequisiteKey }),
    onSuccess: async () => {
      await refresh();
      setUnlinking(null);
    },
    onError: (cause) => {
      setFailure(describe(cause));
      setUnlinking(null);
    },
  });

  const title = detail.data?.name ?? conceptKey;
  const locked = detail.data?.textbookStatus === 'PUBLISHED' || detail.data?.textbookStatus === 'ARCHIVED';

  return (
    <div
      className="fixed inset-0 z-modal flex justify-end bg-scrim"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={t('content.conceptDetail')}
    >
      <div
        className="flex h-full w-full max-w-xl flex-col overflow-hidden border-s border-border bg-surface-raised shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <p className="text-2xs font-bold uppercase tracking-wide text-text-muted">
              {t('content.conceptDetail')}
            </p>
            <h2 className="text-lg font-bold text-text">{title}</h2>
            {detail.data ? <p className="text-xs text-text-muted">{detail.data.lessonName}</p> : null}
          </div>
          <Button variant="ghost" size="iconSm" aria-label={t('common.close')} onClick={onClose}>
            ✕
          </Button>
        </header>

        <div className="flex-1 space-y-6 overflow-y-auto p-5">
          {detail.isPending ? <LoadingState /> : null}
          {detail.isError ? <ErrorState error={detail.error} onRetry={() => detail.refetch()} /> : null}

          {detail.isSuccess ? (
            <>
              <section className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-text">{t('content.misconceptionsSection')}</h3>
                  {!locked ? (
                    <Button variant="secondary" size="sm" onClick={() => setAddingMisconception(true)}>
                      {t('content.addMisconception')}
                    </Button>
                  ) : null}
                </div>

                {addingMisconception ? (
                  <MisconceptionForm
                    conceptKey={conceptKey}
                    onDone={async () => {
                      await refresh();
                      setAddingMisconception(false);
                    }}
                    onCancel={() => setAddingMisconception(false)}
                  />
                ) : null}

                {detail.data.misconceptions.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-border px-4 py-4 text-center text-xs text-text-muted">
                    {t('content.noMisconceptions')}
                  </p>
                ) : (
                  <ul className="space-y-1.5">
                    {detail.data.misconceptions.map((mis) => (
                      <li key={mis.key} className="rounded-lg border border-border bg-surface px-3 py-2">
                        <p className="text-sm font-medium text-text">{mis.name}</p>
                        <p className="text-xs text-text-muted">{mis.description}</p>
                        {mis.remediation ? (
                          <p className="mt-1 text-2xs text-success">{mis.remediation}</p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-text">{t('content.prerequisitesSection')}</h3>
                  {!locked ? (
                    <Button variant="secondary" size="sm" onClick={() => setAddingPrerequisite(true)}>
                      {t('content.addPrerequisite')}
                    </Button>
                  ) : null}
                </div>

                {addingPrerequisite ? (
                  <PrerequisiteLinkForm
                    conceptKey={conceptKey}
                    ownerTextbookKey={detail.data.textbookKey}
                    onDone={async () => {
                      await refresh();
                      setAddingPrerequisite(false);
                    }}
                    onCancel={() => setAddingPrerequisite(false)}
                  />
                ) : null}

                <div className="space-y-2">
                  <p className="text-2xs font-medium text-text-muted">{t('content.requiresLabel')}</p>
                  {detail.data.requires.length === 0 ? (
                    <p className="text-xs text-text-muted">{t('content.noPrerequisites')}</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {detail.data.requires.map((edge) => (
                        <li
                          key={edge.conceptKey}
                          className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2"
                        >
                          <div>
                            <p className="text-sm text-text">{edge.conceptName}</p>
                            {edge.textbookKey !== detail.data!.textbookKey ? (
                              <Badge tone="accent">{edge.textbookTitle}</Badge>
                            ) : null}
                          </div>
                          {!locked ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setUnlinking({ conceptKey: edge.conceptKey, name: edge.conceptName })}
                            >
                              {t('content.unlinkPrerequisite')}
                            </Button>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="space-y-2">
                  <p className="text-2xs font-medium text-text-muted">{t('content.requiredByLabel')}</p>
                  {detail.data.requiredBy.length === 0 ? (
                    <p className="text-xs text-text-muted">{t('content.noPrerequisites')}</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {detail.data.requiredBy.map((edge) => (
                        <li key={edge.conceptKey} className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text">
                          {edge.conceptName}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </section>
            </>
          ) : null}

          {failure ? <p className="text-xs text-danger">{failure}</p> : null}
        </div>
      </div>

      {unlinking !== null ? (
        <ConfirmDialog
          title={t('content.unlinkPrerequisite')}
          body={t('content.confirmUnlinkPrerequisite', { name: unlinking.name })}
          confirmLabel={t('content.unlinkPrerequisite')}
          pending={unlink.isPending}
          destructive
          onConfirm={() => unlink.mutate(unlinking.conceptKey)}
          onCancel={() => setUnlinking(null)}
        />
      ) : null}
    </div>
  );
}

