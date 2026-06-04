/* Brain2 Console — Generate overlay.

   Opens when an Action card is run (Home quick-action tiles, Reports cards).
   It shows the prompt that will be SUBMITTED TO THE SELECTED AGENT, plus the
   parameter chips the action's plugin registered — toggling a chip rewrites
   the draft live. Self-contained (only depends on Icon / Popover / StatusDot
   / DATA), so every page that loads it gets the same overlay. */

const GEN_TONE = { accent: 'var(--accent)', success: 'var(--success)', warning: 'var(--warning)', destructive: 'var(--destructive)', muted: 'var(--fg-muted)' };
const GEN_TONE_SOFT = { accent: 'var(--accent-soft)', success: 'var(--success-soft)', warning: 'var(--warning-soft)', destructive: 'var(--destructive-soft)', muted: 'var(--surface-2)' };

function genSectionLabel() {
  return { fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-faint)' };
}
function genChip(on) {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 6, height: 30, padding: '0 11px', borderRadius: 8, cursor: 'pointer',
    fontFamily: 'var(--ui-font)', fontSize: 12.5, fontWeight: 600,
    border: on ? '1px solid var(--accent)' : '1px solid var(--border)',
    background: on ? 'var(--accent-soft)' : 'var(--surface)', color: on ? 'var(--accent)' : 'var(--fg-muted)',
  };
}

// One registered parameter → a compact dropdown chip (same chip style the cards use).
function GenParamChip({ param, value, onChange }) {
  const [open, setOpen] = React.useState(false);
  const cur = param.options.find((o) => o.id === value) || param.options[0];
  return (
    <div style={{ position: 'relative', display: 'inline-flex' }}>
      <button onClick={() => setOpen((o) => !o)} style={{
        display: 'inline-flex', alignItems: 'center', gap: 7, height: 34, padding: '0 12px', borderRadius: 999, cursor: 'pointer',
        fontFamily: 'var(--ui-font)', fontSize: 12.5, fontWeight: 600, lineHeight: 1,
        border: `1px solid ${open ? 'var(--border-strong)' : 'var(--border)'}`, background: open ? 'var(--surface-3)' : 'var(--surface-2)', color: 'var(--fg)' }}>
        {param.icon && <Icon name={param.icon} size={13} color="var(--accent)" />}
        <span style={{ color: 'var(--fg-faint)' }}>{param.label}</span>
        <span>{cur.label}</span>
        <Icon name="chevDown" size={12} color="var(--fg-muted)" />
      </button>
      {open && (
        <Popover onClose={() => setOpen(false)} style={{ top: 'calc(100% + 6px)', left: 0, width: 250, padding: 6 }}>
          <div style={{ ...genSectionLabel(), padding: '6px 8px 4px' }}>{param.label}</div>
          {param.options.map((o) => {
            const on = o.id === value;
            return (
              <button key={o.id} onClick={() => { onChange(o.id); setOpen(false); }} style={{
                display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', padding: '8px', border: 'none', borderRadius: 8,
                background: on ? 'var(--accent-soft)' : 'transparent', cursor: 'pointer', fontFamily: 'var(--ui-font)' }}>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: on ? 'var(--accent)' : 'var(--fg)' }}>{o.label}</span>
                  {o.hint && <span style={{ display: 'block', fontSize: 11, color: 'var(--fg-muted)', fontFamily: 'var(--mono-font)', marginTop: 1 }}>{o.hint}</span>}
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

// "Submit to agent" picker.
function GenAgentSelect({ value, onChange }) {
  const [open, setOpen] = React.useState(false);
  const agents = DATA.agents;
  const cur = agents.find((a) => a.name === value) || agents[0];
  return (
    <div style={{ position: 'relative', display: 'inline-flex' }}>
      <button onClick={() => setOpen((o) => !o)} style={{
        display: 'inline-flex', alignItems: 'center', gap: 10, height: 40, padding: '0 12px', borderRadius: 9, cursor: 'pointer',
        fontFamily: 'var(--ui-font)', border: `1px solid ${open ? 'var(--accent)' : 'var(--border)'}`, background: 'var(--surface)' }}>
        <StatusDot status={cur.status} />
        <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1.25 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)', fontFamily: 'var(--display-font)', letterSpacing: 'var(--display-track)' }}>{cur.name}</span>
          <span style={{ fontSize: 10.5, color: 'var(--fg-faint)', fontFamily: 'var(--mono-font)' }}>{cur.model}</span>
        </span>
        <Icon name="chevDown" size={13} color="var(--fg-muted)" />
      </button>
      {open && (
        <Popover onClose={() => setOpen(false)} style={{ top: 'calc(100% + 6px)', left: 0, width: 290, padding: 6 }}>
          <div style={{ ...genSectionLabel(), padding: '6px 8px 4px' }}>Submit to agent</div>
          {agents.map((a) => {
            const on = a.name === value;
            return (
              <button key={a.id} onClick={() => { onChange(a.name); setOpen(false); }} style={{
                display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', padding: '8px', border: 'none', borderRadius: 8,
                background: on ? 'var(--accent-soft)' : 'transparent', cursor: 'pointer', fontFamily: 'var(--ui-font)' }}>
                <StatusDot status={a.status} pulse={false} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>{a.name}</span>
                  <span style={{ display: 'block', fontSize: 11, color: 'var(--fg-muted)', fontFamily: 'var(--mono-font)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.model} · {a.provider}</span>
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

// Schedule options — local so the overlay works on every page (not just Reports).
const GEN_SCHEDULE = [
  { id: 'now', label: 'Run once now', sub: 'generate immediately', icon: 'zap' },
  { id: 'weekly', label: 'Every week', sub: 'Mondays · 9:00', icon: 'calendar' },
  { id: 'monthly', label: 'Every month', sub: '1st · 9:00', icon: 'calendar' },
  { id: 'quarterly', label: 'Every quarter', sub: 'start of quarter', icon: 'calendar' },
];
const genScheduleById = (id) => GEN_SCHEDULE.find((o) => o.id === id) || GEN_SCHEDULE[0];

// "Schedule" picker — sits next to the agent picker, always present.
function GenScheduleSelect({ value, onChange }) {
  const [open, setOpen] = React.useState(false);
  const cur = genScheduleById(value);
  const active = value !== 'now';
  return (
    <div style={{ position: 'relative', display: 'inline-flex' }}>
      <button onClick={() => setOpen((o) => !o)} style={{
        display: 'inline-flex', alignItems: 'center', gap: 10, height: 40, padding: '0 12px', borderRadius: 9, cursor: 'pointer',
        fontFamily: 'var(--ui-font)', border: `1px solid ${open || active ? 'var(--accent)' : 'var(--border)'}`, background: active ? 'var(--accent-soft)' : 'var(--surface)' }}>
        <Icon name={cur.icon} size={16} color={active ? 'var(--accent)' : 'var(--fg-muted)'} />
        <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1.25 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: active ? 'var(--accent)' : 'var(--fg)', fontFamily: 'var(--display-font)', letterSpacing: 'var(--display-track)' }}>{cur.label}</span>
          <span style={{ fontSize: 10.5, color: active ? 'var(--accent)' : 'var(--fg-faint)', fontFamily: 'var(--mono-font)' }}>{cur.sub}</span>
        </span>
        <Icon name="chevDown" size={13} color={active ? 'var(--accent)' : 'var(--fg-muted)'} />
      </button>
      {open && (
        <Popover onClose={() => setOpen(false)} style={{ top: 'calc(100% + 6px)', left: 0, width: 250, padding: 6 }}>
          <div style={{ ...genSectionLabel(), padding: '6px 8px 4px' }}>Run this report…</div>
          {GEN_SCHEDULE.map((o) => {
            const on = o.id === value;
            return (
              <button key={o.id} onClick={() => { onChange(o.id); setOpen(false); }} style={{
                display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', padding: '8px', border: 'none', borderRadius: 8,
                background: on ? 'var(--accent-soft)' : 'transparent', cursor: 'pointer', fontFamily: 'var(--ui-font)' }}>
                <span style={{ width: 28, height: 28, borderRadius: 7, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: on ? 'var(--surface)' : 'var(--surface-2)', color: on ? 'var(--accent)' : 'var(--fg-muted)' }}><Icon name={o.icon} size={15} /></span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>{o.label}</span>
                  <span style={{ display: 'block', fontSize: 11, color: 'var(--fg-muted)', fontFamily: 'var(--mono-font)' }}>{o.sub}</span>
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

function GenerateOverlay({ action, schedule: scheduleProp = 'now', onClose }) {
  const [vals, setVals] = React.useState(action.initial);
  const [agent, setAgent] = React.useState(action.runner);
  const [schedule, setSchedule] = React.useState(scheduleProp === 'oneoff' ? 'now' : (scheduleProp || 'now'));
  const [override, setOverride] = React.useState(null); // user-typed prompt, null = follow params
  const [sent, setSent] = React.useState(false);
  const [page, setPage] = React.useState(0); // 0 = configure params, 1 = review prompt + run

  React.useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [onClose]);

  const tone = action.tone || 'accent';
  const draft = action.buildPrompt(vals);
  const promptText = override != null ? override : draft;

  // Toggling a parameter rewrites the draft (drops any manual edit).
  const setParam = (id, v) => { setVals((s) => ({ ...s, [id]: v })); setOverride(null); };

  const send = () => { if (sent) return; setSent(true); setTimeout(onClose, 950); };

  const scheduled = schedule !== 'now';
  const verb = scheduled ? 'Schedule report' : `Send to ${agent}`;
  const sentLabel = scheduled ? 'Scheduled' : 'Sent';

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(8,9,12,0.55)', backdropFilter: 'blur(3px)', WebkitBackdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 640, maxWidth: '100%', maxHeight: '90vh', display: 'flex', flexDirection: 'column', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, boxShadow: '0 24px 80px rgba(0,0,0,0.5)', overflow: 'visible', fontFamily: 'var(--ui-font)' }}>

        {/* header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '16px 20px 14px', borderBottom: '1px solid var(--border)', borderTopLeftRadius: 16, borderTopRightRadius: 16 }}>
          <span style={{ width: 38, height: 38, borderRadius: 10, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: GEN_TONE_SOFT[tone], color: GEN_TONE[tone] }}>
            <Icon name={action.icon} size={19} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--display-font)', fontSize: 16, fontWeight: 700, letterSpacing: 'var(--display-track)', color: 'var(--fg)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{action.title}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 5, flexWrap: 'wrap', fontSize: 11.5, color: 'var(--fg-muted)' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: 'var(--mono-font)', fontSize: 10.5, fontWeight: 600, color: 'var(--fg-muted)', background: 'var(--surface-2)', borderRadius: 6, padding: '2px 7px' }}>
                <Icon name="plug" size={11} color="var(--fg-faint)" /> {action.plugin}
              </span>
              <Icon name="arrowRight" size={12} color="var(--fg-faint)" />
              <span>submits to <b style={{ color: 'var(--fg)', fontWeight: 600 }}>{agent}</b></span>
            </div>
          </div>
          <button onClick={onClose} style={{ width: 30, height: 30, borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--fg-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name="x" size={15} /></button>
        </div>

        {/* body */}
        <div style={{ flex: 1, overflow: 'visible', padding: 20, display: 'flex', flexDirection: 'column', gap: 20 }}>
          {page === 0 ? (
            <React.Fragment>
              {/* what this action does */}
              {action.coverage && (
                <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: 'var(--fg-muted)', textWrap: 'pretty' }}>{action.coverage}</p>
              )}

              {/* parameters — one dropdown chip each */}
              {action.params && action.params.length > 0 && (
                <div>
                  <div style={{ ...genSectionLabel(), marginBottom: 12 }}>Parameters</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 9 }}>
                    {action.params.map((p) => <GenParamChip key={p.id} param={p} value={vals[p.id]} onChange={(v) => setParam(p.id, v)} />)}
                  </div>
                </div>
              )}
            </React.Fragment>
          ) : (
            <React.Fragment>
              {/* agent + schedule */}
              <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                <div style={{ minWidth: 200 }}>
                  <div style={{ ...genSectionLabel(), marginBottom: 10 }}>Run with</div>
                  <GenAgentSelect value={agent} onChange={setAgent} />
                </div>
                <div style={{ minWidth: 180 }}>
                  <div style={{ ...genSectionLabel(), marginBottom: 10 }}>Schedule</div>
                  <GenScheduleSelect value={schedule} onChange={setSchedule} />
                </div>
              </div>

              {/* prompt draft */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 9 }}>
                  <span style={genSectionLabel()}>Prompt to {agent}</span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, fontFamily: 'var(--mono-font)', color: override != null ? 'var(--accent)' : 'var(--fg-faint)' }}>
                    <Icon name={override != null ? 'pencil' : 'wand'} size={11} color={override != null ? 'var(--accent)' : 'var(--fg-faint)'} />
                    {override != null ? 'edited' : 'auto-written from parameters'}
                  </span>
                  {override != null && (
                    <button onClick={() => setOverride(null)} style={{ marginLeft: 'auto', border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--accent)', fontFamily: 'var(--ui-font)', fontSize: 12, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                      <Icon name="refresh" size={12} color="var(--accent)" /> Reset
                    </button>
                  )}
                </div>
                <textarea value={promptText} onChange={(e) => setOverride(e.target.value)} rows={6}
                  style={{ width: '100%', resize: 'vertical', minHeight: 132, padding: '13px 15px', borderRadius: 11, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--fg)', fontFamily: 'var(--ui-font)', fontSize: 13.5, lineHeight: 1.6, outline: 'none', boxSizing: 'border-box' }} />
              </div>
            </React.Fragment>
          )}
        </div>

        {/* footer */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 20px', borderTop: '1px solid var(--border)', background: 'var(--surface)', borderBottomLeftRadius: 16, borderBottomRightRadius: 16 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, color: 'var(--fg-muted)', fontFamily: 'var(--mono-font)', minWidth: 0 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)' }} />
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: page === 1 ? 'var(--accent)' : 'var(--border-strong)' }} />
              <span style={{ marginLeft: 3 }}>Step {page + 1} of 2</span>
            </span>
            {action.sources != null && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>· <Icon name="sources" size={13} color="var(--fg-faint)" /> {action.sources} sources</span>}
            {action.est && <span>· {action.est}</span>}
          </span>
          {page === 0 ? (
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <button onClick={onClose} style={{ display: 'inline-flex', alignItems: 'center', height: 36, padding: '0 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--fg-muted)', fontFamily: 'var(--ui-font)', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>Cancel</button>
              <button onClick={() => setPage(1)} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, height: 36, padding: '0 16px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', fontFamily: 'var(--ui-font)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                Next <Icon name="arrowRight" size={15} color="#fff" />
              </button>
            </span>
          ) : (
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <button onClick={() => setPage(0)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 36, padding: '0 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--fg-muted)', fontFamily: 'var(--ui-font)', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>
                <Icon name="arrowLeft" size={15} color="var(--fg-muted)" /> Back
              </button>
              <button onClick={send} disabled={sent} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, height: 36, padding: '0 16px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', fontFamily: 'var(--ui-font)', fontSize: 13, fontWeight: 600, cursor: sent ? 'default' : 'pointer', opacity: sent ? 0.92 : 1 }}>
                <Icon name={sent ? 'check' : (scheduled ? 'calendar' : 'send')} size={15} color="#fff" />
                {sent ? sentLabel : verb}
              </button>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { GenerateOverlay, GenParamChip, GenAgentSelect, GenScheduleSelect, GEN_SCHEDULE });
