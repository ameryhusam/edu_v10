/**
 * Light or dark, and who decides.
 *
 * Dark is the default, because dark is the product's identity — inherited from
 * the previous system, EduInsight «Nebula», and kept when its look was cloned
 * into this one. An explicit choice overrides the default and persists.
 * Applied as `data-theme` on the document element, which is what the token
 * file keys off — so switching repaints without re-rendering a single
 * component. The OS preference is deliberately NOT followed: a product whose
 * identity is dark does not become light because the OS is.
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
import { storage } from '../platform/storage';

export type Theme = 'light' | 'dark';

interface ThemeValue {
  readonly theme: Theme;
  readonly toggle: () => void;
  readonly setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeValue | null>(null);
const STORAGE_KEY = 'edu7.theme';

function initialTheme(): Theme {
  const stored = storage.get(STORAGE_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  return 'dark';
}

export function ThemeProvider({ children }: { children: ReactNode }): ReactNode {
  const [theme, setThemeState] = useState<Theme>(initialTheme);

  useEffect(() => {
    document.documentElement.dataset['theme'] = theme;
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    storage.set(STORAGE_KEY, next);
  }, []);

  const value = useMemo<ThemeValue>(
    () => ({
      theme,
      setTheme,
      toggle: () => setTheme(theme === 'dark' ? 'light' : 'dark'),
    }),
    [theme, setTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used inside ThemeProvider.');
  }
  return context;
}
