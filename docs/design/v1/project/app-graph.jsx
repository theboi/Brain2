/* Brain2 Console — standalone Graph page.
   Hosts OrgGraphView (org-graph.jsx): the whole organization — workspaces,
   vaults, people, groups — in one force-directed graph, with a per-vault
   wiki-link mode. Opened from the Wiki header ("Open graph"). */

function GraphPage() {
  const [theme, setTheme] = useStored('b2-theme', 'dark');
  const [accent] = useStored('b2-accent', 'indigo');
  const vars = getTokens(theme, accent, 'inter');
  const isMobile = useIsMobile();

  return (
    <div style={{ ...vars, height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg)', color: 'var(--fg)', fontFamily: 'var(--ui-font)', fontSize: 14 }}>
      <TopBar theme={theme} onToggleTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')} />
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <LeftRail active="wiki" />
        <main style={{ flex: 1, minWidth: 0, position: 'relative', overflow: 'hidden', background: 'var(--bg)' }}>
          <OrgGraphView theme={theme} isMobile={isMobile} />
        </main>
      </div>
      <BottomNav active="wiki" />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<GraphPage />);
