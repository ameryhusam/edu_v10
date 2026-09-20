/**
 * The hero capsule — the junior board's greeting strip.
 *
 * Name, level, XP bar, streak, and stars, the way the legacy "البراعم
 * المستكشفون" board opened. Every number is the server's: the level and the
 * streak come from the Engagement context's summary, and the star count is
 * the same rule the legacy economy used (one star per 100 XP) applied to the
 * server's total, and the level fill and star count arrive already
 * computed. Nothing here can be earned by the page itself — and nothing
 * here divides, so the drawing can never disagree with the ledger (FE8).
 */

import type { ReactNode } from 'react';
import { Flame, Star } from 'lucide-react';
import { Card, CardContent } from '../../design-system/ui/card';
import { ProgressBar } from '../progress/progress-bar';
import { useI18n } from '../../shared/i18n/i18n';
import { formatCount } from '../../shared/format/numbers';
import type { XpSummary } from '../engagement/engagement.api';

export function HeroCapsule({ name, xp }: { readonly name: string; readonly xp: XpSummary }): ReactNode {
  const { t, locale } = useI18n();

  // The level fill and the star count arrive as server values; drawing them
  // is all this component does (FE8).

  return (
    <Card elevation="raised">
      <CardContent className="flex flex-wrap items-center gap-5">
        {/* The level medallion: the one number a junior reads first. */}
        <span
          aria-label={t('junior.level', { n: formatCount(locale, xp.level) })}
          className="grid size-16 shrink-0 place-items-center rounded-2xl bg-accent text-text-on-accent shadow-sm"
        >
          <span className="text-2xl font-extrabold tabular-nums">{xp.level}</span>
        </span>

        <div className="min-w-56 flex-1 space-y-2">
          <h1 className="text-lg font-extrabold">{t('junior.hello', { name })}</h1>
          <ProgressBar
            completion={xp.levelCompletion}
            label={t('junior.xpToNext', { n: formatCount(locale, xp.toNextLevel) })}
            showValue={false}
          />
          <p className="text-2xs text-text-muted">
            {t('junior.xpToNext', { n: formatCount(locale, xp.toNextLevel) })}
          </p>
        </div>

        <div className="flex shrink-0 gap-4">
          <span className="flex flex-col items-center gap-1">
            <Flame
              className={xp.currentStreak > 0 ? 'size-6 text-warning' : 'size-6 text-text-subtle'}
              aria-hidden="true"
            />
            <span className="text-sm font-bold tabular-nums">
              {formatCount(locale, xp.currentStreak)}
            </span>
            <span className="text-2xs text-text-muted">{t('junior.streakUnit')}</span>
          </span>

          <span className="flex flex-col items-center gap-1">
            <Star className="size-6 text-warning" aria-hidden="true" />
            <span className="text-sm font-bold tabular-nums">{formatCount(locale, xp.stars)}</span>
            <span className="text-2xs text-text-muted">{t('junior.starsUnit')}</span>
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
