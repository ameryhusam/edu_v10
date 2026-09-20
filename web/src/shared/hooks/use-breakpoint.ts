/**
 * Is the viewport compact?
 *
 * Used sparingly. §7.4 is explicit that CSS should handle layout, and a JS
 * breakpoint is only justified when the component *tree* genuinely differs —
 * a sidebar versus a bottom bar, a dialog versus a sheet. Using this to choose
 * a padding value would be a mistake.
 *
 * The primary split is `< lg` compact / `>= lg` expanded, matching the
 * breakpoint tokens.
 */

import { useEffect, useState } from 'react';

const EXPANDED_QUERY = '(min-width: 64rem)';

function matches(query: string): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    // jsdom and SSR. Compact is the safer default: it is the layout that works
    // at every size, so a wrong guess degrades rather than breaks.
    return false;
  }
  return window.matchMedia(query).matches;
}

export function useIsExpanded(): boolean {
  const [expanded, setExpanded] = useState(() => matches(EXPANDED_QUERY));

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;

    const list = window.matchMedia(EXPANDED_QUERY);
    const onChange = (event: MediaQueryListEvent): void => setExpanded(event.matches);

    // Re-read on mount: the viewport may have changed between the initial
    // state and the effect running.
    setExpanded(list.matches);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, []);

  return expanded;
}
