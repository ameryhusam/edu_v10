/**
 * Manual grading queue.
 *
 * Essay evidence is intentionally paused at REQUIRES_MANUAL_REVIEW. This page
 * is the human loop that turns it into a scored item, feedback and mastery
 * recomputation.
 */

import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge } from '../../design-system/ui/badge';
import { Button } from '../../design-system/ui/button';
import { Card, CardContent } from '../../design-system/ui/card';
import { Input } from '../../design-system/ui/input';
import { EmptyState, ErrorState, LoadingState } from '../../design-system/patterns/data-states';
import { PageHeader } from '../../design-system/patterns/page-header';
import {
  manualGradingApi,
  type ManualReviewQueueItem,
} from '../../education/assessment/manual-grading.api';
import { queryKeys } from '../../shared/api/query-keys';
import { useI18n } from '../../shared/i18n/i18n';
import { formatCount } from '../../shared/format/numbers';

const PAGE_SIZE = 25;

type Drafts = Record<string, { score: string; feedback: string }>;

export function ManualGradingPage(): ReactNode {
  const { t, locale } = useI18n();
  const queryClient = useQueryClient();
  const [offset, setOffset] = useState(0);
  const [drafts, setDrafts] = useState<Drafts>({});
  const scope = { limit: PAGE_SIZE, offset };

  const reviews = useQuery({
    queryKey: queryKeys.assessment.manualReviews(scope),
    queryFn: () => manualGradingApi.list(scope),
  });

  const grade = useMutation({
    mutationFn: (input: {
      attemptKey: string;
      questionKey: string;
      scoreEarned: number;
      feedback: string;
    }) =>
      manualGradingApi.grade({
        attemptKey: input.attemptKey,
        questionKey: input.questionKey,
        scoreEarned: input.scoreEarned,
        feedback: input.feedback.trim() ? input.feedback.trim() : null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.assessment.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.learning.all });
    },
  });

  function draftFor(row: ManualReviewQueueItem): { score: string; feedback: string } {
    return drafts[draftKey(row)] ?? { score: '', feedback: '' };
  }

  function updateDraft(row: ManualReviewQueueItem, patch: Partial<{ score: string; feedback: string }>): void {
    setDrafts((current) => ({
      ...current,
      [draftKey(row)]: { ...draftFor(row), ...patch },
    }));
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t('manualGrading.title')} subtitle={t('manualGrading.subtitle')} />

      {reviews.isPending ? (
        <LoadingState />
      ) : reviews.isError ? (
        <ErrorState error={reviews.error} onRetry={() => void reviews.refetch()} />
      ) : reviews.data.rows.length === 0 ? (
        <EmptyState title={t('manualGrading.emptyTitle')} body={t('manualGrading.emptyBody')} />
      ) : (
        <>
          <p className="text-xs text-text-muted">
            {t('manualGrading.total', { count: formatCount(locale, reviews.data.total) })}
          </p>
          <ul className="space-y-3">
            {reviews.data.rows.map((row) => {
              const draft = draftFor(row);
              const score = Number(draft.score);
              const canSubmit = Number.isFinite(score) && score >= 0 && score <= row.scorePossible;
              return (
                <li key={draftKey(row)}>
                  <Card elevation="default">
                    <CardContent className="space-y-4 py-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="space-y-1">
                          <h2 className="text-sm font-bold text-text">{row.questionText}</h2>
                          <p className="text-2xs text-text-muted">
                            {row.learnerName ?? row.learnerKey} · {row.attemptKey}
                          </p>
                        </div>
                        <Badge tone="warning">{t('manualGrading.pending')}</Badge>
                      </div>

                      <div className="rounded-xl border border-border bg-surface-sunken p-3">
                        <p className="mb-1 text-2xs font-bold text-text-muted">{t('manualGrading.answer')}</p>
                        <pre className="whitespace-pre-wrap text-xs text-text">
                          {answerText(row.rawAnswer)}
                        </pre>
                      </div>

                      {row.note ? (
                        <p className="rounded-xl border border-info-border bg-info-subtle p-3 text-xs text-info">
                          {row.note}
                        </p>
                      ) : null}

                      <div className="grid gap-3 md:grid-cols-[12rem_1fr_auto] md:items-end">
                        <label className="space-y-1.5">
                          <span className="text-xs font-medium text-text-muted">
                            {t('manualGrading.scoreLabel', { max: formatCount(locale, row.scorePossible) })}
                          </span>
                          <Input
                            type="number"
                            min={0}
                            max={row.scorePossible}
                            step="0.25"
                            value={draft.score}
                            onChange={(event) => updateDraft(row, { score: event.target.value })}
                          />
                        </label>
                        <label className="space-y-1.5">
                          <span className="text-xs font-medium text-text-muted">{t('manualGrading.feedback')}</span>
                          <Input
                            value={draft.feedback}
                            onChange={(event) => updateDraft(row, { feedback: event.target.value })}
                          />
                        </label>
                        <Button
                          variant="primary"
                          disabled={!canSubmit || grade.isPending}
                          onClick={() =>
                            grade.mutate({
                              attemptKey: row.attemptKey,
                              questionKey: row.questionKey,
                              scoreEarned: score,
                              feedback: draft.feedback,
                            })
                          }
                        >
                          {grade.isPending ? t('common.working') : t('manualGrading.submit')}
                        </Button>
                      </div>

                      {grade.isError ? <ErrorState error={grade.error} /> : null}
                    </CardContent>
                  </Card>
                </li>
              );
            })}
          </ul>
          <div className="flex justify-between gap-2">
            <Button
              variant="secondary"
              disabled={offset === 0}
              onClick={() => setOffset((current) => Math.max(0, current - PAGE_SIZE))}
            >
              {t('common.previous')}
            </Button>
            <Button
              variant="secondary"
              disabled={offset + PAGE_SIZE >= reviews.data.total}
              onClick={() => setOffset((current) => current + PAGE_SIZE)}
            >
              {t('common.next')}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function draftKey(row: ManualReviewQueueItem): string {
  return `${row.attemptKey}:${row.questionKey}`;
}

function answerText(raw: Readonly<Record<string, unknown>>): string {
  if (typeof raw.text === 'string') return raw.text;
  if (Array.isArray(raw.choiceIds)) return raw.choiceIds.join(', ');
  return JSON.stringify(raw, null, 2);
}
