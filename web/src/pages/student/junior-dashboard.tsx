/**
 * لوحة البراعم المستكشفين — the junior learner's home.
 *
 * The legacy junior board, cloned in shape and rebuilt in substance. The
 * shape is the same four movements a grades-1-to-4 learner could read
 * without knowing the word "dashboard": the hero capsule says who they are,
 * the mission board says what today holds (three stations, no scrolling),
 * the card treasure is one tap away, and the trophy shelf shows what the
 * next star buys.
 *
 * The substance is that every station reflects the server's truth: the
 * lesson station is the engine's next-step decision (green when it says
 * there is nothing due), the treasure draws the server's deck for the
 * journey's current concept, and the stars are the Engagement ledger's
 * total. Nothing on this page can congratulate a learner the ledger does
 * not agree with — the legacy board's "تم" button could.
 */

import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, FileSignature, Layers3 } from 'lucide-react';
import { PageHeader } from '../../design-system/patterns/page-header';
import { LoadingState, ErrorState, EmptyState, AbsentValue } from '../../design-system/patterns/data-states';
import { Button } from '../../design-system/ui/button';
import { HeroCapsule } from '../../education/junior/hero-capsule';
import { MissionPath, type JuniorStation } from '../../education/junior/mission-path';
import { TreasureDeck } from '../../education/junior/treasure-deck';
import { TrophyBox } from '../../education/junior/trophy-box';
import {
  useJourney,
  useLearnerTextbooks,
  useNextStep,
  useSelectedTextbook,
} from '../../education/learning/use-learning';
import { engagementApi } from '../../education/engagement/engagement.api';
import { attemptApi, type LearnerExam } from '../../education/assessment/attempt.api';
import { queryKeys } from '../../shared/api/query-keys';
import { useI18n } from '../../shared/i18n/i18n';
import { useSession } from '../../shared/auth/session';

export function JuniorDashboardPage(): ReactNode {
  const { t } = useI18n();
  const { user } = useSession();
  const navigate = useNavigate();

  const textbooks = useLearnerTextbooks();
  // The remembered selection persists from the senior dashboard; a junior
  // never chooses a book — the first entitled one is theirs.
  const { selected } = useSelectedTextbook(textbooks.data?.textbooks);
  const bookKey = selected ?? textbooks.data?.textbooks[0]?.key ?? null;

  const nextStep = useNextStep({ ...(bookKey ? { textbookKey: bookKey } : {}) });
  const journey = useJourney({ textbookKey: bookKey });

  const xp = useQuery({
    queryKey: queryKeys.engagement.xp({}),
    queryFn: () => engagementApi.xp(),
  });

  /** The treasure opens below the board, the way the legacy board opened it. */
  const [treasureOpen, setTreasureOpen] = useState(false);

  // The challenge station is real exactly when a published exam exists for
  // the learner's books; the board never promises a challenge that is not
  // there, and never hides one that is.
  const examList = useQuery({
    queryKey: ['assessment', 'exams'],
    queryFn: () => attemptApi.exams(),
  });
  const firstExam: LearnerExam | null = examList.data?.exams[0] ?? null;

  if (textbooks.isPending) return <LoadingState />;
  if (textbooks.isError) {
    return <ErrorState error={textbooks.error} onRetry={() => void textbooks.refetch()} />;
  }
  if (textbooks.data.textbooks.length === 0) {
    return (
      <EmptyState title={t('learning.noTextbooks')} body={t('learning.noTextbooksHint')} />
    );
  }

  // The concept the treasure draws from: the journey's current one, or the
  // next step's when the path has not picked yet. Null means "answer some
  // questions first" and the deck station says exactly that.
  const currentConceptKey = journey.data?.currentConceptKey ?? nextStep.data?.step?.conceptKey ?? null;
  const currentConceptName =
    journey.data?.path.find((node) => node.conceptKey === currentConceptKey)?.name ??
    nextStep.data?.step?.conceptName ??
    null;
  const nextStepLessonKey = nextStep.data?.step
    ? (journey.data?.path.find((node) => node.conceptKey === nextStep.data!.step!.conceptKey)
        ?.lessonKey ?? null)
    : null;

  const stations: JuniorStation[] = [
    {
      id: 'lesson',
      icon: <BookOpen className="size-5 text-accent" aria-hidden="true" />,
      title: t('junior.stationLesson'),
      subtitle:
        nextStep.data?.step?.conceptName ??
        (nextStep.data ? t('junior.stationLessonDoneHint') : t('junior.stationLessonHint')),
      status: nextStep.isPending ? 'pending' : nextStep.data?.step ? 'active' : 'completed',
      ...(nextStep.data?.step
        ? {
            action: {
              label: t('junior.startLesson'),
              onClick: () =>
                navigate(
                  nextStepLessonKey
                    ? `/lesson?lesson=${nextStepLessonKey}`
                    : `/path${bookKey ? `?textbook=${bookKey}` : ''}`,
                ),
            },
          }
        : {}),
    },
    {
      id: 'cards',
      icon: <Layers3 className="size-5 text-accent" aria-hidden="true" />,
      title: t('junior.stationCards'),
      subtitle: currentConceptKey ? t('junior.stationCardsHint') : t('junior.deckNoConcept'),
      status: currentConceptKey ? 'active' : 'pending',
      ...(currentConceptKey
        ? {
            action: {
              label: t('junior.openCards'),
              onClick: () => setTreasureOpen(true),
            },
          }
        : {}),
    },
    {
      id: 'exam',
      icon: <FileSignature className="size-5 text-warning" aria-hidden="true" />,
      title: t('junior.stationExam'),
      subtitle: firstExam ? firstExam.title : t('junior.stationExamHint'),
      status: firstExam ? 'active' : 'pending',
      ...(firstExam
        ? { action: { label: t('junior.startExam'), onClick: () => navigate('/exams') } }
        : {}),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('junior.pageTitle')}
        subtitle={t('junior.pageIntro')}
        actions={
          <Button variant="secondary" size="sm" onClick={() => navigate('/')}>
            {t('junior.seniorMode')}
          </Button>
        }
      />

      {/* The hero: who I am and what I have earned. A failed read is not
          zero XP — it is no number at all. */}
      {xp.isPending ? <LoadingState /> : xp.isSuccess && xp.data ? (
        <HeroCapsule name={user?.fullName ?? t('learning.greetingAnon')} xp={xp.data} />
      ) : (
        <AbsentValue reason="unavailable" />
      )}

      {/* The board waits for the engine's decision: a station that guessed
          while the next-step query was in flight would lie for a frame. */}
      {nextStep.isPending ? (
        <LoadingState />
      ) : nextStep.isError ? (
        <ErrorState error={nextStep.error} onRetry={() => void nextStep.refetch()} />
      ) : (
        <MissionPath stations={stations} />
      )}

      {treasureOpen ? (
        <TreasureDeck conceptKey={currentConceptKey} conceptName={currentConceptName} />
      ) : null}

      {xp.isSuccess && xp.data ? (
        <TrophyBox stars={xp.data.stars} />
      ) : (
        <AbsentValue reason="unavailable" />
      )}
    </div>
  );
}
