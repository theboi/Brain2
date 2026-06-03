/* Brain2 Console — dashboard building blocks. */

// Generic panel/card wrapper.
function Panel({ title, action, children, style, pad = 18 }) {
  return (
    <section style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, boxShadow: 'var(--shadow-card)', display: 'flex', flexDirection: 'column', ...style }}>
      {title && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: `14px ${pad}px 0` }}>
          <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--fg)', fontFamily: 'var(--ui-font)' }}>{title}</h3>
          {action}
        </div>
      )}
      <div style={{ padding: pad, paddingTop: title ? 12 : pad, flex: 1 }}>{children}</div>
    </section>
  );
}

function MoreLink({ children, onClick }) {
  return (
    <button onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 4, border: 'none', background: 'transparent', cursor: 'pointer',
      color: 'var(--fg-muted)', fontFamily: 'var(--ui-font)', fontSize: 12, fontWeight: 500 }}>
      {children} <Icon name="chevRight" size={12} />
    </button>
  );
}

// ── Hero band ──────────────────────────────────────────────────────────────
const HERO_INGEST_FILES = [
  { name: 'darwin-1859.pdf', type: 'pdf', size: '11.2 MB', topic: 'Origin of Species' },
  { name: 'standup-04-12.md', type: 'md', size: '18 KB', topic: 'Q3 themes' },
];
function HeroBand({ compact = false, openIngest = false }) {
  const [modal, setModal] = React.useState(openIngest);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap' }}>
      <div>
        <h1 style={{ margin: 0, fontFamily: 'var(--display-font)', fontWeight: 700, fontSize: compact ? 24 : 28,
          letterSpacing: 'var(--display-track)', color: 'var(--fg)' }}>{DATA.greeting}</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginTop: 10, flexWrap: 'wrap' }}>
          {DATA.hero.map((m, i) => (
            <React.Fragment key={m.label}>
              {i > 0 && <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--fg-faint)', margin: '0 12px' }} />}
              <span style={{ fontSize: 14, color: 'var(--fg-muted)' }}>
                <b style={{ color: 'var(--fg)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{m.value}</b> {m.label}
              </span>
            </React.Fragment>
          ))}
        </div>
      </div>
      <button onClick={() => setModal(true)} style={{ display: 'flex', alignItems: 'center', gap: 8, height: 38, padding: '0 16px', borderRadius: 9,
        border: 'none', background: 'var(--accent)', color: '#fff', fontFamily: 'var(--ui-font)', fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }}>
        <Icon name="plus" size={16} color="#fff" /> Ingest source
      </button>
      <IngestModal open={modal} onClose={() => setModal(false)} files={HERO_INGEST_FILES} />
    </div>
  );
}

// ── Agent card (card-with-sparkline, the spec's pick) ───────────────────────
function AgentCard({ a }) {
  const s = STATUS[a.status] || STATUS.ready;
  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', background: 'var(--surface)',
      border: '1px solid var(--border)', borderRadius: 12, padding: 16, boxShadow: 'var(--shadow-card)', cursor: 'pointer', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <StatusDot status={a.status} />
        <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--fg)', fontFamily: 'var(--display-font)', letterSpacing: 'var(--display-track)' }}>{a.name}</span>
        <span style={{ marginLeft: 'auto', color: 'var(--fg-faint)', display: 'flex' }}><Icon name="more" size={16} /></span>
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--fg-muted)', marginTop: 6, fontFamily: 'var(--mono-font)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.model}</div>
      <div style={{ fontSize: 11.5, color: 'var(--fg-faint)', marginTop: 2 }}>{a.provider}</div>
      <div style={{ height: 1, background: 'var(--border)', margin: '13px 0 11px' }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: 'var(--fg-muted)' }}>
        <span>{a.msgs} msgs · {a.last}</span>
        <span style={{ color: 'var(--fg)', fontVariantNumeric: 'tabular-nums' }}>{a.cost}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 9, fontSize: 11.5,
        color: s.color === 'var(--fg-muted)' || s.color === 'var(--fg-faint)' ? 'var(--fg-muted)' : s.color }}>
        {a.status === 'active' && <Icon name="loader" size={12} />}
        {a.status === 'degraded' && <Icon name="alert" size={12} />}
        <span style={{ fontFamily: 'var(--mono-font)' }}>{a.note || a.statusLabel}</span>
      </div>
      <div style={{ margin: '12px -2px 14px' }}>
        <Sparkline data={a.spark} w={240} h={26} stroke={a.status === 'idle' ? 'var(--fg-faint)' : 'var(--accent)'} fill />
      </div>
      <button style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, height: 34, borderRadius: 8,
        border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--fg)', fontFamily: 'var(--ui-font)',
        fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
        <Icon name="chats" size={14} color="var(--fg-muted)" /> Open chat
      </button>
    </div>
  );
}

function AddAgentTile({ onClick }) {
  return (
    <div onClick={onClick} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10,
      border: '1.5px dashed var(--border-strong)', borderRadius: 12, padding: 16, color: 'var(--fg-muted)', cursor: 'pointer', minHeight: 120 }}>
      <div style={{ width: 38, height: 38, borderRadius: 10, background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="plus" size={20} color="var(--fg-muted)" />
      </div>
      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>Add agent</span>
      <span style={{ fontSize: 11.5, fontFamily: 'var(--mono-font)' }}>Cloud · Local</span>
    </div>
  );
}

// Compact agent row (for editorial / list variant).
function AgentRow({ a }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr 130px 90px 90px', alignItems: 'center', gap: 16,
      padding: '13px 4px', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <StatusDot status={a.status} />
        <span style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--fg)', fontFamily: 'var(--display-font)', letterSpacing: 'var(--display-track)' }}>{a.name}</span>
      </div>
      <span style={{ fontSize: 12.5, color: 'var(--fg-muted)', fontFamily: 'var(--mono-font)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.model} · {a.provider}</span>
      <span style={{ fontSize: 12, fontFamily: 'var(--mono-font)', color: a.status === 'degraded' ? 'var(--warning)' : a.status === 'active' ? 'var(--success)' : 'var(--fg-muted)' }}>{a.note || a.statusLabel}</span>
      <Sparkline data={a.spark} w={84} h={22} stroke={a.status === 'idle' ? 'var(--fg-faint)' : 'var(--accent)'} />
      <span style={{ fontSize: 12.5, color: 'var(--fg-muted)', textAlign: 'right', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
        {a.msgs} msgs <Icon name="chevRight" size={14} color="var(--fg-faint)" />
      </span>
    </div>
  );
}

// ── Stat / chart cards ──────────────────────────────────────────────────────
function StatTile({ label, value, delta, deltaUp = true, data, kind = 'area', id }) {
  return (
    <Panel pad={16} style={{ minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 12.5, color: 'var(--fg-muted)' }}>{label}</span>
        {delta && (
          <span style={{ fontSize: 11.5, fontWeight: 600, fontFamily: 'var(--mono-font)', color: deltaUp ? 'var(--success)' : 'var(--fg-muted)' }}>
            {deltaUp ? '↑' : '↓'} {delta}
          </span>
        )}
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--fg)', fontFamily: 'var(--display-font)', letterSpacing: 'var(--display-track)', marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      <div style={{ marginTop: 10 }}>
        {kind === 'area' ? <AreaChart data={data} h={48} id={id} /> : <Sparkline data={data} w={300} h={40} fill />}
      </div>
    </Panel>
  );
}

// Legend for stacked area.
function Legend({ items }) {
  return (
    <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
      {items.map((it) => (
        <span key={it.label} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--fg-muted)', cursor: 'pointer' }}>
          <span style={{ width: 9, height: 9, borderRadius: 3, background: it.color }} /> {it.label}
        </span>
      ))}
    </div>
  );
}

// ── Activity feed ────────────────────────────────────────────────────────────
const ACT_ICON = { accent: 'var(--accent)', success: 'var(--success)', warning: 'var(--warning)', muted: 'var(--fg-muted)' };
function ActivityFeed({ rows = DATA.activity, dense = false }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {rows.map((r, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: dense ? '8px 0' : '9px 0',
          borderTop: i ? '1px solid var(--border)' : 'none' }}>
          <span style={{ fontFamily: 'var(--mono-font)', fontSize: 11.5, color: 'var(--fg-faint)', width: 38, flexShrink: 0 }}>{r.t}</span>
          <span style={{ width: 26, height: 26, borderRadius: 7, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--surface-2)', color: ACT_ICON[r.tone] }}>
            <Icon name={r.icon} size={14} />
          </span>
          <span style={{ fontSize: 13, color: 'var(--fg)', flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.text}</span>
          <span style={{ fontSize: 11.5, color: 'var(--fg-muted)', fontFamily: 'var(--mono-font)', flexShrink: 0 }}>{r.meta}</span>
        </div>
      ))}
    </div>
  );
}

Object.assign(window, { Panel, MoreLink, HeroBand, AgentCard, AddAgentTile, AgentRow, StatTile, Legend, ActivityFeed });
