/**
 * A native `<select>`, styled to match `Input`.
 *
 * Native rather than a custom listbox: eighteen call sites across the app
 * hand-rolled the same `h-11 rounded-lg border …` string on a bare
 * `<select>` before this existed, which is real evidence a shared control was
 * missing, not evidence a fancier one was needed. A native element gets
 * keyboard support, screen-reader semantics and mobile picker UI for free —
 * exactly what those eighteen call sites already had, just duplicated.
 *
 * Shares `Input`'s field surface (`bg-field`) and wide focus ring on purpose:
 * a form with both controls must not let one look like a bare page control
 * and the other look like a coloured button.
 */

import { forwardRef, type ReactNode, type SelectHTMLAttributes } from 'react';
import { cn } from './cn';

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  readonly invalid?: boolean;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { invalid = false, className, children, ...props },
  ref,
) {
  return (
    <select
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        'h-11 w-full rounded-lg border bg-field px-3 text-sm text-text',
        'transition-[color,background-color,border-color,box-shadow] duration-fast',
        'hover:bg-field-hover',
        'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-field-focus-ring focus-visible:border-accent',
        'disabled:cursor-not-allowed disabled:opacity-60',
        invalid
          ? 'border-danger focus-visible:ring-danger/20 focus-visible:border-danger'
          : 'border-field-border hover:border-border-strong',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
});

export function SelectOption({
  value,
  children,
}: {
  readonly value: string;
  readonly children: ReactNode;
}): ReactNode {
  return <option value={value}>{children}</option>;
}
