/**
 * ConfirmDialog — the one yes/no the admin surface needs, shared.
 *
 * Extracted from the academic-structure screen's delete confirm so every
 * destructive or far-reaching act (delete, archive, unadopt, deactivate)
 * asks the same way: a named thing, an explicit verb, and a click outside
 * that means "no". One implementation, not one modal per resource.
 */

import { useEffect, useRef, type ReactNode } from 'react';
import { Button } from '../ui/button';
import { useI18n } from '../../shared/i18n/i18n';

export interface ConfirmDialogProps {
  readonly title: string;
  readonly body: string;
  /** The explicit verb on the confirming button — "حذف", "أرشفة", … */
  readonly confirmLabel: string;
  readonly pending?: boolean;
  /** Redraw the confirm button as the dangerous act it is. */
  readonly destructive?: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  pending = false,
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps): ReactNode {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onCancel();
    };
    const doc = dialogRef.current?.ownerDocument;
    doc?.addEventListener('keydown', onKey);
    return () => doc?.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-modal flex items-center justify-center bg-scrim p-4"
      onClick={onCancel}
    >
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-sm space-y-4 rounded-xl border border-border bg-surface-raised p-5 shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="space-y-1.5">
          <h2 className="text-base font-semibold text-text">{title}</h2>
          <p className="text-sm leading-relaxed text-text-muted">{body}</p>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onCancel} disabled={pending}>
            {t('common.cancel')}
          </Button>
          <Button variant={destructive ? 'danger' : 'primary'} size="sm" disabled={pending} onClick={onConfirm}>
            {pending ? t('common.working') : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
