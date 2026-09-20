/**
 * Author question bank.
 *
 * Type, origin and concept links stay separate: correction method, provenance
 * and mastery impact. Creation and ministerial bulk import live in extracted
 * flows so this page stays an orchestrator, not a giant component.
 */

import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge } from '../../design-system/ui/badge';
import { Button } from '../../design-system/ui/button';
import { Card, CardContent } from '../../design-system/ui/card';
import { Input } from '../../design-system/ui/input';
import { DataTable, type Column } from '../../design-system/patterns/data-table';
import { EmptyState, ErrorState, LoadingState } from '../../design-system/patterns/data-states';
import { textbookLabelParts } from '../../design-system/patterns/textbook-label';
import { PageHeader } from '../../design-system/patterns/page-header';
import { ExamCreateCard } from '../../education/authoring/exam-create-card';
import { ExamManagementPanel } from '../../education/authoring/exam-management-panel';
import { MinisterialImportCard } from '../../education/authoring/ministerial-importer';
import { QuestionCreateCard } from '../../education/authoring/question-create-card';
import { QuestionBankStudioOverview } from '../../education/authoring/question-bank-studio-overview';
import { QuestionLinkModal } from '../../education/authoring/question-link-modal';
import { QuestionQuickImportCard } from '../../education/authoring/question-quick-import-card';
import { SelectFilter } from '../../education/authoring/select-filter';
import {
  PUBLICATION_STATUSES,
  QUESTION_ORIGINS,
  QUESTION_TYPES,
  QUESTION_VISIBILITIES,
  questionBankApi,
  type PublicationAction,
  type PublicationStatus,
  type QuestionOrigin,
  type QuestionRecord,
  type QuestionVisibility,
  type QuestionType,
} from '../../education/authoring/question-bank.api';
import { textbookAdministrationApi } from '../../features/content/content.api';
import { actionsFor } from '../../education/authoring/question-form-utils';
import { queryKeys } from '../../shared/api/query-keys';
import { useI18n } from '../../shared/i18n/i18n';
import type { MessageKey } from '../../shared/i18n/messages';

const PAGE_SIZE = 25;

export function AuthorQuestionBankPage(): ReactNode {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [type, setType] = useState<QuestionType | ''>('');
  const [origin, setOrigin] = useState<QuestionOrigin | ''>('');
  const [status, setStatus] = useState<PublicationStatus | ''>('');
  const [visibility, setVisibility] = useState<QuestionVisibility | ''>('');
  const [textbookKey, setTextbookKey] = useState('');
  const [sourceRef, setSourceRef] = useState('');
  const [difficultyMin, setDifficultyMin] = useState('');
  const [difficultyMax, setDifficultyMax] = useState('');
  const [offset, setOffset] = useState(0);
  const [linkLessonKey, setLinkLessonKey] = useState<string | null>(null);

  const query = {
    ...(search.trim() ? { search: search.trim() } : {}),
    ...(type ? { type } : {}),
    ...(origin ? { origin } : {}),
    ...(status ? { status } : {}),
    ...(visibility ? { visibility } : {}),
    ...(textbookKey ? { textbookKey } : {}),
    ...(sourceRef.trim() ? { sourceRef: sourceRef.trim() } : {}),
    ...(Number.isFinite(Number(difficultyMin)) && difficultyMin !== '' ? { difficultyMin: Number(difficultyMin) } : {}),
    ...(Number.isFinite(Number(difficultyMax)) && difficultyMax !== '' ? { difficultyMax: Number(difficultyMax) } : {}),
    limit: PAGE_SIZE,
    offset,
  };

  const questions = useQuery({
    queryKey: queryKeys.content.questions(query),
    queryFn: () => questionBankApi.list(query),
  });
  const textbooks = useQuery({
    queryKey: queryKeys.textbookAdministration.textbooks({ status: 'PUBLISHED', limit: 200 }),
    queryFn: () => textbookAdministrationApi.textbooks({ status: 'PUBLISHED', limit: 200 }),
  });

  const transition = useMutation({
    mutationFn: (input: { questionKey: string; action: PublicationAction }) =>
      questionBankApi.transition(input.questionKey, input.action),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.content.all }),
  });

  const columns = questionColumns(t, transition.mutate, transition.isPending, setLinkLessonKey);

  function resetFilters(): void {
    setSearch('');
    setType('');
    setOrigin('');
    setStatus('');
    setVisibility('');
    setTextbookKey('');
    setSourceRef('');
    setDifficultyMin('');
    setDifficultyMax('');
    setOffset(0);
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t('questionBank.title')} subtitle={t('questionBank.subtitle')} />
      <QuestionBankStudioOverview rows={questions.data?.rows ?? []} total={questions.data?.total ?? 0} />
      <div className="flex flex-wrap gap-3">
        <QuestionCreateCard />
        <QuestionQuickImportCard />
        <MinisterialImportCard />
        <ExamCreateCard />
      </div>
      <ExamManagementPanel />

      <Card elevation="flat">
        <CardContent className="space-y-4 py-4">
          <div className="grid gap-3 md:grid-cols-5">
            <label className="space-y-1.5 md:col-span-2">
              <span className="text-xs font-medium text-text-muted">{t('admin.search')}</span>
              <Input value={search} onChange={(event) => { setSearch(event.target.value); setOffset(0); }} />
            </label>
            <SelectFilter label={t('questionBank.type')} value={type} onChange={(value) => { setType(value as QuestionType | ''); setOffset(0); }} options={QUESTION_TYPES} labelFor={(value) => t(`question.type.${value}` as MessageKey)} />
            <SelectFilter label={t('questionBank.origin')} value={origin} onChange={(value) => { setOrigin(value as QuestionOrigin | ''); setOffset(0); }} options={QUESTION_ORIGINS} labelFor={(value) => t(`question.origin.${value}` as MessageKey)} />
            <SelectFilter label={t('catalogue.state')} value={status} onChange={(value) => { setStatus(value as PublicationStatus | ''); setOffset(0); }} options={PUBLICATION_STATUSES} labelFor={(value) => t(`publication.${value}` as MessageKey)} />
            <SelectFilter label={t('questionBank.visibility')} value={visibility} onChange={(value) => { setVisibility(value as QuestionVisibility | ''); setOffset(0); }} options={QUESTION_VISIBILITIES} labelFor={(value) => t(`question.visibility.${value}` as MessageKey)} />
          </div>
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_9rem_9rem_auto]">
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-text-muted">{t('content.textbook')}</span>
              <select value={textbookKey} onChange={(event) => { setTextbookKey(event.target.value); setOffset(0); }} className="h-11 w-full rounded-lg border border-border bg-surface-raised px-3 text-sm text-text">
                <option value="">{t('common.all')}</option>
                {(textbooks.data?.rows ?? []).map((book) => (
                  <option key={book.key} value={book.key}>
                    {textbookLabelParts({ title: book.title, gradeName: book.gradeName }).join(' · ')}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-text-muted">{t('examBuilder.minDifficulty')}</span>
              <Input type="number" min="0" max="1" step="0.1" value={difficultyMin} onChange={(event) => { setDifficultyMin(event.target.value); setOffset(0); }} />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-text-muted">{t('examBuilder.maxDifficulty')}</span>
              <Input type="number" min="0" max="1" step="0.1" value={difficultyMax} onChange={(event) => { setDifficultyMax(event.target.value); setOffset(0); }} />
            </label>
            <div className="flex items-end"><Button variant="secondary" onClick={resetFilters}>{t('textbookAdmin.clearFilters')}</Button></div>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="min-w-60 flex-1 space-y-1.5">
              <span className="text-xs font-medium text-text-muted">{t('questionBank.sourceRef')}</span>
              <Input value={sourceRef} onChange={(event) => { setSourceRef(event.target.value); setOffset(0); }} />
            </label>
          </div>
        </CardContent>
      </Card>

      {questions.isPending ? (
        <LoadingState />
      ) : questions.isError ? (
        <ErrorState error={questions.error} onRetry={() => void questions.refetch()} />
      ) : questions.data.rows.length === 0 ? (
        <EmptyState title={t('questionBank.emptyTitle')} body={t('questionBank.emptyBody')} variant="filtered" />
      ) : (
        <>
          <DataTable rows={questions.data.rows} columns={columns} keyOf={(row) => row.key} caption={t('questionBank.title')} />
          <div className="flex justify-between gap-2">
            <Button variant="secondary" disabled={offset === 0} onClick={() => setOffset((value) => Math.max(0, value - PAGE_SIZE))}>{t('common.previous')}</Button>
            <Button variant="secondary" disabled={offset + PAGE_SIZE >= questions.data.total} onClick={() => setOffset((value) => value + PAGE_SIZE)}>{t('common.next')}</Button>
          </div>
        </>
      )}

      {transition.isError ? <ErrorState error={transition.error} /> : null}
      {linkLessonKey ? <QuestionLinkModal lessonKey={linkLessonKey} onClose={() => setLinkLessonKey(null)} /> : null}
    </div>
  );
}

function questionColumns(
  t: (key: MessageKey, values?: Record<string, string | number>) => string,
  transition: (input: { questionKey: string; action: PublicationAction }) => void,
  pending: boolean,
  openLinking: (lessonKey: string) => void,
): readonly Column<QuestionRecord>[] {
  return [
    {
      id: 'question',
      label: t('questionBank.question'),
      render: (row) => (
        <span>
          <span className="block max-w-xl truncate font-semibold text-text">{row.text}</span>
          <span className="block text-2xs text-text-muted">{row.lessonKey}</span>
        </span>
      ),
    },
    { id: 'type', label: t('questionBank.type'), render: (row) => <Badge tone="neutral">{t(`question.type.${row.type}` as MessageKey)}</Badge> },
    {
      id: 'origin',
      label: t('questionBank.origin'),
      render: (row) => (
        <span className="space-y-1">
          <Badge tone={row.origin === 'MINISTERIAL' ? 'info' : 'neutral'}>{t(`question.origin.${row.origin}` as MessageKey)}</Badge>
          {row.sourceRef ? <span className="block text-2xs text-text-muted">{row.sourceRef}</span> : null}
        </span>
      ),
    },
    { id: 'status', label: t('catalogue.state'), render: (row) => <Badge tone={row.status === 'PUBLISHED' ? 'success' : 'neutral'}>{t(`publication.${row.status}` as MessageKey)}</Badge> },
    { id: 'concepts', label: t('content.concepts'), numeric: true, render: (row) => row.concepts.length },
    {
      id: 'actions',
      label: t('common.actions'),
      render: (row) => (
        <div className="flex flex-wrap gap-1">
          <Button variant="secondary" size="sm" onClick={() => openLinking(row.lessonKey)}>
            {t('questionStudio.reviewLink')}
          </Button>
          {actionsFor(row.status).map((action) => (
            <Button key={action} variant="secondary" size="sm" disabled={pending} onClick={() => transition({ questionKey: row.key, action })}>
              {t(`question.action.${action}` as MessageKey)}
            </Button>
          ))}
        </div>
      ),
    },
  ];
}
