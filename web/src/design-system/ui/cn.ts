/**
 * Merge class names, resolving Tailwind conflicts.
 *
 * `clsx` handles conditionals; `tailwind-merge` makes a later class win over an
 * earlier one in the same group, so a caller's `p-6` overrides a variant's
 * `p-4` instead of both landing in the attribute and the outcome depending on
 * stylesheet order.
 */

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
