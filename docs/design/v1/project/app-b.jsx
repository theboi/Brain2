/* Brain2 Console — Home (Variant B), focused interactive build. */

function useStored(key, init) {
  const [v, setV] = React.useState(() => { try { return localStorage.getItem(key) || init; } catch { return init; } });
  React.useEffect(() => { try { localStorage.setItem(key, v); } catch {} }, [v]);
  return [v, setV];
}

function useMedia(query) {
  const [match, setMatch] = React.useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  React.useEffect(() => {
    const mq = window.matchMedia(query);
    const fn = (e) => setMatch(e.matches);
    setMatch(mq.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, [query]);
  return match;
}

function SectionLabel({ children, action }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
      <h2 style={{ margin: 0, fontSize: 12, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-muted)' }}>{children}</h2>
      {action}
    </div>
  );
}

function HomeB() {
  const [theme, setTheme] = useStored('b2-theme', 'dark');
  // Accent is chosen on Settings → Appearance and persisted as 'b2-accent'.
  const [accent] = useStored('b2-accent', 'indigo');
  const vars = getTokens(theme, accent, 'inter');
  const isMobile = useMedia('(max-width: 820px)');
  const [modal, setModal] = React.useState(null); // 'activity' | 'agents' | 'addAgent'

  return (
    <div style={{ ...vars, height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg)',
      color: 'var(--fg)', fontFamily: 'var(--ui-font)', fontSize: 14 }}>
      <TopBar theme={theme} onToggleTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')} />
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <div className="b2-hide-sm" style={{ display: 'flex' }}>
          <LeftRail active="home" />
        </div>
        <main style={{ flex: 1, minWidth: 0, overflowY: 'auto', background: 'var(--bg)' }}>
          <div style={{ maxWidth: 1560, margin: '0 auto', padding: isMobile ? '16px 14px 88px' : 28, display: 'flex', flexDirection: 'column', gap: isMobile ? 18 : 22 }}>
            <HeroBand />
            <QuickActions isMobile={isMobile} />
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'minmax(0,1fr) 380px', gap: isMobile ? 18 : 22, alignItems: 'start' }}>
              {/* focus column */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 24, minWidth: 0 }}>
                <div>
                  <SectionLabel action={<MoreLink onClick={() => setModal('agents')}>Manage agents</MoreLink>}>Agents</SectionLabel>
                  <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(3, 1fr)', gap: isMobile ? 10 : 14 }}>
                    {DATA.agents.map((a) => <AgentCard key={a.id} a={a} />)}
                    <AddAgentTile onClick={() => setModal('addAgent')} />
                  </div>
                </div>
                <div>
                  <SectionLabel>Knowledge stats</SectionLabel>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: isMobile ? 10 : 16 }}>
                      <StatTile label="Sources ingested" value="1,284" delta="3.4%" data={DATA.sourcesOverTime} id="sb" />
                      <StatTile label="Queries served · today" value="89" delta="12%" data={DATA.queriesServed} id="qb" />
                    </div>
                    <Panel title="LLM tokens used" action={<Legend items={legendItems()} />}>
                      <StackedArea series={DATA.tokensByProvider} colors={PROVIDER_COLORS} h={150} id="tb" />
                    </Panel>
                  </div>
                </div>
              </div>
              {/* sidebar */}
              <aside style={{ display: 'flex', flexDirection: 'column', gap: 16, position: isMobile ? 'static' : 'sticky', top: 0 }}>
                <ActivityPanel onViewAll={() => setModal('activity')} />
                <WikiHealth />
                <Panel title="Wiki pages by project" action={<MoreLink>Open wiki</MoreLink>}>
                  <div style={{ paddingTop: 4 }}><BarsH data={DATA.wikiByProject} /></div>
                </Panel>
              </aside>
            </div>
          </div>
        </main>
      </div>
      <BottomNav active="home" />
      {modal === 'activity' && <ActivityModal onClose={() => setModal(null)} />}
      {modal === 'agents' && <ManageAgentsModal onClose={() => setModal(null)} onAddAgent={() => setModal('addAgent')} />}
      {modal === 'addAgent' && <AddAgentModal onClose={() => setModal(null)} />}
    </div>
  );
}

const PROVIDER_COLORS = ['var(--accent)', '#2DD4BF', '#94A3B8'];
function legendItems() {
  return [
    { label: 'Anthropic', color: PROVIDER_COLORS[0] },
    { label: 'Gemini', color: PROVIDER_COLORS[1] },
    { label: 'Ollama', color: PROVIDER_COLORS[2] },
  ];
}

ReactDOM.createRoot(document.getElementById('root')).render(<HomeB />);
