/* Brain2 Console — Settings app shell + section nav. */

const SETTINGS_NAV = [
  { id: 'profile', icon: 'user', label: 'Profile' },
  { id: 'members', icon: 'users', label: 'Members' },
  { id: 'integrations', icon: 'plug', label: 'Integrations' },
  { id: 'providers', icon: 'key', label: 'Providers' },
  { id: 'appearance', icon: 'sparkles', label: 'Appearance' },
  { id: 'tools', icon: 'command', label: 'Tools' },
  { id: 'audit', icon: 'history', label: 'Audit log' },
  { id: 'danger', icon: 'shield', label: 'Danger zone' },
];

function SettingsApp() {
  const [theme, setTheme] = useStored('b2-theme', 'dark');
  const [accent, setAccent] = useStored('b2-accent', 'indigo');
  const vars = getTokens(theme, accent, 'inter');
  const [sec, setSec] = React.useState('profile');

  const body = {
    profile: <ProfileSection />,
    members: <MembersSection />,
    integrations: <IntegrationsSection />,
    providers: <ProvidersSection />,
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
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-faint)', padding: '0 10px 10px' }}>Settings</div>
          {SETTINGS_NAV.map((n) => {
            const on = n.id === sec;
            return (
              <button key={n.id} onClick={() => setSec(n.id)} style={{ display: 'flex', alignItems: 'center', gap: 11, width: '100%', height: 38, padding: '0 12px', border: 'none', borderRadius: 9, cursor: 'pointer', marginBottom: 2,
                background: on ? 'var(--accent-soft)' : 'transparent', color: on ? 'var(--accent)' : 'var(--fg-muted)' }}>
                <Icon name={n.icon} size={17} />
                <span style={{ fontSize: 13.5, fontWeight: on ? 600 : 500, color: on ? 'var(--fg)' : 'var(--fg-muted)' }}>{n.label}</span>
              </button>
            );
          })}
        </nav>
        {/* content */}
        <main style={{ flex: 1, minWidth: 0, overflowY: 'auto', background: 'var(--bg)' }}>
          <div style={{ maxWidth: 760, margin: '0 auto', padding: '28px 28px 96px' }}>
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
  members: 'Invite teammates and manage their roles.',
  integrations: 'Connect Telegram, Slack and other channels.',
  providers: 'Bring your own model API keys.',
  appearance: 'Theme, accent and interface preferences.',
  tools: 'Control which operations agents can call.',
  audit: 'A record of every change in this workspace.',
  danger: 'Irreversible, destructive actions.',
};

ReactDOM.createRoot(document.getElementById('root')).render(<SettingsApp />);
