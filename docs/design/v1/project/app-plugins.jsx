/* Brain2 Console — Plugins app shell: tabs, install state, drawer. */

function useStored(key, init) {
  const [v, setV] = React.useState(() => { try { return localStorage.getItem(key) || init; } catch { return init; } });
  React.useEffect(() => { try { localStorage.setItem(key, v); } catch {} }, [v]);
  return [v, setV];
}

function PluginTab({ label, count, active, onClick }) {
  return (
    <button onClick={onClick} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 8, height: 38, padding: '0 2px',
      border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'var(--ui-font)', fontSize: 14, fontWeight: active ? 600 : 500,
      color: active ? 'var(--fg)' : 'var(--fg-muted)' }}>
      {label}
      {count != null && <span style={{ fontSize: 11, fontFamily: 'var(--mono-font)', color: active ? 'var(--accent)' : 'var(--fg-muted)',
        background: active ? 'var(--accent-soft)' : 'var(--surface-2)', borderRadius: 6, padding: '1px 6px' }}>{count}</span>}
      {active && <span style={{ position: 'absolute', left: 0, right: 0, bottom: -1, height: 2, borderRadius: 2, background: 'var(--accent)' }} />}
    </button>
  );
}

function PluginsApp() {
  const [theme, setTheme] = useStored('b2-theme', 'dark');
  const [accent] = useStored('b2-accent', 'indigo');
  const vars = getTokens(theme, accent, 'inter');

  // install state: id -> { installed, enabled }
  const [state, setState] = React.useState(() => {
    const m = {};
    PLUGINS.forEach((p) => { m[p.id] = { installed: p.installed, enabled: p.enabled }; });
    return m;
  });
  const [busy, setBusy] = React.useState({});       // id -> true while "installing"
  const [tab, setTab] = React.useState('installed'); // installed | marketplace
  const [cat, setCat] = React.useState('All');
  const [openId, setOpenId] = React.useState(null);

  const st = (id) => state[id] || { installed: false, enabled: false };
  const install = (id) => {
    setBusy((b) => ({ ...b, [id]: true }));
    setTimeout(() => {
      setBusy((b) => { const n = { ...b }; delete n[id]; return n; });
      setState((s) => ({ ...s, [id]: { installed: true, enabled: true } }));
    }, 750);
  };
  const uninstall = (id) => setState((s) => ({ ...s, [id]: { installed: false, enabled: false } }));
  const toggle = (id) => setState((s) => ({ ...s, [id]: { ...s[id], enabled: !s[id].enabled } }));

  const installed = PLUGINS.filter((p) => st(p.id).installed);
  const market = PLUGINS.filter((p) => cat === 'All' || p.category === cat);
  const openPlugin = PLUGINS.find((p) => p.id === openId);

  return (
    <div style={{ ...vars, height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg)', color: 'var(--fg)', fontFamily: 'var(--ui-font)', fontSize: 14 }}>
      <TopBar theme={theme} onToggleTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')} />
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <LeftRail active="plugins" />
        <main style={{ flex: 1, minWidth: 0, overflowY: 'auto', background: 'var(--bg)' }}>
          <div style={{ maxWidth: 1080, margin: '0 auto', padding: '28px 28px 96px' }}>
            {/* header */}
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h1 style={{ margin: '0 0 4px', fontFamily: 'var(--display-font)', fontSize: 26, fontWeight: 700, letterSpacing: 'var(--display-track)', color: 'var(--fg)' }}>Plugins</h1>
                <div style={{ fontSize: 13, color: 'var(--fg-muted)' }}>Extend Brain2 with capabilities your agents and wiki can use.</div>
              </div>
              <button onClick={() => setTab('marketplace')} style={pbtn('primary')}><Icon name="search" size={14} color="#fff" /> Browse marketplace</button>
            </div>

            {/* tabs */}
            <div style={{ display: 'flex', gap: 26, marginTop: 20, borderBottom: '1px solid var(--border)' }}>
              <PluginTab label="Installed" count={installed.length} active={tab === 'installed'} onClick={() => setTab('installed')} />
              <PluginTab label="Marketplace" count={PLUGINS.length} active={tab === 'marketplace'} onClick={() => setTab('marketplace')} />
            </div>

            {/* installed */}
            {tab === 'installed' && (
              <div style={{ marginTop: 22 }}>
                {installed.length
                  ? installed.map((p) => (
                      <InstalledRow key={p.id} p={p} st={st(p.id)}
                        onToggle={() => toggle(p.id)} onConfigure={() => {}} onUninstall={() => uninstall(p.id)} onOpen={() => setOpenId(p.id)} />
                    ))
                  : <InstalledEmpty />}
              </div>
            )}

            {/* marketplace */}
            {tab === 'marketplace' && (
              <div style={{ marginTop: 20 }}>
                {/* first-party notice */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '12px 14px', borderRadius: 11, marginBottom: 18,
                  background: 'var(--accent-soft)', border: '1px solid var(--border)' }}>
                  <Icon name="shield" size={17} color="var(--accent)" />
                  <span style={{ fontSize: 13, color: 'var(--fg)' }}>
                    <b>First-party plugins only.</b> <span style={{ color: 'var(--fg-muted)' }}>Every plugin here is built and maintained by Brain2. Third-party plugins are coming soon.</span>
                  </span>
                </div>
                {/* category filter */}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
                  {PLUGIN_CATEGORIES.map((c) => {
                    const on = c === cat;
                    return (
                      <button key={c} onClick={() => setCat(c)} style={{ height: 30, padding: '0 13px', borderRadius: 999, cursor: 'pointer',
                        fontFamily: 'var(--ui-font)', fontSize: 12.5, fontWeight: on ? 600 : 500,
                        border: `1px solid ${on ? 'transparent' : 'var(--border)'}`, background: on ? 'var(--accent)' : 'transparent', color: on ? '#fff' : 'var(--fg-muted)' }}>{c}</button>
                    );
                  })}
                </div>
                {/* grid */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(310px, 1fr))', gap: 16 }}>
                  {market.map((p) => (
                    <MarketCard key={p.id} p={p} st={st(p.id)} busy={!!busy[p.id]}
                      onInstall={() => install(p.id)} onUninstall={() => uninstall(p.id)} onOpen={() => setOpenId(p.id)} />
                  ))}
                </div>
              </div>
            )}
          </div>
        </main>
      </div>

      <PluginDrawer p={openPlugin} st={openPlugin ? st(openPlugin.id) : {}} busy={openPlugin ? !!busy[openPlugin.id] : false}
        onInstall={() => install(openId)} onUninstall={() => uninstall(openId)} onToggle={() => toggle(openId)} onClose={() => setOpenId(null)} />
      <BottomNav active="plugins" />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<PluginsApp />);
