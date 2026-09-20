/**
 * كنز البطاقات — the junior flashcard deck.
 *
 * Flip and move on; that is the whole interaction. There is deliberately no
 * "I knew this one" button: the server's position is that flipping a card is
 * not evidence, and a deck that graded itself would inflate mastery without
 * a single graded question. The deck is ordered hardest-trouble-first by the
 * server, so "keep flipping" is the entire strategy.
 */

import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { RotateCw } from 'lucide-react';
import { Card, CardContent } from '../../design-system/ui/card';
import { Button } from '../../design-system/ui/button';
import { LoadingState, ErrorState, EmptyState } from '../../design-system/patterns/data-states';
import { queryKeys } from '../../shared/api/query-keys';
import { learningApi } from '../learning/learning.api';
import { useI18n } from '../../shared/i18n/i18n';
import { formatCount } from '../../shared/format/numbers';

/** How many cards one sitting may hold — the server caps at fifty. */
const DECK_LIMIT = 20;

export function TreasureDeck({
  conceptKey,
  conceptName,
}: {
  /** The concept the deck is drawn from — the journey's current one. */
  readonly conceptKey: string | null;
  readonly conceptName: string | null;
}): ReactNode {
  const { t, locale } = useI18n();
  const [index, setIndex] = useState(0);
  const [faceUp, setFaceUp] = useState(false);

  const deck = useQuery({
    queryKey: queryKeys.learning.flashcards({ ...(conceptKey ? { conceptKey } : {}) }),
    queryFn: () =>
      learningApi.flashcardDeck({ ...(conceptKey ? { conceptKey } : {}), limit: DECK_LIMIT }),
    enabled: conceptKey !== null,
  });

  if (conceptKey === null) {
    return <EmptyState title={t('junior.deckNoConcept')} body={t('junior.deckEmptyHint')} />;
  }
  if (deck.isPending) return <LoadingState />;
  if (deck.isError) {
    return <ErrorState error={deck.error} onRetry={() => void deck.refetch()} />;
  }

  const cards = deck.data.cards;
  if (cards.length === 0) {
    return <EmptyState title={t('junior.deckEmpty')} body={t('junior.deckEmptyHint')} />;
  }

  // Bounded by cards.length, so a stale index after a refetch cannot escape.
  const current = cards[Math.min(index, cards.length - 1)]!;
  const flip = (): void => setFaceUp((up) => !up);
  const go = (step: number): void => {
    setFaceUp(false);
    setIndex((at) => Math.min(Math.max(at + step, 0), cards.length - 1));
  };

  return (
    <Card elevation="raised">
      <CardContent className="space-y-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-base font-bold">{t('junior.treasureTitle')}</h2>
          <span className="text-2xs text-text-muted tabular-nums">
            {t('junior.deckPosition', {
              current: formatCount(locale, Math.min(index, cards.length - 1) + 1),
              total: formatCount(locale, cards.length),
            })}
          </span>
        </div>

        {conceptName ? <p className="text-2xs text-text-muted">{conceptName}</p> : null}

        {/* The card itself: one tap target that flips, sized like a real card. */}
        <button
          type="button"
          onClick={flip}
          className="grid min-h-40 w-full place-items-center rounded-xl border border-border bg-surface-sunken p-6 text-center transition-colors duration-(--duration-fast)"
        >
          <span className="space-y-2">
            <span className="block text-lg font-bold">{faceUp ? current.back : current.front}</span>
            <span className="block text-2xs text-text-subtle">
              {faceUp ? t('junior.cardBack') : t('junior.cardFront')}
            </span>
          </span>
        </button>

        <div className="flex items-center justify-between gap-2">
          <Button variant="secondary" size="sm" onClick={() => go(-1)} disabled={index === 0}>
            {t('common.previous')}
          </Button>
          <Button variant="secondary" size="sm" onClick={flip}>
            <RotateCw className="size-4" aria-hidden="true" />
            {t('junior.flip')}
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => go(1)}
            disabled={index >= cards.length - 1}
          >
            {t('common.next')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
