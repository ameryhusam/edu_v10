/**
 * Theme toggle.
 *
 * Extracted from the user menu because it is also needed on the sign-in
 * screen, before any menu exists. Someone who needs a light screen needs it at
 * the login, not after.
 */

import { Moon, Sun } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTheme } from './theme';
import { useI18n } from '../i18n/i18n';
import { Button } from '../../design-system/ui/button';

export function ThemeToggle(): ReactNode {
  const { theme, toggle } = useTheme();
  const { t } = useI18n();

  return (
    <Button
      variant="ghost"
      size="iconSm"
      onClick={toggle}
      aria-label={t('theme.toggle')}
      // The label is the accessible name; the pressed state says which way.
      aria-pressed={theme === 'dark'}
      title={theme === 'dark' ? t('theme.light') : t('theme.dark')}
    >
      {theme === 'dark' ? (
        <Sun className="size-4" aria-hidden="true" />
      ) : (
        <Moon className="size-4" aria-hidden="true" />
      )}
    </Button>
  );
}
