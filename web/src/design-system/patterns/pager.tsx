/**
 * Pager — offset paging over a server that reports a true total.
 *
 * Offset, not cursor: every paged admin read reports `total`, and a pager
 * that can say "34 of 210" is worth more than an infinite scroll nobody can
 * link to. Kept as one component so every server-paged screen pages the same
 * way — the fourth copy of "prev/next" is always the one that forgets to
 * reset the offset when a filter changes.
 */

import type { ReactNode } from 'react';
import { Button } from '../ui/button';
import { useI18n } from '../../shared/i18n/i18n';
import { formatCount } from '../../shared/format/numbers';

export function Pager({
  total,
  limit,
  offset,
  onOffsetChange,
}: {
  /** Matching rows in total, not rows on this page. */
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
  readonly onOffsetChange: (offset: number) => void;
}): ReactNode {
  const { t, locale } = useI18n();
  if (total <= limit) return null;

  const page = Math.floor(offset / limit) + 1;
  const pages = Math.ceil(total / limit);

  return (
    <div className="flex items-center justify-between gap-3">
      <p className="text-xs text-text-muted">
        {t('common.pageOf', {
          page: formatCount(locale, page),
          pages: formatCount(locale, pages),
        })}
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={offset === 0}
          onClick={() => onOffsetChange(Math.max(0, offset - limit))}
        >
          {t('common.previous')}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={offset + limit >= total}
          onClick={() => onOffsetChange(offset + limit)}
        >
          {t('common.next')}
        </Button>
      </div>
    </div>
  );
}
