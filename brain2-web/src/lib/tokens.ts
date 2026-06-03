/*
 * Brain2 Console — Token utilities
 *
 * Applies theme and accent to <html> as data attributes, which the CSS in
 * tokens.css reads to resolve the correct CSS variable values.
 *
 * Theme and accent are persisted in localStorage so the correct variant
 * renders before React hydrates (avoids flash).
 */

export type Theme = 'dark' | 'light';
export type Accent = 'indigo' | 'violet' | 'emerald';

export const ACCENT_LABELS: Record<Accent, string> = {
  indigo: 'Indigo',
  violet: 'Violet',
  emerald: 'Emerald',
};

export const ACCENT_COLORS: Record<Accent, { dark: string; light: string }> = {
  indigo:  { dark: '#7C8CFF', light: '#5466E5' },
  violet:  { dark: '#A78BFA', light: '#7C3AED' },
  emerald: { dark: '#34D399', light: '#0E9F6E' },
};

export function applyTheme(theme: Theme, accent: Accent): void {
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.setAttribute('data-accent', accent);
}

export function readStoredTheme(): Theme {
  try {
    const v = localStorage.getItem('b2-theme');
    if (v === 'light' || v === 'dark') return v;
  } catch { /* ignore */ }
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function readStoredAccent(): Accent {
  try {
    const v = localStorage.getItem('b2-accent');
    if (v === 'indigo' || v === 'violet' || v === 'emerald') return v;
  } catch { /* ignore */ }
  return 'indigo';
}

export function storeTheme(theme: Theme): void {
  try { localStorage.setItem('b2-theme', theme); } catch { /* ignore */ }
  document.documentElement.setAttribute('data-theme', theme);
}

export function storeAccent(accent: Accent): void {
  try { localStorage.setItem('b2-accent', accent); } catch { /* ignore */ }
  document.documentElement.setAttribute('data-accent', accent);
}
