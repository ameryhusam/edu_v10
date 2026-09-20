/**
 * The aurora backdrop — the one piece of scenery «Nebula» kept everywhere.
 *
 * Decorative by definition: it carries no information, so it is aria-hidden
 * and pointer-transparent. The gradients live in styles.css (`.aurora`) where
 * they can reference the aurora tokens directly and theme themselves — this
 * component exists only so both surfaces that render it (the application
 * shell, the sign-in screen) share one name for it.
 */

import type { ReactNode } from 'react';

export function Aurora(): ReactNode {
  return <div className="aurora" aria-hidden="true" />;
}
