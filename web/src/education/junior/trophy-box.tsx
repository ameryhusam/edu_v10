/**
 * صندوق الأوسمة — the junior trophy shelf.
 *
 * The badge catalog is a static list of names and star prices, the way the
 * legacy shelf was: the same eight badges, the same thresholds, so a learner
 * who saw the old board finds the same ladder. What changed is the honesty
 * of the lock: a badge is earned exactly when the server's XP total has paid
 * its price, and nothing on the page can hand out a badge the ledger does
 * not back.
 */

import type { ReactNode } from 'react';
import { Lock } from 'lucide-react';
import { Card, CardContent } from '../../design-system/ui/card';
import { Badge } from '../../design-system/ui/badge';
import { cn } from '../../design-system/ui/cn';
import { useI18n } from '../../shared/i18n/i18n';
import { formatCount } from '../../shared/format/numbers';
import type { MessageKey } from '../../shared/i18n/messages';

/** The ladder, cheapest first. Names are i18n keys; icons are the shelf's. */
const CATALOG: readonly { readonly key: MessageKey; readonly icon: string; readonly stars: number }[] = [
  { key: 'junior.badge.firstLesson', icon: '📖', stars: 1 },
  { key: 'junior.badge.quizHero', icon: '🎯', stars: 5 },
  { key: 'junior.badge.weekWarrior', icon: '🔥', stars: 7 },
  { key: 'junior.badge.mathGenius', icon: '🧮', stars: 10 },
  { key: 'junior.badge.readerStar', icon: '📚', stars: 10 },
  { key: 'junior.badge.scienceExplorer', icon: '🔬', stars: 15 },
  { key: 'junior.badge.perfectScore', icon: '💯', stars: 20 },
  { key: 'junior.badge.knowledgeKing', icon: '👑', stars: 30 },
];

export function TrophyBox({ stars }: { readonly stars: number }): ReactNode {
  const { t, locale } = useI18n();

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-extrabold">{t('junior.trophiesTitle')}</h2>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {CATALOG.map((badge) => {
          const earned = stars >= badge.stars;
          return (
            <Card
              key={badge.key}
              className={cn(
                earned
                  ? 'border-warning-border bg-warning-subtle'
                  : 'border-border bg-surface opacity-70',
              )}
            >
              <CardContent className="space-y-2 p-3 text-center">
                <div className={cn('text-3xl', earned ? undefined : 'opacity-50')}>
                  {earned ? badge.icon : <Lock className="mx-auto size-6 text-text-subtle" aria-hidden="true" />}
                </div>
                <div className="text-xs font-bold">{t(badge.key)}</div>
                {earned ? (
                  <Badge tone="warning">{t('junior.badgeEarned')}</Badge>
                ) : (
                  <div className="text-2xs text-text-muted">
                    {t('junior.badgeStars', { n: formatCount(locale, badge.stars) })}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
