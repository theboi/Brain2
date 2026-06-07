import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/lib/queryClient';
import { WorkspaceProvider } from '@/contexts/WorkspaceContext';
import { AppShell } from '@/components/layout/AppShell';
import { useTheme } from '@/hooks/useTheme';
import { RequireAuth } from '@/components/auth/RequireAuth';
import { LoginPage } from '@/pages/Login';
import { ForcePasswordChange } from '@/pages/Account/ForcePasswordChange';
import { HomePage } from '@/pages/Home';
import { SettingsPage } from '@/pages/Settings';
import { InboxPage } from '@/pages/Inbox';
import { SourcesPage } from '@/pages/Sources';
import { WikiPage } from '@/pages/Wiki';

function App() {
  const { theme, accent, setTheme, setAccent, toggleTheme } = useTheme();

  return (
    <QueryClientProvider client={queryClient}>
      <WorkspaceProvider>
        <BrowserRouter>
          <Routes>
            {/* Public routes */}
            <Route path="/login" element={<LoginPage />} />
            <Route path="/account/change-password" element={<ForcePasswordChange />} />
            {/* Protected routes */}
            <Route path="/*" element={
              <RequireAuth>
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
              </RequireAuth>
            } />
          </Routes>
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
