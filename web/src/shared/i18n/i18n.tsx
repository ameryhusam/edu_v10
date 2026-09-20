/**
 * Locale and direction, available to every component.
 *
 * Direction is derived from the locale, never set independently — they cannot
 * disagree, because a component that could read one without the other is a
 * component that will eventually render Arabic left-to-right.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  DIRECTION_BY_LOCALE,
  translate,
  type Direction,
  type Locale,
  type MessageKey,
} from './messages';
import { storage } from '../platform/storage';

interface I18nValue {
  readonly locale: Locale;
  readonly direction: Direction;
  readonly t: (key: MessageKey, values?: Record<string, string | number>) => string;
  readonly setLocale: (locale: Locale) => void;
  /** Locale-aware number, percent and date formatting. */
  readonly formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
  readonly formatDate: (value: Date | string, options?: Intl.DateTimeFormatOptions) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

const STORAGE_KEY = 'edu7.locale';

/** Arabic unless a previous choice says otherwise — `User.locale` defaults to "ar". */
function initialLocale(): Locale {
  const stored = storage.get(STORAGE_KEY);
  return stored === 'en' || stored === 'ar' ? stored : 'ar';
}

export function I18nProvider({ children }: { children: ReactNode }): ReactNode {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);
  const direction = DIRECTION_BY_LOCALE[locale];

  // The document element is the only correct place for lang/dir: CSS logical
  // properties, text selection, form controls and the browser's own UI all
  // read it from there, and none of them look at a React context.
  useEffect(() => {
    const root = document.documentElement;
    root.lang = locale;
    root.dir = direction;
  }, [locale, direction]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    storage.set(STORAGE_KEY, next);
  }, []);

  const value = useMemo<I18nValue>(() => {
    // `ar` alone, not `ar-EG` or similar: the numbering system is a product
    // decision (Western digits, see styles.css) and a region subtag would drag
    // Arabic-Indic digits back in on some platforms.
    const numberLocale = locale === 'ar' ? 'ar' : 'en';

    return {
      locale,
      direction,
      t: (key, values) => translate(locale, key, values),
      setLocale,
      formatNumber: (n, options) =>
        new Intl.NumberFormat(numberLocale, { numberingSystem: 'latn', ...options }).format(n),
      formatDate: (d, options) =>
        new Intl.DateTimeFormat(numberLocale, {
          numberingSystem: 'latn',
          dateStyle: 'medium',
          ...options,
        }).format(typeof d === 'string' ? new Date(d) : d),
    };
  }, [locale, direction, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18n must be used inside I18nProvider.');
  }
  return context;
}
