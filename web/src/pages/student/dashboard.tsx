/**
 * The learner's home screen.
 *
 * It answers one question — *what should I do now* — and everything else on
 * the page is secondary to that. The legacy dashboard tried to be an analytics
 * console for a twelve-year-old: charts, averages, and a recomputation of
 * mastery performed while rendering. This one shows the server's decision, the
 * book's progress, and nothing that needed a calculation to produce.
 *
 * Every number here was computed by the backend. There is no arithmetic in
 * this file, which is why FE8 passes over it.
 *
 * The order of the page is the answer to four questions, in the order a
 * learner asks them:
 *
 *   1. What do I do now?   the next-step card, raised, the only focal point
 *   2. Where have I got to? progress and mastery, flat, supporting
 *   3. What have I done?    recent finished attempts (G4)
 *   4. Where does it lead?  the path, one link away
 *
 * Anything that does not answer one of those does not belong on this screen.
 */

import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Activity, Award, BookOpen, ClipboardCheck, LifeBuoy } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../../design-system/ui/card';
import { Badge } from '../../design-system/ui/badge';
import { MetricCard, MetricGrid } from '../../design-system/patterns/metric-grid';
import { PageHeader } from '../../design-system/patterns/page-header';
import { LoadingState, ErrorState, EmptyState, AbsentValue } from '../../design-system/patterns/data-states';
import { NextStepCard } from '../../education/learning/next-step-card';
import { ProgressBar } from '../../education/progress/progress-bar';
import { TextbookPicker } from '../../education/learning/textbook-picker';
import {
  useDiagnosticPlacement,
  useJourney,
  useLearnerTextbooks,
  useNextStep,
  useSelectedTextbook,
} from '../../education/learning/use-learning';
import { useI18n } from '../../shared/i18n/i18n';
import { useSession } from '../../shared/auth/session';
import { formatCount, formatRatioAsPercent } from '../../shared/format/numbers';
import { Button } from '../../design-system/ui/button';
import { AttemptHistoryList } from '../../education/assessment/attempt-history';
import { assessmentApi } from '../../education/assessment/assessment.api';
import { dueWorkApi } from '../../education/instruction/due-work.api';
import { DashboardDiscovery, DueWorkList, StudyPulse } from '../../education/learning/student-dashboard-widgets';
import { queryKeys } from '../../shared/api/query-keys';

export function StudentDashboardPage(): ReactNode {
  const { t, locale } = useI18n();
  const { user } = useSession();
  const navigate = useNavigate();

  const textbooks = useLearnerTextbooks();
  const { selected, select } = useSelectedTextbook(textbooks.data?.textbooks);

  const nextStep = useNextStep({ ...(selected ? { textbookKey: selected } : {}) });
  const journey = useJourney({ textbookKey: selected });
  const diagnostic = useDiagnosticPlacement({ textbookKey: selected });
  const dueWork = useQuery({
    queryKey: queryKeys.instruction.dueWork({}),
    queryFn: () => dueWorkApi.forLearner(),
  });

  // A preview, not the archive: five rows answer "what did I just do".
  const history = useQuery({
    queryKey: queryKeys.assessment.history({ limit: 5 }),
    queryFn: () => assessmentApi.history({ limit: 5 }),
  });

  if (textbooks.isPending) return <LoadingState />;
  if (textbooks.isError) {
    return <ErrorState error={textbooks.error} onRetry={() => void textbooks.refetch()} />;
  }

  const books = textbooks.data.textbooks;

  // Gap G1 made this state reachable and honest: a learner with no current
  // enrollment genuinely has no books, and saying so beats an empty dashboard.
  if (books.length === 0) {
    return (
      <EmptyState title={t('learning.noTextbooks')} body={t('learning.noTextbooksHint')} />
    );
  }

  const greeting = user?.fullName
    ? t('learning.greeting', { name: user.fullName })
    : t('learning.greetingAnon');
  const selectedBook = books.find((book) => book.key === selected) ?? null;
  const textbookQuery = selected ? `?textbook=${encodeURIComponent(selected)}` : '';
  const resumeNode = journey.isSuccess
    ? (journey.data.path.find((node) => node.conceptKey === journey.data.currentConceptKey) ??
      journey.data.path.find((node) => node.state === 'IN_PROGRESS' || node.state === 'STRUGGLING') ??
      journey.data.path.find((node) => node.state === 'NOT_STARTED'))
    : null;
  const strugglingCount = journey.isSuccess ? journey.data.progress.overall.struggling : 0;

  function openPath(): void {
    navigate(`/path${textbookQuery}`);
  }

  function openReview(): void {
    navigate(`/review${textbookQuery}`);
  }

  function startNextStep(): void {
    const step = nextStep.data?.step;
    if (!step) return;
    const reviewQuery = `?${new URLSearchParams({
      ...(selected ? { textbook: selected } : {}),
      concept: step.conceptKey,
    }).toString()}`;
    const targetNode = journey.isSuccess
      ? journey.data.path.find((node) => node.conceptKey === step.conceptKey)
      : null;

    if (
      targetNode &&
      (step.activity === 'LEARN' ||
        step.activity === 'UNBLOCK' ||
        step.activity === 'REMEDIATE' ||
        step.activity === 'ADVANCE')
    ) {
      navigate(`/lesson?lesson=${encodeURIComponent(targetNode.lessonKey)}`);
      return;
    }

    if (step.activity === 'REVIEW') {
      navigate(`/review${reviewQuery}`);
      return;
    }

    if (step.activity === 'PRACTISE' || step.activity === 'ASSESS') {
      navigate(`/exams${textbookQuery}`);
      return;
    }

    navigate(`/path${textbookQuery}`);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={greeting}
        subtitle={t('app.tagline')}
        badge={t('student.badge')}
        actions={
          // The mode switch the legacy board had: the same learner, the same
          // data, a friendlier shape for the youngest readers.
          <Button variant="secondary" size="sm" onClick={() => navigate('/junior')}>
            {t('junior.juniorMode')}
          </Button>
        }
      />

      {books.length > 1 ? (
        <TextbookPicker books={books} selected={selected} onSelect={select} />
      ) : null}

      {resumeNode ? (
        <Card elevation="raised">
          <CardContent className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm font-bold text-text">{t('learning.resumeLastPoint')}</p>
              <p className="text-xs text-text-muted">
                {resumeNode.unitName} · {resumeNode.lessonName} · {resumeNode.name}
              </p>
            </div>
            <Button variant="primary" onClick={() => navigate(`/lesson?lesson=${resumeNode.lessonKey}`)}>
              {t('learning.continueLearning')}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {diagnostic.isSuccess ? (
        <Card elevation="flat">
          <CardContent className="flex flex-col gap-3 py-4 md:flex-row md:items-center md:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-info-subtle text-info">
                <ClipboardCheck className="size-5" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-bold text-text">{t('diagnostic.cardTitle')}</p>
                <p className="text-xs text-text-muted">
                  {diagnostic.data.status === 'NEEDS_DIAGNOSTIC'
                    ? t('diagnostic.needsBody')
                    : diagnostic.data.status === 'COMPLETE'
                      ? t('diagnostic.completeBody')
                      : diagnostic.data.placement
                        ? t('diagnostic.cardPlaced', {
                            lesson: diagnostic.data.placement.lessonName,
                            concept: diagnostic.data.placement.conceptName,
                          })
                        : t('diagnostic.needsBody')}
                </p>
              </div>
            </div>
            <Button
              variant={diagnostic.data.status === 'NEEDS_DIAGNOSTIC' ? 'primary' : 'secondary'}
              size="sm"
              onClick={() =>
                diagnostic.data.placement
                  ? navigate(`/lesson?lesson=${diagnostic.data.placement.lessonKey}`)
                  : navigate(`/diagnostic${textbookQuery}`)
              }
            >
              {diagnostic.data.placement ? t('learning.continueLearning') : t('diagnostic.start')}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {dueWork.isSuccess && journey.isSuccess ? (
        <StudyPulse
          outstanding={formatCount(locale, dueWork.data.summary.outstanding)}
          struggling={formatCount(locale, journey.data.progress.overall.struggling)}
          needsAttention={dueWork.data.summary.needsAttention}
          onDueWork={() => navigate('#due-work')}
          onReview={openReview}
        />
      ) : null}

      {/* The «Nebula» opening row: four numbers the server already computed —
          progress, mastered, in progress, needs review. This grid replaces the
          two flat cards that carried the same information with less presence;
          the numbers themselves are the same journey roll-up, unmodified. */}
      {journey.isPending ? null : journey.isSuccess ? (
        <MetricGrid>
          <MetricCard
            title={t('student.metric.progress')}
            value={formatRatioAsPercent(locale, journey.data.progress.overall.completion)}
            subtitle={selectedBook?.title ?? selected ?? undefined}
            icon={<BookOpen className="size-5" />}
            tone="accent"
            onClick={openPath}
            ariaLabel={t('student.metric.progressAction')}
          />
          <MetricCard
            title={t('student.metric.mastered')}
            value={formatCount(locale, journey.data.progress.overall.mastered)}
            subtitle={t('student.metric.openPath')}
            icon={<Award className="size-5" />}
            tone="success"
            onClick={openPath}
            ariaLabel={t('student.metric.masteredAction')}
          />
          <MetricCard
            title={t('student.metric.inProgress')}
            value={formatCount(locale, journey.data.progress.overall.inProgress)}
            subtitle={t('student.metric.openPath')}
            icon={<Activity className="size-5" />}
            tone="info"
            onClick={openPath}
            ariaLabel={t('student.metric.inProgressAction')}
          />
          <MetricCard
            title={t('student.metric.struggling')}
            value={formatCount(locale, journey.data.progress.overall.struggling)}
            subtitle={t('student.metric.openReview')}
            icon={<LifeBuoy className="size-5" />}
            tone="warning"
            onClick={openReview}
            ariaLabel={t('student.metric.strugglingAction')}
          />
        </MetricGrid>
      ) : (
        // Not zero. A failed read is not evidence of no progress.
        <AbsentValue reason="unavailable" />
      )}

      {/* 1. What do I do now? */}
      <section className="space-y-3">
        <h2 className="text-sm font-bold text-text-muted">{t('learning.nextStep')}</h2>

        {nextStep.isPending ? (
          <LoadingState />
        ) : nextStep.isError ? (
          <ErrorState error={nextStep.error} onRetry={() => void nextStep.refetch()} />
        ) : nextStep.data.step ? (
          <NextStepCard step={nextStep.data.step} onStart={startNextStep} />
        ) : (
          // No step is a real outcome, not an error: everything is mastered.
          <EmptyState title={t('learning.allDone')} />
        )}
      </section>

      {/* 2. Where have I got to, in detail. The metric row above carries the
          four headline numbers; this is the honest bar behind the first one —
          completion as a proportion, not an average of mastery. */}
      {journey.isSuccess ? (
        <Card elevation="flat">
          <CardHeader>
            <CardTitle className="text-sm">{t('learning.overallProgress')}</CardTitle>
          </CardHeader>
          <CardContent>
            <ProgressBar
              completion={journey.data.progress.overall.completion}
              label={t('learning.overallProgress')}
            />
          </CardContent>
        </Card>
      ) : null}

      {dueWork.isSuccess ? (
        <section id="due-work" className="space-y-3">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-bold text-text-muted">{t('work.dueTitle')}</h2>
            <Badge tone={dueWork.data.summary.needsAttention ? 'warning' : 'neutral'}>
              {t('work.outstandingCount', { count: formatCount(locale, dueWork.data.summary.outstanding) })}
            </Badge>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <DueWorkList title={t('work.academicTitle')} tone="info" items={dueWork.data.academic} />
            <DueWorkList title={t('work.advisoryTitle')} tone="advisory" items={dueWork.data.advisory} />
          </div>
        </section>
      ) : dueWork.isError ? (
        <ErrorState error={dueWork.error} onRetry={() => void dueWork.refetch()} />
      ) : null}

      {/* 3. What have I done? (gap G4) Finished attempts only — an attempt in
             progress is not history, and the server already excludes it. */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-bold text-text-muted">{t('learning.recentWork')}</h2>
        </div>

        {history.isPending ? (
          <LoadingState />
        ) : history.isError ? (
          <ErrorState error={history.error} onRetry={() => void history.refetch()} />
        ) : history.data.attempts.length === 0 ? (
          <EmptyState title={t('attempt.none')} body={t('attempt.noneHint')} />
        ) : (
          <AttemptHistoryList attempts={history.data.attempts} />
        )}
      </section>

      {/* 4. Where does it lead? One compact exploration panel, not a loose CTA. */}
      <DashboardDiscovery
        selected={selectedBook?.title ?? selected}
        strugglingCount={strugglingCount}
        onPath={openPath}
        onSubjects={() => navigate('/subjects')}
        onReview={openReview}
      />
    </div>
  );
}
