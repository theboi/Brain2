/* Brain2 Console — Home page modals (Activity · Manage agents · Add agent).
   Visual shell mirrors the Ingest sources modal in components.jsx. */

// ── shared button / input styles (match ingest modal) ──────────────────────
function hmBtnGhost() { return { display: 'inline-flex', alignItems: 'center', gap: 6, height: 34, padding: '0 13px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--fg-muted)', fontFamily: 'var(--ui-font)', fontSize: 13, fontWeight: 500, cursor: 'pointer' }; }
function hmBtnPrimary() { return { display: 'inline-flex', alignItems: 'center', gap: 6, height: 34, padding: '0 14px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', fontFamily: 'var(--ui-font)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }; }
function hmInput() { return { width: '100%', height: 36, padding: '0 11px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--fg)', fontFamily: 'var(--ui-font)', fontSize: 13, outline: 'none' }; }
function hmLabel() { return { display: 'block', fontSize: 11.5, fontWeight: 600, color: 'var(--fg-muted)', letterSpacing: '0.02em', marginBottom: 7 }; }

const ACT_TONE_COLOR = { accent: 'var(--accent)', success: 'var(--success)', warning: 'var(--warning)', muted: 'var(--fg-muted)' };

// ── shared modal shell ──────────────────────────────────────────────────────
function HomeModalShell({ icon, title, headerRight, width = 760, children, footer, onClose }) {
  React.useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(8,9,12,0.55)', backdropFilter: 'blur(3px)', WebkitBackdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width, maxWidth: '100%', maxHeight: '90vh', display: 'flex', flexDirection: 'column', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, boxShadow: '0 24px 80px rgba(0,0,0,0.5)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 20px 14px', borderBottom: '1px solid var(--border)' }}>
          <Icon name={icon} size={18} color="var(--accent)" />
          <span style={{ fontFamily: 'var(--display-font)', fontSize: 16, fontWeight: 600, color: 'var(--fg)' }}>{title}</span>
          {headerRight && <span style={{ marginLeft: 12, display: 'flex', alignItems: 'center', gap: 8 }}>{headerRight}</span>}
          <span style={{ marginLeft: 'auto' }}>
            <button onClick={onClose} style={{ width: 30, height: 30, borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--fg-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="x" size={15} /></button>
          </span>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>{children}</div>
        {footer && <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 20px', borderTop: '1px solid var(--border)' }}>{footer}</div>}
      </div>
    </div>
  );
}

// ── 1 · Activity (Recent activity → View all) ───────────────────────────────
const ACTIVITY_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'accent', label: 'Agents', icon: 'sparkles' },
  { id: 'muted', label: 'Sources', icon: 'file' },
  { id: 'success', label: 'Wiki', icon: 'check' },
  { id: 'warning', label: 'Alerts', icon: 'alert' },
];
// A fuller log than the dashboard preview — today + an earlier block.
const ACTIVITY_EARLIER = [
  { t: '09:51', icon: 'wiki', text: 'Wiki page merged · “Microscopy”', meta: 'v4 · 6 sources', tone: 'accent', day: 'Yesterday' },
  { t: '09:14', icon: 'sparkles', text: 'Researcher · answered 3 queries', meta: '5,120 tok', tone: 'muted', day: 'Yesterday' },
  { t: '08:30', icon: 'shield', text: 'Citations Guard · 2 unsupported claims flagged', meta: 'Cell theory', tone: 'warning', day: 'Yesterday' },
  { t: '17:42', icon: 'file', text: 'Source ingested · “gateway.py”', meta: '→ LLM Gateway', tone: 'muted', day: 'Yesterday' },
  { t: '16:05', icon: 'check', text: 'Weekly exec digest sent', meta: 'to 4 people', tone: 'success', day: 'Yesterday' },
];
function ActivityModal({ onClose }) {
  const [filter, setFilter] = React.useState('all');
  const today = DATA.activity.map((r) => ({ ...r, day: 'Today' }));
  const all = [...today, ...ACTIVITY_EARLIER];
  const rows = filter === 'all' ? all : all.filter((r) => r.tone === filter);
  const groups = [...new Set(rows.map((r) => r.day))];

  const row = (r, i, first) => (
    <button key={r.day + r.t + i} style={{ display: 'flex', alignItems: 'center', gap: 13, width: '100%', textAlign: 'left', padding: '11px 10px', border: 'none', borderTop: first ? 'none' : '1px solid var(--border)', borderRadius: 0, background: 'transparent', cursor: 'pointer', fontFamily: 'var(--ui-font)' }}
      onMouseEnter={(e) => e.currentTarget.style.background = 'var(--surface-2)'} onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
      <span style={{ fontFamily: 'var(--mono-font)', fontSize: 11.5, color: 'var(--fg-faint)', width: 40, flexShrink: 0 }}>{r.t}</span>
      <span style={{ width: 30, height: 30, borderRadius: 8, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-2)', color: ACT_TONE_COLOR[r.tone] }}><Icon name={r.icon} size={15} /></span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 13.5, color: 'var(--fg)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.text}</span>
        <span style={{ display: 'block', fontSize: 11.5, color: 'var(--fg-muted)', fontFamily: 'var(--mono-font)', marginTop: 2 }}>{r.meta}</span>
      </span>
      <Icon name="chevRight" size={15} color="var(--fg-faint)" />
    </button>
  );

  return (
    <HomeModalShell icon="history" title="Activity" width={720} onClose={onClose}
      footer={<>
        <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>Showing <b style={{ color: 'var(--fg)' }}>{rows.length}</b> of {all.length} events</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button onClick={onClose} style={hmBtnGhost()}><Icon name="external" size={14} /> Open audit log</button>
          <button onClick={onClose} style={hmBtnPrimary()}>Done</button>
        </span>
      </>}>
      {/* filter chips */}
      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
        {ACTIVITY_FILTERS.map((f) => {
          const on = filter === f.id;
          return (
            <button key={f.id} onClick={() => setFilter(f.id)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 30, padding: '0 12px', borderRadius: 8, cursor: 'pointer', fontFamily: 'var(--ui-font)', fontSize: 12.5, fontWeight: 600, border: on ? '1px solid var(--accent)' : '1px solid var(--border)', background: on ? 'var(--accent-soft)' : 'transparent', color: on ? 'var(--accent)' : 'var(--fg-muted)' }}>
              {f.icon && <Icon name={f.icon} size={13} color={on ? 'var(--accent)' : 'var(--fg-muted)'} />} {f.label}
            </button>
          );
        })}
      </div>
      {/* grouped log */}
      {groups.map((day) => {
        const list = rows.filter((r) => r.day === day);
        return (
          <div key={day}>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-faint)', margin: '2px 0 6px 2px' }}>{day}</div>
            <div style={{ borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg)', overflow: 'hidden' }}>
              {list.map((r, i) => row(r, i, i === 0))}
            </div>
          </div>
        );
      })}
      {!rows.length && <div style={{ textAlign: 'center', color: 'var(--fg-faint)', padding: '30px 0', fontSize: 13 }}>No events match this filter.</div>}
    </HomeModalShell>
  );
}

// ── 2 · Manage agents (Agents → Manage agents) ──────────────────────────────
function ManageAgentsModal({ onClose, onAddAgent }) {
  const [q, setQ] = React.useState('');
  const [paused, setPaused] = React.useState(() => new Set());
  const ql = q.trim().toLowerCase();
  const list = DATA.agents.filter((a) => !ql || a.name.toLowerCase().includes(ql) || a.model.toLowerCase().includes(ql) || a.provider.toLowerCase().includes(ql));
  const online = DATA.agents.filter((a) => a.status === 'active').length;
  const togglePause = (id) => setPaused((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <HomeModalShell icon="users" title="Manage agents" width={880} onClose={onClose}
      footer={<>
        <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}><b style={{ color: 'var(--fg)' }}>{DATA.agents.length}</b> agents · <b style={{ color: 'var(--success)' }}>{online}</b> online</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button onClick={onClose} style={hmBtnGhost()}>Close</button>
          <button onClick={() => { onAddAgent && onAddAgent(); }} style={hmBtnPrimary()}><Icon name="plus" size={14} color="#fff" /> Add agent</button>
        </span>
      </>}>
      {/* search bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, height: 36, padding: '0 11px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)' }}>
        <Icon name="search" size={15} color="var(--fg-muted)" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search agents by name, model or provider…" style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', color: 'var(--fg)', fontSize: 13, fontFamily: 'var(--ui-font)' }} />
      </div>
      {/* table */}
      <div style={{ borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg)', overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1.6fr 1fr 0.7fr 132px', gap: 14, padding: '9px 14px', borderBottom: '1px solid var(--border)', background: 'var(--surface-2)', fontSize: 10.5, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--fg-faint)' }}>
          <span>Agent</span><span>Model</span><span>Status</span><span style={{ textAlign: 'right' }}>Msgs</span><span style={{ textAlign: 'right' }}>Actions</span>
        </div>
        {list.map((a, i) => {
          const isPaused = paused.has(a.id);
          return (
            <div key={a.id} style={{ display: 'grid', gridTemplateColumns: '1.5fr 1.6fr 1fr 0.7fr 132px', gap: 14, alignItems: 'center', padding: '12px 14px', borderTop: i ? '1px solid var(--border)' : 'none' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                <StatusDot status={isPaused ? 'idle' : a.status} />
                <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)', fontFamily: 'var(--display-font)', letterSpacing: 'var(--display-track)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.name}</span>
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12.5, color: 'var(--fg)', fontFamily: 'var(--mono-font)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.model}</div>
                <div style={{ fontSize: 11, color: 'var(--fg-faint)', marginTop: 1 }}>{a.provider}</div>
              </div>
              <span style={{ fontSize: 12, fontFamily: 'var(--mono-font)', color: isPaused ? 'var(--fg-faint)' : a.status === 'degraded' ? 'var(--warning)' : a.status === 'active' ? 'var(--success)' : 'var(--fg-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{isPaused ? 'paused' : (a.note || a.statusLabel)}</span>
              <span style={{ fontSize: 12.5, color: 'var(--fg-muted)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{a.msgs}</span>
              <span style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                <button onClick={() => togglePause(a.id)} title={isPaused ? 'Resume' : 'Pause'} style={hmIconBtn(isPaused)}><Icon name={isPaused ? 'play' : 'pause'} size={14} color={isPaused ? 'var(--accent)' : 'var(--fg-muted)'} /></button>
                <button title="Configure" style={hmIconBtn(false)}><Icon name="settings" size={14} color="var(--fg-muted)" /></button>
                <button title="More" style={hmIconBtn(false)}><Icon name="more" size={14} color="var(--fg-muted)" /></button>
              </span>
            </div>
          );
        })}
        {!list.length && <div style={{ textAlign: 'center', color: 'var(--fg-faint)', padding: '26px 0', fontSize: 12.5 }}>No agents match “{q.trim()}”.</div>}
      </div>
    </HomeModalShell>
  );
}
function hmIconBtn(active) { return { width: 30, height: 30, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', border: active ? '1px solid var(--accent)' : '1px solid var(--border)', background: active ? 'var(--accent-soft)' : 'transparent' }; }

// ── 3 · Add agent ───────────────────────────────────────────────────────────
const AGENT_DEPLOY = [
  { id: 'cloud', label: 'Cloud', icon: 'cloud', desc: 'Hosted provider API' },
  { id: 'local', label: 'Local', icon: 'cpu', desc: 'Runs on Ollama' },
];
const AGENT_MODELS = {
  cloud: [
    { provider: 'Anthropic', model: 'Claude 3.5 Sonnet' },
    { provider: 'Anthropic', model: 'Claude 3 Haiku' },
    { provider: 'OpenAI', model: 'GPT-4o-mini' },
    { provider: 'Google', model: 'gemini-1.5-flash' },
  ],
  local: [
    { provider: 'Ollama', model: 'llama3 · 8B' },
    { provider: 'Ollama', model: 'mistral · 7B' },
    { provider: 'Ollama', model: 'qwen2.5 · 14B' },
  ],
};
const AGENT_TOOLS = [
  { id: 'sources:read', label: 'sources:read', icon: 'sources' },
  { id: 'wiki:get', label: 'wiki:get', icon: 'wiki' },
  { id: 'wiki:edit', label: 'wiki:edit', icon: 'pencil' },
  { id: 'web:crawl', label: 'web:crawl', icon: 'globe' },
  { id: 'reports:write', label: 'reports:write', icon: 'file' },
  { id: 'chat:send', label: 'chat:send', icon: 'chats' },
];
function AddAgentModal({ onClose }) {
  const [name, setName] = React.useState('');
  const [deploy, setDeploy] = React.useState('cloud');
  const [modelIdx, setModelIdx] = React.useState(0);
  const [prompt, setPrompt] = React.useState('');
  const [tools, setTools] = React.useState(() => new Set(['sources:read', 'wiki:get']));
  const models = AGENT_MODELS[deploy];
  const cur = models[Math.min(modelIdx, models.length - 1)];
  const toggleTool = (id) => setTools((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const ready = name.trim().length > 0;

  return (
    <HomeModalShell icon="plus" title="Add agent" width={600} onClose={onClose}
      footer={<>
        <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{cur.provider} · {cur.model}</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button onClick={onClose} style={hmBtnGhost()}>Cancel</button>
          <button onClick={onClose} style={{ ...hmBtnPrimary(), opacity: ready ? 1 : 0.5, pointerEvents: ready ? 'auto' : 'none' }}><Icon name="plus" size={14} color="#fff" /> Create agent</button>
        </span>
      </>}>
      {/* name */}
      <div>
        <label style={hmLabel()}>Agent name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="e.g. Analyst" style={hmInput()} />
      </div>
      {/* deployment */}
      <div>
        <label style={hmLabel()}>Deployment</label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {AGENT_DEPLOY.map((d) => {
            const on = deploy === d.id;
            return (
              <button key={d.id} onClick={() => { setDeploy(d.id); setModelIdx(0); }} style={{ display: 'flex', alignItems: 'center', gap: 11, textAlign: 'left', padding: '11px 13px', borderRadius: 10, cursor: 'pointer', fontFamily: 'var(--ui-font)', border: on ? '1px solid var(--accent)' : '1px solid var(--border)', background: on ? 'var(--accent-soft)' : 'var(--bg)' }}>
                <span style={{ width: 34, height: 34, borderRadius: 9, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: on ? 'var(--surface)' : 'var(--surface-2)', color: on ? 'var(--accent)' : 'var(--fg-muted)' }}><Icon name={d.icon} size={17} /></span>
                <span>
                  <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600, color: 'var(--fg)' }}>{d.label}</span>
                  <span style={{ display: 'block', fontSize: 11.5, color: 'var(--fg-muted)', marginTop: 1 }}>{d.desc}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
      {/* model */}
      <div>
        <label style={hmLabel()}>Model</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {models.map((m, i) => {
            const on = i === Math.min(modelIdx, models.length - 1);
            return (
              <button key={m.provider + m.model} onClick={() => setModelIdx(i)} style={{ display: 'flex', alignItems: 'center', gap: 11, textAlign: 'left', padding: '9px 12px', borderRadius: 9, cursor: 'pointer', fontFamily: 'var(--ui-font)', border: on ? '1px solid var(--accent)' : '1px solid var(--border)', background: on ? 'var(--accent-soft)' : 'var(--bg)' }}>
                <span style={{ width: 16, height: 16, borderRadius: '50%', flexShrink: 0, border: on ? '5px solid var(--accent)' : '1.6px solid var(--border-strong)', background: on ? 'var(--surface)' : 'transparent', boxSizing: 'border-box' }} />
                <span style={{ flex: 1, fontSize: 13, color: 'var(--fg)', fontFamily: 'var(--mono-font)' }}>{m.model}</span>
                <span style={{ fontSize: 11, color: 'var(--fg-faint)' }}>{m.provider}</span>
              </button>
            );
          })}
        </div>
      </div>
      {/* system prompt */}
      <div>
        <label style={hmLabel()}>System prompt <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: 'var(--fg-faint)' }}>· optional</span></label>
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3} placeholder="Describe how this agent should behave and which sources to favour…" style={{ ...hmInput(), height: 'auto', padding: '9px 11px', resize: 'vertical', lineHeight: 1.5 }} />
      </div>
      {/* tools */}
      <div>
        <label style={hmLabel()}>Tools <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: 'var(--fg-faint)' }}>· {tools.size} enabled</span></label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {AGENT_TOOLS.map((t) => {
            const on = tools.has(t.id);
            return (
              <button key={t.id} onClick={() => toggleTool(t.id)} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, height: 32, padding: '0 11px', borderRadius: 8, cursor: 'pointer', fontFamily: 'var(--mono-font)', fontSize: 12, fontWeight: 500, border: on ? '1px solid var(--accent)' : '1px solid var(--border)', background: on ? 'var(--accent-soft)' : 'var(--bg)', color: on ? 'var(--accent)' : 'var(--fg-muted)' }}>
                <Icon name={on ? 'check' : t.icon} size={13} color={on ? 'var(--accent)' : 'var(--fg-faint)'} /> {t.label}
              </button>
            );
          })}
        </div>
      </div>
    </HomeModalShell>
  );
}

Object.assign(window, { ActivityModal, ManageAgentsModal, AddAgentModal });
