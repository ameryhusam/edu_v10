/**
 * Sign in.
 *
 * No client-side credential rules. The server decides what is wrong with a
 * credential, and a second opinion here would eventually contradict it — and
 * the contradiction always surfaces as "the form said it was fine".
 */

import { useState, type FormEvent, type ReactNode } from 'react';
import { Lock, UserRound } from 'lucide-react';
import { Button } from '../../design-system/ui/button';
import { Input } from '../../design-system/ui/input';
import { Field } from '../../design-system/ui/field';
import { PasswordInput } from './password-input';
import { DemoAccounts } from './demo-accounts';
import { useI18n } from '../../shared/i18n/i18n';
import { useSession } from '../../shared/auth/session';
import { ApiError } from '../../shared/api/errors';
import { describeApiError } from '../../shared/api/error-messages';

export function SignInForm({ onSignedIn }: { readonly onSignedIn: () => void }): ReactNode {
  const { t, locale } = useI18n();
  const { signIn } = useSession();

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signIn(identifier, password);
      onSignedIn();
    } catch (cause) {
      setError(
        cause instanceof ApiError ? describeApiError(cause, locale, t).title : t('error.unknown'),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-5">
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <Field label={t('auth.identifier')}>
          {({ id }) => (
            <Input
              id={id}
              name="identifier"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              required
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
              leadingIcon={<UserRound className="size-4" />}
            />
          )}
        </Field>

        <Field label={t('auth.password')}>
          {({ id }) => (
            <PasswordInput
              id={id}
              name="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              leadingIcon={<Lock className="size-4" />}
            />
          )}
        </Field>

        {error ? (
          <p
            role="alert"
            className="rounded-xl border border-danger-border bg-danger-subtle px-3 py-2.5 text-xs font-medium text-danger"
          >
            {error}
          </p>
        ) : null}

        <Button type="submit" variant="primary" size="lg" className="w-full" disabled={submitting}>
          {submitting ? t('auth.signingIn') : t('auth.signIn')}
        </Button>
      </form>

      <DemoAccounts
        onPick={(account) => {
          setIdentifier(account.login);
          setPassword(account.password);
          setError(null);
        }}
      />
    </div>
  );
}
