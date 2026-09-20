/**
 * The compact-viewport navigation drawer.
 *
 * A dialog, not a styled div: it traps focus, closes on Escape, and is
 * announced as a dialog. `<dialog>` gives all three from the platform rather
 * than from a hand-rolled focus trap that will be subtly wrong.
 */

import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button } from '../ui/button';
import { cn } from '../ui/cn';
import { useI18n } from '../../shared/i18n/i18n';
import { NavItem } from './sidebar';
import type { NavDestination } from './navigation';

export function NavigationDrawer({
  destinations,
  open,
  onClose,
}: {
  destinations: readonly NavDestination[];
  open: boolean;
  onClose: () => void;
}): ReactNode {
  const { t } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    // jsdom implements the element but not the modal methods.
    if (!dialog || typeof dialog.showModal !== 'function') return;

    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-label={t('nav.primary')}
      onClose={onClose}
      // Clicking the backdrop closes. The check compares against the dialog
      // itself because the backdrop is not a separate element.
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      className={cn(
        'm-0 h-dvh max-h-dvh w-72 max-w-[85vw] border-0 bg-surface p-0 text-text',
        // Anchored to the inline start so it slides in from the side the
        // reader's eye starts on, in either direction.
        'me-auto ms-0',
        'backdrop:bg-black/40',
      )}
    >
      <div className="flex h-16 items-center justify-between px-5">
        <span className="font-display text-xl font-bold text-accent">{t('app.name')}</span>
        <Button variant="ghost" size="iconSm" onClick={onClose} aria-label={t('nav.closeMenu')}>
          <X aria-hidden="true" />
        </Button>
      </div>

      <nav className="px-3 py-2">
        <ul className="flex flex-col gap-1">
          {destinations.map((destination) => (
            <li key={destination.to}>
              <NavItem destination={destination} />
            </li>
          ))}
        </ul>
      </nav>
    </dialog>
  );
}
