/**
 * Modal dialog for editing textbook metadata.
 */

import { useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '../../design-system/ui/button';
import { Input } from '../../design-system/ui/input';
import { ErrorState } from '../../design-system/patterns/data-states';
import {
  textbookAdministrationApi,
  type TextbookAdminSummary,
  type PublicationStatus,
} from './content.api';
import { queryKeys } from '../../shared/api/query-keys';
import { useI18n } from '../../shared/i18n/i18n';

export function TextbookEditModal({
  open,
  onClose,
  textbook,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly textbook: TextbookAdminSummary | null;
}): ReactNode {
  if (!open || !textbook) return null;

  return <TextbookEditForm textbook={textbook} onClose={onClose} />;
}

function TextbookEditForm({
  textbook,
  onClose,
}: {
  readonly textbook: TextbookAdminSummary;
  readonly onClose: () => void;
}): ReactNode {
  const { t } = useI18n();
  const queryClient = useQueryClient();

  const [title, setTitle] = useState(textbook.title);
  const [status, setStatus] = useState<PublicationStatus>(textbook.status ?? 'DRAFT');
  const [description, setDescription] = useState(textbook.description ?? '');
  const [issuer, setIssuer] = useState(textbook.issuer ?? '');
  const [isbn, setIsbn] = useState(textbook.isbn ?? '');
  const [publishYear, setPublishYear] = useState(
    textbook.publishYear ? String(textbook.publishYear) : '',
  );
  const [totalPages, setTotalPages] = useState(
    textbook.totalPages ? String(textbook.totalPages) : '',
  );

  const updateMutation = useMutation({
    mutationFn: async () => {
      await textbookAdministrationApi.updateNode({
        kind: 'textbook',
        key: textbook.key,
        patch: {
          title: title.trim(),
          description: description.trim() ? description.trim() : null,
          issuer: issuer.trim() ? issuer.trim() : null,
          isbn: isbn.trim() ? isbn.trim() : null,
          publishYear: publishYear ? Number(publishYear) : null,
          totalPages: totalPages ? Number(totalPages) : null,
        },
      });
      if (status !== textbook.status) {
        await textbookAdministrationApi.updateTextbookStatus(textbook.key, status);
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.textbookAdministration.all });
      onClose();
    },
  });

  function handleSubmit(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    updateMutation.mutate();
  }

  return (
    <div
      className="fixed inset-0 z-modal flex items-center justify-center bg-scrim p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={t('textbookAdmin.editBookTitle')}
    >
      <form
        className="max-h-[min(44rem,92vh)] w-full max-w-xl space-y-4 overflow-y-auto rounded-2xl border border-border bg-surface-raised p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <div className="flex items-center justify-between border-b border-border pb-3">
          <div>
            <h2 className="text-lg font-bold text-text">{t('textbookAdmin.editBookTitle')}</h2>
            <p className="text-xs text-text-muted">{textbook.gradeName} · {textbook.subjectName} · {textbook.part === 'PART_1' ? t('textbookAdmin.part1') : t('textbookAdmin.part2')}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex size-8 items-center justify-center rounded-lg text-text-muted hover:bg-surface-hover hover:text-text"
          >
            ✕
          </button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-text-muted">{t('textbookAdmin.titleLabel')} *</span>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} required />
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-text-muted">{t('admin.status')}</span>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as PublicationStatus)}
              className="h-11 w-full rounded-lg border border-border bg-surface px-3 text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="DRAFT">{t('contentStatus.DRAFT')}</option>
              <option value="IN_REVIEW">{t('contentStatus.IN_REVIEW')}</option>
              <option value="PUBLISHED">{t('contentStatus.PUBLISHED')}</option>
              <option value="ARCHIVED">{t('contentStatus.ARCHIVED')}</option>
            </select>
          </label>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-text-muted">{t('textbookAdmin.issuer')}</span>
            <Input value={issuer} onChange={(e) => setIssuer(e.target.value)} />
          </label>

          <label className="space-y-1.5">
            <span className="text-xs font-medium text-text-muted">{t('textbookAdmin.isbn')}</span>
            <Input value={isbn} onChange={(e) => setIsbn(e.target.value)} />
          </label>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-text-muted">{t('textbookAdmin.publishYear')}</span>
            <Input
              type="number"
              min="1900"
              max="2100"
              value={publishYear}
              onChange={(e) => setPublishYear(e.target.value)}
            />
          </label>

          <label className="space-y-1.5">
            <span className="text-xs font-medium text-text-muted">{t('textbookAdmin.totalPages')}</span>
            <Input
              type="number"
              min="1"
              max="2000"
              value={totalPages}
              onChange={(e) => setTotalPages(e.target.value)}
            />
          </label>
        </div>

        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-text-muted">{t('textbookAdmin.bookDescription')}</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </label>

        {updateMutation.isError ? <ErrorState error={updateMutation.error} /> : null}

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button variant="ghost" size="sm" type="button" disabled={updateMutation.isPending} onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            size="sm"
            type="submit"
            disabled={updateMutation.isPending || !title.trim()}
          >
            {updateMutation.isPending ? t('common.working') : t('catalogue.save')}
          </Button>
        </div>
      </form>
    </div>
  );
}
