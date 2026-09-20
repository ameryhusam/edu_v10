/**
 * EntityDrawer — the detail surface for one record.
 *
 * A drawer, not a modal: admin detail views are read-and-act surfaces that
 * sit beside the table the administrator is triaging, and covering the whole
 * screen for that is how "giant modal" happened in the legacy UI. The shell
 * owns chrome only — title, subtitle, close, and a scrollable body the caller
 * fills with sections.
 */

import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button } from '../ui/button';
import { useI18n } from '../../shared/i18n/i18n';

export interface EntityDrawerProps {
  readonly title: string;
  readonly subtitle?: string | undefined;
  /** Badges rendered beside the title — status, role, current. */
  readonly badges?: ReactNode;
  readonly onClose: () => void;
  readonly children: ReactNode;
}

export function EntityDrawer({
  title,
  subtitle,
  badges,
  onClose,
  children,
}: EntityDrawerProps): ReactNode {
  const { t } = useI18n();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    const doc = panelRef.current?.ownerDocument;
    doc?.addEventListener('keydown', onKey);
    return () => doc?.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-modal flex bg-scrim"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
        className="ms-auto flex h-full w-full max-w-xl flex-col border-inline-start border-border bg-surface shadow-lg"
      >
        <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-lg font-bold text-text">{title}</h2>
              {badges}
            </div>
            {subtitle ? <p className="text-sm text-text-muted">{subtitle}</p> : null}
          </div>
          <Button
            variant="ghost"
            size="iconSm"
            onClick={onClose}
            aria-label={t('common.close')}
          >
            <X aria-hidden="true" />
          </Button>
        </header>

        <div className="flex-1 space-y-6 overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}
