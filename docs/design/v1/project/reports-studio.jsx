/* Brain2 Console — Reports Studio: interactive pieces for the live tab.
   B's suggestion panels + per-card format dropdowns, a prominent schedule
   control that flips every Generate button to Schedule, and a custom-prompt
   card that replaces the old top composer. */

const RP = REPORT_PERSONA;

const SCHEDULE_OPTIONS = [
  { id: 'oneoff',    label: 'Run now',       sub: 'generate now',      icon: 'zap' },
  { id: 'weekly',    label: 'Every week',    sub: 'Mondays · 9:00',    icon: 'calendar' },
  { id: 'monthly',   label: 'Every month',   sub: '1st · 9:00',        icon: 'calendar' },
  { id: 'quarterly', label: 'Every quarter', sub: 'start of quarter',  icon: 'calendar' },
];
const scheduleById = (id) => SCHEDULE_OPTIONS.find((o) => o.id === id) || SCHEDULE_OPTIONS[0];

// ── Small format chip → dropdown (one rounded chip per card) ───────────────
function FormatChipSelect({ value, onChange, recommended = [], align = 'left' }) {
  const [open, setOpen] = React.useState(false);
  const f = fmtById(value);
  return (
    <div style={{ position: 'relative', display: 'inline-flex' }}>
      <button onClick={() => setOpen((o) => !o)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: 'var(--ui-font)', fontSize: 11, fontWeight: 600,
        color: 'var(--fg)', background: open ? 'var(--surface-3)' : 'var(--surface-2)', border: `1px solid ${open ? 'var(--border-strong)' : 'var(--border)'}`, borderRadius: 999, padding: '3px 8px', cursor: 'pointer', lineHeight: 1.6 }}>
        <Icon name={f.icon} size={12} color="var(--accent)" />
        {f.label}
        <Icon name="chevDown" size={11} color="var(--fg-muted)" />
      </button>
      {open && (
        <Popover onClose={() => setOpen(false)} style={{ top: 'calc(100% + 6px)', [align]: 0, width: 230, padding: 6 }}>
          <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-faint)', padding: '6px 8px 4px' }}>Output format</div>
          {REPORT_FORMATS.map((opt) => {
            const on = opt.id === value;
            const rec = recommended.includes(opt.id);
            return (
              <button key={opt.id} onClick={() => { onChange(opt.id); setOpen(false); }} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', padding: '8px', border: 'none', borderRadius: 8, background: on ? 'var(--accent-soft)' : 'transparent', cursor: 'pointer', fontFamily: 'var(--ui-font)' }}>
                <span style={{ width: 28, height: 28, borderRadius: 7, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: on ? 'var(--surface)' : 'var(--surface-2)', color: on ? 'var(--accent)' : 'var(--fg-muted)' }}><Icon name={opt.icon} size={15} /></span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>
                    {opt.label}
                    {rec && <span style={{ fontSize: 9, fontWeight: 700, fontFamily: 'var(--mono-font)', color: 'var(--accent)', background: 'var(--accent-soft)', borderRadius: 5, padding: '1px 5px', letterSpacing: '0.03em' }}>BEST</span>}
                  </span>
                  <span style={{ display: 'block', fontSize: 11, color: 'var(--fg-muted)', fontFamily: 'var(--mono-font)', marginTop: 1 }}>{opt.sub}</span>
                </span>
                {on && <Icon name="check" size={14} color="var(--accent)" />}
              </button>
            );
          })}
        </Popover>
      )}
    </div>
  );
}

// ── Prominent schedule dropdown — governs every action button ──────────────
function ScheduleDropdown({ value, onChange }) {
  const [open, setOpen] = React.useState(false);
  const opt = scheduleById(value);
  const active = value !== 'oneoff';
  return (
    <div style={{ position: 'relative', display: 'inline-flex' }}>
      <button onClick={() => setOpen((o) => !o)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 32, padding: '0 10px', borderRadius: 8, cursor: 'pointer', fontFamily: 'var(--ui-font)', fontSize: 12, fontWeight: 600,
        border: `1px solid ${active ? 'var(--accent-line)' : 'var(--border-strong)'}`, background: active ? 'var(--accent-soft)' : 'var(--surface)', color: active ? 'var(--accent)' : 'var(--fg)' }}>
        <Icon name={opt.icon} size={14} color={active ? 'var(--accent)' : 'var(--fg-muted)'} />
        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: active ? 'var(--accent)' : 'var(--fg-faint)' }}>Schedule</span>
        <span>{opt.label}</span>
        <Icon name="chevDown" size={12} color={active ? 'var(--accent)' : 'var(--fg-muted)'} />
      </button>
      {open && (
        <Popover onClose={() => setOpen(false)} style={{ top: 'calc(100% + 6px)', right: 0, width: 248, padding: 6 }}>
          <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-faint)', padding: '6px 8px 4px' }}>Schedule this report for…</div>
          {SCHEDULE_OPTIONS.map((o) => {
            const on = o.id === value;
            return (
              <button key={o.id} onClick={() => { onChange(o.id); setOpen(false); }} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', padding: '8px', border: 'none', borderRadius: 8, background: on ? 'var(--accent-soft)' : 'transparent', cursor: 'pointer', fontFamily: 'var(--ui-font)' }}>
                <span style={{ width: 28, height: 28, borderRadius: 7, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: on ? 'var(--surface)' : 'var(--surface-2)', color: on ? 'var(--accent)' : 'var(--fg-muted)' }}><Icon name={o.icon} size={15} /></span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>{o.label}</span>
                  <span style={{ display: 'block', fontSize: 11, color: 'var(--fg-muted)', fontFamily: 'var(--mono-font)', marginTop: 1 }}>{o.sub}</span>
                </span>
                {on && <Icon name="check" size={14} color="var(--accent)" />}
              </button>
            );
          })}
        </Popover>
      )}
    </div>
  );
}

// Action button whose verb flips with the schedule mode. Opens the Generate overlay.
function ActionButton({ scheduled, size = 'md', full = false, onClick }) {
  const h = size === 'sm' ? 34 : 40;
  return (
    <button onClick={onClick} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, height: h, width: full ? '100%' : 'auto', padding: '0 16px', borderRadius: 9, flexShrink: 0,
      border: 'none', background: 'var(--accent)', color: '#fff', fontFamily: 'var(--ui-font)', fontSize: size === 'sm' ? 12.5 : 13.5, fontWeight: 600, cursor: 'pointer' }}>
      <Icon name={scheduled ? 'calendar' : 'wand'} size={size === 'sm' ? 14 : 16} color="#fff" />
      {scheduled ? 'Schedule' : 'Generate'}
    </button>
  );
}

// ── Suggestion panel — whole card opens the Generate overlay ───────────────
function SuggestCard({ r, scheduled, schedule }) {
  const [gen, setGen] = React.useState(false);
  const [hover, setHover] = React.useState(false);
  return (
    <React.Fragment>
    <div onClick={() => setGen(true)} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ display: 'flex', flexDirection: 'column', gap: 11, padding: 16, borderRadius: 12, cursor: 'pointer', minWidth: 0,
        border: `1px solid ${hover ? 'var(--accent-line)' : 'var(--border)'}`, background: 'var(--surface)',
        boxShadow: hover ? '0 8px 24px rgba(0,0,0,0.18)' : 'var(--shadow-card)', transform: hover ? 'translateY(-1px)' : 'none', transition: 'border-color .14s, box-shadow .14s, transform .14s' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ width: 34, height: 34, borderRadius: 9, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: RTONE_SOFT[r.tone], color: RTONE[r.tone] }}><Icon name={r.icon} size={17} /></span>
        {r.isNew && <span style={{ fontSize: 9.5, fontWeight: 700, fontFamily: 'var(--mono-font)', color: 'var(--warning)', background: 'var(--warning-soft)', borderRadius: 5, padding: '2px 6px', letterSpacing: '0.04em' }}>NEW</span>}
        <span style={{ marginLeft: 'auto', fontSize: 10.5, fontWeight: 600, fontFamily: 'var(--mono-font)', color: 'var(--fg-muted)', background: 'var(--surface-2)', borderRadius: 6, padding: '3px 9px' }}>{r.category}</span>
      </div>
      <div style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--fg)', fontFamily: 'var(--display-font)', letterSpacing: 'var(--display-track)' }}>{r.title}</div>
      <p style={{ margin: 0, fontSize: 12.5, color: 'var(--fg-muted)', lineHeight: 1.45, flex: 1, textWrap: 'pretty' }}>{r.desc}</p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontFamily: 'var(--mono-font)', color: 'var(--fg-faint)' }}>
          <Icon name="sources" size={12} /> {r.sources} sources · {r.est}
        </span>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, color: hover ? 'var(--accent)' : 'var(--fg-muted)' }}>
          {scheduled ? 'Schedule' : 'Configure'} <Icon name="arrowRight" size={14} color={hover ? 'var(--accent)' : 'var(--fg-muted)'} />
        </span>
      </div>
    </div>
    {gen && <GenerateOverlay action={reportActionConfig(r, r.best)} schedule={schedule} onClose={() => setGen(false)} />}
    </React.Fragment>
  );
}

// ── Custom prompt card (relocated composer — last option under suggested) ──
function CustomPromptCard({ scheduled, schedule }) {
  const [fmt, setFmt] = React.useState('doc');
  const [text, setText] = React.useState('');
  const [gen, setGen] = React.useState(false);
  return (
    <React.Fragment>
    <div style={{ gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', gap: 12, padding: 16, borderRadius: 12, border: '1px dashed var(--border-strong)', background: 'var(--surface-2)', minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ width: 34, height: 34, borderRadius: 9, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--accent-soft)', color: 'var(--accent)' }}><Icon name="wand" size={17} /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--fg)', fontFamily: 'var(--display-font)', letterSpacing: 'var(--display-track)' }}>Custom report</div>
          <div style={{ fontSize: 11.5, color: 'var(--fg-muted)' }}>Describe any report in plain language — cited back to your sources.</div>
        </div>
      </div>
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Q2 burn vs. plan for the board, with a hiring breakdown…"
        onKeyDown={(e) => { if (e.key === 'Enter') setGen(true); }}
        style={{ width: '100%', height: 42, padding: '0 14px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--fg)', fontFamily: 'var(--ui-font)', fontSize: 13.5, outline: 'none' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontFamily: 'var(--mono-font)', color: 'var(--fg-faint)' }}><Icon name="sources" size={12} /> 12 sources</span>
        <span style={{ marginLeft: 'auto' }}><ActionButton scheduled={scheduled} size="sm" onClick={() => setGen(true)} /></span>
      </div>
    </div>
    {gen && <GenerateOverlay action={customReportConfig(text, fmt)} schedule={schedule} onClose={() => setGen(false)} />}
    </React.Fragment>
  );
}

Object.assign(window, { SCHEDULE_OPTIONS, scheduleById, FormatChipSelect, ScheduleDropdown, ActionButton, SuggestCard, CustomPromptCard });
