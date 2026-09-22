/**
 * Modal dialog for creating a single textbook.
 *
 * Converts the inline creation card to a focused, modern dialog.
 */

import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '../../design-system/ui/button';
import { Input } from '../../design-system/ui/input';
import { ErrorState } from '../../design-system/patterns/data-states';
import { catalogueApi as administrationApi } from '../catalogue/catalogue.api';
import { textbookAdministrationApi } from './content.api';
import { queryKeys } from '../../shared/api/query-keys';
import { useI18n } from '../../shared/i18n/i18n';

const selectClass =
  'h-11 w-full rounded-lg border border-border bg-surface px-3 text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent';

export function TextbookCreateModal({
  open,
  onClose,
  initialGradeKey,
  initialPart,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly initialGradeKey?: string | null | undefined;
  readonly initialPart?: 'PART_1' | 'PART_2' | 'BOTH' | null | undefined;
}): ReactNode {
  const { t } = useI18n();
  const queryClient = useQueryClient();

  const subjects = useQuery({
    queryKey: queryKeys.administration.catalogue('subjects'),
    queryFn: () => administrationApi.subjects.list(),
  });
  const grades = useQuery({
    queryKey: queryKeys.administration.catalogue('grades'),
    queryFn: () => administrationApi.grades.list(),
  });
  const [subjectKey, setSubjectKey] = useState('');
  const [gradeKey, setGradeKey] = useState(initialGradeKey ?? '');
  const [part, setPart] = useState<'PART_1' | 'PART_2' | 'BOTH'>(initialPart ?? 'PART_1');
  const [title, setTitle] = useState('');
  const [edition, setEdition] = useState(String(new Date().getFullYear()));
  const [isbn, setIsbn] = useState('');
  const [description, setDescription] = useState('');
  const [issuer, setIssuer] = useState('');
  const [publishYear, setPublishYear] = useState(String(new Date().getFullYear()));
  const [totalPages, setTotalPages] = useState('');

  const defaultTitle = useMemo(() => {
    return (subjects.data ?? []).find((row) => row.key === subjectKey)?.defaultTextbookTitle ?? '';
  }, [subjectKey, subjects.data]);

  const create = useMutation({
    mutationFn: () =>
      textbookAdministrationApi.createTextbook({
        subjectKey,
        gradeKey,
        part,
        title: title.trim() || defaultTitle,
        edition: edition.trim(),
        isbn: isbn.trim() ? isbn.trim() : null,
        description: description.trim() ? description.trim() : null,
        issuer: issuer.trim() ? issuer.trim() : null,
        publishYear: publishYear ? Number(publishYear) : null,
        totalPages: totalPages ? Number(totalPages) : null,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.textbookAdministration.all });
      await queryClient.invalidateQueries({ queryKey: queryKeys.administration.all });
      onClose();
    },
  });

  if (!open) return null;

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    create.mutate();
  }

  return (
    <div
      className="fixed inset-0 z-modal flex items-center justify-center bg-scrim p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={t('textbookAdmin.addTextbookButton')}
    >
      <form
        className="max-h-[min(48rem,94vh)] w-full max-w-2xl space-y-4 overflow-y-auto rounded-2xl border border-border bg-surface-raised p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <div className="flex items-center justify-between border-b border-border pb-3">
          <div>
            <h2 className="text-lg font-bold text-text">{t('textbookAdmin.addTextbookButton')}</h2>
            <p className="text-xs text-text-muted">{t('textbookAdmin.creationHint')}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex size-8 items-center justify-center rounded-lg text-text-muted hover:bg-surface-hover hover:text-text"
          >
            ✕
          </button>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-text-muted">{t('collection.subjects')} *</span>
            <select
              value={subjectKey}
              onChange={(e) => setSubjectKey(e.target.value)}
              className={selectClass}
              required
            >
              <option value="">—</option>
              {(subjects.data ?? []).map((subject) => (
                <option key={subject.key} value={subject.key}>
                  {subject.name}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1.5">
            <span className="text-xs font-medium text-text-muted">{t('collection.grades')} *</span>
            <select
              value={gradeKey}
              onChange={(e) => setGradeKey(e.target.value)}
              className={selectClass}
              required
            >
              <option value="">—</option>
              {(grades.data ?? []).map((grade) => (
                <option key={grade.key} value={grade.key}>
                  {grade.name}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1.5">
            <span className="text-xs font-medium text-text-muted">{t('textbookAdmin.physicalPart')} *</span>
            <select
              value={part}
              onChange={(e) => setPart(e.target.value)}
              className={selectClass}
              required
            >
              <option value="">—</option>
              {<option value="PART_1">الجزء الأول</option>
              <option value="PART_2">الجزء الثاني</option>
              <option value="BOTH">الجزآن</option>}
            </select>
          </label>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-text-muted">{t('textbookAdmin.titleLabel')} *</span>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={defaultTitle || t('textbookAdmin.titleLabel')}
              required
            />
          </label>

          <label className="space-y-1.5">
            <span className="text-xs font-medium text-text-muted">{t('textbookAdmin.edition')} *</span>
            <Input value={edition} onChange={(e) => setEdition(e.target.value)} required />
          </label>
        </div>

        <div className="grid gap-3 sm:grid-cols-4">
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-text-muted">{t('textbookAdmin.isbn')}</span>
            <Input
              value={isbn}
              onChange={(e) => setIsbn(e.target.value)}
              placeholder="ISBN"
            />
          </label>

          <label className="space-y-1.5">
            <span className="text-xs font-medium text-text-muted">{t('textbookAdmin.issuer')}</span>
            <Input
              value={issuer}
              onChange={(e) => setIssuer(e.target.value)}
              placeholder={t('textbookAdmin.issuer')}
            />
          </label>

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
              placeholder="e.g. 180"
            />
          </label>
        </div>

        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-text-muted">{t('textbookAdmin.bookDescription')}</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </label>

        {create.isError ? <ErrorState error={create.error} /> : null}

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button variant="ghost" size="sm" type="button" disabled={create.isPending} onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" size="sm" type="submit" disabled={create.isPending || !subjectKey || !gradeKey || !part}>
            {create.isPending ? t('common.working') : t('textbookAdmin.createOne')}
          </Button>
        </div>
      </form>
    </div>
  );
}
