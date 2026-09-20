/**
 * A surface that groups related content.
 *
 * Composed of parts rather than configured by props: `Card.Header` with a
 * `title` prop would grow a `titleAction`, then a `titleBadge`, and end up as
 * the giant configurable component §45 warns about. Composition stays flat.
 */

import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';

/**
 * Which layer of the surface ladder this card sits on.
 *
 *   flat     a section divider — belongs to the page
 *   default  the ordinary card
 *   raised   a dialog, a popover, or the one learning object that matters
 *
 * Three values, matching the three surface tokens exactly. Elevation is a
 * property of the ladder, not a free-floating shadow size, which is what
 * stops it drifting into "which shadow looked nicer that day".
 */
export type CardElevation = 'flat' | 'default' | 'raised';

const ELEVATION: Record<CardElevation, string> = {
  flat: 'bg-surface border-border',
  default: 'bg-surface border-border shadow-xs',
  raised: 'bg-surface-raised border-border shadow-md',
};

const HOVER: Record<CardElevation, string> = {
  flat: 'hover:bg-surface-hover hover:border-border-strong',
  default: 'hover:bg-surface-hover hover:border-border-strong hover:shadow-sm',
  raised: 'hover:bg-surface-raised-hover hover:shadow-lg',
};

export function Card({
  className,
  interactive = false,
  elevation = 'default',
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  readonly interactive?: boolean;
  readonly elevation?: CardElevation;
}): ReactNode {
  return (
    <div
      className={cn(
        'rounded-xl border',
        ELEVATION[elevation],
        // Hover affordances are additive only: touch devices never see them,
        // so nothing may depend on hover to be discoverable (§12).
        interactive && [
          'transition-[background-color,border-color,box-shadow] duration-(--duration-fast) ease-(--ease-out-soft)',
          HOVER[elevation],
        ],
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>): ReactNode {
  return <div className={cn('flex flex-col gap-1 p-5 pb-3', className)} {...props} />;
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>): ReactNode {
  return <h3 className={cn('text-lg font-semibold text-text', className)} {...props} />;
}

export function CardDescription({
  className,
  ...props
}: HTMLAttributes<HTMLParagraphElement>): ReactNode {
  return <p className={cn('text-sm text-text-muted', className)} {...props} />;
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>): ReactNode {
  return <div className={cn('p-5 pt-0', className)} {...props} />;
}

export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>): ReactNode {
  return (
    <div
      className={cn('flex items-center gap-3 border-t border-border p-5 py-3', className)}
      {...props}
    />
  );
}
