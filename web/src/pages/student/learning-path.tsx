/**
 * The learning path — a visual trail through units, lessons and concepts.
 *
 * The learner meets a textbook as a journey, not a spreadsheet. Units are smart
 * accordions, the current unit opens by default, lesson cards sit on a vertical
 * trail, and locked concepts explain which prerequisites block them. The order
 * and states still come entirely from the server.
 */

import type { ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BookOpen, ChevronDown, CheckCircle2, Lock, MapPinned } from 'lucide-react';
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from '../../design-system/patterns/data-states';
import { Card, CardContent } from '../../design-system/ui/card';
import { MasteryBadge } from '../../education/mastery/mastery-badge';
import { ProgressBar } from '../../education/progress/progress-bar';
import { TextbookPicker } from '../../education/learning/textbook-picker';
import {
  useJourney,
  useLearnerTextbooks,
  useSelectedTextbook,
} from '../../education/learning/use-learning';
import { useI18n } from '../../shared/i18n/i18n';
import { formatRatioAsPercent } from '../../shared/format/numbers';
import { cn } from '../../design-system/ui/cn';
import type { JourneyView, LearnerTextbook, PathNode, ProgressScope } from '../../education/learning/learning.api';

export function LearningPathPage(): ReactNode {
  const { t } = useI18n();
  const [searchParams] = useSearchParams();

  const textbooks = useLearnerTextbooks();
  const { selected, select } = useSelectedTextbook(textbooks.data?.textbooks);

  // A textbook named in the URL wins, so a link from the dashboard lands on
  // the right book even before the remembered selection resolves.
  const requested = searchParams.get('textbook');
  const active =
    requested && textbooks.data?.textbooks.some((b) => b.key === requested) ? requested : selected;

  const journey = useJourney({ textbookKey: active });

  if (textbooks.isPending) return <LoadingState />;
  if (textbooks.isError) {
    return <ErrorState error={textbooks.error} onRetry={() => void textbooks.refetch()} />;
  }

  const books = textbooks.data.textbooks;
  if (books.length === 0) {
    return <EmptyState title={t('learning.noTextbooks')} body={t('learning.noTextbooksHint')} />;
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-bold text-text sm:text-2xl sm:font-extrabold">{t('learning.pathTitle')}</h1>
        <p className="text-sm leading-relaxed text-text-muted">{t('learning.pathIntro')}</p>
      </header>

      {active ? (
        <ActiveTermStrip book={books.find((book) => book.key === active) ?? null} />
      ) : null}

      {books.length > 1 ? (
        <TextbookPicker books={books} selected={active} onSelect={select} />
      ) : null}

      {journey.isPending ? (
        <LoadingState />
      ) : journey.isError ? (
        <ErrorState error={journey.error} onRetry={() => void journey.refetch()} />
      ) : (
        <BookTrail view={journey.data} />
      )}
    </div>
  );
}

function ActiveTermStrip({
  book,
}: {
  readonly book: LearnerTextbook | null;
}): ReactNode {
  const { t } = useI18n();
  if (!book) return null;
  return (
    <Card elevation="flat">
      <CardContent className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-text">{book.subjectName}</p>
          <p className="text-xs leading-relaxed text-text-muted">
            {t('learning.activeTerm', {
              grade: book.gradeName,
              term: book.termName,
              year: book.academicYearKey,
            })}
          </p>
        </div>
        <span className="w-fit rounded-full bg-surface-sunken px-2.5 py-1 text-2xs text-text-muted">
          {book.edition}
        </span>
      </CardContent>
    </Card>
  );
}

/** The whole book: units as accordions, lessons as stations, concepts inside. */
function BookTrail({ view }: { readonly view: JourneyView }): ReactNode {
  const { t, locale } = useI18n();

  const lessonProgress = new Map(view.progress.lessons.map((l) => [l.key, l]));
  const unitProgress = new Map(view.progress.units.map((u) => [u.key, u]));
  const conceptsByLesson = new Map<string, PathNode[]>();
  const conceptNameByKey = new Map(view.path.map((node) => [node.conceptKey, node.name]));
  for (const node of view.path) {
    const bucket = conceptsByLesson.get(node.lessonKey);
    if (bucket) bucket.push(node);
    else conceptsByLesson.set(node.lessonKey, [node]);
  }
  const currentNode = view.path.find((n) => n.conceptKey === view.currentConceptKey) ?? null;
  const currentLessonKey = currentNode?.lessonKey ?? null;
  const currentUnitKey = currentNode?.unitKey ?? null;
  const units = [...view.units].sort((a, b) => a.order - b.order);

  return (
    <>
      <Card elevation="flat">
        <CardContent className="space-y-3 py-4 sm:py-5">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-accent-subtle text-accent">
              <MapPinned className="size-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-bold text-text">{t('learning.trailSummary')}</p>
              <p className="text-xs text-text-muted">{t('learning.pathIntro')}</p>
            </div>
          </div>
          <ProgressBar
            completion={view.progress.overall.completion}
            label={t('learning.overallProgress')}
          />
        </CardContent>
      </Card>

      <div className="space-y-4">
        {units.map((unit, index) => {
          const rollup = unitProgress.get(unit.key);
          const lessons = view.lessons
            .filter((l) => l.unitKey === unit.key)
            .sort((a, b) => a.order - b.order);
          const open = unit.key === currentUnitKey || (currentUnitKey === null && index === 0);
          return (
            <details key={unit.key} className="group rounded-2xl border border-border bg-surface" open={open}>
              <summary className="flex min-h-13 cursor-pointer list-none items-center justify-between gap-2 rounded-2xl px-3 py-3 hover:bg-surface-hover sm:min-h-14 sm:px-4">
                <span className="min-w-0">
                  <span className="block text-2xs font-semibold uppercase tracking-wide text-text-muted">
                    {t('learning.unitLabel', { n: String(unit.order) })}
                  </span>
                  <span className="block truncate text-sm font-bold text-text sm:text-base sm:font-extrabold">{unit.name}</span>
                </span>
                <span className="flex shrink-0 items-center gap-3 text-xs text-text-muted">
                  {rollup ? (
                    <span className="tabular-nums">
                      {t('learning.unitMastery', {
                        p: formatRatioAsPercent(locale, rollup.completion),
                      })}
                    </span>
                  ) : null}
                  <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden="true" />
                </span>
              </summary>

              <ol className="space-y-3 border-t border-border p-3 sm:p-4">
                {lessons.map((lesson, lessonIndex) => (
                  <LessonStation
                    key={lesson.key}
                    lesson={lesson}
                    concepts={conceptsByLesson.get(lesson.key) ?? []}
                    rollup={lessonProgress.get(lesson.key) ?? null}
                    isCurrent={lesson.key === currentLessonKey}
                    isLast={lessonIndex === lessons.length - 1}
                    conceptNameByKey={conceptNameByKey}
                  />
                ))}
              </ol>
            </details>
          );
        })}
      </div>
    </>
  );
}

function LessonStation({
  lesson,
  concepts,
  rollup,
  isCurrent,
  isLast,
  conceptNameByKey,
}: {
  readonly lesson: JourneyView['lessons'][number];
  readonly concepts: readonly PathNode[];
  readonly rollup: Pick<ProgressScope, 'completion'> | null;
  readonly isCurrent: boolean;
  readonly isLast: boolean;
  readonly conceptNameByKey: ReadonlyMap<string, string>;
}): ReactNode {
  const { t, locale } = useI18n();
  const allLocked = concepts.length > 0 && concepts.every((c) => c.state === 'LOCKED');
  const allMastered = concepts.length > 0 && concepts.every((c) => c.state === 'MASTERED');

  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)] gap-2 sm:gap-3">
      <div className="flex flex-col items-center">
        <span
          className={cn(
            'grid size-8 place-items-center rounded-full border bg-surface-raised sm:size-10',
            isCurrent
              ? 'border-accent-border bg-accent-subtle text-accent shadow-md'
              : allMastered
                ? 'border-success-border bg-success-subtle text-success'
                : allLocked
                  ? 'border-border bg-surface-sunken text-text-muted'
                  : 'border-info-border bg-info-subtle text-info',
          )}
        >
          {allMastered ? (
            <CheckCircle2 className="size-4 sm:size-5" aria-hidden="true" />
          ) : allLocked ? (
            <Lock className="size-4 sm:size-5" aria-hidden="true" />
          ) : (
            <BookOpen className="size-4 sm:size-5" aria-hidden="true" />
          )}
        </span>
        {isLast ? null : <span className="mt-2 w-px flex-1 bg-border" aria-hidden="true" />}
      </div>

      <Card
        elevation={isCurrent ? 'raised' : 'flat'}
        className={cn(isCurrent ? 'border-accent-border bg-accent-subtle' : undefined)}
        aria-current={isCurrent ? 'step' : undefined}
      >
        <CardContent className="space-y-3 px-3 py-3 sm:px-4 sm:py-4">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <Link
              to={`/lesson?lesson=${lesson.key}`}
              className="flex min-h-10 min-w-0 items-center gap-2 text-sm font-semibold leading-relaxed text-text hover:text-accent sm:min-h-11 sm:font-bold"
            >
              <span>
                <span className="text-text-muted tabular-nums">
                  {t('learning.lessonLabel', { n: String(lesson.order) })}
                </span>{' '}
                {lesson.name}
              </span>
            </Link>

            <div className="flex flex-wrap items-center gap-2 text-2xs text-text-muted">
              {lesson.startPage !== null ? (
                <span className="tabular-nums">
                  {t('learning.pages', {
                    from: String(lesson.startPage),
                    to: String(lesson.endPage ?? lesson.startPage),
                  })}
                </span>
              ) : null}
              {lesson.estimatedMins !== null ? (
                <span className="tabular-nums">
                  {t('learning.minutes', { n: String(lesson.estimatedMins) })}
                </span>
              ) : null}
              {allLocked ? (
                <span className="inline-flex items-center gap-1">
                  <Lock aria-hidden="true" className="size-3" />
                  {t('learning.lessonLocked')}
                </span>
              ) : rollup ? (
                <span className="tabular-nums">
                  {t('learning.lessonMastery', { p: formatRatioAsPercent(locale, rollup.completion) })}
                </span>
              ) : null}
              {isCurrent ? (
                <span className="rounded-full bg-accent px-2 py-0.5 font-bold text-text-on-accent">
                  {t('learning.currentLesson')}
                </span>
              ) : null}
            </div>
          </div>

          {concepts.length > 0 ? (
            <ol className="grid gap-2">
              {concepts.map((node) => (
                <ConceptStation key={node.conceptKey} node={node} conceptNameByKey={conceptNameByKey} />
              ))}
            </ol>
          ) : null}
        </CardContent>
      </Card>
    </li>
  );
}

function ConceptStation({
  node,
  conceptNameByKey,
}: {
  readonly node: PathNode;
  readonly conceptNameByKey: ReadonlyMap<string, string>;
}): ReactNode {
  const { t, locale } = useI18n();
  const blockedNames = node.blockedBy
    .map((key) => conceptNameByKey.get(key))
    .filter((name): name is string => Boolean(name));
  const lockedReason =
    node.state === 'LOCKED' && node.blockedBy.length > 0
      ? blockedNames.length > 0
        ? t('learning.lockedByNames', { names: new Intl.ListFormat(locale).format(blockedNames) })
        : t('learning.blockedByCount', { count: String(node.blockedBy.length) })
      : null;

  return (
    <li
      className="rounded-lg border border-border bg-surface px-3 py-2"
      title={lockedReason ?? undefined}
    >
      <div className="flex min-h-8 items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2 text-sm font-medium leading-relaxed text-text [overflow-wrap:anywhere]">
          {node.state === 'LOCKED' ? (
            <Lock aria-hidden="true" className="size-3.5 shrink-0 text-text-muted" />
          ) : null}
          {node.name}
        </span>
        <MasteryBadge state={node.state} />
      </div>
      {lockedReason ? <p className="mt-1 text-2xs text-text-muted">{lockedReason}</p> : null}
    </li>
  );
}
