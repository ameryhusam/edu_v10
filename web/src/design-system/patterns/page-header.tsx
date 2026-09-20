/**
 * PageHeader — one shape for every screen's opening.
 *
 * Cloned from the previous system's `DashboardHeader`: a rounded panel with a
 * small emerald-dot badge, the page's title, a one-line explanation, and the
 * actions docked to the far end. Centralising it is not cosmetic — it is what
 * keeps every screen recognisably the same product rather than a dozen
 * interpretations of "a title with some buttons".
 *
 * The badge is optional and plain text; callers pass an already-translated
 * string, so the header holds no vocabulary of its own.
 */

import type { ReactNode } from 'react';
import { cn } from '../ui/cn';

export function PageHeader({
  title,
  subtitle,
  actions,
  badge,
}: {
  readonly title: string;
  readonly subtitle?: string | undefined;
  readonly actions?: ReactNode;
  readonly badge?: string | undefined;
}): ReactNode {
  return (
    <header className="rounded-2xl border border-border bg-surface p-6 shadow-xl">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
        <div className="min-w-0">
          {badge ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-subtle px-2.5 py-1 text-2xs font-bold text-accent ring-1 ring-accent-border">
              {/* A dot, not colour alone: the badge reads as a status chip
                  even where the tint is invisible. */}
              <span className="size-1.5 rounded-full bg-accent" aria-hidden="true" />
              {badge}
            </span>
          ) : null}
          <h1 className={cn('text-2xl font-extrabold text-text sm:text-3xl', badge && 'mt-2')}>
            {title}
          </h1>
          {subtitle ? (
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-text-muted">{subtitle}</p>
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}
