/**
 * Lesson-page workflow widgets.
 *
 * They are presentation-only: the lesson page passes the gate state that the
 * server returned, and these components draw the staged reading/reinforcement/
 * verification flow around it.
 */

import type { ReactNode } from 'react';
import { ArrowLeft, ArrowRight, CheckCircle2 } from 'lucide-react';
import { Button } from '../../design-system/ui/button';
import { useI18n } from '../../shared/i18n/i18n';
import type { LessonStop } from './learning.api';

export function LessonWorkflow({
  checking,
  gateOpen,
}: {
  readonly checking: boolean;
  readonly gateOpen: boolean;
}): ReactNode {
  const { t } = useI18n();
  const phases = [
    { key: 'absorb', label: t('lesson.phaseAbsorb'), state: 'done' },
    { key: 'reinforce', label: t('lesson.phaseReinforce'), state: checking || gateOpen ? 'done' : 'active' },
    { key: 'verify', label: t('lesson.phaseVerify'), state: gateOpen ? 'done' : checking ? 'active' : 'pending' },
  ] as const;
  return (
    <ol className="grid gap-2 rounded-2xl border border-border bg-surface p-3 sm:grid-cols-3">
      {phases.map((phase) => (
        <li
          key={phase.key}
          className={
            phase.state === 'done'
              ? 'rounded-xl border border-success-border bg-success-subtle p-3 text-success'
              : phase.state === 'active'
                ? 'rounded-xl border border-accent-border bg-accent-subtle p-3 text-accent'
                : 'rounded-xl border border-border bg-surface-raised p-3 text-text-muted'
          }
        >
          <span className="flex items-center gap-2 text-sm font-bold">
            {phase.state === 'done' ? <CheckCircle2 className="size-4" aria-hidden="true" /> : null}
            {phase.label}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function StructuredReading({ body }: { readonly body: string }): ReactNode {
  const blocks = body.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  return (
    <div className="space-y-4 text-base leading-loose text-text">
      {blocks.map((block, index) => {
        const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
        const isList = lines.length > 1 && lines.every((line) => /^[-•*]\s+/.test(line));
        const heading = block.match(/^#{2,3}\s+(.+)$/)?.[1] ?? null;
        if (heading) {
          return <h3 key={index} className="text-lg font-extrabold text-text">{heading}</h3>;
        }
        if (isList) {
          return (
            <ul key={index} className="list-disc space-y-1 ps-5">
              {lines.map((line) => (
                <li key={line}>{line.replace(/^[-•*]\s+/, '')}</li>
              ))}
            </ul>
          );
        }
        return <p key={index}>{block}</p>;
      })}
    </div>
  );
}

export function LessonNavigation({
  previousLesson,
  nextLesson,
  nextAllowed,
  isFinalLesson,
  onNavigate,
  onHome,
}: {
  readonly previousLesson: LessonStop | null;
  readonly nextLesson: LessonStop | null;
  readonly nextAllowed: boolean;
  readonly isFinalLesson: boolean;
  readonly onNavigate: (lesson: LessonStop) => void;
  readonly onHome: () => void;
}): ReactNode {
  const { t, locale } = useI18n();
  const PrevIcon = locale === 'ar' ? ArrowRight : ArrowLeft;
  const NextIcon = locale === 'ar' ? ArrowLeft : ArrowRight;
  return (
    <nav className="sticky bottom-3 z-10 rounded-2xl border border-border bg-surface/95 p-3 shadow-xl backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() => previousLesson && onNavigate(previousLesson)}
            disabled={!previousLesson}
          >
            <PrevIcon className="size-4" aria-hidden="true" />
            {previousLesson ? t('lesson.previousLessonShort') : t('lesson.noPrevious')}
          </Button>
          {nextLesson ? (
            <Button
              variant={nextAllowed ? 'primary' : 'secondary'}
              onClick={() => nextAllowed && onNavigate(nextLesson)}
              disabled={!nextAllowed}
            >
              {t(nextAllowed ? 'lesson.nextLessonShort' : 'lesson.nextLockedShort')}
              <NextIcon className="size-4" aria-hidden="true" />
            </Button>
          ) : null}
        </div>
        {isFinalLesson ? (
          <Button variant="primary" onClick={onHome}>
            {t('lesson.returnHome')}
          </Button>
        ) : null}
      </div>
    </nav>
  );
}

export function orderJourneyLessons(
  units: readonly { key: string; order: number }[],
  lessons: readonly LessonStop[],
): LessonStop[] {
  const unitOrder = new Map(units.map((unit) => [unit.key, unit.order]));
  return [...lessons].sort((a, b) => {
    const unitDelta = (unitOrder.get(a.unitKey) ?? 0) - (unitOrder.get(b.unitKey) ?? 0);
    return unitDelta === 0 ? a.order - b.order : unitDelta;
  });
}
