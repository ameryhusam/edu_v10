/**
 * Bulk creation of MINISTERIAL provenance questions.
 *
 * Rendered inside an `ActionModal` (EdTech Modal Design), matching
 * `QuestionCreateModal`: a trigger button opens a three-step flow — official
 * source metadata, curriculum placement via `CurriculumLinkTree`, then the
 * pasted question rows and their preview — instead of one dense inline card.
 */

import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileStack } from 'lucide-react';
import { Badge } from '../../design-system/ui/badge';
import { Button } from '../../design-system/ui/button';
import { Input } from '../../design-system/ui/input';
import { Textarea } from '../../design-system/ui/textarea';
import { ActionModal, ActionStepCard } from '../../design-system/patterns/action-modal';
import {
  CurriculumLinkTree,
  EMPTY_CURRICULUM_LINK,
  type CurriculumLinkValue,
} from '../../design-system/patterns/curriculum-link-tree';
import { ErrorState } from '../../design-system/patterns/data-states';
import { textbookAdministrationApi } from '../../features/content/content.api';
import { questionBankApi, type QuestionRecord } from './question-bank.api';
import {
  initialMinisterialImport,
  parseConceptLinks,
  parseMinisterialRows,
  sourcePrefixFor,
  type MinisterialImportState,
} from './question-form-utils';
import { queryKeys } from '../../shared/api/query-keys';
import { useI18n } from '../../shared/i18n/i18n';

export function MinisterialImportCard(): ReactNode {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <FileStack aria-hidden="true" />
        {t('questionBank.openMinisterialImport')}
      </Button>
      {open ? <MinisterialImportModal onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function MinisterialImportModal({ onClose }: { readonly onClose: () => void }): ReactNode {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<MinisterialImportState>(initialMinisterialImport);
  const [link, setLink] = useState<CurriculumLinkValue>(EMPTY_CURRICULUM_LINK);
  const update = <K extends keyof MinisterialImportState>(key: K, value: MinisterialImportState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const parsed = useMemo(() => parseMinisterialRows(form.raw), [form.raw]);
  const links = parseConceptLinks(form.conceptLinks);
  const sourcePrefix = sourcePrefixFor(form);

  const textbooks = useQuery({
    queryKey: queryKeys.textbookAdministration.textbooks({ status: 'PUBLISHED', limit: 100 }),
    queryFn: () => textbookAdministrationApi.textbooks({ status: 'PUBLISHED', limit: 100 }),
  });
  const outline = useQuery({
    queryKey: queryKeys.content.outline(link.textbookKey),
    queryFn: () => textbookAdministrationApi.outline(link.textbookKey),
    enabled: Boolean(link.textbookKey),
  });

  const bulk = useMutation({
    mutationFn: async () => {
      const created: QuestionRecord[] = [];
      for (const [index, row] of parsed.entries()) {
        created.push(
          await questionBankApi.create({
            type: 'MCQ_SINGLE',
            lessonKey: link.lessonKey,
            origin: 'MINISTERIAL',
            visibility: 'GLOBAL',
            sourceRef: `${sourcePrefix || 'MINISTERIAL'}-Q${row.number ?? index + 1}`,
            text: row.text,
            choices: row.choices,
            answerKey: { correctChoiceIds: [row.correctChoiceId] },
            concepts: links,
          }),
        );
      }
      return created;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.content.all });
      onClose();
    },
  });

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!link.lessonKey || parsed.length === 0 || links.length === 0) return;
    bulk.mutate();
  }

  return (
    <ActionModal
      kind="question"
      icon={<FileStack aria-hidden="true" />}
      title={t('questionBank.ministerialImport')}
      subtitle={t('questionBank.ministerialImportBody')}
      onClose={onClose}
      footer={
        <>
          {bulk.isError ? <ErrorState error={bulk.error} /> : null}
          <Button variant="secondary" type="button" onClick={onClose}>
            {t('common.close')}
          </Button>
          <Button
            variant="primary"
            type="submit"
            form="ministerial-import-form"
            disabled={bulk.isPending || !link.lessonKey || parsed.length === 0 || links.length === 0}
          >
            {bulk.isPending ? t('common.working') : t('questionBank.importMinisterial')}
          </Button>
        </>
      }
    >
      <form id="ministerial-import-form" className="space-y-4" onSubmit={submit}>
        <ActionStepCard step={1} title={t('questionBank.stepMinisterialSource')}>
          <div className="grid gap-3 md:grid-cols-3">
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-text-muted">{t('questionBank.academicYear')}</span>
              <Input value={form.academicYear} onChange={(event) => update('academicYear', event.target.value)} />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-text-muted">{t('questionBank.country')}</span>
              <Input value={form.country} onChange={(event) => update('country', event.target.value)} />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-text-muted">{t('questionBank.authority')}</span>
              <Input value={form.authority} onChange={(event) => update('authority', event.target.value)} />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-text-muted">{t('collection.grades')}</span>
              <Input value={form.grade} onChange={(event) => update('grade', event.target.value)} />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-text-muted">{t('collection.subjects')}</span>
              <Input value={form.subject} onChange={(event) => update('subject', event.target.value)} />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-text-muted">{t('questionBank.session')}</span>
              <Input value={form.session} onChange={(event) => update('session', event.target.value)} />
            </label>
          </div>
          <label className="block max-w-xs space-y-1.5">
            <span className="text-xs font-medium text-text-muted">{t('questionBank.sourceRef')}</span>
            <Input value={sourcePrefix} onChange={() => undefined} disabled />
          </label>
        </ActionStepCard>

        <ActionStepCard step={2} title={t('questionBank.stepMinisterialPlacement')}>
          <CurriculumLinkTree
            value={link}
            onChange={setLink}
            textbooks={textbooks.data?.rows ?? []}
            outline={outline.data ?? []}
          />
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-text-muted">{t('questionBank.concepts')}</span>
            <Input value={form.conceptLinks} onChange={(event) => update('conceptLinks', event.target.value)} placeholder="CONCEPT-A, CONCEPT-B" />
            {links.length === 0 ? (
              <span className="block text-2xs text-warning">{t('questionBank.conceptsRequired')}</span>
            ) : null}
          </label>
        </ActionStepCard>

        <ActionStepCard step={3} title={t('questionBank.stepMinisterialRows')}>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-text-muted">{t('questionBank.bulkRows')}</span>
            <Textarea
              value={form.raw}
              onChange={(event) => update('raw', event.target.value)}
              rows={5}
              monospace
              placeholder={t('questionBank.bulkPlaceholder')}
            />
            <span className="text-2xs text-text-muted">{t('questionBank.bulkRowsHint')}</span>
          </label>

          {parsed.length > 0 ? (
            <div className="rounded-xl border border-border bg-surface-raised p-3">
              <p className="mb-2 text-xs font-bold text-text-muted">
                {t('questionBank.previewCount', { count: String(parsed.length) })}
              </p>
              <ul className="max-h-40 space-y-1 overflow-auto text-xs text-text-muted">
                {parsed.slice(0, 8).map((row, index) => (
                  <li key={`${row.text}-${index}`}>
                    {row.number ?? index + 1}. {row.text}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <Badge tone="info">MINISTERIAL</Badge>
        </ActionStepCard>
      </form>
    </ActionModal>
  );
}
