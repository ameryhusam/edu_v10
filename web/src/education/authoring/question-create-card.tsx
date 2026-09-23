/**
 * Type-aware draft question editor.
 *
 * Rendered inside an `ActionModal` (EdTech Modal Design): a blue header band
 * for the "question" action, and the form split into three step-cards —
 * placement, content, metadata — rather than one dense block. Placement uses
 * `CurriculumLinkTree` so an author picks the book → unit → lesson chain the
 * same cascading way everywhere in the product, with the destination badge
 * confirming exactly what will be written before they submit.
 */

import { useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PenSquare } from 'lucide-react';
import { Badge } from '../../design-system/ui/badge';
import { Button } from '../../design-system/ui/button';
import { Input } from '../../design-system/ui/input';
import { Select } from '../../design-system/ui/select';
import { Textarea } from '../../design-system/ui/textarea';
import { ActionModal, ActionStepCard } from '../../design-system/patterns/action-modal';
import { DifficultyBar } from '../../design-system/patterns/difficulty-bar';
import {
  CurriculumLinkTree,
  EMPTY_CURRICULUM_LINK,
  type CurriculumLinkValue,
} from '../../design-system/patterns/curriculum-link-tree';
import { ErrorState } from '../../design-system/patterns/data-states';
import { textbookAdministrationApi } from '../../features/content/content.api';
import {
  QUESTION_ORIGINS,
  QUESTION_TYPES,
  QUESTION_VISIBILITIES,
  TEXTBOOK_QUESTION_ROLES,
  questionBankApi,
  type QuestionOrigin,
  type QuestionType,
  type QuestionVisibility,
  type TextbookQuestionRole,
} from './question-bank.api';
import {
  CHOICE_TYPES,
  buildQuestionInput,
  initialQuestionForm,
  parseConceptLinks,
  type QuestionFormState,
} from './question-form-utils';
import { queryKeys } from '../../shared/api/query-keys';
import { useI18n } from '../../shared/i18n/i18n';
import type { MessageKey } from '../../shared/i18n/messages';

export function QuestionCreateCard(): ReactNode {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        <PenSquare aria-hidden="true" />
        {t('questionBank.openCreate')}
      </Button>
      {open ? <QuestionCreateModal onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function QuestionCreateModal({ onClose }: { readonly onClose: () => void }): ReactNode {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<QuestionFormState>(initialQuestionForm);
  const [link, setLink] = useState<CurriculumLinkValue>(EMPTY_CURRICULUM_LINK);
  const update = <K extends keyof QuestionFormState>(key: K, value: QuestionFormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));
  const hasConceptLinks = parseConceptLinks(form.conceptLinks).length > 0;

  const textbooks = useQuery({
    queryKey: queryKeys.textbookAdministration.textbooks({ status: 'PUBLISHED', limit: 100 }),
    queryFn: () => textbookAdministrationApi.textbooks({ status: 'PUBLISHED', limit: 100 }),
  });
  const outline = useQuery({
    queryKey: queryKeys.content.outline(link.textbookKey),
    queryFn: () => textbookAdministrationApi.outline(link.textbookKey),
    enabled: Boolean(link.textbookKey),
  });
  const selectedBook = (textbooks.data?.rows ?? []).find((book) => book.key === link.textbookKey) ?? null;
  const selectedUnit = (outline.data ?? []).find((unit) => unit.key === link.unitKey) ?? null;
  const selectedLesson = selectedUnit?.lessons.find((lesson) => lesson.key === link.lessonKey) ?? null;

  const create = useMutation({
    mutationFn: () => questionBankApi.create(buildQuestionInput({ ...form, lessonKey: link.lessonKey })),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.content.all });
      onClose();
    },
  });

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!hasConceptLinks || !link.lessonKey) return;
    create.mutate();
  }

  return (
    <ActionModal
      kind="question"
      icon={<PenSquare aria-hidden="true" />}
      title={t('questionBank.createTitle')}
      subtitle={t('questionBank.dynamicEditor')}
      onClose={onClose}
      footer={
        <>
          {create.isError ? <ErrorState error={create.error} /> : null}
          <Button variant="secondary" type="button" onClick={onClose}>
            {t('common.close')}
          </Button>
          <Button
            variant="primary"
            type="submit"
            form="question-create-form"
            disabled={create.isPending || !hasConceptLinks || !link.lessonKey}
          >
            {create.isPending ? t('common.working') : t('questionBank.saveDraft')}
          </Button>
        </>
      }
    >
      <form id="question-create-form" className="space-y-4" onSubmit={submit}>
        <ActionStepCard step={1} title={t('questionBank.stepPlacement')}>
          <CurriculumLinkTree
            value={link}
            onChange={setLink}
            textbooks={textbooks.data?.rows ?? []}
            outline={outline.data ?? []}
          />
        </ActionStepCard>

        <ActionStepCard step={2} title={t('questionBank.stepContent')}>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-text-muted">{t('questionBank.type')}</span>
              <Select
                value={form.questionType}
                onChange={(event) => {
                  const next = event.target.value as QuestionType;
                  setForm((current) => ({
                    ...current,
                    questionType: next,
                    ...(next === 'TRUE_FALSE' ? { choices: 'true|True\nfalse|False', correct: 'true' } : {}),
                  }));
                }}
              >
                {QUESTION_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {t(`question.type.${type}` as MessageKey)}
                  </option>
                ))}
              </Select>
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-text-muted">{t('questionBank.concepts')}</span>
              <Input value={form.conceptLinks} onChange={(event) => update('conceptLinks', event.target.value)} placeholder="CONCEPT-A, CONCEPT-B" />
              {!hasConceptLinks ? (
                <span className="block text-2xs text-warning">{t('questionBank.conceptsRequired')}</span>
              ) : null}
              {selectedLesson?.concepts?.length ? (
                <span className="block text-2xs text-text-muted">
                  {selectedLesson.concepts.map((concept) => concept.key).join(', ')}
                </span>
              ) : null}
            </label>
          </div>

          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-text-muted">{t('questionBank.stem')}</span>
            <Textarea value={form.text} onChange={(event) => update('text', event.target.value)} rows={3} required />
          </label>

          {CHOICE_TYPES.has(form.questionType) ? (
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-text-muted">{t('questionBank.choices')}</span>
              <Textarea value={form.choices} onChange={(event) => update('choices', event.target.value)} rows={4} monospace />
              <span className="text-2xs text-text-muted">{t('questionBank.choicesHint')}</span>
            </label>
          ) : null}

          <AnswerKeyFields form={form} update={update} />
        </ActionStepCard>

        <ActionStepCard step={3} title={t('questionBank.stepMeta')}>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-text-muted">{t('questionBank.origin')}</span>
              <Select value={form.origin} onChange={(event) => update('origin', event.target.value as QuestionOrigin)}>
                {QUESTION_ORIGINS.map((origin) => (
                  <option key={origin} value={origin}>
                    {t(`question.origin.${origin}` as MessageKey)}
                  </option>
                ))}
              </Select>
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-text-muted">{t('questionBank.visibility')}</span>
              <Select value={form.visibility} onChange={(event) => update('visibility', event.target.value as QuestionVisibility)}>
                {QUESTION_VISIBILITIES.map((visibility) => (
                  <option key={visibility} value={visibility}>
                    {t(`question.visibility.${visibility}` as MessageKey)}
                  </option>
                ))}
              </Select>
            </label>
            {form.origin === 'TEXTBOOK' ? (
              <label className="space-y-1.5">
                <span className="text-xs font-medium text-text-muted">{t('questionBank.textbookRole')}</span>
                <Select value={form.textbookRole} onChange={(event) => update('textbookRole', event.target.value as TextbookQuestionRole | '')}>
                  {TEXTBOOK_QUESTION_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {t(`question.role.${role}` as MessageKey)}
                    </option>
                  ))}
                </Select>
              </label>
            ) : null}
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-text-muted">{t('questionBank.sourceRef')}</span>
              <Input value={form.sourceRef} onChange={(event) => update('sourceRef', event.target.value)} />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-text-muted">{t('questionBank.points')}</span>
              <Input value={form.points} onChange={(event) => update('points', event.target.value)} inputMode="numeric" />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-text-muted">{t('questionBank.hint')}</span>
              <Input value={form.hint} onChange={(event) => update('hint', event.target.value)} />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-text-muted">{t('questionBank.explanation')}</span>
              <Input value={form.explanation} onChange={(event) => update('explanation', event.target.value)} />
            </label>
          </div>

          <label className="block space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-text-muted">{t('questionBank.difficulty')}</span>
              <Badge tone="neutral">{selectedBook ? selectedBook.title : t('linkTree.pickSubjectFirst')}</Badge>
            </div>
            <Input
              value={form.difficulty}
              onChange={(event) => update('difficulty', event.target.value)}
              inputMode="decimal"
              type="range"
              min="0"
              max="1"
              step="0.01"
            />
            <DifficultyBar difficulty01={Number(form.difficulty) || 0.5} />
          </label>
        </ActionStepCard>
      </form>
    </ActionModal>
  );
}

function AnswerKeyFields({
  form,
  update,
}: {
  readonly form: QuestionFormState;
  readonly update: <K extends keyof QuestionFormState>(key: K, value: QuestionFormState[K]) => void;
}): ReactNode {
  const { t } = useI18n();
  if (form.questionType === 'NUMERIC') {
    return (
      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-1.5">
          <span className="text-xs font-medium text-text-muted">{t('questionBank.numericMin')}</span>
          <Input value={form.numericMin} onChange={(event) => update('numericMin', event.target.value)} inputMode="decimal" required />
        </label>
        <label className="space-y-1.5">
          <span className="text-xs font-medium text-text-muted">{t('questionBank.numericMax')}</span>
          <Input value={form.numericMax} onChange={(event) => update('numericMax', event.target.value)} inputMode="decimal" required />
        </label>
      </div>
    );
  }
  if (form.questionType === 'SHORT_TEXT' || form.questionType === 'FILL_BLANK') {
    return <TextLineArea label={t('questionBank.acceptedTexts')} value={form.acceptedTexts} onChange={(value) => update('acceptedTexts', value)} />;
  }
  if (form.questionType === 'ORDERING') {
    return <TextLineArea label={t('questionBank.expectedOrder')} value={form.expectedOrder} onChange={(value) => update('expectedOrder', value)} />;
  }
  if (form.questionType === 'MATCHING') {
    return <TextLineArea label={t('questionBank.expectedPairs')} value={form.expectedPairs} onChange={(value) => update('expectedPairs', value)} hint={t('questionBank.pairsHint')} />;
  }
  if (form.questionType === 'ESSAY') {
    return <TextLineArea label={t('questionBank.rubric')} value={form.rubric} onChange={(value) => update('rubric', value)} />;
  }
  return (
    <label className="block max-w-md space-y-1.5">
      <span className="text-xs font-medium text-text-muted">{t('questionBank.correctChoices')}</span>
      <Input value={form.correct} onChange={(event) => update('correct', event.target.value)} required />
      <span className="text-2xs text-text-muted">{t('questionBank.correctChoicesHint')}</span>
    </label>
  );
}

function TextLineArea({
  label,
  value,
  onChange,
  hint,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly hint?: string;
}): ReactNode {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-text-muted">{label}</span>
      <Textarea value={value} onChange={(event) => onChange(event.target.value)} rows={3} monospace />
      {hint ? <span className="text-2xs text-text-muted">{hint}</span> : null}
    </label>
  );
}
