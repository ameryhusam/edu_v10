/**
 * The graduated difficulty indicator: green (easy) → yellow (medium) → red
 * (hard), for every place the product shows an authored `difficulty01`.
 *
 * A bare "0.62" asks the reader to remember what the scale means and where
 * the cut points are. A three-colour bar plus its label answers both at a
 * glance — the whole reason this component exists instead of a `<Badge>`
 * wrapping a formatted number.
 *
 * Class strings are a static lookup (`TIER_FILL`/`TIER_BADGE`), never built by
 * interpolating the tier into a template string: Tailwind only ever sees the
 * classes that are written out literally in this file, and a
 * `bg-difficulty-${tier}` string would be invisible to it and ship as dead
 * CSS. See `metric-grid.tsx`'s `TONE_BOX` for the same rule applied earlier.
 */

import type { ReactNode } from 'react';
import { cn } from '../ui/cn';
import { useI18n } from '../../shared/i18n/i18n';
import type { MessageKey } from '../../shared/i18n/messages';
import { difficultyTier, type DifficultyTier } from './difficulty';

const TIER_FILL: Record<DifficultyTier, string> = {
  easy: 'bg-difficulty-easy',
  medium: 'bg-difficulty-medium',
  hard: 'bg-difficulty-hard',
};

const TIER_TEXT: Record<DifficultyTier, string> = {
  easy: 'text-difficulty-easy',
  medium: 'text-difficulty-medium',
  hard: 'text-difficulty-hard',
};

const TIER_BADGE: Record<DifficultyTier, string> = {
  easy: 'bg-difficulty-easy-subtle text-difficulty-easy border-difficulty-easy/30',
  medium: 'bg-difficulty-medium-subtle text-difficulty-medium border-difficulty-medium/30',
  hard: 'bg-difficulty-hard-subtle text-difficulty-hard border-difficulty-hard/30',
};

const TIER_LABEL: Record<DifficultyTier, MessageKey> = {
  easy: 'examBuilder.easy',
  medium: 'examBuilder.medium',
  hard: 'examBuilder.hard',
};

/** A compact pill — for a table cell or an inline mention beside a stem. */
export function DifficultyBadge({
  difficulty01,
  className,
}: {
  readonly difficulty01: number;
  readonly className?: string;
}): ReactNode {
  const { t } = useI18n();
  const tier = difficultyTier(difficulty01);
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-2xs font-semibold tabular-nums',
        TIER_BADGE[tier],
        className,
      )}
    >
      <span aria-hidden="true" className={cn('size-1.5 rounded-full', TIER_FILL[tier])} />
      {t(TIER_LABEL[tier])}
      <span className="text-text-subtle">{difficulty01.toFixed(2)}</span>
    </span>
  );
}

/** The full graduated bar — for a form field or a detail panel. */
export function DifficultyBar({
  difficulty01,
  className,
}: {
  readonly difficulty01: number;
  readonly className?: string;
}): ReactNode {
  const { t } = useI18n();
  const clamped = Math.min(1, Math.max(0, difficulty01));
  const tier = difficultyTier(clamped);
  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex items-center justify-between gap-2">
        <span className={cn('text-2xs font-bold', TIER_TEXT[tier])}>{t(TIER_LABEL[tier])}</span>
        <span className="text-2xs font-semibold tabular-nums text-text-muted">
          {clamped.toFixed(2)}
        </span>
      </div>
      <div
        role="meter"
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={clamped}
        aria-label={t('questionBank.difficulty')}
        className="flex h-2 gap-0.5 overflow-hidden rounded-full bg-surface-sunken"
      >
        {/* Three fixed segments — the scale's three bands, not a single fill
            sized by the value — so the boundaries at 0.34/0.66 are always
            visible landmarks, not just implied by colour blending. */}
        <span
          className={cn('h-full flex-1 rounded-s-full', TIER_FILL.easy, tier === 'easy' ? '' : 'opacity-25')}
        />
        <span className={cn('h-full flex-1', TIER_FILL.medium, tier === 'medium' ? '' : 'opacity-25')} />
        <span
          className={cn('h-full flex-1 rounded-e-full', TIER_FILL.hard, tier === 'hard' ? '' : 'opacity-25')}
        />
      </div>
    </div>
  );
}
