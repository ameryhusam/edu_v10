/**
 * Field — label, control and error message wired together.
 *
 * This exists because the wiring is easy to get subtly wrong by hand, and the
 * failure is invisible in a browser: a label that is not associated, or an
 * error that is displayed but never announced. Both look perfect on screen.
 *
 * The caller passes a render function receiving the ids to attach, so the
 * relationship cannot drift: there is exactly one place the id is generated.
 */

import { useId, type ReactNode } from 'react';
import { cn } from './cn';

export interface FieldRenderArgs {
  readonly id: string;
  readonly describedBy: string | undefined;
  readonly invalid: boolean;
}

export interface FieldProps {
  readonly label: string;
  /** Shown in place of the hint when present, and announced. */
  readonly error?: string | undefined;
  readonly hint?: string | undefined;
  /** Extra control rendered beside the label — a show/hide toggle. */
  readonly labelAction?: ReactNode;
  readonly children: (args: FieldRenderArgs) => ReactNode;
  readonly className?: string;
}

export function Field({
  label,
  error,
  hint,
  labelAction,
  children,
  className,
}: FieldProps): ReactNode {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;

  // Error wins: pointing at both would read the stale hint after the failure.
  const describedBy = error ? errorId : hint ? hintId : undefined;

  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-xs font-medium text-text">
          {label}
        </label>
        {labelAction}
      </div>

      {children({ id, describedBy, invalid: Boolean(error) })}

      {error ? (
        // role="alert" so the failure is announced when it appears, not only
        // when focus happens to land back on the input.
        <p id={errorId} role="alert" className="text-2xs font-medium text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-2xs text-text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
