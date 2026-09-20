/**
 * The Edu7 mark.
 *
 * Drawn as inline SVG rather than shipped as an image file, for reasons that
 * are practical rather than aesthetic: it inherits `currentColor` so it works
 * in both themes without a second asset, it stays sharp at any density, and it
 * costs no network request on the one screen that must paint fast.
 *
 * The mark itself: seven ascending nodes on a path, connected. It reads as a
 * learning path — which is literally what this product models — and the seven
 * nodes are the "7". At small sizes the connections blur into an upward sweep,
 * which is the right impression to keep when the detail is gone.
 *
 * Why not a graduation cap or an open book: every education product uses them,
 * they say "school" rather than anything about this system, and a cap is a
 * symbol of *finishing* — the opposite of a mastery platform's premise that
 * learning is continuous.
 *
 * The mark is deliberately NOT mirrored in RTL. A brand is a fixed shape; an
 * Arabic user seeing a flipped logo sees a different logo.
 */

import type { ReactNode } from 'react';
import { cn } from '../ui/cn';

export interface LogoMarkProps {
  readonly className?: string;
  /** Decorative beside a wordmark; labelled when it stands alone. */
  readonly title?: string;
}

export function LogoMark({ className, title }: LogoMarkProps): ReactNode {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      className={cn('size-8', className)}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : 'true'}
      {...(title ? { 'aria-label': title } : {})}
    >
      {/* The path itself: a rising route through the nodes. Drawn first so the
          nodes sit on top of it. */}
      <path
        d="M5 25.5 L11 20 L16 22 L21 13 L27 7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.35"
      />

      {/* Four mastered nodes: filled. */}
      <circle cx="5" cy="25.5" r="2.6" fill="currentColor" />
      <circle cx="11" cy="20" r="2.6" fill="currentColor" />
      <circle cx="16" cy="22" r="2.6" fill="currentColor" />
      <circle cx="21" cy="13" r="2.6" fill="currentColor" />

      {/* The current node: ringed, not filled — the learner is here. This is
          the same visual language the path screen uses for currentConceptKey,
          so the logo and the product agree. */}
      <circle
        cx="27"
        cy="7"
        r="3.4"
        stroke="currentColor"
        strokeWidth="2.2"
        fill="none"
      />
    </svg>
  );
}

export interface LogoProps {
  readonly className?: string;
  /** The descriptive Arabic name beneath the wordmark. */
  readonly showTagline?: boolean;
  readonly name: string;
  readonly tagline?: string;
}

/**
 * Mark plus wordmark.
 *
 * The Latin wordmark stays Latin in both languages — a transliterated brand is
 * a non-word — while the line beneath it is the descriptive name in the
 * reader's language.
 */
export function Logo({ className, name, tagline, showTagline = true }: LogoProps): ReactNode {
  return (
    <span className={cn('flex items-center gap-2.5', className)}>
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent text-text-on-accent shadow-sm">
        <LogoMark className="size-6" />
      </span>
      <span className="leading-tight">
        <span className="block text-base font-extrabold tracking-tight">{name}</span>
        {showTagline && tagline ? (
          <span className="block text-2xs text-text-muted">{tagline}</span>
        ) : null}
      </span>
    </span>
  );
}
