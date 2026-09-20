/**
 * Text input.
 *
 * Two things it does that a bare <input> does not:
 *
 * 1. The leading icon is positioned with logical inset, so it sits on the
 *    correct side in Arabic without a second implementation.
 * 2. `invalid` drives the border AND aria-invalid together. Making them
 *    separate props is how an input ends up looking wrong to sighted users but
 *    reporting fine to a screen reader, or the reverse.
 *
 * It does not own its label or its error text. Those belong to the field
 * wrapper, because only the caller knows the id relationships.
 *
 * 3. Its fill is `bg-field`, not `bg-surface` or `bg-surface-raised`: a field
 *    sits at its own step of the surface ladder so it reads as an input
 *    against ANY card it is dropped into, rather than blending into whatever
 *    surface happens to be behind it and relying on the 1px border alone.
 *    Focus gets a wide, low-opacity ring (`field-focus-ring`, 4px) on top of
 *    the product's usual hairline ring, because a form is the one place a
 *    user must have zero doubt which control is receiving their keystrokes.
 */

import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from './cn';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  /** Decorative icon on the leading edge. Never announced. */
  readonly leadingIcon?: ReactNode;
  /** Interactive control on the trailing edge — a show/hide toggle, say. */
  readonly trailingSlot?: ReactNode;
  readonly invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { leadingIcon, trailingSlot, invalid = false, className, ...props },
  ref,
) {
  return (
    <div className="relative flex items-center">
      {leadingIcon ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-inline-start-0 flex items-center ps-3 text-text-subtle"
        >
          {leadingIcon}
        </span>
      ) : null}

      <input
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(
          // 44px minimum: this is a touch target, and most sign-ins are on a phone.
          'min-h-11 w-full rounded-lg border bg-field px-3 py-2 text-sm text-text',
          'placeholder:text-text-subtle',
          'transition-[color,background-color,border-color,box-shadow] duration-fast',
          'hover:bg-field-hover',
          'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-field-focus-ring focus-visible:border-accent',
          'disabled:cursor-not-allowed disabled:opacity-60',
          leadingIcon ? 'ps-10' : undefined,
          trailingSlot ? 'pe-11' : undefined,
          invalid
            ? 'border-danger focus-visible:ring-danger/20 focus-visible:border-danger'
            : 'border-field-border hover:border-border-strong',
          className,
        )}
        {...props}
      />

      {trailingSlot ? (
        <span className="absolute inset-inline-end-0 flex items-center pe-1.5">{trailingSlot}</span>
      ) : null}
    </div>
  );
});
