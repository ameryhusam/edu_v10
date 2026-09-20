/** Small operational summary for an academic-structure collection. */

import type { ReactNode } from 'react';
import { Card, CardContent } from '../../design-system/ui/card';
import { useI18n } from '../../shared/i18n/i18n';

export function AcademicStructureInsights({
  records,
  activeOf,
  currentOf,
  referencesOf,
}: {
  readonly records: readonly unknown[];
  readonly activeOf?: ((record: unknown) => boolean) | undefined;
  readonly currentOf?: ((record: unknown) => boolean) | undefined;
  readonly referencesOf?: ((record: unknown) => number) | undefined;
}): ReactNode {
  const { t } = useI18n();
  const active = activeOf ? records.filter(activeOf).length : null;
  const inactive = activeOf ? records.length - (active ?? 0) : null;
  const current = currentOf ? records.filter(currentOf).length : null;
  const referenced = referencesOf ? records.filter((record) => referencesOf(record) > 0).length : 0;
  const deletable = referencesOf ? records.length - referenced : 0;
  const cards = [
    { label: t('catalogue.metric.total'), value: records.length },
    ...(active !== null ? [{ label: t('catalogue.metric.active'), value: active }] : []),
    ...(inactive !== null ? [{ label: t('catalogue.metric.inactive'), value: inactive }] : []),
    ...(current !== null ? [{ label: t('catalogue.metric.current'), value: current }] : []),
    { label: t('catalogue.metric.referenced'), value: referenced },
    { label: t('catalogue.metric.deletable'), value: deletable },
  ];

  return (
    <Card elevation="flat">
      <CardContent className="grid gap-2 py-4 sm:grid-cols-2 lg:grid-cols-5">
        {cards.map((card) => (
          <div key={card.label} className="rounded-xl border border-border bg-surface-raised px-3 py-2">
            <p className="text-2xs text-text-muted">{card.label}</p>
            <p className="text-xl font-bold text-text">{card.value}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
