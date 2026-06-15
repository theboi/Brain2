import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/lib/queryClient';
import { WorkspaceProvider } from '@/contexts/WorkspaceContext';
import { AppShell } from '@/components/layout/AppShell';
import { useTheme } from '@/hooks/useTheme';
import { RequireAuth } from '@/components/auth/RequireAuth';
import { LoginPage } from '@/pages/Login';
import { ForcePasswordChange } from '@/pages/Account/ForcePasswordChange';
import { AcceptInvite } from '@/pages/Account/AcceptInvite';
import { HomePage } from '@/pages/Home';
import { SettingsPage } from '@/pages/Settings';
import { InboxPage } from '@/pages/Inbox';
import { SourcesPage } from '@/pages/Sources';
import { WikiPage } from '@/pages/Wiki';
import { GraphPage } from '@/pages/Graph';
import { ReportsPage } from '@/pages/Reports';
import { AgentsPage } from '@/pages/Agents';

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
            <Route path="/account/accept-invite" element={<AcceptInvite />} />
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
                    <Route path="/graph" element={<GraphPage />} />
                    <Route path="/agents" element={<AgentsPage />} />
                    <Route path="/chats/*" element={<Navigate to="/agents" replace />} />
                    <Route path="/reports" element={<ReportsPage />} />
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

export default App;
