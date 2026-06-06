import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/lib/queryClient';
import { ensureToken } from '@/lib/auth';
import { WorkspaceProvider } from '@/contexts/WorkspaceContext';
import { AppShell } from '@/components/layout/AppShell';
import { useTheme } from '@/hooks/useTheme';
import { HomePage } from '@/pages/Home';
import { SettingsPage } from '@/pages/Settings';
import { InboxPage } from '@/pages/Inbox';
import { SourcesPage } from '@/pages/Sources';
import { WikiPage } from '@/pages/Wiki';

function App() {
  const { theme, accent, setTheme, setAccent, toggleTheme } = useTheme();
  const [authed, setAuthed] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    ensureToken()
      .then(() => { if (!cancelled) setAuthed(true); })
      .catch((e) => { if (!cancelled) setAuthError(String(e)); });
    return () => { cancelled = true; };
  }, []);

  if (authError) {
    return <pre style={{ padding: 24, color: 'crimson' }}>Auth failed:\n{authError}</pre>;
  }
  if (!authed) {
    return <div style={{ padding: 24, color: 'var(--fg-muted)' }}>Signing in…</div>;
  }

  return (
    <QueryClientProvider client={queryClient}>
      <WorkspaceProvider>
        <BrowserRouter>
          <AppShell theme={theme} onToggleTheme={toggleTheme}>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route
                path="/settings"
                element={
                  <SettingsPage
                    theme={theme}
                    setTheme={setTheme}
                    accent={accent}
                    setAccent={setAccent}
                  />
                }
              />
              <Route path="/inbox" element={<InboxPage />} />
              <Route path="/sources" element={<SourcesPage />} />
              <Route path="/sources/:id" element={<SourcesPage />} />
              <Route path="/wiki" element={<WikiPage />} />
              <Route path="/wiki/:topic" element={<WikiPage />} />
              <Route path="/chats/*" element={<StubPage title="Chats" />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </AppShell>
        </BrowserRouter>
      </WorkspaceProvider>
    </QueryClientProvider>
  );
}

function StubPage({ title }: { title: string }) {
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100%', flexDirection: 'column', gap: 12,
        color: 'var(--fg-muted)',
      }}
    >
      <span style={{ fontSize: 32, fontWeight: 700, color: 'var(--fg)', fontFamily: 'var(--display-font)' }}>{title}</span>
      <span style={{ fontSize: 14, fontFamily: 'var(--mono-font)' }}>coming soon</span>
    </div>
  );
}

export default App;
