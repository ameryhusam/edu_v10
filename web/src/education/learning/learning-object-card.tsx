/**
 * A learning object, as a card.
 *
 * The shape the product actually needs, rather than Card + Title + Text +
 * Button assembled differently on every screen:
 *
 *   subject          where this sits
 *   title            the concept or lesson
 *   mastery state    where the learner stands, as colour *and* label
 *   progress         how far, from the server's own ratio
 *   action           the one thing to do next
 *
 * The mastery rail down the leading edge is the reason this exists as a
 * component. It is a single flat band of the mastery colour, so a column of
 * these reads as a progress column at a glance without anyone having to
 * decode five badge colours. In RTL it moves to the right automatically,
 * because it is a logical border, not a left one.
 *
 * No thresholds are evaluated here, and no percentage is computed here. The
 * state arrives decided and the ratio arrives divided (FE8, FE9).
 */

import type { ReactNode } from 'react';
import { Card, CardContent } from '../../design-system/ui/card';
import { Button } from '../../design-system/ui/button';
import { ProgressBar } from '../progress/progress-bar';
import { MasteryBadge } from '../mastery/mastery-badge';
import { cn } from '../../design-system/ui/cn';
import { useI18n } from '../../shared/i18n/i18n';
import type { MasteryState } from './learning.api';

/** The rail colour per state. Flat bands — no gradients on a data surface. */
const RAIL: Record<MasteryState, string> = {
  MASTERED: 'bg-mastery-mastered',
  IN_PROGRESS: 'bg-mastery-in-progress',
  STRUGGLING: 'bg-mastery-struggling',
  LOCKED: 'bg-mastery-locked',
  NOT_STARTED: 'bg-mastery-not-started',
};

export interface LearningObjectCardProps {
  readonly subject?: string | undefined;
  readonly title: string;
  readonly state: MasteryState;
  /** 0..1, already divided by the server. Omit when there is nothing to show. */
  readonly completion?: number | undefined;
  readonly actionLabel?: string | undefined;
  readonly onAction?: (() => void) | undefined;
  /** A locked object is shown, but dimmed and unactionable. */
  readonly disabled?: boolean;
}

export function LearningObjectCard({
  subject,
  title,
  state,
  completion,
  actionLabel,
  onAction,
  disabled = false,
}: LearningObjectCardProps): ReactNode {
  const { t } = useI18n();
  const isInteractive = Boolean(onAction) && !disabled;

  return (
    <Card
      interactive={isInteractive}
      className={cn('relative overflow-hidden', disabled && 'opacity-60')}
    >
      {/* The rail. aria-hidden because MasteryBadge already says this in
          words — the colour is a second channel, never the only one (§42). */}
      <span
        aria-hidden="true"
        className={cn('absolute inset-y-0 start-0 w-1', RAIL[state])}
      />

      <CardContent className="space-y-3 ps-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-0.5">
            {subject ? (
              <p className="truncate text-2xs font-medium text-text-subtle">{subject}</p>
            ) : null}
            <h3 className="text-base font-bold leading-snug text-text">{title}</h3>
          </div>
          <MasteryBadge state={state} />
        </div>

        {completion === undefined ? null : (
          <ProgressBar
            completion={completion}
            label={t('learning.overallProgress')}
            tone={state}
          />
        )}

        {actionLabel && onAction ? (
          <Button variant="primary" size="sm" onClick={onAction} disabled={disabled}>
            {actionLabel}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
