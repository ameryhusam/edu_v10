/**
 * Which child is the guardian viewing?
 *
 * Remembered across page loads, but only if the remembered child is still in
 * the verified list. A stale key for a child whose link was revoked must not
 * be used: the server would refuse it, and the parent would see an error they
 * cannot act on instead of simply seeing their other child.
 */

import { useCallback, useEffect, useState } from 'react';
import { storage } from '../../shared/platform/storage';

const SELECTED_CHILD_KEY = 'edu7.selectedChild';

export function useSelectedChild(children: readonly { learnerKey: string }[] | undefined) {
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    if (!children || children.length === 0) return;

    const remembered = storage.get(SELECTED_CHILD_KEY);
    const rememberedIsValid =
      remembered !== null && children.some((c) => c.learnerKey === remembered);

    setSelected((current) => {
      if (current !== null && children.some((c) => c.learnerKey === current)) return current;
      return rememberedIsValid ? remembered : (children[0]?.learnerKey ?? null);
    });
  }, [children]);

  const select = useCallback((learnerKey: string) => {
    setSelected(learnerKey);
    storage.set(SELECTED_CHILD_KEY, learnerKey);
  }, []);

  return { selected, select };
}
