/**
 * مغامرة اليوم — the three-station mission board.
 *
 * The junior board's centrepiece, cloned from the legacy MissionPath and fed
 * real data: each station describes what the server says is true right now,
 * and the component only chooses icons and words for it. A station never
 * invents work: if there is no next step, the lesson station says so and
 * turns green rather than pointing at something stale.
 *
 * Three stations, never a scroll: a junior reads the whole board at once.
 */

import type { ReactNode } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { Card, CardContent } from '../../design-system/ui/card';
import { Badge } from '../../design-system/ui/badge';
import { Button } from '../../design-system/ui/button';
import { cn } from '../../design-system/ui/cn';
import { useI18n } from '../../shared/i18n/i18n';

export type StationStatus = 'pending' | 'active' | 'completed';

export interface JuniorStation {
  readonly id: string;
  readonly icon: ReactNode;
  readonly title: string;
  readonly subtitle: string;
  readonly status: StationStatus;
  /** Shown only while there is somewhere to go. */
  readonly action?: { readonly label: string; readonly onClick: () => void };
}

const STATION_SKIN: Record<StationStatus, string> = {
  active: 'border-accent-border bg-accent-subtle',
  completed: 'border-success-border bg-success-subtle',
  pending: 'border-border bg-surface',
};

export function MissionPath({ stations }: { readonly stations: readonly JuniorStation[] }): ReactNode {
  const { t } = useI18n();

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-extrabold">{t('junior.adventureTitle')}</h2>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {stations.map((station, index) => (
          <MissionCard key={station.id} station={station} index={index} />
        ))}
      </div>
    </section>
  );
}

function MissionCard({
  station,
  index,
}: {
  readonly station: JuniorStation;
  readonly index: number;
}): ReactNode {
  const { t } = useI18n();

  return (
    <Card className={cn('relative', STATION_SKIN[station.status])}>
      <CardContent className="space-y-3 p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {/* رقم المحطة */}
            <span className="grid size-8 place-items-center rounded-full bg-surface-sunken text-sm font-bold tabular-nums">
              {index + 1}
            </span>
            {station.icon}
          </div>

          {station.status === 'completed' ? (
            <CheckCircle2 className="size-6 text-success" aria-hidden="true" />
          ) : station.status === 'active' ? (
            <Badge tone="accent">{t('junior.goStation')}</Badge>
          ) : null}
        </div>

        <div>
          <h3 className="text-base font-bold">{station.title}</h3>
          <p className="mt-1 text-xs text-text-muted">{station.subtitle}</p>
        </div>

        {station.action && station.status !== 'completed' ? (
          <Button variant="primary" size="sm" block onClick={station.action.onClick}>
            {station.action.label}
          </Button>
        ) : null}

        {station.status === 'completed' ? (
          <p className="text-center text-2xs font-bold text-success">{t('junior.wellDone')}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
