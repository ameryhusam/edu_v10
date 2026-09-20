/**
 * Demo account prefill — development only.
 *
 * Carried over from the previous system with the rule that made it safe:
 * clicking **fills the form and stops**. No signIn, no session, no role
 * selection. The credentials still travel to POST /auth/login and the server
 * still decides.
 *
 * A demo button that logs you in is a client-side impersonation path, and the
 * moment one exists somebody reaches for it during a demo against real data. A
 * button that types the password for you has no authority at all.
 *
 * The module holding the credentials is imported lazily behind a statically
 * false flag, so the bundler drops the whole chunk from a production build.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { FlaskConical } from 'lucide-react';
import { useI18n } from '../../shared/i18n/i18n';
import type { DemoAccount } from './demo-credentials.dev';

const DEMO_ENABLED = import.meta.env.DEV;

export function DemoAccounts({
  onPick,
}: {
  readonly onPick: (account: DemoAccount) => void;
}): ReactNode {
  const { t } = useI18n();
  const [accounts, setAccounts] = useState<readonly DemoAccount[]>([]);
  const [filled, setFilled] = useState<string | null>(null);

  useEffect(() => {
    if (!DEMO_ENABLED) return;
    let cancelled = false;
    void import('./demo-credentials.dev')
      .then((module) => {
        if (!cancelled) setAccounts(module.DEMO_ACCOUNTS);
      })
      .catch(() => {
        // A missing dev convenience must never break the real login form.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!DEMO_ENABLED || accounts.length === 0) return null;

  return (
    <div className="space-y-2.5 rounded-2xl border border-dashed border-border bg-surface-sunken p-4">
      <div className="flex items-center gap-1.5">
        <FlaskConical className="size-3.5 shrink-0 text-warning" aria-hidden="true" />
        <div className="space-y-0.5">
          <p className="text-2xs font-bold uppercase tracking-wider text-warning">
            {t('demo.title')}
          </p>
          <p className="text-2xs text-text-muted">{t('demo.hint')}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {accounts.map((account) => (
          <button
            key={account.login}
            type="button"
            onClick={() => {
              onPick(account);
              setFilled(t(account.roleKey));
            }}
            className="min-h-11 rounded-xl border border-border bg-surface px-2 py-1.5 text-2xs font-semibold text-text-muted transition-colors hover:border-accent-border hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <span className="block">{t(account.labelKey)}</span>
            {/* The username that is actually sent as `identifier`. Showing it
                means a drift between this list and the seed data is visible
                here, rather than surfacing later as an unexplained 401. */}
            <span className="block font-mono text-2xs font-normal opacity-60">
              {account.login}
            </span>
          </button>
        ))}
      </div>

      {/* The fields changed without the user typing; that should not be silent
          for someone who cannot see the form. */}
      <p aria-live="polite" className="min-h-4 text-2xs font-medium text-success">
        {filled ? t('demo.filled', { role: filled }) : ''}
      </p>
    </div>
  );
}
