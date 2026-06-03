import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { useTheme } from '@/hooks/useTheme';
import { HomePage } from '@/pages/Home';
import { SettingsPage } from '@/pages/Settings';

function App() {
  const { theme, accent, setTheme, setAccent, toggleTheme } = useTheme();

  return (
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
          {/* Stub routes — pages to be built in subsequent phases */}
          <Route path="/sources/*" element={<StubPage title="Sources" />} />
          <Route path="/wiki/*" element={<StubPage title="Wiki" />} />
          <Route path="/chats/*" element={<StubPage title="Chats" />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AppShell>
    </BrowserRouter>
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
