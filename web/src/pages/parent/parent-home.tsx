/**
 * The guardian's home screen.
 *
 * Built on gap G2: before `GET /learning/children` existed, a parent had no
 * way to discover who their children were, so every parent screen was
 * unbuildable without hardcoding a learner key.
 *
 * The governing rule for this whole area is advisory-only (§11). A parent
 * observes; nothing here gates progression, mastery or eligibility, and the
 * parent's own tasks are marked as advisory wherever they appear. That is
 * enforced in the domain — this screen simply must not imply otherwise.
 *
 * So the framing is deliberately observational: what is my child working on,
 * how far through the book are they. There is no "assign", no "mark complete",
 * and no control that would suggest a parent can move the learner along.
 */

import { useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, Award, BookOpen, LifeBuoy, ListChecks } from 'lucide-react';
import { Button } from '../../design-system/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../design-system/ui/card';
import { Field } from '../../design-system/ui/field';
import { Input } from '../../design-system/ui/input';
import { MetricCard, MetricGrid } from '../../design-system/patterns/metric-grid';
import { PageHeader } from '../../design-system/patterns/page-header';
import { EmptyState, ErrorState, LoadingState } from '../../design-system/patterns/data-states';
import { Badge } from '../../design-system/ui/badge';
import { ChildPicker } from '../../education/guardian/child-picker';
import { LearningObjectCard } from '../../education/learning/learning-object-card';
import { useSelectedChild } from '../../education/guardian/use-children';
import {
  useJourney,
  useLearnerTextbooks,
  useNextStep,
  useSelectedTextbook,
} from '../../education/learning/use-learning';
import { queryKeys } from '../../shared/api/query-keys';
import { learningApi } from '../../education/learning/learning.api';
import {
  parentTasksApi,
  type InstructionalActivityType,
} from '../../education/instruction/parent-tasks.api';
import { useI18n } from '../../shared/i18n/i18n';
import { formatCount, formatRatioAsPercent } from '../../shared/format/numbers';
import type { MessageKey } from '../../shared/i18n/messages';
import { ACTIVITY_TONE } from '../../education/learning/activity-tone';
export function ParentHomePage(): ReactNode {
  const { t, locale } = useI18n();

  const children = useQuery({
    queryKey: queryKeys.learning.children(),
    queryFn: () => learningApi.children(),
  });

  const { selected: childKey, select: selectChild } = useSelectedChild(children.data?.children);

  // Every downstream read is scoped to the chosen child. The server verifies
  // the guardian link on each one — the key coming from this list is a
  // convenience, never the authorization.
  const textbooks = useLearnerTextbooks(childKey ?? undefined);
  const { selected: textbookKey } = useSelectedTextbook(textbooks.data?.textbooks);

  const nextStep = useNextStep({
    ...(textbookKey ? { textbookKey } : {}),
    ...(childKey ? { learnerKey: childKey } : {}),
  });
  const journey = useJourney({
    textbookKey,
    ...(childKey ? { learnerKey: childKey } : {}),
  });

  const queryClient = useQueryClient();
  const [taskTitle, setTaskTitle] = useState('');
  const [taskActivityKey, setTaskActivityKey] = useState('');
  const [taskActivityType, setTaskActivityType] = useState<InstructionalActivityType>('LESSON');
  const [taskDueAt, setTaskDueAt] = useState('');
  const parentTasks = useQuery({
    queryKey: childKey
      ? queryKeys.instruction.parentTasks({ learnerKey: childKey })
      : queryKeys.instruction.parentTasks({ learnerKey: 'none' }),
    enabled: Boolean(childKey),
    queryFn: () => parentTasksApi.list(childKey!),
  });
  const createTask = useMutation({
    mutationFn: () =>
      parentTasksApi.create({
        learnerKey: childKey!,
        title: taskTitle.trim(),
        activityType: taskActivityType,
        activityKey: taskActivityKey.trim(),
        dueAt: taskDueAt ? new Date(`${taskDueAt}T23:59:00`).toISOString() : null,
      }),
    onSuccess: async () => {
      setTaskTitle('');
      setTaskActivityKey('');
      setTaskDueAt('');
      if (childKey) {
        await queryClient.invalidateQueries({
          queryKey: queryKeys.instruction.parentTasks({ learnerKey: childKey }),
        });
      }
    },
  });
  const cancelTask = useMutation({
    mutationFn: (planKey: string) => parentTasksApi.cancel(planKey),
    onSuccess: async () => {
      if (childKey) {
        await queryClient.invalidateQueries({
          queryKey: queryKeys.instruction.parentTasks({ learnerKey: childKey }),
        });
      }
    },
  });

  const submitParentTask = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!childKey || !taskTitle.trim() || !taskActivityKey.trim()) return;
    createTask.mutate();
  };

  if (children.isPending) return <LoadingState />;
  if (children.isError) {
    return <ErrorState error={children.error} onRetry={() => void children.refetch()} />;
  }

  const list = children.data.children;
  if (list.length === 0) {
    // Honest: the link exists but is unverified, or no link exists at all. The
    // school office is the only place that can fix either.
    return <EmptyState title={t('parent.noChildren')} body={t('parent.noChildrenHint')} />;
  }

  const child = list.find((c) => c.learnerKey === childKey) ?? list[0];

  // `relation` is free text the school office typed ("father", "mother",
  // "guardian" by convention, but nothing enforces it). Translate the
  // conventional values; show nothing for anything else rather than printing
  // an English word into an Arabic interface.
  // The concept the server pointed at, found in the path it already returned.
  // A lookup, not a derivation.
  const focusConceptKey = nextStep.data?.step?.conceptKey;
  const focusNode = focusConceptKey
    ? journey.data?.path.find((n) => n.conceptKey === focusConceptKey)
    : undefined;

  const relationKey = child?.relation?.trim().toLowerCase();
  const relationLabel =
    relationKey === 'father' || relationKey === 'mother' || relationKey === 'guardian'
      ? t(`parent.relation.${relationKey}`)
      : null;

  return (
    <div className="space-y-6">
      <PageHeader
        badge={t('parent.badge')}
        title={t('parent.title')}
        subtitle={t('parent.subtitle')}
        actions={
          <>
            {/* Only when there is a genuine choice. */}
            {list.length > 1 ? (
              <ChildPicker options={list} selected={child?.learnerKey ?? null} onSelect={selectChild} />
            ) : null}
            {relationLabel ? <Badge tone="neutral">{relationLabel}</Badge> : null}
          </>
        }
      />

      {/* The «Nebula» opening row, all from the child's own journey roll-up.
          Observational numbers only (§11): each one is a fact the server
          computed, and none of them is a control dressed as a statistic. */}
      {journey.isSuccess ? (
        <MetricGrid>
          <MetricCard
            title={t('parent.metric.progress')}
            value={formatRatioAsPercent(locale, journey.data.progress.overall.completion)}
            subtitle={child?.fullName}
            icon={<BookOpen className="size-5" />}
            tone="accent"
          />
          <MetricCard
            title={t('parent.metric.mastered')}
            value={formatCount(locale, journey.data.progress.overall.mastered)}
            subtitle={t('parent.metric.ofTotal', {
              total: formatCount(locale, journey.data.progress.overall.total),
            })}
            icon={<Award className="size-5" />}
            tone="success"
          />
          <MetricCard
            title={t('parent.metric.inProgress')}
            value={formatCount(locale, journey.data.progress.overall.inProgress)}
            subtitle={t('parent.metric.ofTotal', {
              total: formatCount(locale, journey.data.progress.overall.total),
            })}
            icon={<Activity className="size-5" />}
            tone="info"
          />
          <MetricCard
            title={t('parent.metric.struggling')}
            value={formatCount(locale, journey.data.progress.overall.struggling)}
            subtitle={t('parent.metric.ofTotal', {
              total: formatCount(locale, journey.data.progress.overall.total),
            })}
            icon={<LifeBuoy className="size-5" />}
            tone="advisory"
          />
        </MetricGrid>
      ) : null}

      <section className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t('parent.currentlyWorkingOn')}</CardTitle>
          </CardHeader>
          <CardContent>
            {textbooks.isSuccess && textbooks.data.textbooks.length === 0 ? (
              <p className="text-xs text-text-muted">{t('parent.childNotEnrolled')}</p>
            ) : nextStep.isPending ? (
              <LoadingState />
            ) : nextStep.isError ? (
              <ErrorState error={nextStep.error} />
            ) : nextStep.data.step ? (
              <div className="space-y-2">
                <Badge tone={ACTIVITY_TONE[nextStep.data.step.activity]}>
                  {t(`activity.${nextStep.data.step.activity}` as MessageKey)}
                </Badge>
                {/* The concept as a learning object, with the child's standing
                    on it. `focusNode` is looked up in the path the server
                    already sent — nothing here recomputes a state. There is
                    no action: §11, a parent observes. */}
                {focusNode ? (
                  <LearningObjectCard
                    title={focusNode.name}
                    state={focusNode.state}
                    {...(focusNode.effectiveMastery === null
                      ? {}
                      : { completion: focusNode.effectiveMastery })}
                  />
                ) : (
                  <p className="text-sm font-bold">{nextStep.data.step.conceptName}</p>
                )}
              </div>
            ) : (
              <p className="text-xs text-text-muted">{t('learning.allDone')}</p>
            )}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <ListChecks className="size-4" aria-hidden="true" />
              {t('parent.tasksTitle')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {parentTasks.isPending ? (
              <LoadingState />
            ) : parentTasks.isError ? (
              <ErrorState error={parentTasks.error} onRetry={() => void parentTasks.refetch()} />
            ) : parentTasks.data.tasks.length === 0 ? (
              <p className="text-xs text-text-muted">{t('parent.noTasks')}</p>
            ) : (
              <div className="space-y-2">
                <p className="text-2xs text-text-muted">
                  {t('parent.academicSummary', {
                    completed: formatCount(locale, parentTasks.data.academicSummary.completed),
                    total: formatCount(locale, parentTasks.data.academicSummary.total),
                  })}
                </p>
                {parentTasks.data.tasks.map((task) => (
                  <article
                    key={task.obligationKey}
                    className="rounded-xl border border-border bg-surface-raised p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-text">{task.title}</p>
                        <p className="text-2xs text-text-muted">
                          {t(`obligation.status.${task.status}` as MessageKey)}
                          {task.dueAt ? ` · ${new Date(task.dueAt).toLocaleDateString(locale)}` : ''}
                        </p>
                      </div>
                      <Badge tone={task.countsTowardCompletion ? 'info' : 'advisory'}>
                        {task.countsTowardCompletion ? t('parent.academicTask') : t('parent.advisoryTask')}
                      </Badge>
                    </div>
                    {task.setByThisParent ? (
                      <div className="mt-3 flex justify-end">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={cancelTask.isPending}
                          onClick={() => cancelTask.mutate(task.planKey)}
                        >
                          {t('parent.cancelTask')}
                        </Button>
                      </div>
                    ) : null}
                  </article>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t('parent.createTaskTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="space-y-3" onSubmit={submitParentTask}>
              <Field label={t('parent.taskTitleLabel')}>
                {({ id, describedBy, invalid }) => (
                  <Input
                    id={id}
                    aria-describedby={describedBy}
                    invalid={invalid}
                    value={taskTitle}
                    onChange={(event) => setTaskTitle(event.target.value)}
                    placeholder={t('parent.taskTitlePlaceholder')}
                    required
                  />
                )}
              </Field>
              <Field label={t('parent.taskTypeLabel')}>
                {({ id, describedBy }) => (
                  <select
                    id={id}
                    aria-describedby={describedBy}
                    className="min-h-11 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text"
                    value={taskActivityType}
                    onChange={(event) =>
                      setTaskActivityType(event.target.value as InstructionalActivityType)
                    }
                  >
                    <option value="LESSON">{t('parent.taskType.lesson')}</option>
                    <option value="CONCEPT">{t('parent.taskType.concept')}</option>
                    <option value="EXAM">{t('parent.taskType.exam')}</option>
                    <option value="REVIEW_SET">{t('parent.taskType.review')}</option>
                  </select>
                )}
              </Field>
              <Field label={t('parent.taskActivityKeyLabel')} hint={t('parent.taskActivityKeyHint')}>
                {({ id, describedBy, invalid }) => (
                  <Input
                    id={id}
                    aria-describedby={describedBy}
                    invalid={invalid}
                    value={taskActivityKey}
                    onChange={(event) => setTaskActivityKey(event.target.value)}
                    placeholder="LESSON-..."
                    required
                  />
                )}
              </Field>
              <Field label={t('parent.taskDueLabel')}>
                {({ id, describedBy, invalid }) => (
                  <Input
                    id={id}
                    aria-describedby={describedBy}
                    invalid={invalid}
                    type="date"
                    value={taskDueAt}
                    onChange={(event) => setTaskDueAt(event.target.value)}
                  />
                )}
              </Field>
              {createTask.isError ? (
                <p role="alert" className="text-2xs font-medium text-danger">
                  {createTask.error.message}
                </p>
              ) : null}
              <Button
                type="submit"
                variant="primary"
                block
                disabled={!taskTitle.trim() || !taskActivityKey.trim() || createTask.isPending}
              >
                {createTask.isPending ? t('common.working') : t('parent.createTask')}
              </Button>
              <p className="text-2xs leading-relaxed text-text-muted">{t('parent.taskAdvisoryHint')}</p>
            </form>
          </CardContent>
        </Card>
      </section>

      {/* §11 made visible. A parent reading this screen must understand that
          what they see is observation, not control. */}
      <p className="rounded-xl border border-advisory-border bg-advisory-subtle px-3.5 py-2.5 text-2xs leading-relaxed text-advisory">
        {t('parent.advisoryNote')}
      </p>
    </div>
  );
}
