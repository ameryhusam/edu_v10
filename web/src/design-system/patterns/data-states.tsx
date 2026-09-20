/**
 * The five states every data-bound view must handle (§10).
 *
 * They are components rather than a convention because a convention gets
 * skipped. The one that matters most is `ForbiddenState`: the backend refuses
 * things for good pedagogical and safety reasons, and a refusal rendered as a
 * generic crash turns a meaningful answer into a bug report.
 *
 * `EmptyState` distinguishes *nothing yet* from *nothing matched* — different
 * sentences, different actions. Collapsing them tells a learner with no
 * assignments the same thing it tells a teacher whose filter is too narrow.
 */

import { AlertTriangle, Inbox, Lock, RefreshCw, SearchX, WifiOff } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '../ui/button';
import { cn } from '../ui/cn';
import { useI18n } from '../../shared/i18n/i18n';
import { ApiError } from '../../shared/api/errors';
import { describeApiError } from '../../shared/api/error-messages';

function Frame({
  icon,
  title,
  body,
  action,
  tone = 'neutral',
  className,
}: {
  icon: ReactNode;
  title: string;
  body?: string | null;
  action?: ReactNode;
  tone?: 'neutral' | 'danger' | 'warning';
  className?: string;
}): ReactNode {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border px-6 py-10 text-center',
        className,
      )}
    >
      <div
        className={cn(
          'flex size-12 items-center justify-center rounded-full [&_svg]:size-6',
          tone === 'danger' && 'bg-danger-subtle text-danger',
          tone === 'warning' && 'bg-warning-subtle text-warning',
          tone === 'neutral' && 'bg-surface-sunken text-text-subtle',
        )}
      >
        {icon}
      </div>
      <div className="flex flex-col gap-1">
        <p className="font-medium text-text">{title}</p>
        {body ? <p className="max-w-prose text-sm text-text-muted">{body}</p> : null}
      </div>
      {action}
    </div>
  );
}

/**
 * Loading.
 *
 * The live region is why this exists rather than a bare spinner: a sighted
 * user sees motion, and a screen-reader user hears nothing at all unless the
 * change is announced.
 */
export function LoadingState({
  label,
  className,
}: {
  label?: string;
  className?: string;
}): ReactNode {
  const { t } = useI18n();
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn('flex items-center justify-center gap-3 px-6 py-10 text-text-muted', className)}
    >
      <RefreshCw className="size-5 animate-spin" aria-hidden="true" />
      <span className="text-sm">{label ?? t('state.loading')}</span>
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action,
  variant = 'empty',
  className,
}: {
  title?: string;
  body?: string;
  action?: ReactNode;
  /** `filtered` when a filter excluded everything — a different problem. */
  variant?: 'empty' | 'filtered';
  className?: string;
}): ReactNode {
  const { t } = useI18n();
  const isFiltered = variant === 'filtered';

  return (
    <Frame
      icon={isFiltered ? <SearchX /> : <Inbox />}
      title={title ?? t(isFiltered ? 'state.empty.filtered' : 'state.empty.title')}
      body={body ?? (isFiltered ? t('state.empty.filteredHint') : null)}
      {...(action !== undefined ? { action } : {})}
      {...(className !== undefined ? { className } : {})}
    />
  );
}

export function ForbiddenState({
  title,
  body,
  className,
}: {
  title?: string;
  body?: string;
  className?: string;
}): ReactNode {
  const { t } = useI18n();
  return (
    <Frame
      icon={<Lock />}
      tone="warning"
      title={title ?? t('state.forbidden.title')}
      body={body ?? t('state.forbidden.body')}
      {...(className !== undefined ? { className } : {})}
    />
  );
}

export function OfflineState({ onRetry, className }: { onRetry?: () => void; className?: string }): ReactNode {
  const { t } = useI18n();
  return (
    <Frame
      icon={<WifiOff />}
      tone="warning"
      title={t('state.offline.title')}
      body={t('state.offline.body')}
      {...(className !== undefined ? { className } : {})}
      {...(onRetry
        ? {
            action: (
              <Button variant="secondary" size="sm" onClick={onRetry}>
                <RefreshCw aria-hidden="true" />
                {t('state.error.retry')}
              </Button>
            ),
          }
        : {})}
    />
  );
}

/**
 * An error, routed by kind.
 *
 * This is the component that keeps refusals meaningful. An `ApiError` carrying
 * FORBIDDEN renders as a forbidden state, offline renders as offline, and only
 * a genuine failure renders as an error. The backend's own message is never
 * shown; its stable code is translated, and an unmapped code falls back to a
 * generic sentence plus the code and request id so a report can be traced.
 */
export function ErrorState({
  error,
  onRetry,
  className,
}: {
  error: unknown;
  onRetry?: () => void;
  className?: string;
}): ReactNode {
  const { t, locale } = useI18n();

  if (error instanceof ApiError) {
    if (error.kind === 'OFFLINE') {
      return (
        <OfflineState
          {...(onRetry !== undefined ? { onRetry } : {})}
          {...(className !== undefined ? { className } : {})}
        />
      );
    }
    if (error.kind === 'FORBIDDEN' || error.kind === 'UNAUTHENTICATED') {
      const described = describeApiError(error, locale, t);
      return (
        <ForbiddenState
          title={described.title}
          {...(className !== undefined ? { className } : {})}
        />
      );
    }

    const described = describeApiError(error, locale, t);
    return (
      <Frame
        icon={<AlertTriangle />}
        tone="danger"
        title={described.title}
        body={described.requestId ? t('state.requestId', { id: described.requestId }) : null}
        {...(className !== undefined ? { className } : {})}
        {...(onRetry
          ? {
              action: (
                <Button variant="secondary" size="sm" onClick={onRetry}>
                  <RefreshCw aria-hidden="true" />
                  {t('state.error.retry')}
                </Button>
              ),
            }
          : {})}
      />
    );
  }

  return (
    <Frame
      icon={<AlertTriangle />}
      tone="danger"
      title={t('state.error.title')}
      {...(className !== undefined ? { className } : {})}
      {...(onRetry
        ? {
            action: (
              <Button variant="secondary" size="sm" onClick={onRetry}>
                <RefreshCw aria-hidden="true" />
                {t('state.error.retry')}
              </Button>
            ),
          }
        : {})}
    />
  );
}

/**
 * Render a value that may legitimately be absent.
 *
 * The rule this enforces is §10's and §30's: **null is not zero**. A concept
 * with no evidence has no mastery — showing "0%" tells a parent their child
 * failed, when the truth is nobody has measured yet. Every optional numeric
 * display goes through here.
 */
export function AbsentValue({
  reason = 'notMeasured',
}: {
  reason?: 'notMeasured' | 'unavailable' | 'noData';
}): ReactNode {
  const { t } = useI18n();
  const key =
    reason === 'unavailable'
      ? 'value.unavailable'
      : reason === 'noData'
        ? 'value.noData'
        : 'value.notMeasured';

  return <span className="text-sm text-text-subtle italic">{t(key)}</span>;
}
