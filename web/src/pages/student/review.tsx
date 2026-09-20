/**
 * Review — the concepts that need another look.
 *
 * The server's journey states decide what appears here: IN_PROGRESS and
 * STRUGGLING concepts are the review list, in the book's own order, with the
 * mastery numbers the engine computed. Nothing on this page re-derives a
 * state, and nothing offers a "mark as known" button — mastery moves when
 * graded evidence moves, not when a learner says so.
 *
 * The card treasure hangs off the current concept only: the deck the server
 * built for where the learner actually is, never a self-graded shuffle.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Layers3 } from 'lucide-react';
import { Card, CardContent } from '../../design-system/ui/card';
import { Badge } from '../../design-system/ui/badge';
import { Button } from '../../design-system/ui/button';
import { PageHeader } from '../../design-system/patterns/page-header';
import {
  LoadingState,
  ErrorState,
  EmptyState,
} from '../../design-system/patterns/data-states';
import { MasteryBadge } from '../../education/mastery/mastery-badge';
import { ProgressBar } from '../../education/progress/progress-bar';
import { TextbookPicker } from '../../education/learning/textbook-picker';
import { TreasureDeck } from '../../education/junior/treasure-deck';
import {
  useJourney,
  useLearnerTextbooks,
  useSelectedTextbook,
} from '../../education/learning/use-learning';
import type { PathNode } from '../../education/learning/learning.api';
import { useI18n } from '../../shared/i18n/i18n';
import { formatRatioAsPercent } from '../../shared/format/numbers';

export function ReviewPage(): ReactNode {
  const { t } = useI18n();
  const [searchParams] = useSearchParams();
  const [treasureOpen, setTreasureOpen] = useState(searchParams.has('concept'));

  const textbooks = useLearnerTextbooks();
  const { selected, select } = useSelectedTextbook(textbooks.data?.textbooks);
  const requested = searchParams.get('textbook');
  const requestedConcept = searchParams.get('concept');
  const active =
    requested && textbooks.data?.textbooks.some((b) => b.key === requested) ? requested : selected;

  useEffect(() => {
    if (requestedConcept) setTreasureOpen(true);
  }, [requestedConcept]);

  const journey = useJourney({ textbookKey: active });

  if (textbooks.isPending) return <LoadingState />;
  if (textbooks.isError) {
    return <ErrorState error={textbooks.error} onRetry={() => void textbooks.refetch()} />;
  }
  const books = textbooks.data.textbooks;
  if (books.length === 0) {
    return <EmptyState title={t('learning.noTextbooks')} body={t('learning.noTextbooksHint')} />;
  }

  // The review list, straight from the journey: what is open or struggling,
  // in book order. Filtering a server-ordered list is not re-deciding it.
  const journeyPath = journey.data?.path ?? [];
  const reviewable = journeyPath.filter(
    (node) => node.state === 'IN_PROGRESS' || node.state === 'STRUGGLING',
  );
  const current = journey.data
    ? (journeyPath.find((node) => node.conceptKey === requestedConcept) ??
      journeyPath.find((node) => node.conceptKey === journey.data.currentConceptKey) ??
      null)
    : null;

  return (
    <div className="space-y-6">
      <PageHeader title={t('review.title')} subtitle={t('review.intro')} />

      {books.length > 1 ? (
        <TextbookPicker books={books} selected={active} onSelect={select} />
      ) : null}

      {journey.isPending ? (
        <LoadingState />
      ) : journey.isError ? (
        <ErrorState error={journey.error} onRetry={() => void journey.refetch()} />
      ) : reviewable.length === 0 ? (
        <EmptyState title={t('review.allClear')} body={t('review.allClearHint')} />
      ) : (
        <>
          <ProgressBar
            completion={journey.data!.progress.overall.completion}
            label={t('learning.overallProgress')}
          />
          <ul className="space-y-2">
            {reviewable.map((node) => (
              <ReviewRow key={node.conceptKey} node={node} textbookKey={active} />
            ))}
          </ul>
        </>
      )}

      {/* The treasure: the server's deck for the current concept, one tap
          away. It is not a list-wide shuffle — a deck drawn from a concept the
          learner has not reached would be a quiz, not a review. */}
      {current ? (
        <Card elevation="default">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-subtle text-accent">
                <Layers3 className="size-5" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <h2 className="text-sm font-bold">{t('junior.stationCards')}</h2>
                <p className="text-xs text-text-muted">{current.name}</p>
              </div>
            </div>
            <Button variant="secondary" size="sm" onClick={() => setTreasureOpen((open) => !open)}>
              {treasureOpen ? t('common.close') : t('junior.openCards')}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {treasureOpen && current ? (
        <TreasureDeck conceptKey={current.conceptKey} conceptName={current.name} />
      ) : null}
    </div>
  );
}

function ReviewRow({
  node,
  textbookKey,
}: {
  readonly node: PathNode;
  readonly textbookKey: string | null;
}): ReactNode {
  const { t, locale } = useI18n();
  const reviewTarget = `/review?${new URLSearchParams({
    ...(textbookKey ? { textbook: textbookKey } : {}),
    concept: node.conceptKey,
  }).toString()}`;

  return (
    <li className="rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-bold">{node.name}</h2>
        <div className="flex items-center gap-2">
          <MasteryBadge state={node.state} />
          {node.effectiveMastery !== null ? (
            <Badge tone="neutral">{formatRatioAsPercent(locale, node.effectiveMastery)}</Badge>
          ) : null}
        </div>
      </div>
      {node.attemptsCount > 0 ? (
        <p className="mt-1 text-2xs text-text-muted">
          {t('learning.attempts', { count: String(node.attemptsCount) })}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <Link
          to={`/lesson?lesson=${encodeURIComponent(node.lessonKey)}`}
          className="inline-flex h-9 items-center rounded-lg border border-border bg-surface-raised px-3 text-sm font-medium text-text hover:bg-surface-hover"
        >
          {t('learning.startStep')}
        </Link>
        <Link
          to={reviewTarget}
          className="inline-flex h-9 items-center rounded-lg border border-border bg-surface px-3 text-sm font-medium text-text-muted hover:bg-surface-hover hover:text-text"
        >
          {t('review.openCards')}
        </Link>
      </div>
    </li>
  );
}
