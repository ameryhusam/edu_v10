/** Parent work surface: advisory tasks plus family adaptive exam creation. */

import { useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge } from '../../design-system/ui/badge';
import { Button } from '../../design-system/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../design-system/ui/card';
import { Input } from '../../design-system/ui/input';
import { EmptyState, ErrorState, LoadingState } from '../../design-system/patterns/data-states';
import { PageHeader } from '../../design-system/patterns/page-header';
import { ChildPicker } from '../../education/guardian/child-picker';
import { useSelectedChild } from '../../education/guardian/use-children';
import { useLearnerTextbooks, useSelectedTextbook } from '../../education/learning/use-learning';
import { parentTasksApi } from '../../education/instruction/parent-tasks.api';
import { questionBankApi, type ExamRecord } from '../../education/authoring/question-bank.api';
import { learningApi } from '../../education/learning/learning.api';
import { queryKeys } from '../../shared/api/query-keys';
import { useI18n } from '../../shared/i18n/i18n';
import { formatCount } from '../../shared/format/numbers';
import type { MessageKey } from '../../shared/i18n/messages';

export function ParentWorkPage(): ReactNode {
  const { t, locale } = useI18n();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [minItems, setMinItems] = useState('5');
  const [maxItems, setMaxItems] = useState('15');
  const [createdExam, setCreatedExam] = useState<ExamRecord | null>(null);

  const children = useQuery({ queryKey: queryKeys.learning.children(), queryFn: () => learningApi.children() });
  const { selected: childKey, select: selectChild } = useSelectedChild(children.data?.children);
  const textbooks = useLearnerTextbooks(childKey ?? undefined);
  const { selected: textbookKey, select: selectTextbook } = useSelectedTextbook(textbooks.data?.textbooks);
  const parentTasks = useQuery({
    queryKey: childKey ? queryKeys.instruction.parentTasks({ learnerKey: childKey }) : queryKeys.instruction.parentTasks({ learnerKey: 'none' }),
    queryFn: () => parentTasksApi.list(childKey!),
    enabled: Boolean(childKey),
  });

  const createAdaptiveExam = useMutation({
    mutationFn: async () => {
      const selectedBook = textbooks.data?.textbooks.find((book) => book.key === textbookKey);
      const examTitle = title.trim() || t('parentWork.defaultExamTitle', { book: selectedBook?.title ?? '' });
      const exam = await questionBankApi.createAdaptiveExam({
        title: examTitle,
        description: t('parentWork.examDescription'),
        textbookKey: textbookKey!,
        visibility: 'PRIVATE',
        minItems: Number(minItems) || 5,
        maxItems: Number(maxItems) || 15,
        passingScore: 0.6,
      });
      await questionBankApi.transitionExam(exam.key, 'SUBMIT');
      await questionBankApi.transitionExam(exam.key, 'APPROVE');
      await parentTasksApi.create({
        learnerKey: childKey!,
        title: examTitle,
        instructions: t('parentWork.taskInstructions'),
        activityType: 'EXAM',
        activityKey: exam.key,
        dueAt: dueAt ? new Date(`${dueAt}T23:59:00`).toISOString() : null,
      });
      return { ...exam, status: 'PUBLISHED' as const };
    },
    onSuccess: async (exam) => {
      setCreatedExam(exam);
      setTitle('');
      setDueAt('');
      await queryClient.invalidateQueries({ queryKey: queryKeys.instruction.all });
      await queryClient.invalidateQueries({ queryKey: queryKeys.assessment.all });
    },
  });

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (childKey && textbookKey) createAdaptiveExam.mutate();
  }

  if (children.isPending) return <LoadingState />;
  if (children.isError) return <ErrorState error={children.error} onRetry={() => void children.refetch()} />;
  if (children.data.children.length === 0) {
    return <EmptyState title={t('parent.noChildren')} body={t('parent.noChildrenHint')} />;
  }

  const selectedChild = children.data.children.find((child) => child.learnerKey === childKey) ?? children.data.children[0]!;
  const books = textbooks.data?.textbooks ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        badge={t('parent.badge')}
        title={t('parentWork.title')}
        subtitle={t('parentWork.subtitle')}
        actions={
          children.data.children.length > 1 ? (
            <ChildPicker options={children.data.children} selected={selectedChild.learnerKey} onSelect={selectChild} />
          ) : undefined
        }
      />

      <p className="rounded-xl border border-advisory-border bg-advisory-subtle px-3.5 py-2.5 text-2xs leading-relaxed text-advisory">
        {t('parentWork.advisoryBoundary')}
      </p>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t('parentWork.currentTasks')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {parentTasks.isPending ? <LoadingState /> : null}
            {parentTasks.isError ? <ErrorState error={parentTasks.error} onRetry={() => void parentTasks.refetch()} /> : null}
            {parentTasks.isSuccess && parentTasks.data.tasks.length === 0 ? <p className="text-xs text-text-muted">{t('parent.noTasks')}</p> : null}
            {parentTasks.isSuccess ? parentTasks.data.tasks.map((task) => (
              <article key={task.obligationKey} className="rounded-xl border border-border bg-surface-raised p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-text">{task.title}</p>
                    <p className="text-2xs text-text-muted">{t(`obligation.status.${task.status}` as MessageKey)}</p>
                  </div>
                  <Badge tone={task.countsTowardCompletion ? 'info' : 'advisory'}>
                    {task.countsTowardCompletion ? t('parent.academicTask') : t('parent.advisoryTask')}
                  </Badge>
                </div>
              </article>
            )) : null}
          </CardContent>
        </Card>

        <Card elevation="raised">
          <CardHeader>
            <CardTitle className="text-sm">{t('parentWork.createAdaptiveTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="space-y-3" onSubmit={submit}>
              <label className="space-y-1.5">
                <span className="text-xs font-medium text-text-muted">{t('content.textbook')}</span>
                <select value={textbookKey ?? ''} onChange={(event) => selectTextbook(event.target.value)} className="h-11 w-full rounded-lg border border-border bg-surface-raised px-3 text-sm text-text" required>
                  <option value="">—</option>
                  {books.map((book) => <option key={book.key} value={book.key}>{book.title}</option>)}
                </select>
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-medium text-text-muted">{t('teacherAssignments.titleLabel')}</span>
                <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={t('parentWork.titlePlaceholder')} />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-text-muted">{t('examBuilder.minItems')}</span>
                  <Input type="number" min="3" value={minItems} onChange={(event) => setMinItems(event.target.value)} />
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-text-muted">{t('examBuilder.maxItems')}</span>
                  <Input type="number" min="3" value={maxItems} onChange={(event) => setMaxItems(event.target.value)} />
                </label>
              </div>
              <label className="space-y-1.5">
                <span className="text-xs font-medium text-text-muted">{t('parent.taskDueLabel')}</span>
                <Input type="date" value={dueAt} onChange={(event) => setDueAt(event.target.value)} />
              </label>
              {textbooks.isError ? <ErrorState error={textbooks.error} onRetry={() => void textbooks.refetch()} /> : null}
              {createAdaptiveExam.isError ? <ErrorState error={createAdaptiveExam.error} /> : null}
              <Button variant="primary" type="submit" block disabled={!childKey || !textbookKey || createAdaptiveExam.isPending}>
                {createAdaptiveExam.isPending ? t('common.working') : t('parentWork.createAdaptive')}
              </Button>
              {createdExam ? (
                <p className="text-2xs text-success">
                  {t('parentWork.created', { count: formatCount(locale, createdExam.items.length) })}
                </p>
              ) : null}
            </form>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
