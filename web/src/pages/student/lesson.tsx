/**
 * One lesson, opened — the reading first, then the options, then the gate.
 *
 * This is the screen the Yemeni textbook always implied: اقرأ الدرس، ثم
 * الخيارات التعليمية، ثم أسئلة تجاوز الدرس. The reading is the lesson's
 * own LearningResource (READING kind); the "options" are the rest of the
 * author's resources plus the card treasure; and passing is NOT a button —
 * it is the completion gate, which the server reads from graded evidence.
 * The questions run through the same adaptive engine exams use, scoped to
 * the lesson's concepts as a LESSON_CHECK attempt: answer well and mastery
 * moves, the gate opens, and the next lesson unlocks — the prerequisite
 * chain does the rest.
 *
 * Nothing here grades, unlocks, or counts: the page fetches the lesson
 * (with the gate) after the check closes and reports what came back.
 */

import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { BookOpen, Bot, Lightbulb } from 'lucide-react';
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from '../../design-system/patterns/data-states';
import { Card, CardContent } from '../../design-system/ui/card';
import { Badge } from '../../design-system/ui/badge';
import { Button } from '../../design-system/ui/button';
import { MasteryBadge } from '../../education/mastery/mastery-badge';
import { ExamRunner } from '../../education/assessment/exam-runner';
import { TreasureDeck } from '../../education/junior/treasure-deck';
import { TutorDrawer } from '../../education/tutoring/tutor-drawer';
import {
  LessonNavigation,
  LessonWorkflow,
  StructuredReading,
  orderJourneyLessons,
} from '../../education/learning/lesson-workflow';
import { LearningResourceMedia } from '../../education/learning/resource-viewer';
import { useJourney, useLesson } from '../../education/learning/use-learning';
import { useI18n } from '../../shared/i18n/i18n';
import type { MessageKey } from '../../shared/i18n/messages';
import { formatRatioAsPercent } from '../../shared/format/numbers';

export function LessonPage(): ReactNode {
  const { t, locale } = useI18n();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const lessonKey = searchParams.get('lesson');
  const lesson = useLesson({ lessonKey });
  // The book's journey: for the next-lesson link and the shelf's order. It is
  // the same query the path screen uses, so both screens share one cache.
  const journey = useJourney({
    textbookKey: lesson.data?.lesson.textbookKey ?? null,
  });

  const [checking, setChecking] = useState(false);
  const [tutorOpen, setTutorOpen] = useState(false);

  if (lessonKey === null) {
    return (
      <EmptyState
        title={t('lesson.missingTitle')}
        body={t('lesson.missingBody')}
        action={
          <Button variant="secondary" onClick={() => void navigate('/path')}>
            {t('lesson.backToPath')}
          </Button>
        }
      />
    );
  }

  if (lesson.isPending) return <LoadingState />;
  if (lesson.isError) {
    return <ErrorState error={lesson.error} onRetry={() => void lesson.refetch()} />;
  }

  const view = lesson.data;
  const reading = view.resources.find((r) => r.kind === 'READING') ?? null;
  const extras = view.resources.filter((r) => r.kind !== 'READING');
  const gate = view.completion.result;

  const orderedLessons = journey.data ? orderJourneyLessons(journey.data.units, journey.data.lessons) : [];
  const currentLessonIndex = lessonKey ? orderedLessons.findIndex((l) => l.key === lessonKey) : -1;
  const previousLesson = currentLessonIndex > 0 ? orderedLessons[currentLessonIndex - 1]! : null;
  const nextLesson =
    currentLessonIndex >= 0 && currentLessonIndex + 1 < orderedLessons.length
      ? orderedLessons[currentLessonIndex + 1]!
      : null;

  const closeCheck = (): void => {
    setChecking(false);
    // The gate is a reading of evidence: re-read it, and the journey
    // (locked/unlocked, roll-ups) with it.
    void lesson.refetch();
    void journey.refetch();
  };
  const isFinalLesson = journey.isSuccess && nextLesson === null;

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <p className="text-xs text-text-muted">
          <Link to={`/path?textbook=${encodeURIComponent(view.lesson.textbookKey)}`} className="hover:text-accent">
            {view.lesson.textbookTitle}
          </Link>
          {' · '}
          {view.lesson.unitName}
          {view.lesson.startPage !== null
            ? ` · ${t('learning.pages', {
                from: String(view.lesson.startPage),
                to: String(view.lesson.endPage ?? view.lesson.startPage),
              })}`
            : null}
          {view.lesson.estimatedMins !== null
            ? ` · ${t('learning.minutes', { n: String(view.lesson.estimatedMins) })}`
            : null}
        </p>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-extrabold">{view.lesson.name}</h1>
          <Button variant="secondary" onClick={() => setTutorOpen(true)}>
            <Bot aria-hidden="true" className="size-4" />
            {t('tutor.open')}
          </Button>
        </div>
      </header>

      <LessonWorkflow checking={checking} gateOpen={gate.allowedNext} />

      {/* ── 1. The lesson text ─────────────────────────────────────────── */}
      {reading ? (
        <Card elevation="raised">
          <CardContent className="space-y-3">
            <h2 className="flex items-center gap-2 text-sm font-bold text-text-muted">
              <BookOpen aria-hidden="true" className="size-4" />
              {t('lesson.readingTitle')}
            </h2>
            {reading.body ? <StructuredReading body={reading.body} /> : null}
            <LearningResourceMedia resource={reading} />
          </CardContent>
        </Card>
      ) : (
        <EmptyState title={t('lesson.noReadingTitle')} body={t('lesson.noReadingBody')} />
      )}

      {/* ── 2. Additional learning options ──────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-sm font-bold text-text-muted">{t('lesson.optionsTitle')}</h2>
        {extras.length === 0 ? (
          <p className="text-sm text-text-muted">{t('lesson.optionsNone')}</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {extras.map((res) => (
              <Card key={res.key} elevation="flat">
                <CardContent className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-bold">{res.title}</h3>
                    <Badge tone="neutral">{t(`resource.${res.kind}` as MessageKey)}</Badge>
                  </div>
                  {res.body ? (
                    <p className="text-sm leading-relaxed text-text-muted">{res.body}</p>
                  ) : null}
                  <LearningResourceMedia resource={res} />
                </CardContent>
              </Card>
            ))}
          </div>
        )}
        <TreasureDeck
          conceptKey={view.currentConceptKey}
          conceptName={
            view.concepts.find((c) => c.conceptKey === view.currentConceptKey)?.name ?? null
          }
        />
      </section>

      {/* ── 3. The concepts, with the learner's own states ─────────────── */}
      <section className="space-y-3">
        <h2 className="text-sm font-bold text-text-muted">{t('lesson.conceptsTitle')}</h2>
        {view.progress ? (
          <p className="text-xs text-text-muted tabular-nums">
            {t('learning.lessonMastery', {
              p: formatRatioAsPercent(locale, view.progress.completion),
            })}
          </p>
        ) : null}
        <ol className="space-y-2">
          {view.concepts.map((node) => (
            <li
              key={node.conceptKey}
              className="flex min-h-11 items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4"
            >
              <span className="text-sm font-bold">{node.name}</span>
              <MasteryBadge state={node.state} />
            </li>
          ))}
        </ol>
      </section>

      {/* ── 4. The gate: questions to pass the lesson ──────────────────── */}
      {checking ? (
        <ExamRunner
          exam={{
            key: `lesson-check:${view.lesson.key}`,
            title: t('lesson.checkTitle', { name: view.lesson.name }),
            description: t('lesson.checkIntro'),
            isAdaptive: true,
            timeLimitMins: null,
            passingScore: 0.5,
            textbookKey: view.lesson.textbookKey,
            itemCount: view.concepts.length,
            conceptKeys: view.concepts.map((c) => c.conceptKey),
            lessonKey: view.lesson.key,
          }}
          onExit={closeCheck}
          completionNotice={
            nextLesson ? (
              <p className="rounded-xl border border-info-border bg-info-subtle px-3 py-2 text-xs text-info">
                {t('lesson.afterCheckNextAvailable')}
              </p>
            ) : isFinalLesson ? (
              <p
                role="alert"
                className="rounded-xl border border-success-border bg-success-subtle px-3 py-2 text-xs text-success"
              >
                {t('lesson.allLessonsComplete')}
              </p>
            ) : null
          }
          completionActions={
            <div className="flex flex-wrap gap-2">
              <Button
                variant={nextLesson ? 'secondary' : 'primary'}
                onClick={() => {
                  closeCheck();
                  navigate('/');
                }}
              >
                {t('lesson.returnHome')}
              </Button>
              {nextLesson ? (
                <Button
                  variant="primary"
                  onClick={() => {
                    closeCheck();
                    navigate(`/lesson?lesson=${nextLesson.key}`);
                  }}
                >
                  {t('lesson.continueToNextLesson', { name: nextLesson.name })}
                </Button>
              ) : null}
            </div>
          }
        />
      ) : (
        <Card elevation="raised">
          <CardContent className="space-y-4">
            <h2 className="flex items-center gap-2 text-sm font-bold text-text-muted">
              <Lightbulb aria-hidden="true" className="size-4" />
              {t('lesson.gateTitle')}
            </h2>
            <p className="text-sm text-text-muted">
              {gate.allowedNext ? t('lesson.gateOpen') : t('lesson.gateClosed')}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => setChecking(true)}>
                {gate.allowedNext ? t('lesson.checkAgain') : t('lesson.startCheck')}
              </Button>
              {gate.allowedNext && nextLesson ? (
                <Button
                  variant="secondary"
                  onClick={() => navigate(`/lesson?lesson=${nextLesson.key}`)}
                >
                  {t('lesson.nextLesson', { name: nextLesson.name })}
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>
      )}

      <LessonNavigation
        previousLesson={previousLesson}
        nextLesson={nextLesson}
        nextAllowed={gate.allowedNext}
        isFinalLesson={isFinalLesson}
        onNavigate={(target) => navigate(`/lesson?lesson=${target.key}`)}
        onHome={() => navigate('/')}
      />

      {tutorOpen ? (
        <TutorDrawer
          open={true}
          onClose={() => setTutorOpen(false)}
          textbookKey={view.lesson.textbookKey}
          lessonKey={view.lesson.key}
          conceptKey={view.currentConceptKey}
        />
      ) : null}
    </div>
  );
}
