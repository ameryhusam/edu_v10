/**
 * The exam runner — one question at a time, the engine's way.
 *
 * The adaptive engine on the server owns every decision: which question
 * comes next, when the attempt is finished, and what the score is. This
 * component owns exactly three things — showing the question it was given,
 * sending the choice the learner made, and saying what the server said back.
 * The moment it started picking questions would be the moment two engines
 * ran the same exam.
 *
 * Resuming is invisible and free: `start` resumes an open attempt on the same
 * scope, so a dropped connection lands the learner back on the same exam, and
 * a closed tab does not fork their evidence.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, XCircle } from 'lucide-react';
import { Card, CardContent } from '../../design-system/ui/card';
import { Badge } from '../../design-system/ui/badge';
import { Button } from '../../design-system/ui/button';
import { LoadingState, ErrorState } from '../../design-system/patterns/data-states';
import { useI18n } from '../../shared/i18n/i18n';
import type { MessageKey } from '../../shared/i18n/messages';
import { formatCount } from '../../shared/format/numbers';
import { cn } from '../../design-system/ui/cn';
import { queryKeys } from '../../shared/api/query-keys';
import { ApiError } from '../../shared/api/errors';
import { attemptApi, type LearnerExam, type AnswerFeedback } from './attempt.api';
import { offlineAttemptStore, type PendingAnswerDraft } from './offline-attempt-store';

/**
 * What the runner needs to run. `LearnerExam` satisfies it structurally; a
 * LESSON_CHECK passes the same shape with `lessonKey` set and no exam key —
 * the engine and the verdicts are identical, only the scope differs.
 */
export interface RunScope {
  readonly key: string;
  readonly title: string;
  readonly description: string | null;
  readonly isAdaptive: boolean;
  readonly timeLimitMins: number | null;
  readonly textbookKey: string | null;
  readonly conceptKeys: readonly string[];
  readonly lessonKey?: string;
}

export interface ExamRunnerProps {
  readonly exam: RunScope | LearnerExam;
  readonly onExit: () => void;
  /** Override the default EXAM/LESSON_CHECK when a scoped runner is diagnostic. */
  readonly attemptKind?: 'PRACTICE' | 'LESSON_CHECK' | 'EXAM' | 'REVIEW' | 'DIAGNOSTIC';
  /** Extra notice/actions shown after a lesson check closes. */
  readonly completionNotice?: ReactNode;
  readonly completionActions?: ReactNode;
}

export function ExamRunner({
  exam,
  onExit,
  attemptKind,
  completionNotice,
  completionActions,
}: ExamRunnerProps): ReactNode {
  const { t, locale } = useI18n();
  const queryClient = useQueryClient();

  const [attemptKey, setAttemptKey] = useState<string | null>(null);
  /** Bumped after every answer, so the next draw is a fresh query. */
  const [step, setStep] = useState(0);
  const [feedback, setFeedback] = useState<AnswerFeedback['feedback'] | null>(null);
  const [choice, setChoice] = useState<string | null>(null);
  const [offlineDraft, setOfflineDraft] = useState<PendingAnswerDraft | null>(null);

  const start = useMutation({
    mutationFn: () =>
      attemptApi.start(
        exam.lessonKey
          ? { kind: attemptKind ?? 'LESSON_CHECK', lessonKey: exam.lessonKey }
          : { kind: attemptKind ?? 'EXAM', examKey: exam.key },
      ),
    onSuccess: (result) => setAttemptKey(result.attempt.key),
  });

  // The engine's draw for the current step. Disabled until the attempt opens.
  const nextItem = useQuery({
    queryKey: attemptKey
      ? queryKeys.assessment.nextItem(attemptKey, exam.conceptKeys, step)
      : queryKeys.assessment.nextItem('pending', exam.conceptKeys, step),
    queryFn: () => attemptApi.nextItem(attemptKey!, exam.conceptKeys),
    enabled: attemptKey !== null,
  });

  const answer = useMutation({
    mutationFn: (input: { questionKey: string; choiceIds: readonly string[] }) =>
      attemptApi.answer({
        attemptKey: attemptKey!,
        questionKey: input.questionKey,
        choiceIds: input.choiceIds,
      }),
    onSuccess: (result, input) => {
      // The learner reads the verdict; moving on is a deliberate act. No
      // invalidation here — refetching the next item now would yank the
      // verdict off the screen before it was read.
      offlineAttemptStore.remove(attemptKey!, input.questionKey);
      setOfflineDraft(null);
      setFeedback(result.feedback);
    },
    onError: (error, input) => {
      if (!(error instanceof ApiError) || error.kind !== 'OFFLINE') return;
      setOfflineDraft(
        offlineAttemptStore.save({
          attemptKey: attemptKey!,
          questionKey: input.questionKey,
          choiceIds: input.choiceIds,
        }),
      );
    },
  });

  const submit = useMutation({
    mutationFn: () => attemptApi.submit(attemptKey!),
    onSuccess: () => {
      // The attempt is closed: the exam list (resume state) and the history
      // are what changed, not the runner itself.
      queryClient.invalidateQueries({ queryKey: queryKeys.assessment.exams() });
      queryClient.invalidateQueries({ queryKey: queryKeys.assessment.history() });
    },
  });

  useEffect(() => {
    const questionKey = nextItem.data?.question?.key;
    if (!attemptKey || !questionKey) return;
    const draft = offlineAttemptStore.get(attemptKey, questionKey);
    setOfflineDraft(draft);
    if (draft?.choiceIds[0]) setChoice(draft.choiceIds[0]);
  }, [attemptKey, nextItem.data?.question?.key]);

  const moveOn = (): void => {
    setFeedback(null);
    setChoice(null);
    setOfflineDraft(null);
    setStep((at) => at + 1);
  };

  // ── Opening ────────────────────────────────────────────────────────────
  if (attemptKey === null) {
    return (
      <Card elevation="raised">
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-bold">{exam.title}</h2>
            {exam.isAdaptive ? <Badge tone="accent">{t('exams.adaptive')}</Badge> : null}
            {exam.timeLimitMins !== null ? (
              <Badge tone="neutral">{t('exams.minutes', { n: formatCount(locale, exam.timeLimitMins) })}</Badge>
            ) : null}
          </div>
          {exam.description ? <p className="text-sm text-text-muted">{exam.description}</p> : null}
          <p className="text-xs text-text-muted">{t('exams.runnerIntro')}</p>
          {start.isError ? (
            <ErrorState error={start.error} onRetry={() => start.mutate()} />
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => start.mutate()} disabled={start.isPending}>
                {start.isPending ? t('exams.starting') : t('exams.start')}
              </Button>
              <Button variant="secondary" onClick={onExit}>
                {t('common.cancel')}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  // ── Drawing ────────────────────────────────────────────────────────────
  if (nextItem.isPending) return <LoadingState />;
  if (nextItem.isError) {
    return <ErrorState error={nextItem.error} onRetry={() => void nextItem.refetch()} />;
  }

  // ── Finished: the engine stopped, the attempt closes with its own totals.
  if (nextItem.data.finished) {
    if (!submit.isIdle) {
      return submit.isPending ? (
        <LoadingState />
      ) : submit.isError ? (
        <ErrorState error={submit.error} onRetry={() => submit.mutate()} />
      ) : (
        <Card elevation="raised">
          <CardContent className="space-y-4">
            <h2 className="text-lg font-bold">{t('exams.finishedTitle')}</h2>
            <p className="text-sm text-text-muted">
              {t(`exams.stopReason.${nextItem.data.reason}` as MessageKey)}
            </p>
            {submit.data ? (
              <div className="flex flex-wrap gap-4">
                <SummaryFigure
                  label={t('exams.score')}
                  value={`${formatCount(locale, submit.data.totals.score)} / ${formatCount(locale, submit.data.totals.maxScore)}`}
                />
                <SummaryFigure
                  label={t('exams.correct')}
                  value={formatCount(locale, submit.data.totals.correctCount)}
                />
                <SummaryFigure
                  label={t('exams.incorrect')}
                  value={formatCount(locale, submit.data.totals.incorrectCount)}
                />
              </div>
            ) : null}
            {completionNotice}
            {completionActions ?? (
              <Button variant="primary" onClick={onExit}>
                {t('exams.backToExams')}
              </Button>
            )}
          </CardContent>
        </Card>
      );
    }
    // The stop reason arrived; closing the attempt is one deliberate click,
    // never a fire-and-forget side effect of a render.
    return (
      <Card elevation="raised">
        <CardContent className="space-y-4">
          <h2 className="text-lg font-bold">{t('exams.stoppedTitle')}</h2>
          <p className="text-sm text-text-muted">
            {t(`exams.stopReason.${nextItem.data.reason}` as MessageKey)}
          </p>
          <Button variant="primary" onClick={() => submit.mutate()} disabled={submit.isPending}>
            {submit.isPending ? t('exams.submitting') : t('exams.seeResults')}
          </Button>
        </CardContent>
      </Card>
    );
  }

  // ── A question ─────────────────────────────────────────────────────────
  const question = nextItem.data.question;
  if (!question) return <LoadingState />;

  return (
    <Card elevation="raised">
      <CardContent className="space-y-5">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-bold text-text-muted">{exam.title}</h2>
          <span className="text-2xs text-text-muted tabular-nums">
            {t('exams.administered', { n: formatCount(locale, nextItem.data.itemsAdministered) })}
          </span>
        </div>

        <p className="text-lg font-bold leading-relaxed">{question.text}</p>

        <div className="space-y-2">
          {[...question.choices]
            .sort((a, b) => a.orderIndex - b.orderIndex)
            .map((option) => {
              const picked = option.id === choice;
              return (
                <button
                  key={option.id}
                  type="button"
                  disabled={feedback !== null}
                  onClick={() => setChoice(option.id)}
                  className={cn(
                    'flex min-h-11 w-full items-center gap-3 rounded-lg border px-4 text-start text-sm transition-colors',
                    'duration-(--duration-fast)',
                    picked
                      ? 'border-accent-border bg-accent-subtle text-accent'
                      : 'border-border bg-surface text-text hover:bg-surface-hover',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'grid size-5 shrink-0 place-items-center rounded-full border',
                      picked ? 'border-accent' : 'border-border',
                    )}
                  >
                    {picked ? <span className="size-2 rounded-full bg-accent" /> : null}
                  </span>
                  <span>{option.text}</span>
                </button>
              );
            })}
        </div>

        {/* The verdict, in the server's words. The explanation follows the
            answer, never precedes it — the learner sees it only after their
            choice is graded and stored. */}
        {offlineDraft ? (
          <div className="rounded-xl border border-warning-border bg-warning-subtle p-3 text-xs text-warning">
            <p>{t('exams.offlineSaved')}</p>
            <Button
              className="mt-2"
              variant="secondary"
              size="sm"
              disabled={answer.isPending}
              onClick={() =>
                answer.mutate({
                  questionKey: offlineDraft.questionKey,
                  choiceIds: offlineDraft.choiceIds,
                })
              }
            >
              {answer.isPending ? t('common.working') : t('exams.retrySavedAnswer')}
            </Button>
          </div>
        ) : answer.isError ? (
          <p role="alert" className="rounded-xl bg-danger-subtle p-3 text-xs text-danger">
            {answer.error.message}
          </p>
        ) : null}

        {feedback ? (
          <div className="space-y-1.5">
            <span
              className={cn(
                'inline-flex items-center gap-1.5 text-sm font-bold',
                feedback.verdict === 'CORRECT' ? 'text-success' : 'text-danger',
              )}
            >
              {feedback.verdict === 'CORRECT' ? (
                <CheckCircle2 className="size-4" aria-hidden="true" />
              ) : (
                <XCircle className="size-4" aria-hidden="true" />
              )}
              {t(`exams.verdict.${feedback.verdict}` as MessageKey)}
            </span>
            {feedback.explanation ? (
              <p className="text-xs leading-relaxed text-text-muted">{feedback.explanation}</p>
            ) : null}
            <div>
              <Button variant="primary" size="sm" onClick={moveOn}>
                {t('common.next')}
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="primary"
            disabled={choice === null || answer.isPending || offlineDraft !== null}
            onClick={() =>
              answer.mutate({ questionKey: question.key, choiceIds: choice ? [choice] : [] })
            }
          >
            {answer.isPending ? t('exams.answerPending') : t('exams.answer')}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function SummaryFigure({ label, value }: { readonly label: string; readonly value: string }): ReactNode {
  return (
    <span className="flex flex-col gap-0.5">
      <span className="text-2xs text-text-muted">{label}</span>
      <span className="text-xl font-extrabold tabular-nums">{value}</span>
    </span>
  );
}
