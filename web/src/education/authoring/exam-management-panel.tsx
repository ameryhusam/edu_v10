/**
 * Exam operations panel: catalogue, lifecycle and blueprint preview.
 */

import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge } from '../../design-system/ui/badge';
import { Button } from '../../design-system/ui/button';
import { Card, CardContent } from '../../design-system/ui/card';
import { Input } from '../../design-system/ui/input';
import { DataTable, type Column } from '../../design-system/patterns/data-table';
import { EmptyState, ErrorState, LoadingState } from '../../design-system/patterns/data-states';
import {
  PUBLICATION_STATUSES,
  questionBankApi,
  type ExamBlueprint,
  type ExamRecord,
  type PublicationAction,
  type PublicationStatus,
} from './question-bank.api';
import { textbookAdministrationApi } from '../../features/content/content.api';
import { actionsFor } from './question-form-utils';
import { queryKeys } from '../../shared/api/query-keys';
import { useI18n } from '../../shared/i18n/i18n';
import type { MessageKey } from '../../shared/i18n/messages';

export function ExamManagementPanel(): ReactNode {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<PublicationStatus | ''>('');
  const [mode, setMode] = useState<'all' | 'fixed' | 'adaptive'>('all');
  const [selectedExamKey, setSelectedExamKey] = useState<string | null>(null);

  const query = {
    ...(search.trim() ? { search: search.trim() } : {}),
    ...(status ? { status } : {}),
    ...(mode !== 'all' ? { isAdaptive: mode === 'adaptive' } : {}),
    limit: 50,
    offset: 0,
  };
  const exams = useQuery({ queryKey: queryKeys.content.exams(query), queryFn: () => questionBankApi.exams(query) });
  const textbooks = useQuery({
    queryKey: queryKeys.textbookAdministration.textbooks({ status: 'PUBLISHED', limit: 100 }),
    queryFn: () => textbookAdministrationApi.textbooks({ status: 'PUBLISHED', limit: 100 }),
  });
  const selectedExam = exams.data?.rows.find((exam) => exam.key === selectedExamKey) ?? null;
  const selectedOutline = useQuery({
    queryKey: queryKeys.content.outline(selectedExam?.textbookKey ?? 'none'),
    queryFn: () => textbookAdministrationApi.outline(selectedExam!.textbookKey!),
    enabled: Boolean(selectedExam?.textbookKey),
  });
  const blueprint = useQuery({
    queryKey: queryKeys.content.examBlueprint(selectedExamKey ?? 'none'),
    queryFn: () => questionBankApi.examBlueprint(selectedExamKey!),
    enabled: Boolean(selectedExamKey),
  });
  const transition = useMutation({
    mutationFn: (input: { examKey: string; action: PublicationAction }) =>
      questionBankApi.transitionExam(input.examKey, input.action),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.content.all });
      if (selectedExamKey) {
        queryClient.invalidateQueries({ queryKey: queryKeys.content.examBlueprint(selectedExamKey) });
      }
    },
  });

  const bookTitle = new Map((textbooks.data?.rows ?? []).map((book) => [book.key, book.title]));
  const conceptName = new Map(
    (selectedOutline.data ?? []).flatMap((unit) =>
      unit.lessons.flatMap((lesson) =>
        (lesson.concepts ?? []).map((concept) => [concept.key, concept.name] as const),
      ),
    ),
  );
  const columns = examColumns(t, setSelectedExamKey, transition.mutate, transition.isPending, bookTitle);

  return (
    <Card elevation="flat">
      <CardContent className="space-y-4 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-text">{t('examOps.title')}</h2>
            <p className="mt-1 text-2xs leading-relaxed text-text-muted">{t('examOps.subtitle')}</p>
          </div>
          <Badge tone="neutral">{t('examOps.count', { count: exams.data?.total ?? 0 })}</Badge>
        </div>
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_12rem_12rem]">
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-text-muted">{t('admin.search')}</span>
            <Input value={search} onChange={(event) => setSearch(event.target.value)} />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-text-muted">{t('catalogue.state')}</span>
            <select value={status} onChange={(event) => setStatus(event.target.value as PublicationStatus | '')} className="h-11 w-full rounded-lg border border-border bg-surface-raised px-3 text-sm text-text">
              <option value="">{t('common.all')}</option>
              {PUBLICATION_STATUSES.map((candidate) => <option key={candidate} value={candidate}>{t(`publication.${candidate}` as MessageKey)}</option>)}
            </select>
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-text-muted">{t('teacherAssignments.examMode')}</span>
            <select value={mode} onChange={(event) => setMode(event.target.value as 'all' | 'fixed' | 'adaptive')} className="h-11 w-full rounded-lg border border-border bg-surface-raised px-3 text-sm text-text">
              <option value="all">{t('common.all')}</option>
              <option value="fixed">{t('teacherAssignments.examModeFixed')}</option>
              <option value="adaptive">{t('teacherAssignments.examModeAdaptive')}</option>
            </select>
          </label>
        </div>

        {exams.isPending ? <LoadingState /> : null}
        {exams.isError ? <ErrorState error={exams.error} onRetry={() => void exams.refetch()} /> : null}
        {exams.isSuccess && exams.data.rows.length === 0 ? (
          <EmptyState title={t('examOps.empty')} body={t('examOps.emptyHint')} variant="filtered" />
        ) : null}
        {exams.isSuccess && exams.data.rows.length > 0 ? (
          <DataTable rows={exams.data.rows} columns={columns} keyOf={(exam) => exam.key} caption={t('examOps.title')} />
        ) : null}

        {selectedExam ? (
          <BlueprintPanel exam={selectedExam} blueprint={blueprint.data ?? null} loading={blueprint.isPending || selectedOutline.isPending} conceptName={conceptName} />
        ) : null}
        {transition.isError ? <ErrorState error={transition.error} /> : null}
      </CardContent>
    </Card>
  );
}

function examColumns(
  t: (key: MessageKey, values?: Record<string, string | number>) => string,
  select: (key: string) => void,
  transition: (input: { examKey: string; action: PublicationAction }) => void,
  pending: boolean,
  bookTitle: ReadonlyMap<string, string>,
): readonly Column<ExamRecord>[] {
  return [
    {
      id: 'exam',
      label: t('collection.exams'),
      sortBy: (exam) => exam.title,
      render: (exam) => (
        <span>
          <span className="block font-semibold text-text">{exam.title}</span>
          <span className="block text-2xs text-text-muted">{exam.textbookKey ? (bookTitle.get(exam.textbookKey) ?? '—') : '—'}</span>
        </span>
      ),
    },
    { id: 'mode', label: t('teacherAssignments.examMode'), render: (exam) => <Badge tone={exam.isAdaptive ? 'info' : 'neutral'}>{exam.isAdaptive ? t('exams.adaptive') : t('teacherAssignments.examModeFixed')}</Badge> },
    { id: 'items', label: t('examBuilder.totalItems'), numeric: true, sortBy: (exam) => exam.items.length, render: (exam) => exam.items.length },
    { id: 'status', label: t('catalogue.state'), render: (exam) => <Badge tone={exam.status === 'PUBLISHED' ? 'success' : 'neutral'}>{t(`publication.${exam.status}` as MessageKey)}</Badge> },
    { id: 'visibility', label: t('questionBank.visibility'), render: (exam) => <Badge tone="neutral">{t(`question.visibility.${exam.visibility}` as MessageKey)}</Badge> },
    {
      id: 'actions',
      label: t('common.actions'),
      render: (exam) => (
        <div className="flex flex-wrap justify-end gap-1.5">
          <Button size="sm" variant="secondary" onClick={() => select(exam.key)}>{t('examOps.preview')}</Button>
          {actionsFor(exam.status).map((action) => (
            <Button key={action} size="sm" variant={action === 'ARCHIVE' ? 'danger' : 'ghost'} disabled={pending} onClick={() => transition({ examKey: exam.key, action })}>
              {t(`question.action.${action}` as MessageKey)}
            </Button>
          ))}
        </div>
      ),
    },
  ];
}

function BlueprintPanel({
  exam,
  blueprint,
  loading,
  conceptName,
}: {
  readonly exam: ExamRecord;
  readonly blueprint: ExamBlueprint | null;
  readonly loading: boolean;
  readonly conceptName: ReadonlyMap<string, string>;
}): ReactNode {
  const { t } = useI18n();
  return (
    <section className="rounded-xl border border-border bg-surface-subtle p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-text">{t('examOps.blueprintFor', { title: exam.title })}</h3>
          <p className="text-2xs text-text-muted">{exam.description ?? t('examOps.noDescription')}</p>
        </div>
        <Badge tone={exam.isAdaptive ? 'info' : 'neutral'}>{exam.isAdaptive ? t('exams.adaptive') : t('teacherAssignments.examModeFixed')}</Badge>
      </div>
      {loading ? <LoadingState /> : null}
      {blueprint ? (
        <div className="grid gap-3 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <div className="grid grid-cols-2 gap-2">
            <BlueprintMetric label={t('examBuilder.totalItems')} value={blueprint.totalItems} />
            <BlueprintMetric label={t('questionBank.points')} value={blueprint.totalPoints} />
            <BlueprintMetric label={t('examBuilder.easy')} value={blueprint.difficultyBands.easy} />
            <BlueprintMetric label={t('examBuilder.medium')} value={blueprint.difficultyBands.medium} />
            <BlueprintMetric label={t('examBuilder.hard')} value={blueprint.difficultyBands.hard} />
          </div>
          <div className="space-y-2">
            <p className="text-2xs font-semibold text-text-muted">{t('examBuilder.conceptCoverage')}</p>
            <div className="flex flex-wrap gap-2">
              {blueprint.conceptCoverage.length === 0 ? <span className="text-xs text-text-muted">{t('examOps.noConceptCoverage')}</span> : null}
              {blueprint.conceptCoverage.map((concept, index) => (
                <Badge key={concept.conceptKey} tone="neutral">
                  {conceptName.get(concept.conceptKey) ?? t('examOps.conceptNumber', { count: index + 1 })} · {concept.items}
                </Badge>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function BlueprintMetric({ label, value }: { readonly label: string; readonly value: number }): ReactNode {
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2">
      <p className="text-2xs text-text-muted">{label}</p>
      <p className="text-lg font-bold text-text">{value}</p>
    </div>
  );
}
