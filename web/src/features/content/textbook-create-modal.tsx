/** Modal for creating a canonical textbook record. */
import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookPlus } from 'lucide-react';
import { Button } from '../../design-system/ui/button';
import { Input } from '../../design-system/ui/input';
import { Textarea } from '../../design-system/ui/textarea';
import { ErrorState } from '../../design-system/patterns/data-states';
import { ActionModal, ActionStepCard } from '../../design-system/patterns/action-modal';
import { catalogueApi as administrationApi } from '../catalogue/catalogue.api';
import { textbookAdministrationApi } from './content.api';
import { queryKeys } from '../../shared/api/query-keys';
import { useI18n } from '../../shared/i18n/i18n';

const selectClass = 'h-11 w-full rounded-lg border border-border bg-surface px-3 text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent';

export function TextbookCreateModal({ open, onClose, initialGradeKey, initialPart }: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly initialGradeKey?: string | null | undefined;
  readonly initialPart?: 'PART_1' | 'PART_2' | null | undefined;
}): ReactNode {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const subjects = useQuery({ queryKey: queryKeys.administration.catalogue('subjects'), queryFn: () => administrationApi.subjects.list() });
  const grades = useQuery({ queryKey: queryKeys.administration.catalogue('grades'), queryFn: () => administrationApi.grades.list() });
  const [subjectKey, setSubjectKey] = useState('');
  const [gradeKey, setGradeKey] = useState(initialGradeKey ?? '');
  const [part, setPart] = useState<'PART_1' | 'PART_2'>(initialPart ?? 'PART_1');
  const [title, setTitle] = useState('');
  const [edition, setEdition] = useState(String(new Date().getFullYear()));
  const [isbn, setIsbn] = useState('');
  const [description, setDescription] = useState('');
  const [issuer, setIssuer] = useState('');
  const [publishYear, setPublishYear] = useState(String(new Date().getFullYear()));
  const [totalPages, setTotalPages] = useState('');

  const defaultTitle = useMemo(() => (subjects.data ?? []).find((row) => row.key === subjectKey)?.defaultTextbookTitle ?? '', [subjectKey, subjects.data]);

  const create = useMutation({
    mutationFn: () => textbookAdministrationApi.createTextbook({
      subjectKey, gradeKey, part, title: title.trim() || defaultTitle, edition: edition.trim(),
      isbn: isbn.trim() || null, description: description.trim() || null, issuer: issuer.trim() || null,
      publishYear: publishYear ? Number(publishYear) : null, totalPages: totalPages ? Number(totalPages) : null,
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.textbookAdministration.all });
      await queryClient.invalidateQueries({ queryKey: queryKeys.administration.all });
      onClose();
    },
  });

  if (!open) return null;
  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => { event.preventDefault(); create.mutate(); };

  return (
    <ActionModal kind="textbook" icon={<BookPlus />} title={t('textbookAdmin.addTextbookButton')} subtitle={t('textbookAdmin.creationHint')} onClose={onClose}
      footer={<><Button variant="ghost" type="button" disabled={create.isPending} onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" type="submit" form="textbook-create-form" disabled={create.isPending || !subjectKey || !gradeKey || !part}>{create.isPending ? t('common.working') : t('textbookAdmin.createOne')}</Button></>}>
      <form id="textbook-create-form" onSubmit={handleSubmit} className="space-y-4">
        <ActionStepCard step={1} title={t('textbookAdmin.physicalPart')}>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="space-y-1.5"><span className="text-xs font-medium text-text-muted">{t('collection.subjects')} *</span><select value={subjectKey} onChange={(e) => setSubjectKey(e.target.value)} className={selectClass} required><option value="">—</option>{(subjects.data ?? []).map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}</select></label>
            <label className="space-y-1.5"><span className="text-xs font-medium text-text-muted">{t('collection.grades')} *</span><select value={gradeKey} onChange={(e) => setGradeKey(e.target.value)} className={selectClass} required><option value="">—</option>{(grades.data ?? []).map((g) => <option key={g.key} value={g.key}>{g.name}</option>)}</select></label>
            <label className="space-y-1.5"><span className="text-xs font-medium text-text-muted">{t('textbookAdmin.physicalPart')} *</span><select value={part} onChange={(e) => setPart(e.target.value as 'PART_1' | 'PART_2')} className={selectClass} required><option value="PART_1">{t('textbookAdmin.part1')}</option><option value="PART_2">{t('textbookAdmin.part2')}</option></select></label>
          </div>
        </ActionStepCard>
        <ActionStepCard step={2} title={t('textbookAdmin.titleLabel')}>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1.5"><span className="text-xs font-medium text-text-muted">{t('textbookAdmin.titleLabel')} *</span><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={defaultTitle || t('textbookAdmin.titleLabel')} required /></label>
            <label className="space-y-1.5"><span className="text-xs font-medium text-text-muted">{t('textbookAdmin.edition')} *</span><Input value={edition} onChange={(e) => setEdition(e.target.value)} required /></label>
          </div>
        </ActionStepCard>
        <ActionStepCard step={3} title={t('textbookAdmin.bookDescription')}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="space-y-1.5"><span className="text-xs font-medium text-text-muted">{t('textbookAdmin.isbn')}</span><Input value={isbn} onChange={(e) => setIsbn(e.target.value)} /></label>
            <label className="space-y-1.5"><span className="text-xs font-medium text-text-muted">{t('textbookAdmin.issuer')}</span><Input value={issuer} onChange={(e) => setIssuer(e.target.value)} /></label>
            <label className="space-y-1.5"><span className="text-xs font-medium text-text-muted">{t('textbookAdmin.publishYear')}</span><Input type="number" min="1900" max="2100" value={publishYear} onChange={(e) => setPublishYear(e.target.value)} /></label>
            <label className="space-y-1.5"><span className="text-xs font-medium text-text-muted">{t('textbookAdmin.totalPages')}</span><Input type="number" min="1" max="2000" value={totalPages} onChange={(e) => setTotalPages(e.target.value)} /></label>
          </div>
          <label className="block space-y-1.5"><span className="text-xs font-medium text-text-muted">{t('textbookAdmin.bookDescription')}</span><Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
        </ActionStepCard>
        {create.isError ? <ErrorState error={create.error} /> : null}
      </form>
    </ActionModal>
  );
}
