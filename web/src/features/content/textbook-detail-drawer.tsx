/**
 * One textbook, in full: its facts and the schools that teach it.
 *
 * Edu7 receives textbooks as already-approved external sources. This drawer
 * therefore focuses on the administrative facts the project actually owns:
 * identity, term/grade coordinates, content counts, and school adoption.
 *
 * Adoption is addressed by the (textbook, school, year) triple — the same
 * identity the DELETE carries in its body.
 */

import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '../../design-system/ui/button';
import { ErrorState, LoadingState } from '../../design-system/patterns/data-states';
import { ConfirmDialog } from '../../design-system/patterns/confirm-dialog';
import { textbookSubtitleParts } from '../../design-system/patterns/textbook-label';
import { PublicationBadge } from './publication-badge';
import { actionsFor } from '../../education/authoring/question-form-utils';
import { TextbookEditModal } from './textbook-edit-modal';
import { TextbookAccreditModal } from './textbook-accredit-modal';
import {
  textbookAdministrationApi,
  type PublicationAction,
  type TextbookSummary,
  type AdoptionRow,
} from './content.api';
import { queryKeys } from '../../shared/api/query-keys';
import { useSession } from '../../shared/auth/session';
import { useI18n } from '../../shared/i18n/i18n';
import { ApiError } from '../../shared/api/errors';
import { describeApiError } from '../../shared/api/error-messages';
import { downloadJson } from '../../shared/platform/download';
import type { MessageKey } from '../../shared/i18n/messages';

const TRANSITION_LABEL: Record<PublicationAction, MessageKey> = {
  SUBMIT: 'textbookAdmin.submit',
  APPROVE: 'textbookAdmin.approve',
  REJECT: 'textbookAdmin.reject',
  ARCHIVE: 'textbookAdmin.archive',
  RESTORE: 'textbookAdmin.restore',
};

export function TextbookDetailDrawer({
  textbook,
  onClose,
}: {
  readonly textbook: TextbookSummary;
  readonly onClose: () => void;
}): ReactNode {
  const { t, locale } = useI18n();
  const queryClient = useQueryClient();
  const { hasRole } = useSession();
  const mayAdopt = hasRole('SYSTEM_ADMIN', 'SCHOOL_ADMIN');
  const mayAuthor = hasRole('SYSTEM_ADMIN', 'SCHOOL_ADMIN', 'CONTENT_AUTHOR');
  const mayApprove = hasRole('SYSTEM_ADMIN', 'SCHOOL_ADMIN');

  const [withdrawing, setWithdrawing] = useState<AdoptionRow | null>(null);
  const [confirmingAction, setConfirmingAction] = useState<PublicationAction | null>(null);
  const [confirmingDirectPublish, setConfirmingDirectPublish] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isAccrediting, setIsAccrediting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const adoptions = useQuery({
    queryKey: queryKeys.textbookAdministration.adoptions({ textbookKey: textbook.key }),
    queryFn: () => textbookAdministrationApi.adoptions({ textbookKey: textbook.key }),
  });

  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.textbookAdministration.all });
    await queryClient.invalidateQueries({ queryKey: queryKeys.administration.all });
  };

  const describe = (cause: unknown): string =>
    cause instanceof ApiError ? describeApiError(cause, locale, t).title : t('catalogue.saveFailed');

  const transition = useMutation({
    mutationFn: (action: PublicationAction) =>
      textbookAdministrationApi.transition(textbook.key, action),
    onSuccess: async () => {
      await refresh();
      setConfirmingAction(null);
      setFailure(null);
    },
    onError: (cause) => {
      setFailure(describe(cause));
      setConfirmingAction(null);
    },
  });

  const directPublish = useMutation({
    mutationFn: async () => {
      await textbookAdministrationApi.transition(textbook.key, 'SUBMIT');
      await textbookAdministrationApi.transition(textbook.key, 'APPROVE');
    },
    onSuccess: async () => {
      await refresh();
      setConfirmingDirectPublish(false);
      setFailure(null);
    },
    onError: (cause) => {
      setFailure(describe(cause));
      setConfirmingDirectPublish(false);
    },
  });

  const download = (): void => {
    textbookAdministrationApi
      .exportTextbook(textbook.key)
      .then((pkg) => downloadJson(`${textbook.key}.json`, pkg))
      .catch((cause) => setFailure(describe(cause)));
  };

  const unadopt = useMutation({
    mutationFn: (row: AdoptionRow) =>
      textbookAdministrationApi.unadopt({
        textbookKey: row.textbookKey,
        schoolKey: row.schoolKey,
        academicYearKey: row.academicYearKey,
      }),
    onSuccess: async () => {
      await refresh();
      setWithdrawing(null);
    },
    onError: (cause) => {
      setFailure(describe(cause));
      setWithdrawing(null);
    },
  });

  const facts: ReadonlyArray<[MessageKey, string]> = [
    ['textbookAdmin.textbook', textbook.title],
    ['collection.subjects', textbook.subjectName],
    ['collection.grades', textbook.gradeName],
    ['collection.terms', textbook.termName],
    ['textbookAdmin.edition', textbook.edition],
    ['textbookAdmin.unitsCount', String(textbook.unitCount)],
    ['textbookAdmin.questionsCount', String(textbook.questionCount)],
  ];

  // SUBMIT/REJECT are an author's decision about their own draft; APPROVE is
  // reserved for an administrator (requireApprover on the backend enforces
  // this exactly — this list only decides which buttons are worth drawing).
  const available = mayAuthor
    ? actionsFor(textbook.status).filter((action) => action !== 'APPROVE' || mayApprove)
    : [];

  return (
    <div
      className="fixed inset-0 z-modal flex justify-end bg-scrim"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={textbook.title}
    >
      <div
        className="flex h-full w-full max-w-xl flex-col overflow-hidden border-s border-border bg-surface-raised shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="space-y-1.5 border-b border-border px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <h2 className="text-lg font-bold text-text">{textbook.title}</h2>
              <p className="text-xs text-text-muted">
                {textbookSubtitleParts({
                  title: textbook.title,
                  subjectName: textbook.subjectName,
                  gradeName: textbook.gradeName,
                  termName: textbook.termName,
                }).join(' · ')}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <PublicationBadge status={textbook.status} />
              <Button variant="ghost" size="sm" onClick={download}>
                {t('textbookAdmin.downloadExport')}
              </Button>
              <Button variant="ghost" size="iconSm" aria-label={t('common.close')} onClick={onClose}>
                ✕
              </Button>
            </div>
          </div>
        </header>

        <div className="flex-1 space-y-6 overflow-y-auto p-5">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-xl border border-border bg-surface-sunken p-4 text-sm">
            {facts.map(([labelKey, value]) => (
              <div key={labelKey} className="col-span-2 grid grid-cols-subgrid">
                <dt className="text-xs font-medium text-text-muted">{t(labelKey)}</dt>
                <dd className="text-text">{value}</dd>
              </div>
            ))}
          </dl>

          <div className="flex flex-wrap items-center gap-2">
            <Link
              to={`/admin/content?textbook=${encodeURIComponent(textbook.key)}`}
              className="inline-flex h-8 items-center rounded-lg border border-accent/40 bg-accent/10 px-3 text-xs font-semibold text-accent hover:bg-accent/20"
            >
              📚 {t('textbookAdmin.manageContent')}
            </Link>
            {mayAuthor ? (
              <Button variant="secondary" size="sm" onClick={() => setIsEditing(true)}>
                ✏️ {t('textbookAdmin.editTextbook')}
              </Button>
            ) : null}
            {mayAdopt ? (
              <Button variant="secondary" size="sm" onClick={() => setIsAccrediting(true)}>
                🏫 {t('textbookAdmin.accreditToSchoolButton')}
              </Button>
            ) : null}
          </div>

          {available.length > 0 || (textbook.status === 'DRAFT' && mayApprove) ? (
            <section className="space-y-2 rounded-xl border border-border bg-surface-sunken p-4">
              <h3 className="text-sm font-semibold text-text">{t('textbookAdmin.lifecycle')}</h3>
              <div className="flex flex-wrap items-center gap-2">
                {textbook.status === 'DRAFT' && mayApprove ? (
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={directPublish.isPending}
                    onClick={() => setConfirmingDirectPublish(true)}
                  >
                    🚀 {t('textbookAdmin.quickPublish')}
                  </Button>
                ) : null}
                {available.map((action) => (
                  <Button
                    key={action}
                    variant={action === 'REJECT' || action === 'ARCHIVE' ? 'secondary' : 'primary'}
                    size="sm"
                    disabled={transition.isPending}
                    onClick={() => setConfirmingAction(action)}
                  >
                    {t(TRANSITION_LABEL[action])}
                  </Button>
                ))}
              </div>
              {!mayApprove ? (
                <p className="text-2xs text-text-muted">{t('textbookAdmin.reviewOnly')}</p>
              ) : null}
            </section>
          ) : null}

          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-text">{t('textbookAdmin.adoptionsSection')}</h3>
              {mayAdopt ? (
                <div className="flex items-center gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setIsAccrediting(true)}>
                    + {t('textbookAdmin.adopt')}
                  </Button>
                  <Link to="/admin/schools" className="text-xs font-medium text-accent hover:underline">
                    {t('textbookAdmin.adoptFor')}
                  </Link>
                </div>
              ) : null}
            </div>

            {adoptions.isPending ? <LoadingState /> : null}
            {adoptions.isError ? (
              <ErrorState error={adoptions.error} onRetry={() => adoptions.refetch()} />
            ) : null}

            {adoptions.isSuccess && adoptions.data.rows.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-text-muted">
                {t('textbookAdmin.noAdoptions')}
              </p>
            ) : null}

            {adoptions.isSuccess && adoptions.data.rows.length > 0 ? (
              <ul className="space-y-1.5">
                {adoptions.data.rows.map((row) => (
                  <li
                    key={`${row.schoolKey}-${row.academicYearKey}`}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-text">{row.schoolName}</span>
                      <span className="text-xs text-text-muted">{row.academicYearKey}</span>
                      <span className="text-xs text-text-muted">
                        {t('textbookAdmin.adoptedOn')}{' '}
                        {new Date(row.adoptedAt).toLocaleDateString(locale === 'ar' ? 'ar' : 'en')}
                      </span>
                    </div>
                    {mayAdopt ? (
                      <Button variant="ghost" size="sm" onClick={() => setWithdrawing(row)}>
                        {t('textbookAdmin.unadopt')}
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          {failure ? <p className="text-xs text-danger">{failure}</p> : null}
        </div>
      </div>

      {withdrawing !== null ? (
        <ConfirmDialog
          title={t('textbookAdmin.unadopt')}
          body={t('textbookAdmin.confirmUnadopt', {
            book: withdrawing.textbookTitle,
            school: withdrawing.schoolName,
            year: withdrawing.academicYearKey,
          })}
          confirmLabel={t('textbookAdmin.unadopt')}
          pending={unadopt.isPending}
          destructive
          onConfirm={() => unadopt.mutate(withdrawing)}
          onCancel={() => setWithdrawing(null)}
        />
      ) : null}

      {confirmingAction !== null ? (
        <ConfirmDialog
          title={t(TRANSITION_LABEL[confirmingAction])}
          body={t('textbookAdmin.confirmTransition', {
            action: t(TRANSITION_LABEL[confirmingAction]),
            name: textbook.title,
          })}
          confirmLabel={t(TRANSITION_LABEL[confirmingAction])}
          pending={transition.isPending}
          destructive={confirmingAction === 'ARCHIVE' || confirmingAction === 'REJECT'}
          onConfirm={() => transition.mutate(confirmingAction)}
          onCancel={() => setConfirmingAction(null)}
        />
      ) : null}

      {confirmingDirectPublish ? (
        <ConfirmDialog
          title={t('textbookAdmin.quickPublish')}
          body={t('textbookAdmin.quickPublishDesc')}
          confirmLabel={t('textbookAdmin.quickPublish')}
          pending={directPublish.isPending}
          onConfirm={() => directPublish.mutate()}
          onCancel={() => setConfirmingDirectPublish(false)}
        />
      ) : null}

      {isEditing ? (
        <TextbookEditModal
          open={isEditing}
          onClose={() => setIsEditing(false)}
          textbook={textbook}
        />
      ) : null}

      {isAccrediting ? (
        <TextbookAccreditModal
          open={isAccrediting}
          onClose={() => setIsAccrediting(false)}
          initialTextbookKey={textbook.key}
        />
      ) : null}
    </div>
  );
}
