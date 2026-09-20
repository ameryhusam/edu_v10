/**
 * The authentication screen — sign in and registration on one page.
 *
 * One screen rather than two routes, because the two are a single decision
 * ("do I have an account?") and a user who guesses wrong should not have to
 * navigate. The tab is a real tablist, so the choice is announced rather than
 * inferred from which fields appeared.
 *
 * Layout: the brand panel is the decorative half and is `aria-hidden`, so
 * assistive technology goes straight to the form. On a phone the panel is not
 * rendered at all — it would push the form below the fold, and the form is the
 * reason the page exists.
 *
 * One screen serves every role. The role comes from the server session; a role
 * picker on a login form is an authentication decision made by the client,
 * which is not an authentication decision at all.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogIn, UserPlus } from 'lucide-react';
import { AuthShowcase } from '../features/auth/auth-showcase';
import { SignInForm } from '../features/auth/sign-in-form';
import { RegisterForm } from '../features/auth/register-form';
import { Logo } from '../design-system/brand/logo';
import { Aurora } from '../design-system/layout/aurora';
import { ThemeToggle } from '../shared/theme/theme-toggle';
import { LocaleToggle } from '../shared/i18n/locale-toggle';
import { useI18n } from '../shared/i18n/i18n';
import { useSession } from '../shared/auth/session';
import { cn } from '../design-system/ui/cn';

type AuthMode = 'signIn' | 'register';

export function SignInPage(): ReactNode {
  const { t } = useI18n();
  const { status } = useSession();
  const navigate = useNavigate();
  const [mode, setMode] = useState<AuthMode>('signIn');

  // A session restored in another tab, or an already-signed-in user landing
  // here directly, should not be shown a login form.
  useEffect(() => {
    if (status === 'authenticated') navigate('/', { replace: true });
  }, [status, navigate]);

  const goHome = (): void => {
    navigate('/', { replace: true });
  };

  return (
    <div className="min-h-dvh bg-canvas text-text">
      {/* The shell renders its own aurora; this page stands outside it, so it
          carries the same backdrop — the login is the front door of the same
          product, not a different building. */}
      <Aurora />
      <div className="mx-auto flex min-h-dvh max-w-6xl flex-col p-4 sm:p-6 lg:p-8">
        <header className="flex items-center justify-between gap-4">
          <Logo name={t('app.name')} tagline={t('app.tagline')} />
          <div className="flex items-center gap-1.5">
            <LocaleToggle />
            <ThemeToggle />
          </div>
        </header>

        <main className="flex flex-1 items-center py-8">
          <div className="grid w-full gap-8 lg:grid-cols-2 lg:gap-12">
            <AuthShowcase />

            <section className="mx-auto w-full max-w-md lg:mx-0 lg:max-w-none lg:self-center">
              <div className="rounded-3xl border border-border bg-surface p-6 shadow-lg sm:p-8">
                {/* Segmented control. The sliding indicator is a transform on a
                    single element rather than an animated width, so it does not
                    trigger layout on every frame. */}
                <div
                  role="tablist"
                  aria-label={t('auth.signIn')}
                  className="relative mb-6 grid grid-cols-2 gap-1 rounded-2xl bg-surface-sunken p-1"
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'pointer-events-none absolute inset-y-1 start-1 w-[calc(50%-0.25rem)] rounded-xl bg-surface shadow-sm',
                      'transition-transform duration-normal ease-out-soft',
                      // Logical translate: in RTL the indicator must travel the
                      // other way, and `rtl:` keeps that in one place.
                      mode === 'register' ? 'translate-x-full rtl:-translate-x-full' : undefined,
                    )}
                  />
                  <TabButton
                    isActive={mode === 'signIn'}
                    onClick={() => setMode('signIn')}
                    icon={<LogIn className="size-3.5" aria-hidden="true" />}
                    label={t('auth.tabSignIn')}
                  />
                  <TabButton
                    isActive={mode === 'register'}
                    onClick={() => setMode('register')}
                    icon={<UserPlus className="size-3.5" aria-hidden="true" />}
                    label={t('auth.tabRegister')}
                  />
                </div>

                <div className="mb-6 space-y-1">
                  <h1 className="text-xl font-extrabold sm:text-2xl">
                    {mode === 'signIn' ? t('auth.welcomeBack') : t('auth.registerTitle')}
                  </h1>
                  <p className="text-xs leading-relaxed text-text-muted sm:text-sm">
                    {mode === 'signIn' ? t('auth.signInPrompt') : t('auth.registerPrompt')}
                  </p>
                </div>

                {mode === 'signIn' ? (
                  <SignInForm onSignedIn={goHome} />
                ) : (
                  <RegisterForm onRegistered={goHome} />
                )}

                <p className="mt-6 text-center text-2xs text-text-muted">
                  {mode === 'signIn' ? t('auth.noAccount') : t('auth.haveAccount')}{' '}
                  <button
                    type="button"
                    onClick={() => setMode(mode === 'signIn' ? 'register' : 'signIn')}
                    className="rounded font-bold text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    {mode === 'signIn' ? t('auth.tabRegister') : t('auth.tabSignIn')}
                  </button>
                </p>
              </div>
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}

function TabButton({
  isActive,
  onClick,
  icon,
  label,
}: {
  readonly isActive: boolean;
  readonly onClick: () => void;
  readonly icon: ReactNode;
  readonly label: string;
}): ReactNode {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={isActive}
      onClick={onClick}
      className={cn(
        'relative z-raised flex min-h-10 items-center justify-center gap-1.5 rounded-xl text-xs font-bold',
        'transition-colors duration-fast',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        isActive ? 'text-text' : 'text-text-muted hover:text-text',
      )}
    >
      {icon}
      {label}
    </button>
  );
}
