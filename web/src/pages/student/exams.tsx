/**
 * My exams.
 *
 * The catalogue answers "what may I take": the published exams of the books I
 * am entitled to, with the server's own scope attached. The history below
 * answers "how did I do": finished EXAM attempts with the scores the server
 * derived at submission. Between the two sits the runner, which is the only
 * place a question is ever answered.
 *
 * No invented urgency: an exam with no time limit shows no countdown, and an
 * exam list that is empty says so, because a fresh install has no exams and a
 * wall of empty cards would claim otherwise.
 */

import { useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ClipboardCheck, Timer } from 'lucide-react';
import { Card, CardContent } from '../../design-system/ui/card';
import { Badge } from '../../design-system/ui/badge';
import { Button } from '../../design-system/ui/button';
import { PageHeader } from '../../design-system/patterns/page-header';
import { LoadingState, ErrorState, EmptyState } from '../../design-system/patterns/data-states';
import { ExamRunner } from '../../education/assessment/exam-runner';
import { AttemptHistoryList } from '../../education/assessment/attempt-history';
import { attemptApi, type LearnerExam } from '../../education/assessment/attempt.api';
import { assessmentApi } from '../../education/assessment/assessment.api';
import { useI18n } from '../../shared/i18n/i18n';
import { formatCount, formatRatioAsPercent } from '../../shared/format/numbers';

/** How many past attempts the page previews; the rest are on the dashboard. */
const HISTORY_LIMIT = 5;

export function ExamsPage(): ReactNode {
  const { t } = useI18n();
  const [running, setRunning] = useState<LearnerExam | null>(null);
  const [params] = useSearchParams();
  const highlightedExamKey = params.get('exam');

  const exams = useQuery({ queryKey: ['assessment', 'exams'], queryFn: () => attemptApi.exams() });
  const history = useQuery({
    queryKey: ['assessment', 'history', 'EXAM', HISTORY_LIMIT],
    queryFn: () => assessmentApi.history({ kind: 'EXAM', limit: HISTORY_LIMIT }),
  });

  return (
    <div className="space-y-6">
      <PageHeader title={t('exams.title')} subtitle={t('exams.intro')} />

      {running ? (
        <ExamRunner exam={running} onExit={() => setRunning(null)} />
      ) : exams.isPending ? (
        <LoadingState />
      ) : exams.isError ? (
        <ErrorState error={exams.error} onRetry={() => void exams.refetch()} />
      ) : exams.data.exams.length === 0 ? (
        <EmptyState title={t('exams.empty')} body={t('exams.emptyHint')} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {[...exams.data.exams]
            .sort((a, b) => Number(b.key === highlightedExamKey) - Number(a.key === highlightedExamKey))
            .map((exam) => (
              <ExamCard
                key={exam.key}
                exam={exam}
                highlighted={exam.key === highlightedExamKey}
                onStart={() => setRunning(exam)}
              />
            ))}
        </div>
      )}

      {history.isPending ? null : history.isError ? null : history.data.attempts.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-text-muted">{t('exams.recent')}</h2>
          <AttemptHistoryList attempts={history.data.attempts} />
        </section>
      ) : null}
    </div>
  );
}

function ExamCard({
  exam,
  onStart,
  highlighted = false,
}: {
  readonly exam: LearnerExam;
  readonly onStart: () => void;
  readonly highlighted?: boolean;
}): ReactNode {
  const { t, locale } = useI18n();

  return (
    <Card elevation="default" className={highlighted ? 'border-advisory-border bg-advisory-subtle' : undefined}>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-subtle text-accent">
            <ClipboardCheck className="size-5" aria-hidden="true" />
          </span>
          <h2 className="min-w-0 flex-1 text-base font-bold">{exam.title}</h2>
          {exam.isAdaptive ? <Badge tone="accent">{t('exams.adaptive')}</Badge> : null}
          {highlighted ? <Badge tone="advisory">{t('exams.fromAdvisoryTask')}</Badge> : null}
        </div>

        {exam.description ? (
          <p className="text-sm leading-relaxed text-text-muted">{exam.description}</p>
        ) : null}

        <div className="flex flex-wrap gap-x-4 gap-y-1 text-2xs text-text-muted">
          {exam.timeLimitMins !== null ? (
            <span className="inline-flex items-center gap-1">
              <Timer className="size-3.5" aria-hidden="true" />
              {t('exams.minutes', { n: formatCount(locale, exam.timeLimitMins) })}
            </span>
          ) : null}
          <span>
            {t('exams.conceptsMeasured', { n: formatCount(locale, exam.conceptKeys.length) })}
          </span>
          <span>
            {t('exams.passMark', { score: formatRatioAsPercent(locale, exam.passingScore) })}
          </span>
        </div>

        <div>
          <Button variant="primary" size="sm" onClick={onStart}>
            {t('exams.start')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
