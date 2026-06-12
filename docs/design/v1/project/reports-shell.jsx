/* Brain2 Console — Reports/Studio: static app shell for the canvas previews
   + studio primitives shared by every design direction. */

const RTONE = { accent: 'var(--accent)', success: 'var(--success)', warning: 'var(--warning)', muted: 'var(--fg-muted)', destructive: 'var(--destructive)' };
const RTONE_SOFT = { accent: 'var(--accent-soft)', success: 'var(--success-soft)', warning: 'var(--warning-soft)', muted: 'var(--surface-2)', destructive: 'var(--destructive-soft)' };
const fmtById = (id) => REPORT_FORMATS.find((f) => f.id === id) || REPORT_FORMATS[0];

// ── Static top bar (non-interactive clone for canvas frames) ───────────────
function MiniTopBar() {
  return (
    <header style={{ height: 52, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 16, padding: '0 18px',
      borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <div style={{ width: 22, height: 22, borderRadius: 6, background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ width: 9, height: 9, background: 'var(--surface)', borderRadius: 2, transform: 'rotate(45deg)' }} />
        </div>
        <span style={{ fontFamily: 'var(--display-font)', fontWeight: 700, fontSize: 15, letterSpacing: 'var(--display-track)', color: 'var(--fg)' }}>Brain2</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, height: 30, padding: '0 11px', borderRadius: 8, border: '1px solid var(--border)' }}>
        <span style={{ color: 'var(--fg-muted)', fontSize: 12.5 }}>workspace</span>
        <span style={{ color: 'var(--fg)', fontWeight: 500, fontSize: 12.5 }}>default</span>
        <Icon name="chevDown" size={13} color="var(--fg-muted)" />
      </div>
      <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: 380, maxWidth: '46%', height: 33, padding: '0 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--fg-muted)', fontSize: 13 }}>
          <Icon name="search" size={15} />
          <span style={{ flex: 1 }}>Search…</span>
          <kbd style={kbdStyle()}>⌘K</kbd>
        </div>
      </div>
      <div style={{ width: 33, height: 33, borderRadius: 8, border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
        <Icon name="bell" size={16} color="var(--fg-muted)" />
        <span style={{ position: 'absolute', top: -5, right: -5, minWidth: 16, height: 16, padding: '0 4px', borderRadius: 8, background: 'var(--destructive)', color: '#fff', fontSize: 10, fontWeight: 700, fontFamily: 'var(--mono-font)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid var(--surface)' }}>9</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 4px', borderRadius: 999, border: '1px solid var(--border)' }}>
        <span style={{ width: 26, height: 26, borderRadius: '50%', background: 'var(--accent-soft)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600 }}>A</span>
        <span style={{ fontSize: 13, color: 'var(--fg)', fontWeight: 500, paddingRight: 4 }}>alice</span>
      </div>
    </header>
  );
}

// ── Static left rail with a new Reports tab ────────────────────────────────
function MiniRail({ active = 'reports' }) {
  const items = [
    { id: 'home', icon: 'home' }, { id: 'sources', icon: 'sources' }, { id: 'wiki', icon: 'wiki' },
    { id: 'chats', icon: 'chats', badge: 2 }, { id: 'reports', icon: 'file' }, { id: 'plugins', icon: 'plug' },
  ];
  const Row = ({ it }) => {
    const on = it.id === active;
    return (
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', height: 40, borderRadius: 9,
        background: on ? 'var(--accent-soft)' : 'transparent', color: on ? 'var(--accent)' : 'var(--fg-muted)' }}>
        {on && <span style={{ position: 'absolute', left: -8, top: 9, bottom: 9, width: 2.5, borderRadius: 2, background: 'var(--accent)' }} />}
        <Icon name={it.icon} size={19} />
        {it.badge && <span style={{ position: 'absolute', right: 10, top: 8, minWidth: 17, height: 17, padding: '0 5px', borderRadius: 9, background: 'var(--accent)', color: '#fff', fontSize: 10.5, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--mono-font)' }}>{it.badge}</span>}
      </div>
    );
  };
  return (
    <nav style={{ width: 64, flexShrink: 0, borderRight: '1px solid var(--border)', background: 'var(--surface)', display: 'flex', flexDirection: 'column', padding: '12px 8px', gap: 3 }}>
      {items.map((it) => <Row key={it.id} it={it} />)}
      <div style={{ height: 1, background: 'var(--border)', margin: '8px 6px' }} />
      <Row it={{ id: 'settings', icon: 'settings' }} />
    </nav>
  );
}

// Full app frame wrapping a variation's main region.
function MiniShell({ children }) {
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg)', color: 'var(--fg)', fontFamily: 'var(--ui-font)', fontSize: 14, overflow: 'hidden' }}>
      <MiniTopBar />
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <MiniRail active="reports" />
        <main style={{ flex: 1, minWidth: 0, overflow: 'hidden', background: 'var(--bg)' }}>{children}</main>
      </div>
    </div>
  );
}

// ── Studio primitives ──────────────────────────────────────────────────────
function SectionLabel({ children, action, style }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, ...style }}>
      <h2 style={{ margin: 0, fontSize: 12, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-muted)' }}>{children}</h2>
      {action}
    </div>
  );
}

// Small static format badge (icon + label).
function FormatBadge({ id, subtle = false }) {
  const f = fmtById(id);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, fontFamily: 'var(--mono-font)',
      color: subtle ? 'var(--fg-muted)' : 'var(--fg)', background: subtle ? 'transparent' : 'var(--surface-2)',
      border: subtle ? 'none' : '1px solid var(--border)', borderRadius: 6, padding: subtle ? 0 : '2px 7px' }}>
      <Icon name={f.icon} size={12} color="var(--fg-muted)" /> {f.label}
    </span>
  );
}

function FormatBadgeRow({ ids, best }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      {ids.map((id) => {
        const isBest = id === best;
        const f = fmtById(id);
        return (
          <span key={id} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, fontFamily: 'var(--mono-font)',
            color: isBest ? 'var(--accent)' : 'var(--fg-muted)', background: isBest ? 'var(--accent-soft)' : 'var(--surface-2)',
            border: `1px solid ${isBest ? 'var(--accent-line)' : 'var(--border)'}`, borderRadius: 6, padding: '2px 7px' }}>
            <Icon name={f.icon} size={12} /> {f.label}
          </span>
        );
      })}
    </span>
  );
}

// Interactive segmented format selector.
function FormatToggle({ value, onChange, size = 'md' }) {
  const pad = size === 'sm' ? '7px 10px' : '10px 14px';
  return (
    <div style={{ display: 'inline-flex', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10, padding: 3, gap: 3 }}>
      {REPORT_FORMATS.map((f) => {
        const on = f.id === value;
        return (
          <button key={f.id} onClick={() => onChange && onChange(f.id)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: pad, borderRadius: 8, border: 'none', cursor: 'pointer', fontFamily: 'var(--ui-font)',
            background: on ? 'var(--surface)' : 'transparent', color: on ? 'var(--fg)' : 'var(--fg-muted)', boxShadow: on ? 'var(--shadow-card)' : 'none', transition: 'background .14s, color .14s' }}>
            <Icon name={f.icon} size={size === 'sm' ? 14 : 16} color={on ? 'var(--accent)' : 'var(--fg-muted)'} />
            <span style={{ textAlign: 'left' }}>
              <span style={{ display: 'block', fontSize: size === 'sm' ? 12.5 : 13.5, fontWeight: 600 }}>{f.label}</span>
              {size !== 'sm' && <span style={{ display: 'block', fontSize: 10.5, fontFamily: 'var(--mono-font)', color: 'var(--fg-faint)', marginTop: 1 }}>{f.sub}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// The sparkle crest used to mark AI-suggested content.
function PersonaCrest({ size = 38, pulse = true }) {
  return (
    <span style={{ position: 'relative', width: size, height: size, borderRadius: size * 0.3, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--accent-soft)', color: 'var(--accent)' }}>
      {pulse && <span className="b2-pulse" style={{ position: 'absolute', inset: 0, borderRadius: size * 0.3, background: 'var(--accent)', opacity: 0.16 }} />}
      <Icon name="sparkles" size={size * 0.5} />
    </span>
  );
}

function SignalChips({ signals = REPORT_PERSONA.signals }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {signals.map((s) => (
        <span key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--fg-muted)', fontFamily: 'var(--mono-font)', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 7, padding: '3px 9px' }}>
          <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--accent)' }} /> {s}
        </span>
      ))}
    </div>
  );
}

function MatchPill({ n, tone = 'accent' }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, fontWeight: 700, fontFamily: 'var(--mono-font)', color: RTONE[tone], background: RTONE_SOFT[tone], borderRadius: 6, padding: '2px 7px' }}>
      <Icon name="sparkles" size={11} /> {n}% match
    </span>
  );
}

function GenerateBtn({ label = 'Generate', icon = 'wand', full = false, size = 'md' }) {
  const h = size === 'sm' ? 34 : 40;
  return (
    <button style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, height: h, width: full ? '100%' : 'auto', padding: '0 18px', borderRadius: 9,
      border: 'none', background: 'var(--accent)', color: '#fff', fontFamily: 'var(--ui-font)', fontSize: size === 'sm' ? 13 : 13.5, fontWeight: 600, cursor: 'pointer' }}>
      <Icon name={icon} size={16} color="#fff" /> {label}
    </button>
  );
}

function GhostBtn({ label, icon, size = 'md' }) {
  const h = size === 'sm' ? 34 : 38;
  return (
    <button style={{ display: 'inline-flex', alignItems: 'center', gap: 8, height: h, padding: '0 14px', borderRadius: 9,
      border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--fg)', fontFamily: 'var(--ui-font)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
      {icon && <Icon name={icon} size={15} color="var(--fg-muted)" />} {label}
    </button>
  );
}

// Recent-report row (shared by directions that show history).
function RecentRow({ r, border = true }) {
  const f = fmtById(r.format);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderTop: border ? '1px solid var(--border)' : 'none', cursor: 'pointer' }}>
      <span style={{ width: 30, height: 30, borderRadius: 8, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-2)', color: 'var(--fg-muted)' }}>
        <Icon name={f.icon} size={15} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, color: 'var(--fg)', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.title}</div>
        <div style={{ fontSize: 11.5, color: 'var(--fg-muted)', fontFamily: 'var(--mono-font)', marginTop: 1 }}>{r.meta} · {r.when}</div>
      </div>
      <Icon name="external" size={15} color="var(--fg-faint)" />
    </div>
  );
}

Object.assign(window, {
  RTONE, RTONE_SOFT, fmtById, MiniShell, MiniTopBar, MiniRail, SectionLabel,
  FormatBadge, FormatBadgeRow, FormatToggle, PersonaCrest, SignalChips, MatchPill,
  GenerateBtn, GhostBtn, RecentRow,
});
