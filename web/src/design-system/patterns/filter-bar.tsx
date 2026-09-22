import type { ReactNode } from 'react';
import { cn } from '../ui/cn';

export interface FilterBarProps {
  readonly children: ReactNode;
  readonly actions?: ReactNode;
  readonly className?: string;
}

/** Shared responsive shell for server-backed filters; it owns layout, not filter semantics. */
export function FilterBar({ children, actions, className }: FilterBarProps): ReactNode {
  return (
    <div className={cn('flex flex-col gap-3 rounded-xl border border-border bg-surface p-3 sm:flex-row sm:flex-wrap sm:items-end', className)}>
      <div className="flex min-w-0 flex-1 flex-wrap items-end gap-3">{children}</div>
      {actions ? <div className="flex shrink-0 items-end gap-2">{actions}</div> : null}
    </div>
  );
}
