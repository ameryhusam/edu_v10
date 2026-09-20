/**
 * A completion bar.
 *
 * Takes a ratio the **server** computed. It deliberately does not accept
 * `mastered` and `total` and divide them: that division is the server's
 * definition of completion, and a component that reimplements it becomes a
 * second opinion the moment the definition changes.
 *
 * Rendered as a real `progressbar` with aria values, because a coloured div is
 * invisible to a screen reader, and progress is exactly the kind of
 * information a blind learner needs most.
 */

import type { ReactNode } from 'react';
import { useI18n } from '../../shared/i18n/i18n';
import { formatRatioAsPercent } from '../../shared/format/numbers';
import { cn } from '../../design-system/ui/cn';
import type { MasteryState } from '../learning/learning.api';

/**
 * The fill colour follows the mastery state when one is given, so a bar and
 * its badge never disagree. Default accent, for progress that is not about
 * mastery (a form, an upload).
 */
const FILL: Record<MasteryState, string> = {
  MASTERED: 'bg-mastery-mastered',
  IN_PROGRESS: 'bg-mastery-in-progress',
  STRUGGLING: 'bg-mastery-struggling',
  LOCKED: 'bg-mastery-locked',
  NOT_STARTED: 'bg-mastery-not-started',
};

export interface ProgressBarProps {
  /** 0..1, computed by the server. */
  readonly completion: number;
  readonly label: string;
  readonly className?: string;
  readonly showValue?: boolean;
  readonly tone?: MasteryState | undefined;
}

export function ProgressBar({
  completion,
  label,
  className,
  showValue = true,
  tone,
}: ProgressBarProps): ReactNode {
  const { locale } = useI18n();
  // Clamping is presentation safety, not a calculation: a bar wider than its
  // track is a rendering bug, and it should not be able to happen even if the
  // server ever sends something out of range.
  const clamped = Math.min(1, Math.max(0, completion));
  const text = formatRatioAsPercent(locale, clamped);

  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-text-muted">{label}</span>
        {showValue ? <span className="text-sm font-bold tabular-nums">{text}</span> : null}
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(clamped * 100)}
        aria-valuetext={text}
        aria-label={label}
        className="h-2 overflow-hidden rounded-full bg-surface-sunken inset-shadow-2xs"
      >
        {/* Width is an inline style because the value is dynamic; the colour
            still comes from a token. */}
        <div
          className={cn(
            'h-full rounded-full transition-[width] duration-(--duration-slow) ease-(--ease-out-soft)',
            'motion-reduce:transition-none',
            tone ? FILL[tone] : 'bg-accent',
          )}
          style={{ inlineSize: `${clamped * 100}%` }}
        />
      </div>
    </div>
  );
}
