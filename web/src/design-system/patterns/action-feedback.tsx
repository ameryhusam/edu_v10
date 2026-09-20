/**
 * Telling the user their action worked.
 *
 * The gap this fills: archiving a user changed the list and said nothing. The
 * row simply moved or vanished, and the administrator had to infer success
 * from a layout change — which is indistinguishable from a filter refreshing.
 *
 * Three rules hold this honest.
 *
 * **It reports, it never predicts.** The message is rendered from a mutation
 * that has already resolved. Showing "saved" optimistically and rolling it
 * back is how a UI ends up claiming something the server refused.
 *
 * **It is announced, not just drawn.** `role="status"` with `aria-live` is the
 * only reason a screen-reader user learns that anything happened at all;
 * colour and position tell them nothing.
 *
 * **It does not steal focus.** A toast that grabs focus interrupts a keyboard
 * user mid-task. The message is polite: it waits for a pause in speech.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { cn } from '../ui/cn';

/**
 * How long a success message stays.
 *
 * Long enough to read a short sentence in either script, short enough not to
 * linger over the next action. Errors are not auto-dismissed — see below.
 */
const SUCCESS_DURATION_MS = 4000;

export interface ActionFeedbackProps {
  /** Rendered when present. Clearing it removes the message. */
  readonly message: string | null;
  readonly tone?: 'success' | 'danger';
  readonly onDismiss?: (() => void) | undefined;
}

export function ActionFeedback({
  message,
  tone = 'success',
  onDismiss,
}: ActionFeedbackProps): ReactNode {
  useEffect(() => {
    // Errors stay until something else replaces them: a failure the user did
    // not read is a failure they will repeat.
    if (message === null || tone !== 'success' || !onDismiss) return;
    const id = setTimeout(onDismiss, SUCCESS_DURATION_MS);
    return () => clearTimeout(id);
  }, [message, tone, onDismiss]);

  return (
    // Rendered even when empty so the live region exists before it has
    // content — announcing into a region that was just inserted is unreliable.
    <div role="status" aria-live="polite" className="min-h-0">
      {message === null ? null : (
        <p
          className={cn(
            'flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-xs font-medium',
            'motion-safe:animate-[dialog-enter_var(--duration-normal)_var(--ease-out-soft)]',
            tone === 'success'
              ? 'border-success-border bg-success-subtle text-success'
              : 'border-danger-border bg-danger-subtle text-danger',
          )}
        >
          <CheckCircle2 aria-hidden="true" className="size-4 shrink-0" />
          {message}
        </p>
      )}
    </div>
  );
}

/**
 * Hold a message that clears itself.
 *
 * Kept here rather than in each page so that "how long does a confirmation
 * stay" is one decision. Returns the message and a setter; passing `null`
 * clears it immediately.
 */
export function useActionFeedback(): {
  message: string | null;
  show: (text: string) => void;
  clear: () => void;
} {
  const [message, setMessage] = useState<string | null>(null);
  return {
    message,
    show: setMessage,
    clear: () => setMessage(null),
  };
}
