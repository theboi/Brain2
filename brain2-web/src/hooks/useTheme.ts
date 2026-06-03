import { useState, useCallback } from 'react';
import { readStoredTheme, readStoredAccent, storeTheme, storeAccent, applyTheme } from '@/lib/tokens';
import type { Theme, Accent } from '@/lib/tokens';

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => {
    const t = readStoredTheme();
    applyTheme(t, readStoredAccent());
    return t;
  });
  const [accent, setAccentState] = useState<Accent>(readStoredAccent);

  const setTheme = useCallback((t: Theme) => {
    storeTheme(t);
    setThemeState(t);
  }, []);

  const setAccent = useCallback((a: Accent) => {
    storeAccent(a);
    setAccentState(a);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  }, [theme, setTheme]);

  return { theme, accent, setTheme, setAccent, toggleTheme };
}
