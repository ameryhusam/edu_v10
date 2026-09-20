/**
 * A route that exists but has no screen yet.
 *
 * It says so, plainly. The alternative — a dashboard of invented numbers —
 * looks finished, gets accepted, and is then discovered to be fiction after
 * someone has planned around it. §53 forbids shipping fake data; this is what
 * honest absence looks like.
 */

import type { ReactNode } from 'react';
import { Construction } from 'lucide-react';
import { Card, CardContent } from '../design-system/ui/card';

export default function Placeholder({ area }: { area: string }): ReactNode {
  return (
    <Card className="mx-auto max-w-xl">
      <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-surface-sunken text-text-subtle">
          <Construction className="size-6" aria-hidden="true" />
        </div>
        <p className="font-medium text-text">Phase 2</p>
        <p className="text-sm text-text-muted">
          The <code className="rounded bg-surface-sunken px-1.5 py-0.5 text-xs">{area}</code>{' '}
          screens are not built yet. Phase 1 delivered the shell, tokens, API client, session and
          state primitives they will be built from.
        </p>
      </CardContent>
    </Card>
  );
}
