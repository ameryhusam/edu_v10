/**
 * Identity and preferences in the header.
 *
 * Deliberately small: theme, language, sign out. Everything else belongs on a
 * settings page rather than in a menu that grows until it needs its own
 * scrollbar.
 */

import { LogOut, Languages, Moon, Sun } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '../ui/button';
import { useI18n } from '../../shared/i18n/i18n';
import { useTheme } from '../../shared/theme/theme';
import { useSession } from '../../shared/auth/session';

export function UserMenu(): ReactNode {
  const { t, locale, setLocale } = useI18n();
  const { theme, toggle } = useTheme();
  const { user, signOut } = useSession();

  /**
   * What to call the user.
   *
   * `/auth/me` returns no display name (audit gap G5), so after a reload only
   * the key is known. Showing the key is honest; inventing a name or rendering
   * an empty greeting is not. When login supplied a name, it is used.
   */
  const displayName = user?.fullName ?? user?.username ?? user?.userKey ?? '';

  return (
    <div className="flex items-center gap-1">
      <span className="hidden text-sm text-text-muted md:inline" data-testid="user-display-name">
        {displayName}
      </span>

      <Button
        variant="ghost"
        size="iconSm"
        onClick={() => setLocale(locale === 'ar' ? 'en' : 'ar')}
        aria-label={t('locale.toggle')}
        title={t('locale.toggle')}
      >
        <Languages aria-hidden="true" />
      </Button>

      <Button
        variant="ghost"
        size="iconSm"
        onClick={toggle}
        aria-label={t('theme.toggle')}
        title={t(theme === 'dark' ? 'theme.light' : 'theme.dark')}
      >
        {theme === 'dark' ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
      </Button>

      <Button
        variant="ghost"
        size="iconSm"
        onClick={() => void signOut()}
        aria-label={t('auth.signOut')}
        title={t('auth.signOut')}
      >
        {/* Directional: it should point the way out, which flips in RTL. */}
        <LogOut className="rtl-mirror" aria-hidden="true" />
      </Button>
    </div>
  );
}
