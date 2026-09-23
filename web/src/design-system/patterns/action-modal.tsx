/**
 * ActionModal — the centred-dialog shell for an authoring action, with a
 * header banded in the colour of the action it starts (EdTech Modal Design).
 *
 * Three actions carry one accent each: writing a question is blue, building
 * an exam is orange, importing the ministerial bank is emerald. The accent
 * lives only on the header band and the matching breadcrumb badge
 * (`ActionBreadcrumb`) — never on body text or a primary button, which stay
 * on the product's ordinary semantic tones so "this button submits" keeps
 * meaning the same thing everywhere.
 *
 * Escape-to-close and a body scroll lock match `content-node-create-modal.tsx`,
 * the app's other centred-dialog shell — this is that shell generalised, not
 * a competing one.
 *
 * The body is composed of `ActionStepCard` sections rather than one dense
 * block: EdTech Modal Design calls for a form to read as a sequence of small
 * decisions (where does this belong → what does it say → how hard is it),
 * not a single undifferentiated sheet of fields.
 */

import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '../ui/cn';
import { Button } from '../ui/button';
import { useI18n } from '../../shared/i18n/i18n';

export type ActionKind = 'question' | 'exam' | 'ministerial' | 'textbook';

const HEADER_BAND: Record<ActionKind, string> = {
  question: 'bg-gradient-to-r from-action-question/25 via-action-question/10 to-transparent',
  exam: 'bg-gradient-to-r from-action-exam/25 via-action-exam/10 to-transparent',
  ministerial: 'bg-gradient-to-r from-action-ministerial/25 via-action-ministerial/10 to-transparent',
  textbook: 'bg-gradient-to-r from-action-textbook/25 via-action-textbook/10 to-transparent',
};

const HEADER_ICON_BOX: Record<ActionKind, string> = {
  question: 'bg-action-question-subtle text-action-question',
  exam: 'bg-action-exam-subtle text-action-exam',
  ministerial: 'bg-action-ministerial-subtle text-action-ministerial',
  textbook: 'bg-action-textbook-subtle text-action-textbook',
};

export interface ActionModalProps {
  readonly kind: ActionKind;
  readonly icon: ReactNode;
  readonly title: string;
  readonly subtitle?: string | undefined;
  readonly onClose: () => void;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
}

export function ActionModal({
  kind,
  icon,
  title,
  subtitle,
  onClose,
  children,
  footer,
}: ActionModalProps): ReactNode {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    const doc = dialog?.ownerDocument;
    if (!dialog || !doc) return;

    const previousActive = doc.activeElement as HTMLElement | null;
    const focusableSelector = [
      'a[href]',
      'button:not([disabled])',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
    ].join(',');

    const focusInitial = (): void => {
      const first = dialog.querySelector<HTMLElement>(focusableSelector);
      first?.focus();
    };

    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusables = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector))
        .filter((element) => element.offsetParent !== null);
      if (focusables.length === 0) return;

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && doc.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && doc.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    doc.addEventListener('keydown', onKey);
    const previousOverflow = doc.body.style.overflow;
    doc.body.style.overflow = 'hidden';
    window.requestAnimationFrame(focusInitial);

    return () => {
      doc.removeEventListener('keydown', onKey);
      doc.body.style.overflow = previousOverflow;
      previousActive?.focus();
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-modal flex items-center justify-center bg-scrim p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-border bg-surface-raised shadow-xl sm:max-h-[90vh]"
      >
        <header className={cn('flex items-start justify-between gap-3 border-b border-border px-5 py-4', HEADER_BAND[kind])}>
          <div className="flex min-w-0 items-start gap-3">
            <span
              aria-hidden="true"
              className={cn('grid size-10 shrink-0 place-items-center rounded-xl [&_svg]:size-5', HEADER_ICON_BOX[kind])}
            >
              {icon}
            </span>
            <div className="min-w-0 space-y-0.5">
              <h2 className="truncate text-base font-extrabold text-text">{title}</h2>
              {subtitle ? <p className="text-xs text-text-muted">{subtitle}</p> : null}
            </div>
          </div>
          <Button variant="ghost" size="iconSm" onClick={onClose} aria-label={t('common.close')}>
            <X aria-hidden="true" />
          </Button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">{children}</div>

        {footer ? <footer className="flex items-center justify-end gap-3 border-t border-border px-5 py-4">{footer}</footer> : null}
      </div>
    </div>
  );
}

/** One visually separated step within an `ActionModal` body. */
export function ActionStepCard({
  step,
  title,
  children,
  className,
}: {
  readonly step?: number;
  readonly title: string;
  readonly children: ReactNode;
  readonly className?: string;
}): ReactNode {
  return (
    <section className={cn('space-y-3 rounded-xl border border-border bg-surface-subtle p-4', className)}>
      <h3 className="flex items-center gap-2 text-xs font-bold text-text-muted">
        {step !== undefined ? (
          <span
            aria-hidden="true"
            className="grid size-5 shrink-0 place-items-center rounded-full bg-accent-subtle text-2xs font-extrabold text-accent"
          >
            {step}
          </span>
        ) : null}
        {title}
      </h3>
      <div className="space-y-3">{children}</div>
    </section>
  );
}
