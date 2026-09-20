/**
 * The button.
 *
 * Knows nothing about learners, mastery or textbooks — FE6 keeps it that way.
 * Every visual value comes from a token, and the focus ring is inherited from
 * the global `:focus-visible` rule rather than restated here, so it cannot be
 * accidentally removed by a variant.
 *
 * Touch targets are at least 44px tall at `md` and above, which is the size
 * §42 requires and the reason the default is not the 32px an admin template
 * would ship.
 *
 * **Three tiers, plus destructive. No more.**
 *
 *   primary    the one action this screen exists for
 *   secondary  important, but not the point of the screen
 *   ghost      light actions — details, more, review
 *   danger     destructive, kept apart so it is never a "tier"
 *
 * A fifth `spotlight` variant used to exist for "the big warm one on an
 * early-learner screen". It had zero usages, and its job — this is the
 * action, make it obvious — is what `primary` at `size="lg"` already means.
 * Every extra variant is another chance for two screens to disagree about
 * what the main action looks like.
 *
 * Hover moves along the surface ladder rather than inventing a tint, so a
 * secondary button hovering and a card hovering behave like the same system.
 */

import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from './cn';

const button = cva(
  [
    'inline-flex items-center justify-center gap-2',
    'font-medium whitespace-nowrap',
    'rounded-lg border',
    'transition-[color,background-color,border-color,box-shadow,transform] duration-(--duration-fast) ease-(--ease-out-soft)',
    // A press should feel like a press. 1px, so it reads as feedback and not
    // as the layout moving.
    'active:translate-y-px motion-reduce:active:translate-y-0',
    'disabled:pointer-events-none disabled:opacity-50',
    // Icons inside a button should never capture the pointer or shrink.
    '[&_svg]:pointer-events-none [&_svg]:shrink-0',
  ],
  {
    variants: {
      variant: {
        // Elevation, not just colour: the primary action is the one thing on
        // the screen that sits above the page.
        primary: [
          'bg-accent text-text-on-accent border-transparent font-semibold',
          'shadow-sm hover:bg-accent-hover hover:shadow-md active:shadow-xs',
        ],
        secondary:
          'bg-surface-raised text-text border-border shadow-xs hover:bg-surface-raised-hover hover:border-border-strong hover:shadow-sm',
        ghost: 'bg-transparent text-text-muted border-transparent hover:bg-surface-hover hover:text-text',
        danger: [
          'bg-danger text-text-on-accent border-transparent font-semibold',
          'shadow-sm hover:brightness-110 hover:shadow-md active:shadow-xs',
        ],
      },
      size: {
        sm: 'h-9 px-3 text-sm [&_svg]:size-4',
        md: 'h-11 px-4 text-base [&_svg]:size-5',
        lg: 'h-13 px-6 text-lg [&_svg]:size-5',
        // Square, for an icon alone. Still 44px at md.
        icon: 'size-11 [&_svg]:size-5',
        iconSm: 'size-9 [&_svg]:size-4',
      },
      block: {
        true: 'w-full',
        false: '',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md', block: false },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof button> {
  readonly children?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, block, type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      // Defaulting to "button" rather than the HTML default of "submit": a
      // button inside a form that submits when nobody asked it to is one of
      // the most common and most confusing UI bugs.
      type={type}
      className={cn(button({ variant, size, block }), className)}
      {...props}
    />
  );
});
