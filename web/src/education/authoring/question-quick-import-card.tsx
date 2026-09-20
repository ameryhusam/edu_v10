/**
 * Quick question import for one lesson and one concept.
 *
 * Rendered inside an `ActionModal` (EdTech Modal Design), matching the other
 * two creation flows: a trigger button opens a two-step form — curriculum
 * placement via `CurriculumLinkTree` (concept picked from that lesson's own
 * concept list, never typed by key) then the pasted question rows.
 */

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Zap } from 'lucide-react';
import { Badge } from '../../design-system/ui/badge';
import { Button } from '../../design-system/ui/button';
import { Input } from '../../design-system/ui/input';
import { Select } from '../../design-system/ui/select';
import { Textarea } from '../../design-system/ui/textarea';
import { ActionModal, ActionStepCard } from '../../design-system/patterns/action-modal';
import {
  CurriculumLinkTree,
  EMPTY_CURRICULUM_LINK,
  type CurriculumLinkValue,
} from '../../design-system/patterns/curriculum-link-tree';
import { ErrorState } from '../../design-system/patterns/data-states';
import { textbookAdministrationApi } from '../../features/content/content.api';
import { queryKeys } from '../../shared/api/query-keys';
import { useI18n } from '../../shared/i18n/i18n';
import type { MessageKey } from '../../shared/i18n/messages';
import {
  QUESTION_ORIGINS,
  questionBankApi,
  type QuestionOrigin,
  type QuestionRecord,
} from './question-bank.api';
import { parseMinisterialRows } from './question-form-utils';
import { useLessonBank } from './use-question-linking';

export function QuestionQuickImportCard(): ReactNode {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <Zap aria-hidden="true" />
        {t('questionBank.quickImportTitle')}
      </Button>
      {open ? <QuestionQuickImportModal onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function QuestionQuickImportModal({ onClose }: { readonly onClose: () => void }): ReactNode {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [link, setLink] = useState<CurriculumLinkValue>(EMPTY_CURRICULUM_LINK);
  const [conceptKey, setConceptKey] = useState('');
  const [origin, setOrigin] = useState<QuestionOrigin>('TEXTBOOK');
  const [sourcePrefix, setSourcePrefix] = useState('');
  const [raw, setRaw] = useState('');
  const bank = useLessonBank(link.lessonKey || null);
  const parsed = useMemo(() => parseMinisterialRows(raw), [raw]);

  useEffect(() => setConceptKey(''), [link.lessonKey]);

  const textbooks = useQuery({
    queryKey: queryKeys.textbookAdministration.textbooks({ status: 'PUBLISHED', limit: 200 }),
    queryFn: () => textbookAdministrationApi.textbooks({ status: 'PUBLISHED', limit: 200 }),
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
            origin,
            visibility: origin === 'TEXTBOOK' || origin === 'MINISTERIAL' ? 'GLOBAL' : 'SCHOOL',
            sourceRef: sourcePrefix.trim()
              ? `${sourcePrefix.trim()}-Q${row.number ?? index + 1}`
              : null,
            text: row.text,
            choices: row.choices,
            answerKey: { correctChoiceIds: [row.correctChoiceId] },
            concepts: [{ conceptKey, weight: 1, isPrimary: true }],
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

  const canImport = link.lessonKey !== '' && conceptKey !== '' && parsed.length > 0;

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!canImport) return;
    bulk.mutate();
  }

  return (
    <ActionModal
      kind="question"
      icon={<Zap aria-hidden="true" />}
      title={t('questionBank.quickImportTitle')}
      subtitle={t('questionBank.quickImportBody')}
      onClose={onClose}
      footer={
        <>
          {bulk.isError ? <ErrorState error={bulk.error} /> : null}
          <Button variant="secondary" type="button" onClick={onClose}>
            {t('common.close')}
          </Button>
          <Button variant="primary" type="submit" form="question-quick-import-form" disabled={!canImport || bulk.isPending}>
            {bulk.isPending ? t('common.working') : t('questionBank.importQuick')}
          </Button>
        </>
      }
    >
      <form id="question-quick-import-form" className="space-y-4" onSubmit={submit}>
        <ActionStepCard step={1} title={t('questionBank.stepPlacement')}>
          <CurriculumLinkTree
            value={link}
            onChange={setLink}
            textbooks={textbooks.data?.rows ?? []}
            outline={outline.data ?? []}
          />
          <div className="grid gap-3 md:grid-cols-3">
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-text-muted">{t('questionBank.concept')}</span>
              <Select value={conceptKey} onChange={(event) => setConceptKey(event.target.value)} disabled={bank.status !== 'ready'}>
                <option value="">{t('questionBank.chooseConcept')}</option>
                {(bank.bank?.concepts ?? []).map((concept) => (
                  <option key={concept.key} value={concept.key}>
                    {concept.name}
                  </option>
                ))}
              </Select>
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-text-muted">{t('questionBank.origin')}</span>
              <Select value={origin} onChange={(event) => setOrigin(event.target.value as QuestionOrigin)}>
                {QUESTION_ORIGINS.map((value) => (
                  <option key={value} value={value}>
                    {t(`question.origin.${value}` as MessageKey)}
                  </option>
                ))}
              </Select>
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-text-muted">{t('questionBank.sourceRef')}</span>
              <Input value={sourcePrefix} onChange={(event) => setSourcePrefix(event.target.value)} />
            </label>
          </div>
          {bank.status === 'ready' && bank.bank?.concepts.length === 0 ? (
            <p className="rounded-lg border border-warning-border bg-warning-subtle p-3 text-xs text-warning">
              {t('questionBank.noConceptsForQuickImport')}
            </p>
          ) : null}
        </ActionStepCard>

        <ActionStepCard step={2} title={t('questionBank.stepMinisterialRows')}>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-text-muted">{t('questionBank.bulkRows')}</span>
            <Textarea value={raw} onChange={(event) => setRaw(event.target.value)} rows={5} monospace placeholder={t('questionBank.bulkPlaceholder')} />
            <span className="text-2xs text-text-muted">{t('questionBank.quickImportHint')}</span>
          </label>
          {parsed.length > 0 ? (
            <p className="text-xs font-bold text-text-muted">
              {t('questionBank.previewCount', { count: String(parsed.length) })}
            </p>
          ) : null}
          <Badge tone="accent">{t('questionBank.linkedImportBadge')}</Badge>
        </ActionStepCard>
      </form>
    </ActionModal>
  );
}
