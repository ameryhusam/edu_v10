/**
 * How a mastery state looks.
 *
 * One component so that MASTERED is the same green everywhere. The legacy
 * system had mastery rendered from five places with four different formulas;
 * this cannot fix the formulas — the server owns those now — but it can make
 * sure one state never appears in two colours.
 *
 * The mastery palette is deliberately separate from the work-status palette.
 * Being late is administrative and being weak at a concept is pedagogical;
 * colouring them from one scale tells a learner that a missed deadline is the
 * same kind of problem as a misunderstood idea.
 */

import type { ReactNode } from 'react';
import { Badge } from '../../design-system/ui/badge';
import { useI18n } from '../../shared/i18n/i18n';
import type { MasteryState } from '../learning/learning.api';
import type { MessageKey } from '../../shared/i18n/messages';

/**
 * STRUGGLING is amber rather than red on purpose. Red is for something broken;
 * a learner who is struggling is doing the expected thing, and the UI should
 * not tell them they are a failure.
 */
const TONE: Record<MasteryState, 'success' | 'accent' | 'warning' | 'neutral'> = {
  MASTERED: 'success',
  IN_PROGRESS: 'accent',
  STRUGGLING: 'warning',
  LOCKED: 'neutral',
  NOT_STARTED: 'neutral',
};

export function MasteryBadge({ state }: { readonly state: MasteryState }): ReactNode {
  const { t } = useI18n();
  return <Badge tone={TONE[state]}>{t(`mastery.${state}` as MessageKey)}</Badge>;
}

export function masteryToneOf(state: MasteryState): string {
  return TONE[state];
}
