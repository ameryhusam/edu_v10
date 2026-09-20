/**
 * A list of finished attempts (gap G4).
 *
 * The rule this component exists to hold: **an ungraded attempt has no score,
 * and no score is not zero.** An abandoned or expired attempt renders as
 * `AbsentValue`, never as 0%. Showing zero would tell a learner they failed
 * something they simply did not finish.
 *
 * No arithmetic. `score` and `maxScore` are shown as the server stored them;
 * the ratio is not computed here, because "what fraction did they get" is a
 * grading decision and partial credit already lives on the server.
 */

import type { ReactNode } from 'react';
import { AbsentValue } from '../../design-system/patterns/data-states';
import { Badge } from '../../design-system/ui/badge';
import { Card, CardContent } from '../../design-system/ui/card';
import { useI18n } from '../../shared/i18n/i18n';
import { formatCount, formatDate } from '../../shared/format/numbers';
import type { AttemptSummary, AttemptStatus } from './assessment.api';
import type { MessageKey } from '../../shared/i18n/messages';

/**
 * Tone by outcome, not by score. A submitted attempt is neutral-positive
 * whatever the mark — the mark is shown separately, and colouring a low score
 * red turns a practice record into a scoreboard of failures.
 */
const STATUS_TONE: Record<AttemptStatus, 'success' | 'neutral' | 'warning'> = {
  SUBMITTED: 'success',
  ABANDONED: 'neutral',
  EXPIRED: 'warning',
};

export function AttemptHistoryList({
  attempts,
}: {
  readonly attempts: readonly AttemptSummary[];
}): ReactNode {
  const { t, locale } = useI18n();

  return (
    <ul className="space-y-2">
      {attempts.map((attempt) => (
        <li key={attempt.key}>
          <Card>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 py-3.5">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={STATUS_TONE[attempt.status]}>
                    {t(`attempt.status.${attempt.status}` as MessageKey)}
                  </Badge>
                  <span className="text-2xs text-text-muted">
                    {t(`attempt.kind.${attempt.kind}` as MessageKey)}
                  </span>
                </div>
                <p className="text-2xs text-text-subtle">
                  {formatDate(locale, attempt.submittedAt ?? attempt.startedAt)}
                </p>
              </div>

              <div className="shrink-0 text-end">
                {/* Null score is "not graded", never zero. */}
                {attempt.score === null || attempt.maxScore === null ? (
                  <AbsentValue />
                ) : (
                  <span className="text-sm font-bold tabular-nums">
                    {formatCount(locale, attempt.score)}
                    <span className="text-text-muted">
                      {' / '}
                      {formatCount(locale, attempt.maxScore)}
                    </span>
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  );
}
