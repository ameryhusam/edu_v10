/**
 * MetricGrid + MetricCard — the previous system's dashboard stat cards, cloned.
 *
 * «Nebula» opened every role dashboard the same way: a row of four cards, each
 * one number, an icon in a tinted box, and a small explanatory line. The look
 * was worth keeping; the implementation is rebuilt on this system's rules:
 *
 *   - colours come from semantic tone tokens, never palette names, so the
 *     card themes itself and FE2 stays enforceable;
 *   - the VALUE is passed in already formatted — the card never computes,
 *     rounds or concatenates a number (FE8), because a stat card that does
 *     arithmetic is a stat card that can lie;
 *   - the hover lift is a transform, never a layout property, so hovering
 *     four cards does not reflow the page under them.
 */

import type { ReactNode } from 'react';
import { cn } from '../ui/cn';

export type MetricTone = 'accent' | 'success' | 'warning' | 'info' | 'danger' | 'advisory';

/**
 * Full class strings, looked up — never concatenated. Tailwind compiles the
 * classes it can see in source, so `bg-${tone}-subtle` would silently produce
 * an unstyled box; this table is the only way the tones stay real.
 */
const TONE_BOX: Record<MetricTone, string> = {
  accent: 'bg-accent-subtle text-accent ring-accent-border',
  success: 'bg-success-subtle text-success ring-success-border',
  warning: 'bg-warning-subtle text-warning ring-warning-border',
  info: 'bg-info-subtle text-info ring-info-border',
  danger: 'bg-danger-subtle text-danger ring-danger-border',
  advisory: 'bg-advisory-subtle text-advisory ring-advisory-border',
};

export function MetricGrid({ children }: { readonly children: ReactNode }): ReactNode {
  return <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">{children}</div>;
}

export function MetricCard({
  title,
  value,
  subtitle,
  icon,
  tone = 'accent',
  onClick,
  ariaLabel,
}: {
  /** Already translated by the caller — the card holds no strings of its own. */
  readonly title: string;
  /** Already formatted by the caller — a number, a percent, or an absent marker. */
  readonly value: ReactNode;
  readonly subtitle?: string | undefined;
  readonly icon?: ReactNode;
  readonly tone?: MetricTone;
  /** Optional action: a metric may be a doorway, but never computes its value. */
  readonly onClick?: (() => void) | undefined;
  readonly ariaLabel?: string | undefined;
}): ReactNode {
  const className = cn(
    'flex w-full items-start justify-between gap-3 rounded-xl border border-border bg-surface p-5 text-start shadow-lg',
    'transition-[translate,border-color,box-shadow] duration-fast ease-out-soft',
    // The «Nebula» lift: hover raises the card a hair and sharpens its
    // hairline. A transform, so nothing around it moves.
    'hover:-translate-y-0.5 hover:border-border-strong hover:shadow-xl',
    onClick && 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
  );
  const content = (
    <>
      <div className="min-w-0">
        <span className="text-2xs font-medium tracking-wider text-text-subtle sm:font-semibold">{title}</span>
        <div className="mt-1 truncate text-xl font-bold tracking-tight text-text sm:text-3xl sm:font-extrabold">
          {value}
        </div>
        {subtitle ? <div className="mt-2 text-xs leading-relaxed text-text-muted">{subtitle}</div> : null}
      </div>
      {icon ? (
        <div className={cn('shrink-0 rounded-xl p-3 ring-1', TONE_BOX[tone])} aria-hidden="true">
          {icon}
        </div>
      ) : null}
    </>
  );

  if (onClick) {
    return (
      <button type="button" className={className} onClick={onClick} aria-label={ariaLabel ?? title}>
        {content}
      </button>
    );
  }

  return <div className={className}>{content}</div>;
}
