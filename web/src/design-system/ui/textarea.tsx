/**
 * A multi-line text input, styled to match `Input` and `Select`.
 *
 * Twelve components hand-rolled the same
 * `rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm`
 * string on a bare `<textarea>` before this existed — a stem, a rubric, a
 * pasted answer key are all long-form text and deserve the same field
 * treatment a one-line `Input` gets, not a visually different control just
 * because it grows.
 */

import { forwardRef, type TextareaHTMLAttributes } from 'react';
import { cn } from './cn';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  readonly invalid?: boolean;
  readonly monospace?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { invalid = false, monospace = false, className, ...props },
  ref,
) {
  return (
    <textarea
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        'w-full rounded-lg border bg-field px-3 py-2 text-sm text-text',
        'placeholder:text-text-subtle',
        'transition-[color,background-color,border-color,box-shadow] duration-fast',
        'hover:bg-field-hover',
        'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-field-focus-ring focus-visible:border-accent',
        'disabled:cursor-not-allowed disabled:opacity-60',
        monospace ? 'font-mono text-xs' : undefined,
        invalid
          ? 'border-danger focus-visible:ring-danger/20 focus-visible:border-danger'
          : 'border-field-border hover:border-border-strong',
        className,
      )}
      {...props}
    />
  );
});
