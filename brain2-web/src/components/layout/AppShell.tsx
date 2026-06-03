/*
 * AppShell — full-viewport shell: TopBar + LeftRail + content area + BottomNav.
 * main uses overflow: hidden so each page can manage its own scroll (Settings
 * has two independent scroll columns; Home has one full-page scroll region).
 */
import type { ReactNode } from 'react';
import { TopBar } from './TopBar';
import { LeftRail } from './LeftRail';
import { BottomNav } from './BottomNav';
import type { Theme } from '@/lib/tokens';

interface AppShellProps {
  theme: Theme;
  onToggleTheme: () => void;
  children: ReactNode;
}

export function AppShell({ theme, onToggleTheme, children }: AppShellProps) {
  return (
    <div
      style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg)',
        color: 'var(--fg)',
        fontFamily: 'var(--ui-font)',
        fontSize: 14,
      }}
    >
      <TopBar theme={theme} onToggleTheme={onToggleTheme} />
      <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>
        <LeftRail />
        <main
          style={{
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--bg)',
          }}
        >
          {children}
        </main>
      </div>
      <BottomNav />
    </div>
  );
}
