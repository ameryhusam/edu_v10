/**
 * A loading placeholder shaped like the content it replaces.
 *
 * Shaped, not generic: a rectangle the size of the real card keeps the layout
 * from jumping when data lands, which is the actual point. The pulse is a CSS
 * animation, so `prefers-reduced-motion` already neutralises it via the global
 * rule.
 */

import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>): ReactNode {
  return (
    <div
      // Decorative: a screen reader should hear the surrounding live region's
      // "loading", not a list of empty boxes.
      aria-hidden="true"
      className={cn('animate-pulse rounded-md bg-surface-sunken', className)}
      {...props}
    />
  );
}
