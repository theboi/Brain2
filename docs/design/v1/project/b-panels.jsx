/* Brain2 Console — Variant B extras: quick actions, wiki health, prominent activity. */

// ── Briefing band: everything that needs attention, above the fold ────────
const BRIEF_COLOR = { accent: 'var(--accent)', destructive: 'var(--destructive)', warning: 'var(--warning)', success: 'var(--success)', muted: 'var(--fg-muted)' };
const BRIEF_SOFT = { accent: 'var(--accent-soft)', destructive: 'var(--destructive-soft)', warning: 'var(--warning-soft)', success: 'var(--success-soft)', muted: 'var(--surface-2)' };

function BriefingCard({ g }) {
  const isErr = g.tone === 'destructive';
  return (
    <section style={{ display: 'flex', flexDirection: 'column', background: 'var(--surface)', borderRadius: 12,
      border: `1px solid ${isErr ? 'var(--destructive-soft)' : 'var(--border)'}`, boxShadow: 'var(--shadow-card)', overflow: 'hidden' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderBottom: '1px solid var(--border)', background: BRIEF_SOFT[g.tone] }}>
        <span style={{ position: 'relative', width: 28, height: 28, borderRadius: 8, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'var(--surface)', color: BRIEF_COLOR[g.tone], boxShadow: '0 1px 2px rgba(0,0,0,0.10)' }}>
          {g.tone === 'destructive' && (
            <span className="b2-pulse" style={{ position: 'absolute', width: 28, height: 28, borderRadius: 8, background: BRIEF_COLOR[g.tone], opacity: 0.35 }} />
          )}
          <Icon name={g.icon} size={15} />
        </span>
        <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--fg)' }}>{g.title}</span>
        <span style={{ fontSize: 10.5, fontFamily: 'var(--mono-font)', fontWeight: 600, color: BRIEF_COLOR[g.tone], background: 'var(--surface)',
          borderRadius: 6, padding: '2px 7px', letterSpacing: '0.02em' }}>{g.lead}</span>
        <span style={{ marginLeft: 'auto', display: 'flex' }}><MoreLink>View all</MoreLink></span>
      </header>
      <div style={{ padding: '2px 14px 6px' }}>
        {g.items.map((it, i) => (
          <button key={i} style={{ display: 'flex', alignItems: 'center', gap: 11, width: '100%', textAlign: 'left',
            padding: '10px 0', borderTop: i ? '1px solid var(--border)' : 'none', border: 'none', borderTopStyle: i ? 'solid' : 'none',
            background: 'transparent', cursor: 'pointer', fontFamily: 'var(--ui-font)' }}>
            <span style={{ width: 3, alignSelf: 'stretch', borderRadius: 2, background: BRIEF_COLOR[it.tone], flexShrink: 0 }} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 13, color: 'var(--fg)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.title}</span>
              <span style={{ display: 'block', fontSize: 11.5, color: 'var(--fg-muted)', fontFamily: 'var(--mono-font)', marginTop: 2 }}>{it.meta}</span>
            </span>
            <Icon name="chevRight" size={14} color="var(--fg-faint)" />
          </button>
        ))}
      </div>
    </section>
  );
}

function BriefingBand({ groups = DATA.briefing }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
      {groups.map((g) => <BriefingCard key={g.key} g={g} />)}
    </div>
  );
}

// ── Quick actions ─────────────────────────────────────────────────────────
// One-tap jobs a workspace owner runs. Each is delivered by an installed
// plugin; install more on the Plugins page to add new actions. Chat is last.
function ActionTile({ a, onRun }) {
  const [hov, setHov] = React.useState(false);
  const color = BRIEF_COLOR[a.tone];
  const soft = BRIEF_SOFT[a.tone];
  return (
    <button onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)} onClick={() => onRun(a)}
      style={{ display: 'flex', flexDirection: 'column', gap: 12, textAlign: 'left', padding: 15, borderRadius: 12,
        border: `1px solid ${hov ? color : 'var(--border)'}`, background: 'var(--surface)', cursor: 'pointer', fontFamily: 'var(--ui-font)',
        transform: hov ? 'translateY(-2px)' : 'none', boxShadow: hov ? '0 8px 22px rgba(0,0,0,0.22)' : 'none', transition: 'transform .14s, box-shadow .14s, border-color .14s' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ width: 34, height: 34, borderRadius: 9, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: soft, color }}>
          <Icon name={a.icon} size={17} />
        </span>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 600,
          fontFamily: 'var(--mono-font)', color: 'var(--fg-muted)', background: 'var(--surface-2)', borderRadius: 6, padding: '3px 7px' }}>
          <Icon name="plug" size={11} color="var(--fg-faint)" /> {a.plugin}
        </span>
      </div>
      <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: 'var(--fg)', lineHeight: 1.34, textWrap: 'pretty' }}>{a.title}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11.5, fontFamily: 'var(--mono-font)', color: 'var(--fg-faint)', whiteSpace: 'nowrap', flexShrink: 0 }}>{a.est}</span>
        <span style={{ marginLeft: 'auto', flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: hov ? color : 'var(--fg-muted)' }}>
          Run
          <span style={{ width: 24, height: 24, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: hov ? color : 'var(--surface-2)', transition: 'background .14s' }}>
            <Icon name="arrowRight" size={14} color={hov ? '#fff' : 'var(--fg-muted)'} />
          </span>
        </span>
      </div>
    </button>
  );
}

function ChatTile({ onRun }) {
  const [hov, setHov] = React.useState(false);
  return (
    <button onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)} onClick={onRun}
      style={{ display: 'flex', flexDirection: 'column', gap: 12, textAlign: 'left', padding: 15, borderRadius: 12,
        border: `1px dashed ${hov ? 'var(--accent)' : 'var(--border-strong)'}`, background: hov ? 'var(--accent-soft)' : 'var(--surface-2)',
        cursor: 'pointer', fontFamily: 'var(--ui-font)', transition: 'background .14s, border-color .14s' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ width: 34, height: 34, borderRadius: 9, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'var(--surface)', color: 'var(--accent)' }}>
          <Icon name="chats" size={17} />
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 10.5, fontWeight: 600, fontFamily: 'var(--mono-font)', color: 'var(--fg-muted)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>Open-ended</span>
      </div>
      <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: 'var(--fg)', lineHeight: 1.34 }}>Ask anything else</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11.5, fontFamily: 'var(--mono-font)', color: 'var(--fg-faint)', whiteSpace: 'nowrap', flexShrink: 0 }}>chat with an agent</span>
        <span style={{ marginLeft: 'auto', flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: 'var(--accent)' }}>
          Chat
          <span style={{ width: 24, height: 24, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--accent)' }}>
            <Icon name="arrowRight" size={14} color="#fff" />
          </span>
        </span>
      </div>
    </button>
  );
}

function QuickActions({ isMobile = false }) {
  const actions = DATA.quickActions;
  const runAction = (a) => { /* prototype: would launch the plugin job */ };
  const goChat = () => { try { window.location.href = 'Chats.html'; } catch {} };
  return (
    <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(3, 1fr)', gap: isMobile ? 10 : 14 }}>
      {actions.map((a) => <ActionTile key={a.id} a={a} onRun={runAction} />)}
      <ChatTile onRun={goChat} />
    </div>
  );
}

// ── Prominent activity feed ───────────────────────────────────────────────
function ActivityPanel({ rows = DATA.activity, onViewAll }) {
  return (
    <section style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, boxShadow: 'var(--shadow-card)', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '13px 16px', borderBottom: '1px solid var(--border)' }}>
        <span style={{ position: 'relative', width: 8, height: 8, display: 'inline-flex' }}>
          <span className="b2-pulse" style={{ position: 'absolute', inset: -1, borderRadius: '50%', background: 'var(--success)', opacity: 0.4 }} />
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--success)' }} />
        </span>
        <h3 style={{ margin: 0, fontSize: 13.5, fontWeight: 600, color: 'var(--fg)' }}>Recent activity</h3>
        <span style={{ fontSize: 10.5, fontFamily: 'var(--mono-font)', color: 'var(--success)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>live</span>
        <span style={{ marginLeft: 'auto' }}><MoreLink onClick={onViewAll}>View all</MoreLink></span>
      </div>
      <div style={{ padding: '4px 16px 10px' }}>
        {rows.map((r, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderTop: i ? '1px solid var(--border)' : 'none' }}>
            <span style={{ fontFamily: 'var(--mono-font)', fontSize: 11.5, color: 'var(--fg-faint)', width: 38, flexShrink: 0 }}>{r.t}</span>
            <span style={{ width: 28, height: 28, borderRadius: 8, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'var(--surface-2)', color: ACT_ICON[r.tone] }}>
              <Icon name={r.icon} size={14} />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, color: 'var(--fg)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.text}</div>
              <div style={{ fontSize: 11.5, color: 'var(--fg-muted)', fontFamily: 'var(--mono-font)', marginTop: 1 }}>{r.meta}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ── Wiki health ───────────────────────────────────────────────────────────
function WikiHealth() {
  const wh = DATA.wikiHealth;
  return (
    <Panel title="Wiki health" action={
      <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 600, padding: '2px 9px', borderRadius: 7,
        background: 'var(--success-soft)', color: 'var(--success)' }}>
        <Icon name="check" size={13} /> {wh.label} · {wh.score}
      </span>
    }>
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: 'var(--fg-muted)', marginBottom: 6 }}>
          <span>Provenance coverage</span>
          <span style={{ color: 'var(--fg)', fontVariantNumeric: 'tabular-nums' }}>{wh.coverage}%</span>
        </div>
        <div style={{ height: 7, borderRadius: 4, background: 'var(--surface-2)', overflow: 'hidden' }}>
          <div style={{ width: `${wh.coverage}%`, height: '100%', borderRadius: 4, background: 'var(--accent)' }} />
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {wh.rows.map((r, i) => (
          <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '9px 0', borderTop: i ? '1px solid var(--border)' : 'none', cursor: 'pointer' }}>
            <span style={{ width: 26, height: 26, borderRadius: 7, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'var(--surface-2)', color: ACT_ICON[r.tone] }}>
              <Icon name={r.icon} size={14} />
            </span>
            <span style={{ flex: 1, fontSize: 13, color: 'var(--fg)' }}>{r.label}</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)', fontVariantNumeric: 'tabular-nums' }}>{r.value}</span>
            <Icon name="chevRight" size={14} color="var(--fg-faint)" />
          </div>
        ))}
      </div>
    </Panel>
  );
}

Object.assign(window, { QuickActions, ActivityPanel, WikiHealth, BriefingBand });
