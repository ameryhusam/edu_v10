/**
 * A small status label.
 *
 * Tone names are semantic, matching the token groups. There is no `tone="red"`
 * — a caller choosing a colour has decided what the state means, and the next
 * caller will choose differently for the same state.
 *
 * Colour is never the only carrier of meaning (§42): a badge always has text,
 * and callers pass an icon where the distinction matters at a glance.
 */

import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';

const badge = cva(
  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium [&_svg]:size-3.5',
  {
    variants: {
      tone: {
        neutral: 'bg-surface-sunken text-text-muted border-border',
        accent: 'bg-accent-subtle text-accent border-accent-border',
        success: 'bg-success-subtle text-success border-success-border',
        warning: 'bg-warning-subtle text-warning border-warning-border',
        danger: 'bg-danger-subtle text-danger border-danger-border',
        info: 'bg-info-subtle text-info border-info-border',
        /** Parent-origin work. Used nowhere else, on purpose (§11). */
        advisory: 'bg-advisory-subtle text-advisory border-advisory-border',

        /* Activity tones. Five, for seven server activities — REVIEW, ASSESS
           and PRACTISE share one because all three are consolidation of
           material already met, and the icon and verb separate them. */
        remediate:
          'bg-activity-remediate-subtle text-activity-remediate border-activity-remediate/30',
        unblock: 'bg-activity-unblock-subtle text-activity-unblock border-activity-unblock/30',
        learn: 'bg-activity-learn-subtle text-activity-learn border-activity-learn/30',
        practise:
          'bg-activity-practise-subtle text-activity-practise border-activity-practise/30',
        advance: 'bg-activity-advance-subtle text-activity-advance border-activity-advance/30',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badge> {
  readonly children?: ReactNode;
}

export function Badge({ className, tone, ...props }: BadgeProps): ReactNode {
  return <span className={cn(badge({ tone }), className)} {...props} />;
}
