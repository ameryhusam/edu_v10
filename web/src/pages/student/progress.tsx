/**
 * Progress — where the learner stands, across everything.
 *
 * Three honest sections, each fed by its own server read: per-book progress
 * (the journey roll-ups, one query per book), recent finished attempts (the
 * assessment history), and the engagement ledger's own summary. A page that
 * multiplied, averaged or ranked anything locally would be a second analytics
 * engine, and the one in the browser is the one nobody tested.
 */

import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Award, Flame, Star, Zap } from 'lucide-react';
import { Card, CardContent } from '../../design-system/ui/card';
import { MetricCard, MetricGrid } from '../../design-system/patterns/metric-grid';
import { PageHeader } from '../../design-system/patterns/page-header';
import { LoadingState, ErrorState, EmptyState } from '../../design-system/patterns/data-states';
import { ProgressBar } from '../../education/progress/progress-bar';
import { AttemptHistoryList } from '../../education/assessment/attempt-history';
import { assessmentApi } from '../../education/assessment/assessment.api';
import { engagementApi } from '../../education/engagement/engagement.api';
import {
  useJourney,
  useLearnerTextbooks,
} from '../../education/learning/use-learning';
import { queryKeys } from '../../shared/api/query-keys';
import { useI18n } from '../../shared/i18n/i18n';
import { formatCount, formatRatioAsPercent } from '../../shared/format/numbers';

/** How much history the page carries — a term's worth of sittings, not the archive. */
const HISTORY_LIMIT = 10;

export function ProgressPage(): ReactNode {
  const { t, locale } = useI18n();

  const textbooks = useLearnerTextbooks();
  const history = useQuery({
    queryKey: queryKeys.assessment.history({ limit: HISTORY_LIMIT }),
    queryFn: () => assessmentApi.history({ limit: HISTORY_LIMIT }),
  });
  const xp = useQuery({
    queryKey: queryKeys.engagement.xp({}),
    queryFn: () => engagementApi.xp(),
  });

  if (textbooks.isPending) return <LoadingState />;
  if (textbooks.isError) {
    return <ErrorState error={textbooks.error} onRetry={() => void textbooks.refetch()} />;
  }
  const books = textbooks.data.textbooks;
  if (books.length === 0) {
    return <EmptyState title={t('learning.noTextbooks')} body={t('learning.noTextbooksHint')} />;
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t('progress.title')} subtitle={t('progress.intro')} />

      {/* The ledger's own summary. A failed read is not zero XP — the row is
          simply absent rather than lying with a 0. */}
      {xp.isPending ? null : xp.isSuccess && xp.data ? (
        <MetricGrid>
          <MetricCard
            title={t('progress.totalXp')}
            value={formatCount(locale, xp.data.totalXp)}
            icon={<Zap className="size-5" />}
            tone="accent"
          />
          <MetricCard
            title={t('progress.level')}
            value={formatCount(locale, xp.data.level)}
            icon={<Award className="size-5" />}
            tone="success"
          />
          <MetricCard
            title={t('progress.streak')}
            value={formatCount(locale, xp.data.currentStreak)}
            icon={<Flame className="size-5" />}
            tone="warning"
          />
          <MetricCard
            title={t('progress.stars')}
            value={formatCount(locale, xp.data.stars)}
            icon={<Star className="size-5" />}
            tone="info"
          />
        </MetricGrid>
      ) : null}

      {/* One card per book, each with its own journey read. */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-text-muted">{t('progress.byBook')}</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          {books.map((book) => (
            <BookProgress key={book.key} bookKey={book.key} title={book.title} />
          ))}
        </div>
      </section>

      {history.isPending ? null : history.isError ? null : history.data.attempts.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-text-muted">{t('learning.recentWork')}</h2>
          <AttemptHistoryList attempts={history.data.attempts} />
        </section>
      ) : null}
    </div>
  );
}

/** One book's progress card. Its own query, so a slow book cannot stall another. */
function BookProgress({
  bookKey,
  title,
}: {
  readonly bookKey: string;
  readonly title: string;
}): ReactNode {
  const { t, locale } = useI18n();
  const journey = useJourney({ textbookKey: bookKey });

  if (journey.isPending) {
    return (
      <Card elevation="default">
        <CardContent className="py-4">
          <h3 className="text-sm font-bold text-text-muted">{title}</h3>
          <div className="mt-3">
            <LoadingState />
          </div>
        </CardContent>
      </Card>
    );
  }
  if (journey.isError) {
    return (
      <Card elevation="default">
        <CardContent className="py-4">
          <h3 className="text-sm font-bold">{title}</h3>
          <div className="mt-2">
            <ErrorState error={journey.error} onRetry={() => void journey.refetch()} />
          </div>
        </CardContent>
      </Card>
    );
  }

  const overall = journey.data.progress.overall;

  return (
    <Card elevation="default">
      <CardContent className="space-y-3 py-4">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="min-w-0 truncate text-sm font-bold">{title}</h3>
          <span className="shrink-0 text-2xs text-text-muted tabular-nums">
            {t('progress.masteredOf', {
              mastered: formatCount(locale, overall.mastered),
              total: formatCount(locale, overall.total),
            })}
          </span>
        </div>
        <ProgressBar
          completion={overall.completion}
          label={t('learning.overallProgress')}
          showValue
        />

        {/*
          The book's own spine, below the overall bar: one row per unit with
          the server's unit roll-up, and the lessons named inside it. These are
          the same nodes the journey sent — nothing is recounted here.
        */}
        <div className="space-y-2 border-t border-border pt-3">
          {journey.data.units.map((unit) => {
            const unitRollup = journey.data.progress.units.find((u) => u.key === unit.key);
            if (!unitRollup) return null;
            const lessons = journey.data.lessons.filter((l) => l.unitKey === unit.key);
            return (
              <div key={unit.key} className="space-y-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-bold text-text">
                    {t('learning.unitLabel', { n: String(unit.order) })} · {unit.name}
                  </span>
                  <span className="text-2xs text-text-muted tabular-nums">
                    {t('progress.masteredOf', {
                      mastered: formatCount(locale, unitRollup.mastered),
                      total: formatCount(locale, unitRollup.total),
                    })}
                  </span>
                </div>
                <ProgressBar completion={unitRollup.completion} label={unit.name} showValue={false} />
                <ul className="flex flex-wrap gap-x-3 gap-y-1">
                  {lessons.map((lesson) => {
                    const lessonRollup = journey.data.progress.lessons.find(
                      (l) => l.key === lesson.key,
                    );
                    return (
                      <li
                        key={lesson.key}
                        className="text-2xs text-text-muted tabular-nums"
                        title={lesson.name}
                      >
                        {lesson.name}
                        {lessonRollup
                          ? ` · ${formatRatioAsPercent(locale, lessonRollup.completion)}`
                          : ''}
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
