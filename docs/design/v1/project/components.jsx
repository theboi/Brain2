/* Brain2 Console — icons (Lucide-style) + shell primitives. */

const ICONS = {
  home: <><path d="M3 9.5 12 3l9 6.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z" /><path d="M9 21v-6h5v6" /></>,
  sources: <><path d="M4 6 12 2.5 20 6l-8 3.5L4 6Z" /><path d="M4 12l8 3.5L20 12" /><path d="M4 17l8 3.5L20 17" /></>,
  wiki: <path d="M12 2.5l2.2 6.3 6.6.2-5.3 4 1.9 6.4L12 19.6 6.6 19.4l1.9-6.4-5.3-4 6.6-.2L12 2.5Z" />,
  chats: <path d="M21 14a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2Z" />,
  settings: <><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></>,
  plus: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
  more: <><circle cx="5" cy="12" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="19" cy="12" r="1.4" /></>,
  check: <><circle cx="12" cy="12" r="9" /><path d="M8.5 12.2l2.3 2.3 4.7-4.9" /></>,
  alert: <><path d="M10.3 3.8 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.8a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4" /><path d="M12 17h.01" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  loader: <><path d="M12 3v3" /><path d="M12 18v3" /><path d="M5.6 5.6l2.1 2.1" /><path d="M16.3 16.3l2.1 2.1" /><path d="M3 12h3" /><path d="M18 12h3" /><path d="M5.6 18.4l2.1-2.1" /><path d="M16.3 7.7l2.1-2.1" /></>,
  chevDown: <path d="M5 8.5 12 15l7-6.5" />,
  chevRight: <path d="M9 5l7 7-7 7" />,
  arrowRight: <><path d="M4 12h15" /><path d="M13 5l7 7-7 7" /></>,
  arrowLeft: <><path d="M20 12H5" /><path d="M11 5l-7 7 7 7" /></>,
  sun: <><circle cx="12" cy="12" r="4.5" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" /></>,
  moon: <path d="M21 13.5A8.5 8.5 0 1 1 10.5 3 6.6 6.6 0 0 0 21 13.5Z" />,
  command: <path d="M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3Z" />,
  sparkles: <><path d="M12 3l1.6 4.7L18 9.3l-4.4 1.6L12 16l-1.6-5.1L6 9.3l4.4-1.6L12 3Z" /><path d="M19 14l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7.7-2Z" /></>,
  file: <><path d="M14 3v5h5" /><path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8l-5-5Z" /></>,
  folder: <path d="M3 7a1 1 0 0 1 1-1h5l2 2h8a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z" />,
  zap: <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" />,
  cloud: <path d="M7 18a4 4 0 0 1-.5-7.97A6 6 0 0 1 18 9a4 4 0 0 1 0 9Z" />,
  cpu: <><rect x="6" y="6" width="12" height="12" rx="2" /><path d="M9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3" /></>,
  pause: <><rect x="7" y="5" width="3.5" height="14" rx="1" /><rect x="13.5" y="5" width="3.5" height="14" rx="1" /></>,
  copy: <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" /></>,
  pencil: <><path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3Z" /><path d="M13.5 6.5l3 3" /></>,
  download: <><path d="M12 3v12" /><path d="M7 11l5 5 5-5" /><path d="M5 21h14" /></>,
  x: <><path d="M6 6l12 12" /><path d="M18 6 6 18" /></>,
  tag: <><path d="M3 11.5V4a1 1 0 0 1 1-1h7.5a1 1 0 0 1 .7.3l8 8a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0l-8-8a1 1 0 0 1-.3-.7Z" /><circle cx="7.5" cy="7.5" r="1.2" /></>,
  hash: <><path d="M5 9h14M5 15h14M10 4l-2 16M16 4l-2 16" /></>,
  image: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8.5" cy="9.5" r="1.6" /><path d="M21 16l-5-5L5 20" /></>,
  code: <><path d="M9 8l-4 4 4 4" /><path d="M15 8l4 4-4 4" /></>,
  link: <><path d="M9 13a4 4 0 0 0 6 .5l2-2a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M15 11a4 4 0 0 0-6-.5l-2 2a4 4 0 0 0 5.7 5.7l1-1" /></>,
  refresh: <><path d="M20 11A8 8 0 1 0 18 16" /><path d="M20 5v6h-6" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></>,
  history: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 4v4h4" /><path d="M12 8v4l3 2" /></>,
  panelLeft: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></>,
  filter: <path d="M3 5h18l-7 8v6l-4-2v-4L3 5Z" />,
  dot: <circle cx="12" cy="12" r="3" />,
  send: <><path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4 20-7Z" /></>,
  atSign: <><circle cx="12" cy="12" r="4" /><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8" /></>,
  slash: <path d="M7 21 17 3" />,
  stop: <rect x="6" y="6" width="12" height="12" rx="2.5" />,
  thumbUp: <><path d="M7 10v11" /><path d="M7 10l4-7a2 2 0 0 1 2 2v3h5a2 2 0 0 1 2 2.3l-1.3 7A2 2 0 0 1 17 21H7" /></>,
  thumbDown: <><path d="M17 14V3" /><path d="M17 14l-4 7a2 2 0 0 1-2-2v-3H6a2 2 0 0 1-2-2.3l1.3-7A2 2 0 0 1 7 3h10" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 21a6.5 6.5 0 0 1 13 0" /><path d="M16 5a3.5 3.5 0 0 1 0 7M22 21a6 6 0 0 0-4.5-5.8" /></>,
  key: <><circle cx="7.5" cy="15.5" r="4" /><path d="M10.5 12.5 21 2l1 3-2 2 2 2-3 3-2-2-2.5 2.5" /></>,
  mail: <><rect x="2.5" y="5" width="19" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></>,
  plug: <><path d="M12 22v-5" /><path d="M9 8V2M15 8V2" /><path d="M7 8h10v3a5 5 0 0 1-10 0V8Z" /></>,
  logout: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5M21 12H9" /></>,
  shield: <><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3Z" /><path d="M9 12l2 2 4-4" /></>,
  pin: <><path d="M12 17v5" /><path d="M9 3h6l-1 7 3 3H7l3-3-1-7Z" /></>,
  trash: <><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></>,
  telegram: <path d="M22 4 2.5 11.5 9 14l1.5 6 3.5-4.5 5 4L22 4Z" />,
  bell: <><path d="M18 9a6 6 0 1 0-12 0c0 6-2 8-2 8h16s-2-2-2-8Z" /><path d="M10 21a2 2 0 0 0 4 0" /></>,
  external: <><path d="M14 4h6v6" /><path d="M20 4 10 14" /><path d="M19 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h6" /></>,
  chevLeft: <path d="M15 5l-7 7 7 7" />,
  play: <path d="M7 4.5v15l13-7.5-13-7.5Z" />,
  presentation: <><rect x="3" y="4" width="18" height="12" rx="1.5" /><path d="M12 16v4M8.5 20h7M3 16h18" /></>,
  barChart: <path d="M5 20V11M10 20V5M15 20V9M20 20v-5" />,
  trendingUp: <><path d="M3 16l5.5-5.5 4 4L21 6" /><path d="M15 6h6v6" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
  briefcase: <><rect x="3" y="7.5" width="18" height="12" rx="2" /><path d="M8 7.5V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v1.5M3 13h18" /></>,
  sliders: <><path d="M4 7h9M17 7h3M4 17h3M11 17h9" /><circle cx="15" cy="7" r="2.3" /><circle cx="7" cy="17" r="2.3" /></>,
  layers: <><path d="M12 3l9 5-9 5-9-5 9-5Z" /><path d="M3.5 12.5 12 17l8.5-4.5" /></>,
  wand: <><path d="M5 19 14 10M14.5 5.5 16 4M19 9l1.5-1.5M9.5 4.5 11 3M15 9.5l1 1" /></>,
  clipboard: <><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1M9 11h6M9 15h4" /></>,
  graph: <><circle cx="6" cy="18" r="2.4" /><circle cx="18" cy="17" r="2.4" /><circle cx="14" cy="6" r="2.4" /><path d="M7.7 16.3 12.4 7.7M15.9 15.4 8.1 17.4M12.6 7.9 16.7 14.9" /></>,
};

function Icon({ name, size = 18, sw = 1.75, style, color }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color || 'currentColor'}
      strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flexShrink: 0, ...style }}>
      {ICONS[name]}
    </svg>
  );
}

// ── Status dot: color + a glyph never relies on color alone ──────────────
const STATUS = {
  active:   { color: 'var(--success)', fill: true,  glyph: 'streaming' },
  ready:    { color: 'var(--fg-muted)', fill: false, glyph: 'ready' },
  idle:     { color: 'var(--fg-faint)', fill: false, glyph: 'idle' },
  degraded: { color: 'var(--warning)', fill: true,  glyph: 'degraded' },
  error:    { color: 'var(--destructive)', fill: true, glyph: 'offline' },
};

function StatusDot({ status, pulse = true }) {
  const s = STATUS[status] || STATUS.ready;
  return (
    <span style={{ position: 'relative', width: 9, height: 9, display: 'inline-flex', flexShrink: 0 }}>
      {s.fill && pulse && status === 'active' && (
        <span className="b2-pulse" style={{ position: 'absolute', inset: -2, borderRadius: '50%', background: s.color, opacity: 0.4 }} />
      )}
      <span style={{
        width: 9, height: 9, borderRadius: '50%',
        background: s.fill ? s.color : 'transparent',
        border: s.fill ? 'none' : `1.6px solid ${s.color}`,
      }} />
    </span>
  );
}

// ── Top bar data ───────────────────────────────────────────────────────────
const WORKSPACES = [
  { id: 'default', name: 'default', role: 'Owner', members: 6 },
  { id: 'research-q3', name: 'research-q3', role: 'Admin', members: 4 },
  { id: 'personal', name: 'personal', role: 'Owner', members: 1 },
];
const PALETTE_GROUPS = [
  { group: 'Pages', items: [
    { label: 'Home', icon: 'home', href: 'Home Dashboard B.html' },
    { label: 'Sources', icon: 'sources', href: 'Sources.html' },
    { label: 'Wiki', icon: 'wiki', href: 'Wiki.html' },
    { label: 'Chats', icon: 'chats', href: 'Chats.html' },
    { label: 'Reports', icon: 'file', href: 'Reports.html' },
    { label: 'Plugins', icon: 'plug', href: 'Plugins.html' },
    { label: 'Settings', icon: 'settings', href: 'Settings.html' },
  ] },
  { group: 'Sources', items: [
    { label: 'Hooke 1665.pdf', icon: 'file', href: 'Sources.html', hint: 'pdf' },
    { label: 'anthropic.com/research', icon: 'globe', href: 'Sources.html', hint: 'url' },
    { label: 'gateway.py', icon: 'code', href: 'Sources.html', hint: 'code' },
  ] },
  { group: 'Wiki topics', items: [
    { label: 'Cell theory', icon: 'wiki', href: 'Wiki.html', hint: 'v7' },
    { label: 'Micrographia', icon: 'wiki', href: 'Wiki.html', hint: 'v3' },
    { label: 'LLM Gateway', icon: 'wiki', href: 'Wiki.html', hint: 'v5' },
  ] },
  { group: 'Actions', items: [
    { label: 'Ingest a source', icon: 'download', href: 'Sources.html' },
    { label: 'New chat', icon: 'plus', href: 'Chats.html' },
    { label: 'Open settings', icon: 'settings', href: 'Settings.html' },
  ] },
];

function Popover({ onClose, children, style }) {
  React.useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <React.Fragment>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 300 }} />
      <div style={{ position: 'absolute', zIndex: 301, background: 'var(--surface)', border: '1px solid var(--border-strong)', borderRadius: 12, boxShadow: '0 14px 44px rgba(0,0,0,0.34)', ...style }}>{children}</div>
    </React.Fragment>
  );
}

function WorkspaceMenu({ current, onPick, onClose }) {
  return (
    <Popover onClose={onClose} style={{ top: 44, left: 0, width: 240, padding: 6 }}>
      <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-faint)', padding: '6px 8px 4px' }}>Workspaces</div>
      {WORKSPACES.map((w) => (
        <button key={w.id} onClick={() => { onPick(w.name); onClose(); }} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '8px', border: 'none', borderRadius: 8, background: w.name === current ? 'var(--accent-soft)' : 'transparent', cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--ui-font)' }}>
          <span style={{ width: 24, height: 24, borderRadius: 6, background: 'var(--surface-2)', color: 'var(--fg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700 }}>{w.name[0].toUpperCase()}</span>
          <span style={{ flex: 1 }}>
            <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>{w.name}</span>
            <span style={{ display: 'block', fontSize: 11, color: 'var(--fg-muted)' }}>{w.role} · {w.members} members</span>
          </span>
          {w.name === current && <Icon name="check" size={14} color="var(--accent)" />}
        </button>
      ))}
      <div style={{ height: 1, background: 'var(--border)', margin: '5px 4px' }} />
      <a href="Settings.html" style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px', borderRadius: 8, textDecoration: 'none', color: 'var(--fg-muted)', fontSize: 13, fontWeight: 500 }}><Icon name="plus" size={15} /> New workspace</a>
    </Popover>
  );
}

function ProfileMenu({ theme, onToggleTheme, onClose }) {
  const Item = ({ icon, label, href, onClick, danger }) => {
    const inner = (<React.Fragment><Icon name={icon} size={15} color={danger ? 'var(--destructive)' : 'var(--fg-muted)'} /><span style={{ flex: 1, textAlign: 'left' }}>{label}</span></React.Fragment>);
    const st = { display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '8px 9px', border: 'none', borderRadius: 8, background: 'transparent', cursor: 'pointer', textDecoration: 'none', fontFamily: 'var(--ui-font)', fontSize: 13, fontWeight: 500, color: danger ? 'var(--destructive)' : 'var(--fg)' };
    return href ? <a href={href} style={st}>{inner}</a> : <button onClick={onClick} style={st}>{inner}</button>;
  };
  return (
    <Popover onClose={onClose} style={{ top: 44, right: 0, width: 244, padding: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 8px 10px' }}>
        <span style={{ width: 34, height: 34, borderRadius: '50%', background: 'var(--accent-soft)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 600 }}>A</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><b style={{ fontSize: 13.5, color: 'var(--fg)' }}>Alice Chen</b><span style={{ fontSize: 10, fontWeight: 600, color: 'var(--accent)', background: 'var(--accent-soft)', borderRadius: 5, padding: '1px 5px' }}>Owner</span></span>
          <span style={{ display: 'block', fontSize: 11.5, color: 'var(--fg-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>alice@brain2.dev</span>
        </span>
      </div>
      <div style={{ height: 1, background: 'var(--border)', margin: '0 4px 5px' }} />
      <Item icon="user" label="Profile & account" href="Settings.html" />
      <Item icon="settings" label="Settings" href="Settings.html" />
      <Item icon={theme === 'light' ? 'moon' : 'sun'} label={theme === 'light' ? 'Dark theme' : 'Light theme'} onClick={() => { onToggleTheme && onToggleTheme(); }} />
      <div style={{ height: 1, background: 'var(--border)', margin: '5px 4px' }} />
      <Item icon="logout" label="Sign out" danger onClick={onClose} />
    </Popover>
  );
}

function CommandPalette({ onClose }) {
  const [q, setQ] = React.useState('');
  const ref = React.useRef(null);
  React.useEffect(() => { ref.current && ref.current.focus(); }, []);
  React.useEffect(() => { const k = (e) => { if (e.key === 'Escape') onClose(); }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k); }, [onClose]);
  const groups = PALETTE_GROUPS.map((g) => ({ ...g, items: g.items.filter((it) => it.label.toLowerCase().includes(q.toLowerCase())) })).filter((g) => g.items.length);
  const first = groups[0] && groups[0].items[0];
  // The portal mounts on document.body, OUTSIDE the app root that carries the
  // theme CSS variables — so re-apply them here, or var(--surface) etc. resolve
  // to nothing and the panel renders transparent.
  let paletteVars = {};
  try {
    const theme = (localStorage.getItem('b2-theme') || 'dark').replace(/"/g, '');
    const accent = (localStorage.getItem('b2-accent') || 'indigo').replace(/"/g, '');
    paletteVars = getTokens(theme, accent, 'inter');
  } catch (e) { paletteVars = getTokens('dark', 'indigo', 'inter'); }
  return ReactDOM.createPortal(
    <div onClick={onClose} style={{ ...paletteVars, fontFamily: 'var(--ui-font)', position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(8,9,12,0.5)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '12vh 20px 20px' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 600, maxWidth: '100%', maxHeight: '70vh', display: 'flex', flexDirection: 'column', background: 'var(--surface)', border: '1px solid var(--border-strong)', borderRadius: 14, boxShadow: '0 24px 80px rgba(0,0,0,0.5)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
          <Icon name="search" size={17} color="var(--fg-muted)" />
          <input ref={ref} value={q} onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && first) location.href = first.href; }}
            placeholder="Search pages, sources, wiki, chats…" style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', color: 'var(--fg)', fontSize: 15, fontFamily: 'var(--ui-font)' }} />
          <kbd style={kbdStyle()}>Esc</kbd>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
          {groups.map((g) => (
            <div key={g.group} style={{ marginBottom: 6 }}>
              <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-faint)', padding: '6px 8px 4px' }}>{g.group}</div>
              {g.items.map((it) => (
                <a key={it.label} href={it.href} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '9px 8px', borderRadius: 8, textDecoration: 'none', color: 'var(--fg)' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--accent-soft)')} onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
                  <span style={{ width: 26, height: 26, borderRadius: 7, background: 'var(--surface-2)', color: 'var(--fg-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name={it.icon} size={14} /></span>
                  <span style={{ flex: 1, fontSize: 13.5 }}>{it.label}</span>
                  {it.hint && <span style={{ fontSize: 11, fontFamily: 'var(--mono-font)', color: 'var(--fg-faint)' }}>{it.hint}</span>}
                  <Icon name="arrowRight" size={14} color="var(--fg-faint)" />
                </a>
              ))}
            </div>
          ))}
          {!groups.length && <div style={{ padding: '28px', textAlign: 'center', color: 'var(--fg-faint)', fontSize: 13.5 }}>No results for “{q}”</div>}
        </div>
      </div>
    </div>, document.body);
}

// ── Inbox (navbar) ─────────────────────────────────────────────────────────
const INBOX_TONE = { accent: 'var(--accent)', destructive: 'var(--destructive)', warning: 'var(--warning)', success: 'var(--success)', muted: 'var(--fg-muted)' };
function inboxItems() {
  const out = [];
  (DATA.briefing || []).forEach((g) => (g.items || []).forEach((it, i) => out.push({ id: g.key + ':' + i, icon: g.icon, group: g.title, groupKey: g.key, tone: g.tone, item: it, title: it.title, meta: it.meta, itemTone: it.tone })));
  return out;
}

// Shared read-state, persisted to localStorage and synced across the popup,
// the bell badge, and the full Inbox page via a custom 'b2-inbox' event.
const INBOX_KEY = 'b2-inbox-read';
function readInboxIds() { try { return JSON.parse(localStorage.getItem(INBOX_KEY) || '[]'); } catch { return []; } }
function useInboxRead() {
  const [ids, setIds] = React.useState(readInboxIds);
  React.useEffect(() => {
    const on = () => setIds(readInboxIds());
    window.addEventListener('storage', on);
    window.addEventListener('b2-inbox', on);
    return () => { window.removeEventListener('storage', on); window.removeEventListener('b2-inbox', on); };
  }, []);
  const persist = (next) => {
    const uniq = Array.from(new Set(next));
    try { localStorage.setItem(INBOX_KEY, JSON.stringify(uniq)); } catch {}
    setIds(uniq);
    window.dispatchEvent(new Event('b2-inbox'));
  };
  return {
    ids,
    isRead: (id) => ids.includes(id),
    markAll: () => persist(inboxItems().map((it) => it.id)),
    markRead: (id) => persist([...readInboxIds(), id]),
    markUnread: (id) => persist(readInboxIds().filter((x) => x !== id)),
    reset: () => persist([]),
  };
}

function InboxMenu({ onClose }) {
  const { isRead, markRead, markAll } = useInboxRead();
  const items = inboxItems().filter((it) => !isRead(it.id));
  return (
    <Popover onClose={onClose} style={{ top: 44, right: 0, width: 380, maxWidth: 'calc(100vw - 24px)', padding: 0, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '13px 14px', borderBottom: '1px solid var(--border)' }}>
        <Icon name="bell" size={16} color="var(--fg)" />
        <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--fg)' }}>Inbox</span>
        <span style={{ fontSize: 11, fontFamily: 'var(--mono-font)', color: 'var(--fg-muted)', background: 'var(--surface-2)', borderRadius: 6, padding: '1px 6px' }}>{items.length}</span>
        <button onClick={markAll} disabled={!items.length} style={{ marginLeft: 'auto', border: 'none', background: 'transparent', cursor: items.length ? 'pointer' : 'default', color: items.length ? 'var(--accent)' : 'var(--fg-faint)', fontFamily: 'var(--ui-font)', fontSize: 12, fontWeight: 500 }}>Mark all read</button>
      </div>
      <div style={{ maxHeight: 380, overflowY: 'auto', padding: 6 }}>
        {items.map((it) => (
          <button key={it.id} onClick={() => markRead(it.id)} title="Mark as read" style={{ display: 'flex', alignItems: 'center', gap: 11, width: '100%', textAlign: 'left', padding: '9px 8px',
            border: 'none', borderRadius: 9, background: 'transparent', cursor: 'pointer', fontFamily: 'var(--ui-font)' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-2)')} onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0, background: INBOX_TONE[it.itemTone] || 'var(--accent)' }} />
            <span style={{ width: 30, height: 30, borderRadius: 8, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-2)', color: INBOX_TONE[it.itemTone] }}>
              <Icon name={it.icon} size={15} />
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 13, color: 'var(--fg)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.title}</span>
              <span style={{ display: 'block', fontSize: 11.5, color: 'var(--fg-muted)', fontFamily: 'var(--mono-font)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.meta}</span>
            </span>
            <Icon name="chevRight" size={14} color="var(--fg-faint)" />
          </button>
        ))}
        {!items.length && <div style={{ padding: '28px', textAlign: 'center', color: 'var(--fg-faint)', fontSize: 13 }}>You’re all caught up.</div>}
      </div>
      <a href="Inbox.html" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '11px', borderTop: '1px solid var(--border)', textDecoration: 'none', color: 'var(--fg-muted)', fontSize: 12.5, fontWeight: 600 }}>Open inbox <Icon name="arrowRight" size={13} /></a>
    </Popover>
  );
}

// ── Top bar ──────────────────────────────────────────────────────────────
function TopBar({ theme, onToggleTheme } = {}) {
  const interactive = !!onToggleTheme;
  const [ws, setWs] = React.useState('default');
  const [menu, setMenu] = React.useState(null); // 'ws' | 'profile' | 'palette'
  const { isRead } = useInboxRead();
  const unreadN = inboxItems().filter((it) => !isRead(it.id)).length;
  React.useEffect(() => {
    const k = (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setMenu('palette'); } };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, []);
  return (
    <header style={{
      height: 52, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 16, position: 'relative', zIndex: 50,
      padding: '0 18px', borderBottom: '1px solid var(--border)', background: 'var(--surface)',
    }}>
      <a href="Home Dashboard B.html" style={{ display: 'flex', alignItems: 'center', gap: 9, textDecoration: 'none' }}>
        <div style={{ width: 22, height: 22, borderRadius: 6, background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ width: 9, height: 9, background: 'var(--surface)', borderRadius: 2, transform: 'rotate(45deg)' }} />
        </div>
        <span style={{ fontFamily: 'var(--display-font)', fontWeight: 700, fontSize: 15, letterSpacing: 'var(--display-track)', color: 'var(--fg)' }}>Brain2</span>
      </a>
      <div style={{ position: 'relative' }} className="b2-hide-sm">
        <button style={pillBtn()} onClick={() => setMenu(menu === 'ws' ? null : 'ws')}>
          <span style={{ color: 'var(--fg-muted)' }}>workspace</span>
          <span style={{ color: 'var(--fg)', fontWeight: 500 }}>{ws}</span>
          <Icon name="chevDown" size={13} color="var(--fg-muted)" />
        </button>
        {menu === 'ws' && <WorkspaceMenu current={ws} onPick={setWs} onClose={() => setMenu(null)} />}
      </div>
      <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
        <button className="b2-hide-sm" onClick={() => setMenu('palette')} style={{
          display: 'flex', alignItems: 'center', gap: 10, width: 380, maxWidth: '46%', height: 33,
          padding: '0 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)',
          color: 'var(--fg-muted)', fontFamily: 'var(--ui-font)', fontSize: 13, cursor: 'pointer',
        }}>
          <Icon name="search" size={15} />
          <span style={{ flex: 1, textAlign: 'left' }}>Search…</span>
          <kbd style={kbdStyle()}>⌘K</kbd>
        </button>
      </div>
      <button className="b2-show-sm" onClick={() => setMenu('palette')} style={{ ...iconBtn(), display: 'none' }} title="Search">
        <Icon name="search" size={16} color="var(--fg-muted)" />
      </button>
      <div style={{ position: 'relative' }}>
        <button style={{ ...iconBtn(), position: 'relative' }} onClick={() => setMenu(menu === 'inbox' ? null : 'inbox')} title="Inbox">
          <Icon name="bell" size={16} color={menu === 'inbox' ? 'var(--fg)' : 'var(--fg-muted)'} />
          {unreadN > 0 && (
            <span style={{ position: 'absolute', top: -5, right: -5, minWidth: 16, height: 16, padding: '0 4px', borderRadius: 8,
              background: 'var(--destructive)', color: '#fff', fontSize: 10, fontWeight: 700, fontFamily: 'var(--mono-font)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid var(--surface)' }}>{unreadN}</span>
          )}
        </button>
        {menu === 'inbox' && <InboxMenu onClose={() => setMenu(null)} />}
      </div>
      {/* ACCENT SWITCHER lives on the Settings → Appearance page (writes the
          'b2-accent' localStorage key that every page reads via getTokens). */}
      <div style={{ position: 'relative' }}>
        <button onClick={() => setMenu(menu === 'profile' ? null : 'profile')} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 4px', borderRadius: 999, border: '1px solid var(--border)', background: menu === 'profile' ? 'var(--surface-2)' : 'transparent', cursor: 'pointer' }}>
          <span style={{ width: 26, height: 26, borderRadius: '50%', background: 'var(--accent-soft)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600, fontFamily: 'var(--ui-font)' }}>A</span>
          <span className="b2-hide-sm" style={{ fontSize: 13, color: 'var(--fg)', fontWeight: 500, paddingRight: 4 }}>alice</span>
        </button>
        {menu === 'profile' && <ProfileMenu theme={theme} onToggleTheme={onToggleTheme} onClose={() => setMenu(null)} />}
      </div>
      {menu === 'palette' && <CommandPalette onClose={() => setMenu(null)} />}
    </header>
  );
}

// ── Left rail ─────────────────────────────────────────────────────────────
const RAIL_HREFS = {
  home: 'Home Dashboard B.html', sources: 'Sources.html', wiki: 'Wiki.html', chats: 'Chats.html', reports: 'Reports.html', plugins: 'Plugins.html', settings: 'Settings.html',
};
function LeftRail({ active = 'home', expanded = false }) {
  const items = [
    { id: 'home', icon: 'home', label: 'Home' },
    { id: 'sources', icon: 'sources', label: 'Sources' },
    { id: 'wiki', icon: 'wiki', label: 'Wiki' },
    { id: 'chats', icon: 'chats', label: 'Chats', badge: 2 },
    { id: 'reports', icon: 'file', label: 'Reports' },
    { id: 'plugins', icon: 'plug', label: 'Plugins' },
  ];
  const Row = ({ it, isActive }) => (
    <a href={RAIL_HREFS[it.id] || '#'} style={{ textDecoration: 'none', position: 'relative', display: 'flex', alignItems: 'center', gap: 12, height: 40, padding: '0 14px', borderRadius: 9, cursor: 'pointer',
      background: isActive ? 'var(--accent-soft)' : 'transparent', color: isActive ? 'var(--accent)' : 'var(--fg-muted)' }}>
      {isActive && <span style={{ position: 'absolute', left: -8, top: 9, bottom: 9, width: 2.5, borderRadius: 2, background: 'var(--accent)' }} />}
      <Icon name={it.icon} size={19} />
      {expanded && <span style={{ fontSize: 13.5, fontWeight: isActive ? 600 : 500, color: isActive ? 'var(--fg)' : 'var(--fg-muted)' }}>{it.label}</span>}
      {it.badge && (
        <span style={{ position: expanded ? 'static' : 'absolute', right: expanded ? 0 : 10, top: expanded ? 'auto' : 8, marginLeft: expanded ? 'auto' : 0,
          minWidth: 17, height: 17, padding: '0 5px', borderRadius: 9, background: 'var(--accent)', color: '#fff', fontSize: 10.5, fontWeight: 600,
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--mono-font)' }}>{it.badge}</span>
      )}
    </a>
  );
  return (
    <nav className="b2-hide-sm" style={{ width: expanded ? 200 : 64, flexShrink: 0, borderRight: '1px solid var(--border)', background: 'var(--surface)',
      display: 'flex', flexDirection: 'column', padding: '12px 8px', gap: 3 }}>
      {items.map((it) => <Row key={it.id} it={it} isActive={it.id === active} />)}
      <div style={{ height: 1, background: 'var(--border)', margin: '8px 6px' }} />
      <Row it={{ id: 'settings', icon: 'settings', label: 'Settings' }} isActive={active === 'settings'} />
      <div style={{ flex: 1 }} />
    </nav>
  );
}

// ── Bottom tab bar (mobile) ─────────────────────────────────────────────────
function BottomTab({ it, isActive }) {
  return (
    <a href={RAIL_HREFS[it.id] || '#'} style={{
      position: 'relative', flex: 1, minWidth: 0, textDecoration: 'none',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4,
      padding: '9px 4px 8px', minHeight: 56,
      color: isActive ? 'var(--accent)' : 'var(--fg-muted)',
    }}>
      <span style={{ position: 'relative', display: 'flex' }}>
        <Icon name={it.icon} size={21} />
        {it.badge && (
          <span style={{ position: 'absolute', top: -5, right: -8, minWidth: 15, height: 15, padding: '0 4px', borderRadius: 8,
            background: 'var(--accent)', color: '#fff', fontSize: 9.5, fontWeight: 700, fontFamily: 'var(--mono-font)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid var(--surface)' }}>{it.badge}</span>
        )}
      </span>
      <span style={{ fontSize: 10.5, fontWeight: isActive ? 600 : 500, fontFamily: 'var(--ui-font)', whiteSpace: 'nowrap' }}>{it.label}</span>
    </a>
  );
}

function BottomNav({ active = 'home' }) {
  const items = [
    { id: 'home', icon: 'home', label: 'Home' },
    { id: 'sources', icon: 'sources', label: 'Sources' },
    { id: 'wiki', icon: 'wiki', label: 'Wiki' },
    { id: 'chats', icon: 'chats', label: 'Chats', badge: 2 },
    { id: 'reports', icon: 'file', label: 'Reports' },
    { id: 'plugins', icon: 'plug', label: 'Plugins' },
  ];
  const MIN_TAB = 64; // px — minimum comfortable width per tab
  const navRef = React.useRef(null);
  const [width, setWidth] = React.useState(typeof window !== 'undefined' ? window.innerWidth : 0);
  const [openMore, setOpenMore] = React.useState(false);

  React.useEffect(() => {
    const measure = () => setWidth(window.innerWidth);
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  // How many tabs fit at full width? If they don't all fit, reserve one slot for "More".
  let visible = items, overflow = [];
  if (width > 0) {
    const fit = Math.max(1, Math.floor(width / MIN_TAB));
    if (fit < items.length) {
      const primaryCount = Math.max(1, fit - 1); // last slot becomes "More"
      visible = items.slice(0, primaryCount);
      overflow = items.slice(primaryCount);
    }
  }
  const overflowActive = overflow.some((it) => it.id === active);

  // close dropup on outside click / escape
  React.useEffect(() => {
    if (!openMore) return;
    const onDoc = (e) => { if (navRef.current && !navRef.current.contains(e.target)) setOpenMore(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpenMore(false); };
    document.addEventListener('pointerdown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [openMore]);

  return (
    <nav ref={navRef} className="b2-show-sm" style={{
      display: 'none', position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 60,
      borderTop: '1px solid var(--border)', background: 'var(--surface)',
      paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      boxShadow: '0 -2px 16px rgba(0,0,0,0.18)',
    }}>
      {/* dropup panel */}
      {openMore && overflow.length > 0 && (
        <div style={{
          position: 'absolute', right: 8, bottom: 'calc(100% + 8px)', zIndex: 70,
          minWidth: 184, padding: 6, background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 12, boxShadow: '0 8px 28px rgba(0,0,0,0.3)',
        }}>
          {overflow.map((it) => {
            const isActive = it.id === active;
            return (
              <a key={it.id} href={RAIL_HREFS[it.id] || '#'} onClick={() => setOpenMore(false)} style={{
                display: 'flex', alignItems: 'center', gap: 11, padding: '10px 11px', borderRadius: 8, textDecoration: 'none',
                background: isActive ? 'var(--accent-soft)' : 'transparent', color: isActive ? 'var(--accent)' : 'var(--fg-muted)',
              }}>
                <span style={{ position: 'relative', display: 'flex' }}>
                  <Icon name={it.icon} size={19} />
                  {it.badge && (
                    <span style={{ position: 'absolute', top: -5, right: -8, minWidth: 15, height: 15, padding: '0 4px', borderRadius: 8,
                      background: 'var(--accent)', color: '#fff', fontSize: 9.5, fontWeight: 700, fontFamily: 'var(--mono-font)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid var(--surface)' }}>{it.badge}</span>
                  )}
                </span>
                <span style={{ fontSize: 13.5, fontWeight: isActive ? 600 : 500, color: isActive ? 'var(--fg)' : 'var(--fg-muted)', fontFamily: 'var(--ui-font)' }}>{it.label}</span>
              </a>
            );
          })}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'stretch' }}>
        {visible.map((it) => <BottomTab key={it.id} it={it} isActive={it.id === active} />)}
        {overflow.length > 0 && (
          <button onClick={() => setOpenMore((v) => !v)} aria-label="More tabs" aria-expanded={openMore} style={{
            position: 'relative', flex: 1, minWidth: 0, border: 'none', background: 'transparent', cursor: 'pointer',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4,
            padding: '9px 4px 8px', minHeight: 56, fontFamily: 'var(--ui-font)',
            color: (openMore || overflowActive) ? 'var(--accent)' : 'var(--fg-muted)',
          }}>
            <span style={{ display: 'flex' }}><Icon name="more" size={21} /></span>
            <span style={{ fontSize: 10.5, fontWeight: (openMore || overflowActive) ? 600 : 500, whiteSpace: 'nowrap' }}>More</span>
          </button>
        )}
      </div>
    </nav>
  );
}

// ── Ingest Sources modal — shared across Sources + Home ─────────────────────
function ingBtnGhost() { return { display: 'inline-flex', alignItems: 'center', gap: 6, height: 34, padding: '0 13px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--fg-muted)', fontFamily: 'var(--ui-font)', fontSize: 13, fontWeight: 500, cursor: 'pointer' }; }
function ingBtnPrimary() { return { display: 'inline-flex', alignItems: 'center', gap: 6, height: 34, padding: '0 14px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', fontFamily: 'var(--ui-font)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }; }
function ingInput() { return { width: '100%', height: 34, padding: '0 11px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--fg)', fontFamily: 'var(--ui-font)', fontSize: 13, outline: 'none' }; }
const INGEST_TYPE_ICON = { pdf: 'file', md: 'hash', url: 'globe', txt: 'file', img: 'image', code: 'code', audio: 'sparkles' };
const PROJECT_OPTS = ['default', 'research-q3', 'launch-docs', 'archive'];
const INGEST_MODES = [
  { id: 'wiki', label: 'Wiki', icon: 'wand', desc: 'Summarise with the LLM into a clean wiki page' },
  { id: 'static', label: 'Static', icon: 'file', desc: 'Store the source as-is, no rewriting' },
  { id: 'dynamic', label: 'Dynamic', icon: 'layers', desc: 'Link a live database — refreshes on change' },
];
const INGEST_TOPICS = ['Micrographia', 'Cell theory', 'Constitutional AI', 'LLM Gateway', 'User research Q3', 'Origin of Species', 'Microscopy', 'Alignment methods', 'Web crawling', 'Q3 themes'];
const ACCESS_LEVELS = [
  { id: 'none', label: 'No access', icon: 'x' },
  { id: 'read', label: 'Read only', icon: 'file' },
  { id: 'write', label: 'Read & write', icon: 'pencil' },
  { id: 'admin', label: 'Admin', icon: 'shield' },
];
const PEOPLE_POOL = [
  { id: 'u_alice', name: 'alice', kind: 'user' }, { id: 'u_bob', name: 'bob', kind: 'user' },
  { id: 'u_carol', name: 'carol', kind: 'user' }, { id: 'u_dan', name: 'dan', kind: 'user' },
  { id: 'g_everyone', name: 'Everyone', kind: 'group' }, { id: 'g_research', name: 'Research', kind: 'group' },
  { id: 'g_eng', name: 'Engineering', kind: 'group' }, { id: 'g_design', name: 'Design', kind: 'group' },
];
const seedAccess = () => ([
  { id: 'g_everyone', name: 'Everyone', kind: 'group', level: 'none' },
  { id: 'g_research', name: 'Research', kind: 'group', level: 'write' },
  { id: 'u_alice', name: 'alice', kind: 'user', level: 'admin' },
]);

// Lightweight fixed-position popover. children is a render fn (close) => content.
function IngMenu({ trigger, width = 240, align = 'left', full = false, children }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  const [pos, setPos] = React.useState({ left: 0, top: 0 });
  React.useLayoutEffect(() => {
    if (open && ref.current) {
      const r = ref.current.getBoundingClientRect();
      let left = align === 'right' ? r.right - width : r.left;
      left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
      let top = r.bottom + 6;
      if (top + 280 > window.innerHeight) top = Math.max(8, r.top - 6 - Math.min(280, 280));
      setPos({ left, top });
    }
  }, [open]);
  const close = () => setOpen(false);
  return (
    <React.Fragment>
      <div ref={ref} onClick={() => setOpen((o) => !o)} style={{ display: full ? 'block' : 'inline-flex', width: full ? '100%' : 'auto', minWidth: 0 }}>{trigger(open)}</div>
      {open && (
        <React.Fragment>
          <div onClick={close} style={{ position: 'fixed', inset: 0, zIndex: 305 }} />
          <div style={{ position: 'fixed', left: pos.left, top: pos.top, width, zIndex: 306, background: 'var(--surface)', border: '1px solid var(--border-strong)', borderRadius: 12, boxShadow: '0 18px 50px rgba(0,0,0,0.45)', overflow: 'hidden' }}>
            {children(close)}
          </div>
        </React.Fragment>
      )}
    </React.Fragment>
  );
}
function ingPill(open, full) { return { display: 'inline-flex', alignItems: 'center', gap: 6, width: full ? '100%' : 'auto', maxWidth: '100%', height: 28, padding: '0 9px', borderRadius: 7, border: `1px solid ${open ? 'var(--accent)' : 'var(--border)'}`, background: 'var(--surface)', color: 'var(--fg)', fontFamily: 'var(--ui-font)', fontSize: 12, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap' }; }
function ingRowBtn() { return { display: 'flex', alignItems: 'center', gap: 9, width: '100%', minHeight: 34, padding: '0 9px', borderRadius: 8, border: 'none', background: 'transparent', color: 'var(--fg)', fontFamily: 'var(--ui-font)', fontSize: 12.5, cursor: 'pointer', textAlign: 'left' }; }

function IngCheck({ checked, onChange }) {
  return (
    <button onClick={(e) => { e.stopPropagation(); onChange(); }} style={{ width: 17, height: 17, flexShrink: 0, borderRadius: 5, border: `1.5px solid ${checked ? 'var(--accent)' : 'var(--border-strong)'}`, background: checked ? 'var(--accent)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0 }}>
      {checked && <Icon name="check" size={11} color="#fff" />}
    </button>
  );
}

function ProjectPicker({ value, onPick, full }) {
  return (
    <IngMenu width={224} full={full} trigger={(open) => (
      <button style={{ ...ingPill(open, full), color: value ? 'var(--fg)' : 'var(--fg-muted)' }} title={value || 'Choose vault'}>
        <Icon name="folder" size={13} color="var(--fg-muted)" />
        <span style={{ flex: full ? 1 : 'none', overflow: 'hidden', textOverflow: 'ellipsis', textAlign: 'left' }}>{value || 'Vault'}</span>
        <Icon name="chevDown" size={12} color="var(--fg-muted)" />
      </button>
    )}>
      {(close) => (
        <div style={{ padding: 6 }}>
          <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-faint)', padding: '6px 9px 4px' }}>Vault · project</div>
          {PROJECT_OPTS.map((p) => (
            <button key={p} onClick={() => { onPick(p); close(); }} style={ingRowBtn()}>
              <Icon name="folder" size={13} color="var(--fg-muted)" />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p}</span>
              {value === p && <Icon name="check" size={14} color="var(--accent)" />}
            </button>
          ))}
          <div style={{ height: 1, background: 'var(--border)', margin: '6px 0' }} />
          <button onClick={() => { onPick('new-vault'); close(); }} style={ingRowBtn()}>
            <Icon name="plus" size={13} color="var(--accent)" /><span style={{ color: 'var(--accent)', fontWeight: 600 }}>New vault…</span>
          </button>
        </div>
      )}
    </IngMenu>
  );
}

function TopicPicker({ value, suggested, onPick, full }) {
  const isAi = !!value && value === suggested;
  return (
    <IngMenu width={252} full={full} trigger={(open) => (
      <button style={{ ...ingPill(open, full), color: value ? 'var(--fg)' : 'var(--fg-muted)' }} title={value || 'Choose topic'}>
        <Icon name={isAi ? 'sparkles' : 'wiki'} size={13} color={isAi ? 'var(--accent)' : 'var(--fg-muted)'} />
        <span style={{ flex: full ? 1 : 'none', overflow: 'hidden', textOverflow: 'ellipsis', textAlign: 'left' }}>{value || 'Topic'}</span>
        <Icon name="chevDown" size={12} color="var(--fg-muted)" />
      </button>
    )}>
      {(close) => <TopicMenuBody value={value} onPick={(t) => { onPick(t); close(); }} />}
    </IngMenu>
  );
}
function TopicMenuBody({ value, onPick }) {
  const [q, setQ] = React.useState('');
  const ql = q.trim().toLowerCase();
  const list = INGEST_TOPICS.filter((t) => t.toLowerCase().includes(ql));
  const exact = INGEST_TOPICS.some((t) => t.toLowerCase() === ql);
  return (
    <div>
      <div style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, height: 32, padding: '0 9px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)' }}>
          <Icon name="search" size={14} color="var(--fg-muted)" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search topics…" style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', color: 'var(--fg)', fontSize: 12.5, fontFamily: 'var(--ui-font)' }} />
        </div>
      </div>
      <div style={{ maxHeight: 240, overflowY: 'auto', padding: 6 }}>
        {!exact && (
          <button onClick={() => onPick(q.trim() || 'New topic')} style={ingRowBtn()}>
            <Icon name="plus" size={14} color="var(--accent)" />
            <span style={{ color: 'var(--accent)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{q.trim() ? `Create “${q.trim()}”` : 'Create new topic'}</span>
          </button>
        )}
        {list.map((t) => (
          <button key={t} onClick={() => onPick(t)} style={ingRowBtn()}>
            <Icon name="wiki" size={13} color="var(--fg-muted)" />
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t}</span>
            {value === t && <Icon name="check" size={14} color="var(--accent)" />}
          </button>
        ))}
        {!list.length && <div style={{ padding: '10px 8px', fontSize: 12, color: 'var(--fg-faint)' }}>No topic matches “{q.trim()}”.</div>}
      </div>
    </div>
  );
}

function ModePicker({ value, onPick, full }) {
  const m = INGEST_MODES.find((x) => x.id === value);
  return (
    <IngMenu width={268} align="right" full={full} trigger={(open) => (
      <button style={{ ...ingPill(open, full), color: m ? 'var(--fg)' : 'var(--fg-muted)' }} title={m ? m.desc : 'Ingestion mode'}>
        <Icon name={m ? m.icon : 'sliders'} size={13} color={m ? 'var(--accent)' : 'var(--fg-muted)'} />
        <span style={{ flex: full ? 1 : 'none', overflow: 'hidden', textOverflow: 'ellipsis', textAlign: 'left' }}>{m ? m.label : 'Mode'}</span>
        <Icon name="chevDown" size={12} color="var(--fg-muted)" />
      </button>
    )}>
      {(close) => (
        <div style={{ padding: 6 }}>
          {INGEST_MODES.map((o) => (
            <button key={o.id} onClick={() => { onPick(o.id); close(); }} style={{ ...ingRowBtn(), alignItems: 'flex-start', padding: '9px' }}>
              <Icon name={o.icon} size={15} color={value === o.id ? 'var(--accent)' : 'var(--fg-muted)'} />
              <span style={{ flex: 1 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><b style={{ fontWeight: 600 }}>{o.label}</b>{value === o.id && <Icon name="check" size={13} color="var(--accent)" />}</span>
                <span style={{ display: 'block', fontSize: 11, color: 'var(--fg-muted)', marginTop: 2, lineHeight: 1.4 }}>{o.desc}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </IngMenu>
  );
}

function IngestRow({ r, selected, onToggle, onChange, onRemove }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 12px', borderBottom: '1px solid var(--border)', background: selected ? 'var(--accent-soft)' : 'transparent' }}>
      <IngCheck checked={selected} onChange={onToggle} />
      <span style={{ width: 26, height: 26, flexShrink: 0, borderRadius: 7, background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--fg-muted)' }}><Icon name={INGEST_TYPE_ICON[r.type] || 'file'} size={14} /></span>
      <div style={{ flex: 1, minWidth: 80 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--fg)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.kind === 'url' ? r.url : r.name}</div>
        <div style={{ fontSize: 10.5, color: 'var(--fg-faint)', fontFamily: 'var(--mono-font)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {r.kind === 'url' ? 'web page' : `${r.type} · ${r.size}`}{r.collision && <span style={{ color: 'var(--warning)' }}> · topic exists</span>}
        </div>
      </div>
      <div style={{ flexShrink: 0, width: 124, minWidth: 0 }}><ProjectPicker value={r.project} onPick={(v) => onChange({ project: v })} full /></div>
      <div style={{ flexShrink: 0, width: 150, minWidth: 0 }}><TopicPicker value={r.topic} suggested={r.suggestedTopic} onPick={(v) => onChange({ topic: v })} full /></div>
      <div style={{ flexShrink: 0, width: 104, minWidth: 0 }}><ModePicker value={r.mode} onPick={(v) => onChange({ mode: v })} full /></div>
      <button onClick={onRemove} style={{ width: 26, height: 26, flexShrink: 0, borderRadius: 7, border: '1px solid var(--border)', background: 'transparent', color: 'var(--fg-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="x" size={13} /></button>
    </div>
  );
}

function IngestQueueBar({ total, selCount, allSel, onToggleAll, onBulk, onClearSel, onRemoveSel }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 12px', borderBottom: '1px solid var(--border)', background: 'var(--surface-2)', minHeight: 46, flexWrap: 'wrap' }}>
      <IngCheck checked={allSel} onChange={onToggleAll} />
      {selCount > 0 ? (
        <React.Fragment>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg)', whiteSpace: 'nowrap' }}>{selCount} selected</span>
          <button onClick={onClearSel} style={{ border: 'none', background: 'transparent', color: 'var(--fg-muted)', fontSize: 11.5, cursor: 'pointer', fontFamily: 'var(--ui-font)' }}>clear</button>
          <span style={{ width: 1, height: 18, background: 'var(--border-strong)' }} />
          <span style={{ fontSize: 11.5, color: 'var(--fg-muted)', whiteSpace: 'nowrap' }}>Set for all:</span>
          <ProjectPicker value={null} onPick={(v) => onBulk({ project: v })} />
          <TopicPicker value={null} suggested={null} onPick={(v) => onBulk({ topic: v })} />
          <ModePicker value={null} onPick={(v) => onBulk({ mode: v })} />
          <button onClick={onRemoveSel} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 28, padding: '0 9px', borderRadius: 7, border: '1px solid var(--border)', background: 'transparent', color: 'var(--destructive)', fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'var(--ui-font)', marginLeft: 'auto' }}><Icon name="trash" size={13} /> Remove</button>
        </React.Fragment>
      ) : (
        <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{total} item{total === 1 ? '' : 's'} queued · select rows to bulk-set vault, topic or mode</span>
      )}
    </div>
  );
}

function VaultAccess({ vaults, accessFor, onLevel, onAdd, onRemove }) {
  const [active, setActive] = React.useState(vaults[0]);
  React.useEffect(() => { if (!vaults.includes(active)) setActive(vaults[0]); }, [vaults.join('|')]);
  const av = vaults.includes(active) ? active : vaults[0];
  const members = accessFor(av);
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 11.5, color: 'var(--fg-muted)', display: 'flex', alignItems: 'flex-start', gap: 6, marginBottom: 10, lineHeight: 1.45 }}>
        <Icon name="key" size={13} color="var(--fg-faint)" /> <span>1 vault = 1 project · 1 topic = 1 wiki page · vaults are isolated, with no cross-vault links, so each vault's data stays contained.</span>
      </div>
      {vaults.length > 1 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {vaults.map((v) => (
            <button key={v} onClick={() => setActive(v)} style={{ display: 'flex', alignItems: 'center', gap: 6, height: 28, padding: '0 10px', borderRadius: 7, border: `1px solid ${v === av ? 'var(--accent)' : 'var(--border)'}`, background: v === av ? 'var(--accent-soft)' : 'transparent', color: v === av ? 'var(--fg)' : 'var(--fg-muted)', fontSize: 12, fontWeight: v === av ? 600 : 500, cursor: 'pointer', fontFamily: 'var(--ui-font)' }}>
              <Icon name="folder" size={12} color={v === av ? 'var(--accent)' : 'var(--fg-muted)'} /> {v}
            </button>
          ))}
        </div>
      )}
      <div style={{ borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>
          <Icon name="folder" size={14} color="var(--fg-muted)" />
          <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--fg)' }}>{av}</span>
          <span style={{ fontSize: 11, color: 'var(--fg-faint)', fontFamily: 'var(--mono-font)' }}>{members.filter((m) => m.level !== 'none').length} with access</span>
          <span style={{ marginLeft: 'auto' }}><AddPeople members={members} onAdd={(p) => onAdd(av, p)} /></span>
        </div>
        {members.map((m) => <AccessRow key={m.id} m={m} onLevel={(l) => onLevel(av, m.id, l)} onRemove={() => onRemove(av, m.id)} />)}
      </div>
    </div>
  );
}
function AccessRow({ m, onLevel, onRemove }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
      <span style={{ width: 28, height: 28, flexShrink: 0, borderRadius: '50%', background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--fg-muted)' }}><Icon name={m.kind === 'group' ? 'users' : 'user'} size={14} /></span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--fg)' }}>{m.name}</div>
        <div style={{ fontSize: 10.5, color: 'var(--fg-faint)' }}>{m.kind === 'group' ? 'Group' : 'User'}</div>
      </div>
      <LevelPicker value={m.level} onPick={onLevel} />
      <button onClick={onRemove} style={{ width: 26, height: 26, flexShrink: 0, borderRadius: 7, border: '1px solid var(--border)', background: 'transparent', color: 'var(--fg-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="x" size={13} /></button>
    </div>
  );
}
function LevelPicker({ value, onPick }) {
  const lv = ACCESS_LEVELS.find((l) => l.id === value) || ACCESS_LEVELS[0];
  const isNone = value === 'none';
  return (
    <IngMenu width={204} align="right" trigger={(open) => (
      <button style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 28, padding: '0 9px', borderRadius: 7, border: `1px solid ${open ? 'var(--accent)' : 'var(--border)'}`, background: isNone ? 'transparent' : 'var(--surface)', color: isNone ? 'var(--fg-faint)' : 'var(--fg)', fontFamily: 'var(--ui-font)', fontSize: 12, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap' }}>
        <Icon name={lv.icon} size={12} color={value === 'admin' ? 'var(--accent)' : 'currentColor'} /> {lv.label} <Icon name="chevDown" size={12} color="var(--fg-muted)" />
      </button>
    )}>
      {(close) => (
        <div style={{ padding: 6 }}>
          {ACCESS_LEVELS.map((l) => (
            <button key={l.id} onClick={() => { onPick(l.id); close(); }} style={ingRowBtn()}>
              <Icon name={l.icon} size={13} color={l.id === 'admin' ? 'var(--accent)' : 'var(--fg-muted)'} />
              <span style={{ flex: 1 }}>{l.label}</span>
              {value === l.id && <Icon name="check" size={14} color="var(--accent)" />}
            </button>
          ))}
        </div>
      )}
    </IngMenu>
  );
}
function AddPeople({ members, onAdd }) {
  return (
    <IngMenu width={238} align="right" trigger={(open) => (
      <button style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 28, padding: '0 10px', borderRadius: 7, border: `1px solid ${open ? 'var(--accent)' : 'var(--border)'}`, background: 'transparent', color: 'var(--accent)', fontFamily: 'var(--ui-font)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
        <Icon name="plus" size={13} color="var(--accent)" /> Add people
      </button>
    )}>
      {(close) => <AddPeopleBody members={members} onAdd={(p) => { onAdd(p); close(); }} />}
    </IngMenu>
  );
}
function AddPeopleBody({ members, onAdd }) {
  const [q, setQ] = React.useState('');
  const have = new Set(members.map((m) => m.id));
  const ql = q.trim().toLowerCase();
  const list = PEOPLE_POOL.filter((p) => !have.has(p.id) && p.name.toLowerCase().includes(ql));
  return (
    <div>
      <div style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, height: 32, padding: '0 9px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)' }}>
          <Icon name="search" size={14} color="var(--fg-muted)" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="People or groups…" style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', color: 'var(--fg)', fontSize: 12.5, fontFamily: 'var(--ui-font)' }} />
        </div>
      </div>
      <div style={{ maxHeight: 220, overflowY: 'auto', padding: 6 }}>
        {list.map((p) => (
          <button key={p.id} onClick={() => onAdd(p)} style={ingRowBtn()}>
            <Icon name={p.kind === 'group' ? 'users' : 'user'} size={13} color="var(--fg-muted)" />
            <span style={{ flex: 1 }}>{p.name}</span>
            <span style={{ fontSize: 10.5, color: 'var(--fg-faint)' }}>{p.kind}</span>
          </button>
        ))}
        {!list.length && <div style={{ padding: '10px 8px', fontSize: 12, color: 'var(--fg-faint)' }}>{ql ? `Invite “${q.trim()}” by email` : 'Everyone already added.'}</div>}
      </div>
    </div>
  );
}

function IngestModal({ open, onClose, files = [], defaultTab = 'files', project = 'default' }) {
  const norm = (f, i) => {
    const isUrl = f.kind === 'url' || f.type === 'url' || (!!f.url && !f.type);
    return {
      id: f.id || 'q' + i + '_' + (f.name || f.url || ''),
      kind: isUrl ? 'url' : 'file',
      name: f.name || f.url || 'untitled',
      type: f.type || (isUrl ? 'url' : 'file'),
      size: f.size || '—',
      url: f.url || (isUrl ? f.name : undefined),
      project: f.project || project,
      suggestedTopic: f.suggestedTopic || f.topic || '',
      topic: f.topic || f.suggestedTopic || '',
      mode: f.mode || 'wiki',
      collision: !!f.collision,
    };
  };
  const seedRows = () => {
    const base = files.map(norm);
    // One queue for files AND links — combined upload + URL.
    base.push(norm({ kind: 'url', name: 'https://en.wikipedia.org/wiki/Cell_theory', topic: 'Cell theory', collision: true }, base.length));
    return base;
  };
  const [rows, setRows] = React.useState(seedRows);
  const [sel, setSel] = React.useState(() => new Set());
  const [draft, setDraft] = React.useState('');
  const [access, setAccess] = React.useState({});
  const [showAccess, setShowAccess] = React.useState(true);
  React.useEffect(() => { if (open) { setRows(seedRows()); setSel(new Set()); } }, [open]);
  React.useEffect(() => {
    if (!open) return;
    const k = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [open, onClose]);
  if (!open) return null;

  const addUrl = () => {
    const v = draft.trim();
    if (!v) return;
    let host = v;
    try { host = new URL(v.match(/^https?:\/\//) ? v : 'https://' + v).hostname.replace(/^www\./, ''); } catch (e) {}
    setRows((rs) => [...rs, { id: 'u' + Date.now(), kind: 'url', name: v, url: v, type: 'url', size: '—', project, suggestedTopic: host, topic: host, mode: 'wiki' }]);
    setDraft('');
  };
  const addMockFile = () => {
    const samples = [['field-notes.pdf', 'pdf', '2.3 MB', 'Field notes'], ['sales-2026.csv', 'file', '5.1 MB', 'Sales 2026'], ['onboarding.md', 'md', '8 KB', 'Onboarding']];
    const s = samples[Math.floor(Math.random() * samples.length)];
    setRows((rs) => [...rs, { id: 'f' + Date.now(), kind: 'file', name: s[0], type: s[1], size: s[2], project, suggestedTopic: s[3], topic: s[3], mode: 'wiki' }]);
  };

  const ids = rows.map((r) => r.id);
  const allSel = ids.length > 0 && ids.every((id) => sel.has(id));
  const toggle = (id) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setSel(allSel ? new Set() : new Set(ids));
  const patch = (id, p) => setRows((rs) => rs.map((r) => r.id === id ? { ...r, ...p } : r));
  const bulk = (p) => setRows((rs) => rs.map((r) => sel.has(r.id) ? { ...r, ...p } : r));
  const removeRow = (id) => { setRows((rs) => rs.filter((r) => r.id !== id)); setSel((s) => { const n = new Set(s); n.delete(id); return n; }); };
  const removeSel = () => { setRows((rs) => rs.filter((r) => !sel.has(r.id))); setSel(new Set()); };

  const vaults = [...new Set(rows.map((r) => r.project))];
  const accessFor = (v) => access[v] || seedAccess();
  const setLevel = (v, id, level) => setAccess((a) => { const cur = a[v] || seedAccess(); return { ...a, [v]: cur.map((m) => m.id === id ? { ...m, level } : m) }; });
  const addMember = (v, p) => setAccess((a) => { const cur = a[v] || seedAccess(); if (cur.some((m) => m.id === p.id)) return a; return { ...a, [v]: [...cur, { ...p, level: 'read' }] }; });
  const rmMember = (v, id) => setAccess((a) => { const cur = a[v] || seedAccess(); return { ...a, [v]: cur.filter((m) => m.id !== id) }; });
  const selCount = sel.size;

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(8,9,12,0.55)', backdropFilter: 'blur(3px)', WebkitBackdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 880, maxWidth: '100%', maxHeight: '90vh', display: 'flex', flexDirection: 'column', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, boxShadow: '0 24px 80px rgba(0,0,0,0.5)', overflow: 'hidden' }}>
        {/* header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 20px 14px', borderBottom: '1px solid var(--border)' }}>
          <Icon name="download" size={18} color="var(--accent)" />
          <span style={{ fontFamily: 'var(--display-font)', fontSize: 16, fontWeight: 600, color: 'var(--fg)' }}>Ingest sources</span>
          <span style={{ marginLeft: 'auto' }}><button onClick={onClose} style={{ width: 30, height: 30, borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--fg-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="x" size={15} /></button></span>
        </div>
        {/* body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* combined add area — files + URL in one place */}
          <div style={{ borderRadius: 12, border: '1.5px dashed var(--border-strong)', background: 'var(--bg)', padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ width: 38, height: 38, borderRadius: 11, flexShrink: 0, background: 'var(--accent-soft)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="download" size={19} /></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--fg)' }}>Drag files here, or <button onClick={addMockFile} style={{ border: 'none', background: 'transparent', color: 'var(--accent)', fontWeight: 600, fontSize: 13.5, fontFamily: 'var(--ui-font)', cursor: 'pointer', padding: 0 }}>browse</button></div>
                <div style={{ fontSize: 11.5, color: 'var(--fg-muted)' }}>PDF · Markdown · text · images · code — or paste a link below</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 9, height: 36, padding: '0 11px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)' }}>
                <Icon name="globe" size={15} color="var(--fg-muted)" />
                <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addUrl(); }} placeholder="https://…  paste a page or sitemap URL" style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', color: 'var(--fg)', fontSize: 13, fontFamily: 'var(--ui-font)' }} />
              </div>
              <button onClick={addUrl} style={ingBtnGhost()}><Icon name="plus" size={14} /> Add link</button>
            </div>
          </div>

          {/* queue */}
          <div style={{ borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg)' }}>
            <IngestQueueBar total={rows.length} selCount={selCount} allSel={allSel} onToggleAll={toggleAll} onBulk={bulk} onClearSel={() => setSel(new Set())} onRemoveSel={removeSel} />
            <div>
              {rows.map((r) => <IngestRow key={r.id} r={r} selected={sel.has(r.id)} onToggle={() => toggle(r.id)} onChange={(p) => patch(r.id, p)} onRemove={() => removeRow(r.id)} />)}
              {!rows.length && <div style={{ textAlign: 'center', color: 'var(--fg-faint)', padding: '26px 0', fontSize: 12.5 }}>Nothing queued — drop files or paste a link above.</div>}
            </div>
          </div>

          {/* access management */}
          {vaults.length > 0 && (
            <div style={{ borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg)', padding: 14 }}>
              <button onClick={() => setShowAccess((v) => !v)} style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', border: 'none', background: 'transparent', cursor: 'pointer', padding: 0, textAlign: 'left' }}>
                <Icon name="shield" size={16} color="var(--accent)" />
                <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--fg)' }}>Vault access</span>
                <span style={{ fontSize: 11, color: 'var(--fg-faint)', fontFamily: 'var(--mono-font)' }}>{vaults.length} vault{vaults.length > 1 ? 's' : ''}</span>
                <span style={{ marginLeft: 'auto', transform: showAccess ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform .12s', display: 'flex' }}><Icon name="chevDown" size={15} color="var(--fg-muted)" /></span>
              </button>
              {showAccess && <VaultAccess vaults={vaults} accessFor={accessFor} onLevel={setLevel} onAdd={addMember} onRemove={rmMember} />}
            </div>
          )}
        </div>
        {/* footer */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 20px', borderTop: '1px solid var(--border)' }}>
          <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{rows.length} item{rows.length === 1 ? '' : 's'} → <b style={{ color: 'var(--fg)' }}>{vaults.length}</b> vault{vaults.length === 1 ? '' : 's'}</span>
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button onClick={onClose} style={ingBtnGhost()}>Cancel</button>
            <button onClick={onClose} style={{ ...ingBtnPrimary(), opacity: rows.length ? 1 : 0.5 }}><Icon name="download" size={14} color="#fff" /> Ingest{rows.length ? ` ${rows.length}` : ''}</button>
          </span>
        </div>
      </div>
    </div>
  );
}

// ── small style helpers ───────────────────────────────────────────────────
function pillBtn() {
  return { display: 'flex', alignItems: 'center', gap: 7, height: 30, padding: '0 11px', borderRadius: 8,
    border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', fontFamily: 'var(--ui-font)', fontSize: 12.5 };
}
function iconBtn() {
  return { width: 33, height: 33, borderRadius: 8, border: '1px solid var(--border)', background: 'transparent',
    display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' };
}
function kbdStyle() {
  return { fontFamily: 'var(--mono-font)', fontSize: 11, color: 'var(--fg-muted)', border: '1px solid var(--border)',
    borderRadius: 5, padding: '1px 5px', background: 'var(--surface)' };
}

Object.assign(window, { Icon, ICONS, StatusDot, STATUS, TopBar, LeftRail, BottomNav, pillBtn, iconBtn, kbdStyle, IngestModal, Popover, inboxItems, useInboxRead, INBOX_TONE });
