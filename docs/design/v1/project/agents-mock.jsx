/* Brain2 Console — Agents rework: DESIGN PROPOSAL (static mockups).
   Presentational only. Reuses Icon / StatusDot from components.jsx + tokens.js. */

const MOCK_THEME = getTokens('dark', 'indigo', 'inter');

// ── tiny local primitives (kept independent of chat.jsx / settings.jsx) ───────
const AV_TINT = ['#7C8CFF', '#34D399', '#F59E0B', '#A78BFA', '#F472B6', '#38BDF8', '#FB7185', '#2DD4BF'];
function Av({ name, size = 30 }) {
  let h = 0; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
  const c = AV_TINT[h % AV_TINT.length];
  return (
    <span style={{ width: size, height: size, flexShrink: 0, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.42, fontWeight: 700, color: c, background: hexToRgba(c, 0.16), fontFamily: 'var(--ui-font)' }}>{name[0].toUpperCase()}</span>
  );
}
function agBtnPrimary() { return { display: 'inline-flex', alignItems: 'center', gap: 7, height: 34, padding: '0 14px', borderRadius: 9, border: 'none', background: 'var(--accent)', color: '#fff', fontFamily: 'var(--ui-font)', fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }; }
function agBtnGhost() { return { display: 'inline-flex', alignItems: 'center', gap: 7, height: 34, padding: '0 13px', borderRadius: 9, border: '1px solid var(--border)', background: 'transparent', color: 'var(--fg)', fontFamily: 'var(--ui-font)', fontSize: 13, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap' }; }
function agChip(tone) {
  const c = tone || 'var(--fg-muted)';
  return { display: 'inline-flex', alignItems: 'center', gap: 5, height: 22, padding: '0 8px', borderRadius: 6, fontFamily: 'var(--mono-font)', fontSize: 11, fontWeight: 500, color: c, background: 'var(--surface-2)', whiteSpace: 'nowrap' };
}
function AccessTag({ user, level }) {
  return (
    <span title={`Runs with ${user}'s access`} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 21, padding: '0 7px 0 6px', borderRadius: 6, background: 'var(--accent-soft)', color: 'var(--accent)', fontSize: 11, fontWeight: 600, fontFamily: 'var(--ui-font)' }}>
      <Icon name="lock" size={11} color="var(--accent)" /> {level}
    </span>
  );
}

// ── shared static chrome ──────────────────────────────────────────────────────
function StaticTopBar() {
  return (
    <header style={{ height: 52, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 16, padding: '0 18px', borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <div style={{ width: 22, height: 22, borderRadius: 6, background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ width: 9, height: 9, background: 'var(--surface)', borderRadius: 2, transform: 'rotate(45deg)' }} />
        </div>
        <span style={{ fontFamily: 'var(--display-font)', fontWeight: 700, fontSize: 15, letterSpacing: 'var(--display-track)', color: 'var(--fg)' }}>Brain2</span>
      </div>
      <button style={{ ...pillBtn(), color: 'var(--fg-muted)' }}><span>workspace</span><span style={{ color: 'var(--fg)', fontWeight: 500 }}>default</span><Icon name="chevDown" size={13} color="var(--fg-muted)" /></button>
      <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: 380, maxWidth: '46%', height: 33, padding: '0 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--fg-muted)', fontSize: 13 }}>
          <Icon name="search" size={15} /><span style={{ flex: 1 }}>Search…</span><kbd style={kbdStyle()}>⌘K</kbd>
        </div>
      </div>
      <div style={{ ...iconBtn() }}><Icon name="bell" size={16} color="var(--fg-muted)" /></div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 4px', borderRadius: 999, border: '1px solid var(--border)' }}>
        <span style={{ width: 26, height: 26, borderRadius: '50%', background: 'var(--accent-soft)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600 }}>A</span>
        <span style={{ fontSize: 13, color: 'var(--fg)', fontWeight: 500, paddingRight: 4 }}>alice</span>
      </div>
    </header>
  );
}

function MockRail({ active = 'agents' }) {
  const items = [
    { id: 'home', icon: 'home' }, { id: 'sources', icon: 'sources' }, { id: 'wiki', icon: 'wiki' },
    { id: 'agents', icon: 'chats', badge: 3 }, { id: 'reports', icon: 'file' }, { id: 'plugins', icon: 'plug' },
  ];
  const Row = ({ it, on }) => (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', height: 40, borderRadius: 9, background: on ? 'var(--accent-soft)' : 'transparent', color: on ? 'var(--accent)' : 'var(--fg-muted)' }}>
      {on && <span style={{ position: 'absolute', left: -8, top: 9, bottom: 9, width: 2.5, borderRadius: 2, background: 'var(--accent)' }} />}
      <Icon name={it.icon} size={19} />
      {it.badge && <span style={{ position: 'absolute', right: 10, top: 8, minWidth: 17, height: 17, padding: '0 5px', borderRadius: 9, background: 'var(--accent)', color: '#fff', fontSize: 10.5, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--mono-font)' }}>{it.badge}</span>}
    </div>
  );
  return (
    <nav style={{ width: 64, flexShrink: 0, borderRight: '1px solid var(--border)', background: 'var(--surface)', display: 'flex', flexDirection: 'column', padding: '12px 8px', gap: 3 }}>
      {items.map((it) => <Row key={it.id} it={it} on={it.id === active} />)}
      <div style={{ height: 1, background: 'var(--border)', margin: '8px 6px' }} />
      <Row it={{ id: 'settings', icon: 'settings' }} on={active === 'settings'} />
    </nav>
  );
}

function AppFrame({ active, children, h = 824 }) {
  return (
    <div style={{ ...MOCK_THEME, height: h, display: 'flex', flexDirection: 'column', background: 'var(--bg)', color: 'var(--fg)', fontFamily: 'var(--ui-font)', fontSize: 14, borderRadius: 14, overflow: 'hidden', border: '1px solid var(--border-strong)', boxShadow: '0 24px 70px rgba(0,0,0,0.5)' }}>
      <StaticTopBar />
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <MockRail active={active} />
        {children}
      </div>
    </div>
  );
}

// ── data ──────────────────────────────────────────────────────────────────────
const AGENTS = [
  { u: 'jarvis', name: 'Jarvis', status: 'active', model: 'Claude Sonnet 4.5', loc: 'cloud', task: 'Audit the Cell theory page for unsupported claims', by: 'alice', elapsed: '0:42' },
  { u: 'steve', name: 'Steve', status: 'active', model: 'llama3.3 · 70B', loc: 'workstation-1', task: 'Summarise the research-q3 sources into a digest', by: 'bob', elapsed: '2:10' },
  { u: 'marvin', name: 'Marvin', status: 'active', model: 'qwen2.5 · 32B', loc: 'gpu-box', task: 'Re-crawl tracked sources, flag changed pages', by: 'carol', elapsed: '0:08' },
  { u: 'ada', name: 'Ada', status: 'idle', model: null },
  { u: 'hal', name: 'Hal', status: 'idle', model: null },
  { u: 'friday', name: 'Friday', status: 'error', model: null, note: 'offline' },
];

const RUNNING = AGENTS.filter((a) => a.status === 'active').map((a) => ({
  title: a.task, by: a.by, access: a.by === 'alice' ? 'admin' : a.by === 'bob' ? 'read · research-q3' : 'write',
  agent: a, model: a.model, loc: a.loc, elapsed: a.elapsed, tok: a.loc === 'cloud' ? '1.8k tok' : 'local',
}));
const QUEUED = [
  { title: 'Draft replies to the 7 waiting customer queries', by: 'alice', access: 'admin', model: 'any local model', wait: 'cuts the queue', cloud: false, priority: true },
  { title: 'Rewrite the Origins section per the new source', by: 'dan', access: 'write · default', model: 'auto', wait: 'waiting for a free agent', cloud: false },
  { title: 'Compile the weekly exec digest and email it', by: 'alice', access: 'admin', model: 'Claude Sonnet 4.5 · cloud', wait: 'starts now', cloud: true },
];
const DONE = [
  { title: 'Find every page that cites “Hooke 1665”', by: 'alice', agent: 'Jarvis', model: 'Claude Sonnet 4.5', when: '14m ago', tok: '920 tok' },
  { title: 'Tighten the Microscopy introduction', by: 'carol', agent: 'Ada', model: 'llama3.3 · 70B', when: '1h ago', tok: 'local' },
  { title: 'Where are mitochondria described in the wiki?', by: 'bob', agent: 'Steve', model: 'qwen2.5 · 32B', when: '3h ago', tok: '1,240 tok' },
];

// ── Agent roster card ─────────────────────────────────────────────────────────
function RosterCard({ a }) {
  const working = a.status === 'active';
  const off = a.status === 'error';
  return (
    <div style={{ width: 248, flexShrink: 0, border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface)', padding: 13, display: 'flex', flexDirection: 'column', gap: 10, opacity: off ? 0.6 : 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <span style={{ position: 'relative' }}>
          <Av name={a.name} size={34} />
          <span style={{ position: 'absolute', right: -1, bottom: -1, width: 11, height: 11, borderRadius: '50%', border: '2px solid var(--surface)', background: working ? 'var(--success)' : off ? 'var(--destructive)' : 'var(--fg-faint)' }} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)' }}>{a.name}</div>
          <div style={{ fontSize: 11.5, color: working ? 'var(--success)' : 'var(--fg-muted)', display: 'flex', alignItems: 'center', gap: 5 }}>
            {working ? <><span className="b2-spin" style={{ display: 'flex' }}><Icon name="loader" size={11} color="var(--success)" /></span> Working</> : off ? 'Offline' : 'Idle · free'}
          </div>
        </div>
        <Icon name="more" size={16} color="var(--fg-faint)" />
      </div>
      {working ? (
        <>
          <div style={{ fontSize: 12.5, color: 'var(--fg)', lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', minHeight: 34 }}>{a.task}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={agChip(a.loc === 'cloud' ? 'var(--accent)' : 'var(--fg-muted)')}><Icon name={a.loc === 'cloud' ? 'cloud' : 'cpu'} size={11} /> {a.model}</span>
            <span style={{ fontSize: 11, color: 'var(--fg-faint)', fontFamily: 'var(--mono-font)' }}>{a.elapsed}</span>
            <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--fg-muted)' }}><Av name={a.by} size={16} /> {a.by}</span>
          </div>
        </>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, minHeight: 60, color: 'var(--fg-faint)', fontSize: 12, border: '1px dashed var(--border)', borderRadius: 9, background: 'var(--bg)' }}>
          {off ? <><Icon name="alert" size={14} /> Reconnect runtime</> : <><Icon name="clock" size={14} /> Waiting for the queue</>}
        </div>
      )}
    </div>
  );
}

// ── row overflow menu + priority flag ────────────────────────────────────────
function PriorityBadge() {
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 19, padding: '0 6px', borderRadius: 5, background: 'var(--warning-soft)', color: 'var(--warning)', fontSize: 10, fontWeight: 700, letterSpacing: '0.03em', flexShrink: 0 }}><Icon name="zap" size={10} color="var(--warning)" /> HIGH</span>;
}
function DotsMenu({ items, open }) {
  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <button style={{ width: 30, height: 30, borderRadius: 8, border: '1px solid ' + (open ? 'var(--border-strong)' : 'transparent'), background: open ? 'var(--surface-2)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }} title="More actions"><Icon name="more" size={16} color="var(--fg-muted)" /></button>
      {open && (
        <div style={{ position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 60, width: 238, background: 'var(--surface)', border: '1px solid var(--border-strong)', borderRadius: 11, boxShadow: '0 18px 50px rgba(0,0,0,0.5)', padding: 6 }}>
          {items.map((it, i) => (
            <React.Fragment key={i}>
              {it.divider && <div style={{ height: 1, background: 'var(--border)', margin: '5px 4px' }} />}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 9px', borderRadius: 8, fontSize: 12.5, fontWeight: 500, color: it.danger ? 'var(--destructive)' : 'var(--fg)' }}>
                <Icon name={it.icon} size={14} color={it.danger ? 'var(--destructive)' : 'var(--fg-muted)'} /> {it.label}
              </div>
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
}
const ROW_MENUS = {
  running: [{ icon: 'history', label: 'Open conversation' }, { icon: 'users', label: 'Reassign agent' }, { divider: true, icon: 'repeat', label: 'Stop task and re-queue', danger: true }],
  queued: [{ icon: 'zap', label: 'Mark high priority' }, { icon: 'pencil', label: 'Edit todo' }, { divider: true, icon: 'trash', label: 'Stop task and re-queue', danger: true }],
  done: [{ icon: 'history', label: 'Open conversation' }, { icon: 'send', label: 'Continue task' }, { icon: 'refresh', label: 'Re-run as new todo' }, { divider: true, icon: 'trash', label: 'Delete transcript', danger: true }],
};

// ── A todo row (unified list) ─────────────────────────────────────────────────
function TodoRow({ t, kind, menuOpen }) {
  const ICON = { running: { name: 'loader', spin: true, c: 'var(--success)' }, queued: { name: 'clock', c: 'var(--fg-muted)' }, done: { name: 'check', c: 'var(--success)' } }[kind];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '13px 14px 13px 14px', borderBottom: '1px solid var(--border)', cursor: 'pointer', background: t.priority ? 'var(--warning-soft)' : 'transparent', borderLeft: '2px solid ' + (t.priority ? 'var(--warning)' : 'transparent') }}>
      <span style={{ width: 22, display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
        {ICON.spin ? <span className="b2-spin" style={{ display: 'flex' }}><Icon name={ICON.name} size={16} color={ICON.c} /></span> : <Icon name={ICON.name} size={16} color={ICON.c} />}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {t.priority && <PriorityBadge />}
          <span style={{ fontSize: 13.5, fontWeight: 600, color: kind === 'done' ? 'var(--fg-muted)' : 'var(--fg)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.title}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 5, flexWrap: 'wrap' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11.5, color: 'var(--fg-muted)' }}><Av name={t.by} size={16} /> {t.by}</span>
          <AccessTag user={t.by} level={t.access || 'read'} />
          <span style={agChip(t.cloud ? 'var(--accent)' : 'var(--fg-muted)')}><Icon name={t.cloud ? 'cloud' : 'cpu'} size={11} /> {t.model}</span>
          {kind === 'queued' && <span style={{ fontSize: 11.5, color: t.cloud ? 'var(--accent)' : 'var(--fg-faint)', display: 'flex', alignItems: 'center', gap: 4 }}>· {t.wait}</span>}
        </div>
      </div>
      {kind === 'running' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--fg)' }}><Av name={t.agent.name} size={20} /> {t.agent.name}</span>
          <span style={{ fontSize: 11.5, color: 'var(--fg-muted)', fontFamily: 'var(--mono-font)', width: 38, textAlign: 'right' }}>{t.elapsed}</span>
        </div>
      )}
      {kind === 'done' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <span title="Conversation archived; KV cache flushed from RAM" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 22, padding: '0 8px', borderRadius: 6, fontSize: 11, fontWeight: 500, color: 'var(--fg-muted)', background: 'var(--surface-2)', fontFamily: 'var(--ui-font)' }}><Icon name="cpu" size={11} /> memory flushed</span>
          <span style={{ fontSize: 11.5, color: 'var(--fg-faint)', fontFamily: 'var(--mono-font)' }}>{t.when}</span>
          <span style={{ fontSize: 11.5, color: 'var(--fg-faint)', fontFamily: 'var(--mono-font)', width: 64, textAlign: 'right' }}>{t.tok}</span>
        </div>
      )}
      <DotsMenu items={ROW_MENUS[kind]} open={menuOpen} />
    </div>
  );
}

function GroupHead({ icon, label, n, tone, note }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '11px 16px', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}>
      <Icon name={icon} size={14} color={tone || 'var(--fg-muted)'} />
      <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--fg)' }}>{label}</span>
      <span style={{ fontSize: 11, fontFamily: 'var(--mono-font)', color: 'var(--fg-muted)', background: 'var(--surface-3)', borderRadius: 6, padding: '1px 7px' }}>{n}</span>
      {note && <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--fg-faint)' }}>{note}</span>}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// DIRECTION A — Roster + unified queue
// ════════════════════════════════════════════════════════════════════════════
function DirectionA() {
  const freeN = AGENTS.filter((a) => a.status === 'idle').length;
  return (
    <AppFrame active="agents">
      <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg)' }}>
        {/* page header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '18px 24px 14px', flexShrink: 0 }}>
          <div style={{ flex: 1 }}>
            <h1 style={{ margin: 0, fontFamily: 'var(--display-font)', fontSize: 23, fontWeight: 700, letterSpacing: 'var(--display-track)', color: 'var(--fg)' }}>Agents</h1>
            <div style={{ fontSize: 13, color: 'var(--fg-muted)', marginTop: 3 }}>A shared queue. Free agents pick up the next todo and run it with the requester’s access.</div>
          </div>
          <button style={agBtnGhost()}><Icon name="cpu" size={15} color="var(--fg-muted)" /> Manage models</button>
          <button style={agBtnPrimary()}><Icon name="plus" size={15} color="#fff" /> Add a todo</button>
        </div>

        {/* roster strip */}
        <div style={{ flexShrink: 0, padding: '4px 24px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--fg-faint)' }}>Agents</span>
            <span style={{ fontSize: 11.5, color: 'var(--fg-muted)' }}>{AGENTS.length} total · {freeN} free</span>
          </div>
          <div style={{ display: 'flex', gap: 12, overflow: 'hidden' }}>
            {AGENTS.slice(0, 4).map((a) => <RosterCard key={a.u} a={a} />)}
            <div style={{ width: 96, flexShrink: 0, border: '1px dashed var(--border)', borderRadius: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, color: 'var(--fg-muted)' }}>
              <Icon name="plus" size={18} /><span style={{ fontSize: 11.5 }}>+2 more</span>
            </div>
          </div>
        </div>

        {/* queue list */}
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 24px 24px' }}>
          <div style={{ border: '1px solid var(--border)', borderRadius: 13, overflow: 'visible', background: 'var(--surface)' }}>
            {/* toolbar */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 16px', borderBottom: '1px solid var(--border)' }}>
              <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--fg)' }}>Shared todo list</span>
              <div style={{ display: 'flex', gap: 3, padding: 3, background: 'var(--surface-2)', borderRadius: 9, marginLeft: 6 }}>
                {[['All', 9], ['Running', 3], ['Queued', 3], ['Done', 3]].map(([l, n], i) => (
                  <span key={l} style={{ display: 'flex', alignItems: 'center', gap: 6, height: 27, padding: '0 11px', borderRadius: 7, fontSize: 12, fontWeight: i === 0 ? 600 : 500, background: i === 0 ? 'var(--surface)' : 'transparent', color: i === 0 ? 'var(--fg)' : 'var(--fg-muted)', boxShadow: i === 0 ? 'var(--shadow-card)' : 'none' }}>{l}<span style={{ fontSize: 10.5, fontFamily: 'var(--mono-font)', color: 'var(--fg-faint)' }}>{n}</span></span>
                ))}
              </div>
              <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5, color: 'var(--fg-faint)' }}><Icon name="lock" size={13} color="var(--fg-faint)" /> each todo runs with its requester’s access</span>
            </div>
            <GroupHead icon="loader" label="Running" n={3} tone="var(--success)" note="3 agents busy" />
            {RUNNING.map((t, i) => <TodoRow key={i} t={t} kind="running" menuOpen={i === 0} />)}
            <GroupHead icon="clock" label="Queued" n={3} note="high-priority items jump the queue" />
            {QUEUED.map((t, i) => <TodoRow key={i} t={t} kind="queued" />)}
            <GroupHead icon="check" label="Done · archived" n={3} note="transcripts kept · memory flushed" />
            {DONE.map((t, i) => <TodoRow key={i} t={t} kind="done" />)}
          </div>
        </div>
      </main>
    </AppFrame>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// DIRECTION B — Kanban lanes
// ════════════════════════════════════════════════════════════════════════════
function KanbanCard({ t, kind }) {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 11, background: 'var(--surface)', padding: 12, display: 'flex', flexDirection: 'column', gap: 9 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: kind === 'done' ? 'var(--fg-muted)' : 'var(--fg)', lineHeight: 1.4 }}>{t.title}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {t.priority && <PriorityBadge />}
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--fg-muted)' }}><Av name={t.by} size={15} /> {t.by}</span>
        <AccessTag user={t.by} level={t.access || 'read'} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
        <span style={agChip(t.cloud || t.loc === 'cloud' ? 'var(--accent)' : 'var(--fg-muted)')}><Icon name={(t.cloud || t.loc === 'cloud') ? 'cloud' : 'cpu'} size={11} /> {t.model}</span>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--fg-faint)', display: 'flex', alignItems: 'center', gap: 5 }}>
          {kind === 'running' && <><Av name={t.agent.name} size={16} /> {t.agent.name} · {t.elapsed}</>}
          {kind === 'queued' && (t.wait)}
          {kind === 'done' && <><Icon name="cpu" size={11} /> {t.when}</>}
        </span>
      </div>
    </div>
  );
}
function Lane({ icon, title, n, tone, note, children }) {
  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', background: 'var(--surface-2)', borderRadius: 13, border: '1px solid var(--border)', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', flexShrink: 0 }}>
        <Icon name={icon} size={15} color={tone || 'var(--fg-muted)'} />
        <span style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: '0.03em', textTransform: 'uppercase', color: 'var(--fg)' }}>{title}</span>
        <span style={{ fontSize: 11, fontFamily: 'var(--mono-font)', color: 'var(--fg-muted)', background: 'var(--surface)', borderRadius: 6, padding: '1px 7px' }}>{n}</span>
      </div>
      {note && <div style={{ padding: '0 14px 8px', fontSize: 11, color: 'var(--fg-faint)', flexShrink: 0 }}>{note}</div>}
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 12px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>{children}</div>
    </div>
  );
}
function DirectionB() {
  return (
    <AppFrame active="agents">
      <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '18px 24px 12px', flexShrink: 0 }}>
          <div style={{ flex: 1 }}>
            <h1 style={{ margin: 0, fontFamily: 'var(--display-font)', fontSize: 23, fontWeight: 700, letterSpacing: 'var(--display-track)', color: 'var(--fg)' }}>Agents</h1>
            <div style={{ fontSize: 13, color: 'var(--fg-muted)', marginTop: 3 }}>Todos flow left to right as free agents pick them up.</div>
          </div>
          <button style={agBtnGhost()}><Icon name="cpu" size={15} color="var(--fg-muted)" /> Manage models</button>
          <button style={agBtnPrimary()}><Icon name="plus" size={15} color="#fff" /> Add a todo</button>
        </div>
        {/* agent status bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 24px 14px', flexShrink: 0, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--fg-faint)', marginRight: 4 }}>Agents</span>
          {AGENTS.map((a) => (
            <span key={a.u} style={{ display: 'flex', alignItems: 'center', gap: 7, height: 30, padding: '0 10px 0 6px', borderRadius: 999, border: '1px solid var(--border)', background: 'var(--surface)' }}>
              <span style={{ position: 'relative' }}><Av name={a.name} size={20} /><span style={{ position: 'absolute', right: -1, bottom: -1, width: 8, height: 8, borderRadius: '50%', border: '1.5px solid var(--surface)', background: a.status === 'active' ? 'var(--success)' : a.status === 'error' ? 'var(--destructive)' : 'var(--fg-faint)' }} /></span>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--fg)' }}>{a.name}</span>
              <span style={{ fontSize: 11, color: a.status === 'active' ? 'var(--success)' : 'var(--fg-faint)' }}>{a.status === 'active' ? 'busy' : a.status === 'error' ? 'off' : 'free'}</span>
            </span>
          ))}
        </div>
        {/* lanes */}
        <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 14, padding: '0 24px 24px' }}>
          <Lane icon="clock" title="Queue" n={3} note="Top item goes to the next free agent">
            {QUEUED.map((t, i) => <KanbanCard key={i} t={t} kind="queued" />)}
          </Lane>
          <Lane icon="loader" title="Running" n={3} tone="var(--success)" note="One agent per todo, in-memory">
            {RUNNING.map((t, i) => <KanbanCard key={i} t={t} kind="running" />)}
          </Lane>
          <Lane icon="check" title="Done" n={3} tone="var(--success)" note="Transcript archived · KV cache flushed">
            {DONE.map((t, i) => <KanbanCard key={i} t={t} kind="done" />)}
          </Lane>
        </div>
      </main>
    </AppFrame>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Archived transcript drawer
// ════════════════════════════════════════════════════════════════════════════
function MetaRow({ label, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
      <span style={{ width: 96, flexShrink: 0, fontSize: 11.5, color: 'var(--fg-muted)' }}>{label}</span>
      <span style={{ flex: 1, fontSize: 12.5, color: 'var(--fg)', display: 'flex', alignItems: 'center', gap: 7 }}>{children}</span>
    </div>
  );
}
function TranscriptDrawer() {
  return (
    <div style={{ ...MOCK_THEME, width: 480, height: 760, display: 'flex', flexDirection: 'column', background: 'var(--surface)', color: 'var(--fg)', fontFamily: 'var(--ui-font)', borderRadius: 14, overflow: 'hidden', border: '1px solid var(--border-strong)', boxShadow: '0 24px 70px rgba(0,0,0,0.5)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <span style={{ position: 'relative', flexShrink: 0 }}>
          <Av name="Jarvis" size={36} />
          <span style={{ position: 'absolute', right: -1, bottom: -1, width: 11, height: 11, borderRadius: '50%', border: '2px solid var(--surface)', background: 'var(--success)' }} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--fg)', fontFamily: 'var(--display-font)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Audit the Cell theory page</div>
          <div style={{ fontSize: 11.5, color: 'var(--success)', marginTop: 1, display: 'flex', alignItems: 'center', gap: 6 }}><span className="b2-spin" style={{ display: 'flex' }}><Icon name="loader" size={11} color="var(--success)" /></span> Running · Jarvis · 0:42</div>
        </div>
        <DotsMenu items={ROW_MENUS.running} />
        <button style={{ ...iconBtn(), width: 32, height: 32 }}><Icon name="x" size={16} color="var(--fg-muted)" /></button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 18 }}>
        {/* metadata */}
        <div style={{ marginBottom: 16 }}>
          <MetaRow label="Requested by"><Av name="alice" size={18} /> alice <AccessTag user="alice" level="admin" /></MetaRow>
          <MetaRow label="Model"><span style={agChip('var(--accent)')}><Icon name="cloud" size={11} /> Claude Sonnet 4.5</span></MetaRow>
          <MetaRow label="Tools"><span style={{ fontFamily: 'var(--mono-font)', fontSize: 11.5, color: 'var(--fg-muted)' }}>wiki:get · sources:list · sources:get</span></MetaRow>
        </div>
        {/* live transcript */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', marginBottom: 18 }}>
          <span style={{ fontSize: 11, color: 'var(--fg-muted)', marginBottom: 5 }}>alice</span>
          <div style={{ maxWidth: '86%', padding: '10px 13px', borderRadius: 13, borderTopRightRadius: 4, background: 'var(--accent-soft)', border: '1px solid var(--border)', fontSize: 13, lineHeight: 1.5, color: 'var(--fg)' }}>Audit the Cell theory page and flag any claim its sources don’t support.</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span style={{ width: 22, height: 22, borderRadius: 6, background: hexToRgba('#7C8CFF', 0.16), color: '#7C8CFF', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 }}>J</span>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--fg)' }}>Jarvis</span>
          <span style={{ fontSize: 11, color: 'var(--fg-faint)', fontFamily: 'var(--mono-font)' }}>Claude Sonnet 4.5</span>
        </div>
        <div style={{ paddingLeft: 30 }}>
          <div style={{ border: '1px solid var(--border)', borderRadius: 9, background: 'var(--surface-2)', marginBottom: 8, padding: '8px 11px', display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--mono-font)', fontSize: 11.5 }}>
            <Icon name="check" size={13} color="var(--success)" /><span style={{ color: 'var(--accent)' }}>wiki:get</span><span style={{ color: 'var(--fg-muted)' }}>("Cell theory")</span><span style={{ marginLeft: 'auto', color: 'var(--fg-faint)' }}>└ 3.1 KB</span>
          </div>
          <div style={{ border: '1px solid var(--border)', borderRadius: 9, background: 'var(--surface-2)', marginBottom: 10, padding: '8px 11px', display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--mono-font)', fontSize: 11.5 }}>
            <span className="b2-spin" style={{ display: 'flex' }}><Icon name="loader" size={13} color="var(--accent)" /></span><span style={{ color: 'var(--accent)' }}>sources:get</span><span style={{ color: 'var(--fg-muted)' }}>("Hooke 1665")</span><span style={{ marginLeft: 'auto', color: 'var(--fg-faint)' }}>…</span>
          </div>
          <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--fg)' }}>Most of the page is supported. I’m checking one passage in <b>Origins</b> — the 1839 Schwann attribution isn’t traceable to the cited sources yet<span className="b2-caret" /></div>
        </div>
      </div>
      {/* composer — continue the task */}
      <div style={{ flexShrink: 0, borderTop: '1px solid var(--border)', background: 'var(--bg)', padding: '12px 16px 14px' }}>
        <div style={{ border: '1px solid var(--border-strong)', borderRadius: 12, background: 'var(--surface)', overflow: 'hidden' }}>
          <div style={{ padding: '12px 13px', fontSize: 13, color: 'var(--fg-faint)' }}>Reply or add a follow-up instruction…</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderTop: '1px solid var(--border)' }}>
            <Icon name="atSign" size={15} color="var(--fg-muted)" />
            <span style={{ fontSize: 11, color: 'var(--fg-faint)' }}>re-queues with the full history</span>
            <button style={{ ...agBtnPrimary(), height: 32, marginLeft: 'auto' }}><Icon name="plus" size={14} color="#fff" /> Add to queue</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Add-a-todo composer
// ════════════════════════════════════════════════════════════════════════════
function AddTodoModal() {
  return (
    <div style={{ ...MOCK_THEME, width: 580, background: 'var(--surface)', color: 'var(--fg)', fontFamily: 'var(--ui-font)', borderRadius: 16, overflow: 'hidden', border: '1px solid var(--border-strong)', boxShadow: '0 28px 80px rgba(0,0,0,0.55)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '18px 20px 0' }}>
        <span style={{ width: 38, height: 38, borderRadius: 10, background: 'var(--accent-soft)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="plus" size={19} /></span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--fg)', fontFamily: 'var(--display-font)' }}>Add a todo to the queue</div>
          <div style={{ fontSize: 12.5, color: 'var(--fg-muted)', marginTop: 2 }}>A free agent will pick it up — you don’t wait on this screen.</div>
        </div>
        <button style={{ ...iconBtn(), width: 32, height: 32 }}><Icon name="x" size={16} color="var(--fg-muted)" /></button>
      </div>
      <div style={{ padding: '18px 20px' }}>
        <div style={{ border: '1px solid var(--border-strong)', borderRadius: 12, background: 'var(--bg)', padding: 14, marginBottom: 16 }}>
          <div style={{ fontSize: 14, color: 'var(--fg)', lineHeight: 1.5 }}>Audit the <span style={{ color: 'var(--accent)', fontWeight: 600 }}>@Cell theory</span> page and flag any claim its sources don’t support.</div>
          <div style={{ fontSize: 13, color: 'var(--fg-faint)' }}>Add detail, @mention sources or wiki pages…</div>
        </div>
        {/* controls */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ width: 92, fontSize: 12.5, color: 'var(--fg-muted)' }}>Assign to</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 7, height: 34, padding: '0 12px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 13, color: 'var(--fg)' }}><Icon name="sparkles" size={14} color="var(--accent)" /> Any free agent <Icon name="chevDown" size={13} color="var(--fg-muted)" /></span>
            <span style={{ fontSize: 12, color: 'var(--fg-faint)' }}>or pick Jarvis · Steve · Ada…</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ width: 92, fontSize: 12.5, color: 'var(--fg-muted)' }}>Model</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 7, height: 34, padding: '0 12px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 13, color: 'var(--fg)' }}><Icon name="cpu" size={14} color="var(--fg-muted)" /> Auto <Icon name="chevDown" size={13} color="var(--fg-muted)" /></span>
            <span style={{ fontSize: 12, color: 'var(--fg-faint)' }}>cheapest capable local, else cloud</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ width: 92, fontSize: 12.5, color: 'var(--fg-muted)' }}>Access</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--fg)' }}><AccessTag user="alice" level="admin" /> runs with your access — alice</span>
          </div>
        </div>
        {/* cloud/local hint */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '11px 13px', borderRadius: 10, background: 'var(--accent-soft)', border: '1px solid var(--accent-line)', marginTop: 16 }}>
          <Icon name="zap" size={15} color="var(--accent)" style={{ marginTop: 1, flexShrink: 0 }} />
          <div style={{ fontSize: 12, color: 'var(--fg)', lineHeight: 1.5 }}><b>Cloud models start immediately.</b> Local models queue until a worker frees up — there are <b>2 free agents</b> right now.</div>
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '0 20px 18px' }}>
        <button style={agBtnGhost()}>Cancel</button>
        <button style={agBtnPrimary()}><Icon name="plus" size={14} color="#fff" /> Add to queue</button>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Settings → Models tab
// ════════════════════════════════════════════════════════════════════════════
const LOCAL_MODELS = [
  { name: 'workstation-1', url: 'http://192.168.1.20:11434', model: 'llama3.3', params: '70B', ctx: '128K', status: 'ok' },
  { name: 'gpu-box', url: 'http://gpu-box.local:11434', model: 'qwen2.5', params: '32B', ctx: '32K', status: 'ok' },
  { name: 'mac-studio', url: 'http://10.0.0.7:1234/v1', model: 'llama3.1', params: '8B', ctx: '128K', status: 'off' },
];
const CLOUD_MODELS = [
  { provider: 'Anthropic', icon: 'sparkles', key: 'sk-ant-••••••••3f2a', set: true, models: [['Claude Sonnet 4.5', '~200B'], ['Claude Haiku 4.5', '~40B']] },
  { provider: 'Google Gemini', icon: 'sparkles', key: 'AIza••••••••9kL2', set: true, models: [['Gemini 2.5 Flash', '—'], ['Gemini 2.5 Pro', '—']] },
  { provider: 'OpenAI', icon: 'sparkles', key: '', set: false, models: [] },
];
function MSCard({ title, desc, action, children }) {
  return (
    <section style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ flex: 1 }}>
          <h3 style={{ margin: 0, fontSize: 14.5, fontWeight: 600, color: 'var(--fg)', fontFamily: 'var(--display-font)' }}>{title}</h3>
          {desc && <p style={{ margin: '3px 0 0', fontSize: 12.5, color: 'var(--fg-muted)', lineHeight: 1.5 }}>{desc}</p>}
        </div>
        {action}
      </div>
      <div style={{ padding: 20 }}>{children}</div>
    </section>
  );
}
function msInput(w) { return { height: 34, padding: '0 11px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--fg)', fontFamily: 'var(--mono-font)', fontSize: 12.5, outline: 'none', width: w || '100%' }; }
function ParamBadge({ p }) {
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 22, padding: '0 8px', borderRadius: 6, background: 'var(--surface-3)', color: 'var(--fg)', fontFamily: 'var(--mono-font)', fontSize: 11, fontWeight: 600 }}><Icon name="layers" size={11} color="var(--fg-muted)" /> {p}</span>;
}
function ModelsTab() {
  return (
    <div style={{ ...MOCK_THEME, height: 864, display: 'flex', flexDirection: 'column', background: 'var(--bg)', color: 'var(--fg)', fontFamily: 'var(--ui-font)', fontSize: 14, borderRadius: 14, overflow: 'hidden', border: '1px solid var(--border-strong)', boxShadow: '0 24px 70px rgba(0,0,0,0.5)' }}>
      <StaticTopBar />
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <MockRail active="settings" />
        {/* settings section nav */}
        <nav style={{ width: 230, flexShrink: 0, borderRight: '1px solid var(--border)', background: 'var(--surface)', padding: '18px 12px', overflowY: 'auto' }}>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-faint)', padding: '0 10px 10px' }}>Organization</div>
          {[['layers', 'Workspaces'], ['users', 'People']].map(([i, l]) => <NavItem key={l} icon={i} label={l} />)}
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-faint)', padding: '18px 10px 10px' }}>Settings</div>
          {[['user', 'Profile'], ['plug', 'Integrations']].map(([i, l]) => <NavItem key={l} icon={i} label={l} />)}
          <NavItem icon="cpu" label="Models" on />
          {[['sparkles', 'Appearance'], ['command', 'Tools'], ['history', 'Audit log'], ['shield', 'Danger zone']].map(([i, l]) => <NavItem key={l} icon={i} label={l} />)}
        </nav>
        {/* content */}
        <main style={{ flex: 1, minWidth: 0, overflowY: 'auto', background: 'var(--bg)' }}>
          <div style={{ maxWidth: 820, margin: '0 auto', padding: '28px 28px 80px' }}>
            <h1 style={{ margin: '0 0 4px', fontFamily: 'var(--display-font)', fontSize: 24, fontWeight: 700, letterSpacing: 'var(--display-track)', color: 'var(--fg)' }}>Models</h1>
            <div style={{ fontSize: 13, color: 'var(--fg-muted)', marginBottom: 22 }}>Manage the cloud and local models your agents can run. Agents are model-agnostic — any todo can use any of these.</div>

            {/* LOCAL */}
            <MSCard title="Local models" desc="Point at a runtime URL (Ollama, LM Studio, vLLM…). Name each endpoint and record its size." action={<button style={agBtnGhost()}><Icon name="plus" size={14} color="var(--fg-muted)" /> Add local model</button>}>
              {LOCAL_MODELS.map((m, i) => (
                <div key={m.name} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 0', borderBottom: i === LOCAL_MODELS.length - 1 ? 'none' : '1px solid var(--border)' }}>
                  <span style={{ width: 34, height: 34, flexShrink: 0, borderRadius: 9, background: 'var(--surface-2)', color: m.status === 'ok' ? 'var(--success)' : 'var(--fg-faint)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="cpu" size={17} /></span>
                  <div style={{ width: 150, flexShrink: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--fg)' }}>{m.name}</span><Icon name="pencil" size={12} color="var(--fg-faint)" /></div>
                    <div style={{ fontSize: 11, color: 'var(--fg-muted)', fontFamily: 'var(--mono-font)' }}>{m.model}</div>
                  </div>
                  <div style={{ flex: 1, minWidth: 0, fontFamily: 'var(--mono-font)', fontSize: 12, color: 'var(--fg-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.url}</div>
                  <ParamBadge p={m.params} />
                  <span style={{ fontSize: 11, fontFamily: 'var(--mono-font)', color: 'var(--fg-faint)' }}>{m.ctx}</span>
                  {m.status === 'ok'
                    ? <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--success)', width: 92 }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--success)' }} /> Reachable</span>
                    : <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--fg-faint)', width: 92 }}><span style={{ width: 7, height: 7, borderRadius: '50%', border: '1.5px solid var(--fg-faint)' }} /> Offline</span>}
                  <button style={{ ...iconBtn(), width: 30, height: 30 }}><Icon name="more" size={16} color="var(--fg-muted)" /></button>
                </div>
              ))}
              {/* add form */}
              <div style={{ marginTop: 16, padding: 14, borderRadius: 12, border: '1px solid var(--accent-line)', background: 'var(--accent-soft)' }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--fg)', marginBottom: 10 }}>Add a local model</div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                  <label style={{ flex: '1 1 150px' }}><span style={{ display: 'block', fontSize: 11.5, color: 'var(--fg-muted)', marginBottom: 5 }}>Name</span><input defaultValue="mac-studio-2" style={{ ...msInput(), fontFamily: 'var(--ui-font)' }} /></label>
                  <label style={{ flex: '2 1 240px' }}><span style={{ display: 'block', fontSize: 11.5, color: 'var(--fg-muted)', marginBottom: 5 }}>Base URL</span><input defaultValue="http://10.0.0.9:11434" style={msInput()} /></label>
                  <label style={{ flex: '0 1 110px' }}><span style={{ display: 'block', fontSize: 11.5, color: 'var(--fg-muted)', marginBottom: 5 }}>Parameters</span><input defaultValue="120B" placeholder="90B · 1T · 10M" style={msInput()} /></label>
                  <button style={{ ...agBtnPrimary(), height: 34 }}><Icon name="check" size={14} color="#fff" /> Add</button>
                </div>
                <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 9 }}>Parameter count is free-form — use the model’s own scale (e.g. 10M, 8B, 90B, 1T).</div>
              </div>
            </MSCard>

            {/* CLOUD */}
            <MSCard title="Cloud models" desc="Bring your own API keys. Keys are encrypted at rest and never shown again after saving." action={<button style={agBtnGhost()}><Icon name="plus" size={14} color="var(--fg-muted)" /> Add provider</button>}>
              {CLOUD_MODELS.map((p, i) => (
                <div key={p.provider} style={{ padding: '14px 0', borderBottom: i === CLOUD_MODELS.length - 1 ? 'none' : '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                    <span style={{ width: 34, height: 34, flexShrink: 0, borderRadius: 9, background: 'var(--surface-2)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="cloud" size={17} /></span>
                    <div style={{ width: 150, flexShrink: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--fg)' }}>{p.provider}</div>
                      <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{p.models.length} model{p.models.length === 1 ? '' : 's'}</div>
                    </div>
                    <input defaultValue={p.key} placeholder="Paste API key…" style={{ ...msInput(), flex: 1 }} />
                    {p.set ? <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--success)', width: 64 }}><Icon name="check" size={13} /> Saved</span> : <span style={{ fontSize: 12, color: 'var(--fg-faint)', width: 64 }}>Not set</span>}
                    <button style={agBtnGhost()}>Test</button>
                  </div>
                  {p.models.length > 0 && (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', paddingLeft: 48, marginTop: 10 }}>
                      {p.models.map(([nm, sz]) => (
                        <span key={nm} style={{ display: 'flex', alignItems: 'center', gap: 7, height: 26, padding: '0 10px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg)', fontSize: 12, color: 'var(--fg)' }}>
                          {nm} <span style={{ fontFamily: 'var(--mono-font)', fontSize: 10.5, color: 'var(--fg-faint)' }}>{sz}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </MSCard>
          </div>
        </main>
      </div>
    </div>
  );
}
function NavItem({ icon, label, on }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 11, height: 38, padding: '0 12px', borderRadius: 9, marginBottom: 2, background: on ? 'var(--accent-soft)' : 'transparent', color: on ? 'var(--accent)' : 'var(--fg-muted)' }}>
      <Icon name={icon} size={17} />
      <span style={{ fontSize: 13.5, fontWeight: on ? 600 : 500, color: on ? 'var(--fg)' : 'var(--fg-muted)' }}>{label}</span>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Proposal page assembly
// ════════════════════════════════════════════════════════════════════════════
function Frame({ n, tag, title, desc, children, center }) {
  return (
    <section style={{ marginBottom: 64 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 6 }}>
        <span style={{ fontFamily: 'var(--mono-font)', fontSize: 12, color: 'var(--accent)', fontWeight: 600 }}>{n}</span>
        <span style={{ fontFamily: 'var(--mono-font)', fontSize: 10.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--fg-faint)', padding: '2px 8px', border: '1px solid var(--border)', borderRadius: 5 }}>{tag}</span>
      </div>
      <h2 style={{ margin: '0 0 4px', fontFamily: 'var(--display-font)', fontSize: 21, fontWeight: 700, letterSpacing: 'var(--display-track)', color: 'var(--fg)' }}>{title}</h2>
      <p style={{ margin: '0 0 20px', fontSize: 14, color: 'var(--fg-muted)', lineHeight: 1.6, maxWidth: 760 }}>{desc}</p>
      <div style={{ display: 'flex', justifyContent: center ? 'center' : 'stretch' }}>{children}</div>
    </section>
  );
}

function Proposal() {
  return (
    <div style={{ ...MOCK_THEME, minHeight: '100vh', background: 'var(--bg)', color: 'var(--fg)', fontFamily: 'var(--ui-font)' }}>
      <div style={{ maxWidth: 1400, margin: '0 auto', padding: '56px 40px 120px' }}>
        {/* intro */}
        <div style={{ marginBottom: 56, maxWidth: 820 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
            <div style={{ width: 26, height: 26, borderRadius: 7, background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><div style={{ width: 10, height: 10, background: 'var(--bg)', borderRadius: 2, transform: 'rotate(45deg)' }} /></div>
            <span style={{ fontFamily: 'var(--display-font)', fontWeight: 700, fontSize: 16, color: 'var(--fg)' }}>Brain2</span>
            <span style={{ fontFamily: 'var(--mono-font)', fontSize: 11, color: 'var(--fg-faint)', padding: '3px 9px', border: '1px solid var(--border)', borderRadius: 6 }}>DESIGN PROPOSAL</span>
          </div>
          <h1 style={{ margin: '0 0 14px', fontFamily: 'var(--display-font)', fontSize: 38, fontWeight: 700, letterSpacing: '-0.025em', lineHeight: 1.1, color: 'var(--fg)' }}>Chats → Agents</h1>
          <p style={{ margin: 0, fontSize: 16, color: 'var(--fg-muted)', lineHeight: 1.65 }}>
            The page stops being a chat app and becomes a <b style={{ color: 'var(--fg)' }}>shared work queue</b>. Agents are named, multi-purpose workers (Jarvis, Steve, Ada…). Anyone can append a todo; a free agent picks up the next item and runs it with <b style={{ color: 'var(--fg)' }}>the requester’s access level</b>. When a todo finishes, its transcript is archived and the agent’s memory is flushed before the next one. Below: two layout directions for the page, plus the supporting screens and the new Settings → Models tab.
          </p>
          {/* concept strip */}
          <div style={{ display: 'flex', gap: 12, marginTop: 26, flexWrap: 'wrap' }}>
            {[
              ['users', 'Human-named agents', 'Jarvis, Steve, Ada — each multi-purpose, not role-locked'],
              ['clock', 'Shared todo list', 'Anyone appends; the next free agent takes the top item'],
              ['lock', 'Requester’s access', 'A todo reads wiki & sources as whoever asked for it'],
              ['cpu', 'Memory flushed', 'Transcript archived, KV cache cleared before the next run'],
            ].map(([ic, t, d]) => (
              <div key={t} style={{ flex: '1 1 240px', border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface)', padding: 14 }}>
                <span style={{ width: 30, height: 30, borderRadius: 8, background: 'var(--accent-soft)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 10 }}><Icon name={ic} size={16} /></span>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--fg)', marginBottom: 3 }}>{t}</div>
                <div style={{ fontSize: 12, color: 'var(--fg-muted)', lineHeight: 1.5 }}>{d}</div>
              </div>
            ))}
          </div>
        </div>

        <Frame n="01" tag="Agents page · recommended" title="Direction A — Roster + unified queue" desc="A live roster of agents up top (free vs. working on what), then one scrollable todo list grouped Running / Queued / Done. Reads top-to-bottom like an ops console. The “Add a todo” and “Manage models” actions sit in the header.">
          <DirectionA />
        </Frame>

        <Frame n="02" tag="Agents page · alternate" title="Direction B — Kanban lanes" desc="The same data as three lanes — Queue → Running → Done — with a slim agent status bar above. Better for watching throughput and for dragging a queued item to the top.">
          <DirectionB />
        </Frame>

        <div style={{ display: 'flex', gap: 40, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div style={{ flex: '1 1 480px' }}>
            <Frame n="03" tag="Supporting" title="Open a todo — live or done" desc="Clicking an agent or any todo opens its conversation. While it runs you watch the agent work live (shown here); when it’s done the same view restores the full history. The composer at the bottom lets anyone add a follow-up — which re-queues the task with everything that came before." center>
              <TranscriptDrawer />
            </Frame>
          </div>
          <div style={{ flex: '1 1 560px' }}>
            <Frame n="04" tag="Supporting" title="Add a todo (not “new chat”)" desc="Because nothing streams back immediately, the primary action queues work. Pick any free agent or a specific one, choose Auto/local/cloud, and see the access it’ll run with. Cloud starts now; local waits for a worker." center>
              <AddTodoModal />
            </Frame>
          </div>
        </div>

        <Frame n="05" tag="Settings · new tab" title="Settings → Models" desc="A dedicated Models tab. Local models are added by URL — each named and renameable, with a free-form parameter field (10M · 8B · 90B · 1T) and a reachability check. Cloud models are grouped by provider with their API keys. The Agents page “Manage models” button links straight here.">
          <ModelsTab />
        </Frame>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<Proposal />);
