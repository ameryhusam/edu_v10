/**
 * "What should I do next?"
 *
 * The single most important thing on a learner's screen, and the one most
 * easily got wrong. The decision — remediate, review, unblock, learn, assess,
 * practise, advance — is made entirely by the server's `decideNextActivity`.
 * This component chooses an icon and a verb for a decision that has already
 * been made, and it must never reorder, filter, or second-guess it.
 *
 * That is why there is no `if (mastery < threshold)` anywhere in this file. The
 * moment a component starts deciding what a learner should do, there are two
 * adaptive engines, and the one in the browser is the one nobody tested.
 */

import type { ReactNode } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  ClipboardCheck,
  KeyRound,
  LifeBuoy,
  PenLine,
  RefreshCw,
  Trophy,
} from 'lucide-react';
import { Card, CardContent } from '../../design-system/ui/card';
import { Button } from '../../design-system/ui/button';
import { Badge } from '../../design-system/ui/badge';
import { useI18n } from '../../shared/i18n/i18n';
import { cn } from '../../design-system/ui/cn';
import type { ActivityType, NextStep } from './learning.api';
import { ACTIVITY_TONE, ACTIVITY_FILL } from './activity-tone';
import type { MessageKey } from '../../shared/i18n/messages';

const ACTIVITY_ICON: Record<ActivityType, typeof BookOpen> = {
  REMEDIATE: LifeBuoy,
  REVIEW: RefreshCw,
  UNBLOCK: KeyRound,
  LEARN: BookOpen,
  ASSESS: ClipboardCheck,
  PRACTISE: PenLine,
  ADVANCE: Trophy,
};

/* Tone and fill come from the shared activity-tone table, so a learner and a
   parent looking at the same concept never see different colours. */

export interface NextStepCardProps {
  readonly step: NextStep;
  readonly onStart: () => void;
}

export function NextStepCard({ step, onStart }: NextStepCardProps): ReactNode {
  const { t, direction } = useI18n();
  const Icon = ACTIVITY_ICON[step.activity];
  const Arrow = direction === 'rtl' ? ArrowLeft : ArrowRight;

  return (
    <Card elevation="raised" className="overflow-hidden">
      <CardContent className="space-y-4">
        <div className="flex items-start gap-3">
          <span
            className={cn(
              'grid size-11 shrink-0 place-items-center rounded-xl text-text-on-accent shadow-sm',
              ACTIVITY_FILL[step.activity],
            )}
          >
            <Icon className="size-5" aria-hidden="true" />
          </span>

          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={ACTIVITY_TONE[step.activity]}>
                {t(`activity.${step.activity}` as MessageKey)}
              </Badge>
            </div>
            {/* The concept name, not the key. Keys are for the machine. */}
            <h2 className="text-lg font-bold leading-snug">{step.conceptName}</h2>
            <p className="text-xs leading-relaxed text-text-muted">
              {/* The server's rationale, translated by rule id. Showing the
                  English sentence verbatim would put developer prose in front
                  of a learner. */}
              {t(`rule.${step.rule}` as MessageKey, { concept: step.conceptName })}
            </p>
          </div>
        </div>

        <Button variant="primary" size="lg" onClick={onStart} className="w-full sm:w-auto">
          {t('learning.startStep')}
          <Arrow className="size-4" aria-hidden="true" />
        </Button>
      </CardContent>
    </Card>
  );
}
