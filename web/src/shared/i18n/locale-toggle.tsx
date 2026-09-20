/**
 * Locale toggle.
 *
 * Shows the language you would switch *to*, not the one you are in — the
 * button is an action, and a user who cannot read the current interface needs
 * to recognise the target. Each label is written in its own script for the
 * same reason: "English" is recognisable to someone who reads no Arabic.
 */

import { Languages } from 'lucide-react';
import type { ReactNode } from 'react';
import { useI18n } from './i18n';
import { Button } from '../../design-system/ui/button';

export function LocaleToggle(): ReactNode {
  const { locale, setLocale, t } = useI18n();
  const next = locale === 'ar' ? 'en' : 'ar';

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => setLocale(next)}
      aria-label={t('locale.toggle')}
      className="gap-1.5"
    >
      <Languages className="size-4" aria-hidden="true" />
      {/* Deliberately not translated: each name appears in its own language. */}
      <span>{next === 'en' ? 'English' : 'العربية'}</span>
    </Button>
  );
}
