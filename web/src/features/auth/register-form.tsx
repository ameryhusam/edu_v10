/**
 * Create an account.
 *
 * The account-type choice is fetched from `GET /auth/self-service-roles`
 * rather than hardcoded. If the server's policy changes, a form with a frozen
 * list starts offering a role that will be refused on submit — the user fills
 * everything in and is told no at the last step.
 *
 * No client-side credential rules beyond field shape. Whether a username is
 * taken, whether a role may be self-assigned, whether this deployment permits
 * registration at all — every one of those is a server decision, and a second
 * opinion here would eventually disagree with the first.
 */

import { useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AtSign, IdCard, Lock, UserRound } from 'lucide-react';
import { Button } from '../../design-system/ui/button';
import { Input } from '../../design-system/ui/input';
import { Field } from '../../design-system/ui/field';
import { PasswordInput } from './password-input';
import { api } from '../../shared/api/client';
import { queryKeys } from '../../shared/api/query-keys';
import { useI18n } from '../../shared/i18n/i18n';
import { useSession } from '../../shared/auth/session';
import { ApiError } from '../../shared/api/errors';
import { describeApiError } from '../../shared/api/error-messages';
import { cn } from '../../design-system/ui/cn';
import type { MessageKey } from '../../shared/i18n/messages';

interface SelfServiceRoles {
  readonly roles: readonly string[];
}

export function RegisterForm({ onRegistered }: { readonly onRegistered: () => void }): ReactNode {
  const { t, locale } = useI18n();
  const { adoptSession } = useSession();

  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const roles = useQuery({
    queryKey: queryKeys.auth.selfServiceRoles(),
    queryFn: () => api.get<SelfServiceRoles>('auth/self-service-roles', { skipAuthRefresh: true }),
    staleTime: Infinity,
  });

  const available = roles.data?.roles ?? [];
  const selectedRole = role ?? available[0] ?? null;

  const register = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.post<{ user: unknown; tokens: { accessToken: string } }>('auth/register', body, {
        skipAuthRefresh: true,
      }),
  });

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    if (!selectedRole) return;

    try {
      const result = await register.mutateAsync({
        fullName: fullName.trim(),
        username: username.trim(),
        password,
        // An empty optional field must be absent, not an empty string — the
        // server validates the format of what it is given.
        ...(email.trim() ? { email: email.trim() } : {}),
        role: selectedRole,
      });

      // Registration signs the user in server-side; adopt that session rather
      // than asking them to type the password they just chose.
      adoptSession(result as never);
      onRegistered();
    } catch (cause) {
      setError(
        cause instanceof ApiError ? describeApiError(cause, locale, t).title : t('error.unknown'),
      );
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <Field label={t('auth.fullName')}>
        {({ id }) => (
          <Input
            id={id}
            name="fullName"
            autoComplete="name"
            required
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            leadingIcon={<IdCard className="size-4" />}
          />
        )}
      </Field>

      <Field label={t('auth.username')} hint={t('auth.usernameHint')}>
        {({ id, describedBy }) => (
          <Input
            id={id}
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            leadingIcon={<UserRound className="size-4" />}
            {...(describedBy !== undefined ? { 'aria-describedby': describedBy } : {})}
          />
        )}
      </Field>

      <Field label={`${t('auth.email')} · ${t('auth.emailOptional')}`}>
        {({ id }) => (
          <Input
            id={id}
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            leadingIcon={<AtSign className="size-4" />}
          />
        )}
      </Field>

      <Field label={t('auth.password')} hint={t('auth.passwordHint')}>
        {({ id, describedBy }) => (
          <PasswordInput
            id={id}
            name="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            leadingIcon={<Lock className="size-4" />}
            {...(describedBy !== undefined ? { 'aria-describedby': describedBy } : {})}
          />
        )}
      </Field>

      {/* Server-driven. A hardcoded list would offer a role the server refuses. */}
      <fieldset className="space-y-1.5">
        <legend className="mb-1.5 text-xs font-medium text-text">{t('auth.accountType')}</legend>
        <div className="grid grid-cols-3 gap-2">
          {available.map((option) => {
            const isSelected = option === selectedRole;
            return (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={isSelected}
                onClick={() => setRole(option)}
                className={cn(
                  'min-h-11 rounded-xl border px-2 py-2 text-xs font-semibold transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                  isSelected
                    ? 'border-accent bg-accent-subtle text-accent'
                    : 'border-border bg-surface text-text-muted hover:border-border-strong',
                )}
              >
                {t(`role.${option}` as MessageKey)}
              </button>
            );
          })}
        </div>
      </fieldset>

      {error ? (
        <p
          role="alert"
          className="rounded-xl border border-danger-border bg-danger-subtle px-3 py-2.5 text-xs font-medium text-danger"
        >
          {error}
        </p>
      ) : null}

      <Button
        type="submit"
        variant="primary"
        size="lg"
        className="w-full"
        disabled={register.isPending || !selectedRole}
      >
        {register.isPending ? t('auth.creating') : t('auth.createAccount')}
      </Button>
    </form>
  );
}
