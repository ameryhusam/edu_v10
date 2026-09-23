/**
 * The button.
 *
 * Shared button primitive. Loading is a component concern and is never
 * forwarded to the native DOM element as an unknown HTML attribute.
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
    'active:translate-y-px motion-reduce:active:translate-y-0',
    'disabled:pointer-events-none disabled:opacity-50',
    '[&_svg]:pointer-events-none [&_svg]:shrink-0',
  ],
  {
    variants: {
      variant: {
        primary: ['bg-accent text-text-on-accent border-transparent font-semibold','shadow-sm hover:bg-accent-hover hover:shadow-md active:shadow-xs'],
        secondary: 'bg-surface-raised text-text border-border shadow-xs hover:bg-surface-raised-hover hover:border-border-strong hover:shadow-sm',
        ghost: 'bg-transparent text-text-muted border-transparent hover:bg-surface-hover hover:text-text',
        danger: ['bg-danger text-text-on-accent border-transparent font-semibold','shadow-sm hover:brightness-110 hover:shadow-md active:shadow-xs'],
      },
      size: {
        sm: 'h-9 px-3 text-sm [&_svg]:size-4',
        md: 'h-11 px-4 text-base [&_svg]:size-5',
        lg: 'h-13 px-6 text-lg [&_svg]:size-5',
        icon: 'size-11 [&_svg]:size-5',
        iconSm: 'size-9 [&_svg]:size-4',
      },
      block: { true: 'w-full', false: '' },
    },
    defaultVariants: { variant: 'secondary', size: 'md', block: false },
  },
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof button> {
  readonly children?: ReactNode;
  readonly loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, block, type = 'button', loading = false, disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(button({ variant, size, block }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    />
  );
});
