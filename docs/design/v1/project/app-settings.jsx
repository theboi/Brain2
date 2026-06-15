/* Brain2 Console — Settings app shell + section nav. */

const NAV_GROUPS = [
  { title: 'Organization', items: [
    { id: 'workspaces', icon: 'layers', label: 'Workspaces' },
    { id: 'members', icon: 'users', label: 'People' },
  ] },
  { title: 'Settings', items: [
    { id: 'profile', icon: 'user', label: 'Profile' },
    { id: 'integrations', icon: 'plug', label: 'Integrations' },
    { id: 'models', icon: 'cpu', label: 'Models' },
    { id: 'appearance', icon: 'sparkles', label: 'Appearance' },
    { id: 'tools', icon: 'command', label: 'Tools' },
    { id: 'audit', icon: 'history', label: 'Audit log' },
    { id: 'danger', icon: 'shield', label: 'Danger zone' },
  ] },
];
const SETTINGS_NAV = NAV_GROUPS.flatMap((g) => g.items);

function SettingsApp() {
  const [theme, setTheme] = useStored('b2-theme', 'dark');
  const [accent, setAccent] = useStored('b2-accent', 'indigo');
  const vars = getTokens(theme, accent, 'inter');
  const hashSec = (typeof location !== 'undefined' ? location.hash.replace('#', '') : '');
  const [sec, setSec] = React.useState(SETTINGS_NAV.some((n) => n.id === hashSec) ? hashSec : 'profile');
  React.useEffect(() => {
    const onHash = () => { const h = location.hash.replace('#', ''); if (SETTINGS_NAV.some((n) => n.id === h)) setSec(h); };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const body = {
    profile: <ProfileSection />,
    workspaces: <WorkspacesSection />,
    members: <MembersSection />,
    integrations: <IntegrationsSection />,
    models: <ModelsSection />,
    appearance: <AppearanceSection theme={theme} setTheme={setTheme} accent={accent} setAccent={setAccent} />,
    tools: <ToolsSection />,
    audit: <AuditSection />,
    danger: <DangerSection />,
  }[sec];
  const cur = SETTINGS_NAV.find((n) => n.id === sec);

  return (
    <div style={{ ...vars, height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg)', color: 'var(--fg)', fontFamily: 'var(--ui-font)', fontSize: 14 }}>
      <TopBar theme={theme} onToggleTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')} />
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <LeftRail active="settings" />
        {/* section nav */}
        <nav style={{ width: 230, flexShrink: 0, borderRight: '1px solid var(--border)', background: 'var(--surface)', padding: '18px 12px', overflowY: 'auto' }}>
          {NAV_GROUPS.map((g, gi) => (
            <div key={g.title} style={{ marginTop: gi ? 18 : 0 }}>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-faint)', padding: '0 10px 10px' }}>{g.title}</div>
              {g.items.map((n) => {
                const on = n.id === sec;
                return (
                  <button key={n.id} onClick={() => { setSec(n.id); try { history.replaceState(null, '', '#' + n.id); } catch {} }} style={{ display: 'flex', alignItems: 'center', gap: 11, width: '100%', height: 38, padding: '0 12px', border: 'none', borderRadius: 9, cursor: 'pointer', marginBottom: 2,
                    background: on ? 'var(--accent-soft)' : 'transparent', color: on ? 'var(--accent)' : 'var(--fg-muted)' }}>
                    <Icon name={n.icon} size={17} />
                    <span style={{ fontSize: 13.5, fontWeight: on ? 600 : 500, color: on ? 'var(--fg)' : 'var(--fg-muted)' }}>{n.label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
        {/* content */}
        <main style={{ flex: 1, minWidth: 0, overflowY: 'auto', background: 'var(--bg)' }}>
          <div style={{ maxWidth: sec === 'workspaces' ? 'none' : 760, margin: '0 auto', padding: '28px 28px 96px' }}>
            <h1 style={{ margin: '0 0 4px', fontFamily: 'var(--display-font)', fontSize: 24, fontWeight: 700, letterSpacing: 'var(--display-track)', color: 'var(--fg)' }}>{cur.label}</h1>
            <div style={{ fontSize: 13, color: 'var(--fg-muted)', marginBottom: 22 }}>{secSub[sec]}</div>
            {body}
          </div>
        </main>
      </div>
      <BottomNav active="settings" />
    </div>
  );
}

const secSub = {
  profile: 'Manage your personal details and sign-in.',
  workspaces: 'Organize vaults across workspaces and manage who has access.',
  members: 'Everyone in your organization and their org-wide role.',
  integrations: 'Connect Telegram, Slack and other channels.',
  models: 'Manage the cloud and local models your agents can run.',
  appearance: 'Theme, accent and interface preferences.',
  tools: 'Control which operations agents can call.',
  audit: 'A record of every change in this workspace.',
  danger: 'Irreversible, destructive actions.',
};

ReactDOM.createRoot(document.getElementById('root')).render(<SettingsApp />);
