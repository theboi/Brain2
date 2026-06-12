/* Brain2 Console — "Scheduled runs" overlay · design proposals.
   Three takes on a daily-calendar timeline of every scheduled report run.
   Rendered on a dimmed Reports backdrop inside design-canvas artboards.
   Depends on: Icon, StatusDot, getTokens, DATA, SCHEDULED_RUNS, hhmm. */

const SVARS = getTokens('dark', 'indigo', 'inter');

// Format → colour + icon (events are coloured by output format)
const SFMT = {
  doc:   { c: 'var(--accent)',  s: 'var(--accent-soft)',  icon: 'file',         label: 'Doc' },
  deck:  { c: 'var(--success)', s: 'var(--success-soft)', icon: 'presentation', label: 'Deck' },
  video: { c: 'var(--warning)', s: 'var(--warning-soft)', icon: 'play',         label: 'Video' },
};
const SSTAT = {
  done:      { label: 'Ran',      icon: 'check',  c: 'var(--fg-faint)' },
  running:   { label: 'Running',  icon: 'loader', c: 'var(--accent)', spin: true },
  scheduled: { label: 'Queued',   icon: 'clock',  c: 'var(--fg-muted)' },
  paused:    { label: 'Paused',   icon: 'pause',  c: 'var(--warning)' },
};

const DAY_START = 6 * 60;   // 06:00
const DAY_END   = 20 * 60;  // 20:00
const HOURS = Array.from({ length: (DAY_END - DAY_START) / 60 + 1 }, (_, i) => 6 + i);
const sortRuns = (a, b) => a.time - b.time;

function secLabel(extra) {
  return { fontSize: 10.5, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--fg-faint)', ...extra };
}
function CadenceChip({ id, mini }) {
  const c = CADENCE[id];
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: mini ? 10 : 10.5, fontWeight: 600,
      fontFamily: 'var(--mono-font)', color: 'var(--fg-muted)', background: 'var(--surface-2)',
      border: '1px solid var(--border)', borderRadius: 5, padding: mini ? '1px 5px' : '2px 6px' }}>
      <Icon name={c.icon} size={mini ? 9 : 10} color="var(--fg-faint)" /> {c.label}
    </span>
  );
}
function FmtDot({ id }) {
  const f = SFMT[id];
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--fg-muted)', fontFamily: 'var(--mono-font)' }}>
      <span style={{ width: 8, height: 8, borderRadius: 2.5, background: f.c }} /> {f.label}
    </span>
  );
}
function Legend() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      {['doc', 'deck', 'video'].map((id) => <FmtDot key={id} id={id} />)}
    </div>
  );
}

// ── Shared overlay chrome ──────────────────────────────────────────────────
function SchedHeader({ right, sub }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 22px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
      <span style={{ width: 36, height: 36, borderRadius: 9, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--accent-soft)', color: 'var(--accent)' }}>
        <Icon name="calendar" size={18} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 16, fontWeight: 700, fontFamily: 'var(--display-font)', letterSpacing: 'var(--display-track)', color: 'var(--fg)' }}>Scheduled runs</div>
        <div style={{ fontSize: 11.5, color: 'var(--fg-muted)', marginTop: 1, fontFamily: 'var(--mono-font)' }}>{sub}</div>
      </div>
      {right}
      <button style={{ width: 33, height: 33, borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--fg-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}><Icon name="x" size={16} /></button>
    </div>
  );
}
function SchedFooter({ nextRun }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 22px', borderTop: '1px solid var(--border)', background: 'var(--surface)', flexShrink: 0 }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 11.5, color: 'var(--fg-muted)', fontFamily: 'var(--mono-font)' }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)' }} />
        Next · {hhmm(nextRun.time)} {nextRun.title}
      </span>
      <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
        <button style={{ display: 'inline-flex', alignItems: 'center', gap: 7, height: 34, padding: '0 13px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--fg)', fontFamily: 'var(--ui-font)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
          <Icon name="sliders" size={14} color="var(--fg-muted)" /> Manage schedules
        </button>
        <button style={{ display: 'inline-flex', alignItems: 'center', gap: 7, height: 34, padding: '0 14px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', fontFamily: 'var(--ui-font)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
          <Icon name="plus" size={14} color="#fff" /> New schedule
        </button>
      </span>
    </div>
  );
}
function DayNav() {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <button style={navBtn()}><Icon name="chevLeft" size={15} color="var(--fg-muted)" /></button>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, height: 32, padding: '0 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 12.5, fontWeight: 600, color: 'var(--fg)' }}>
        <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--accent)' }}>Today</span>
        {SCHED_DAY.weekday}, Jun 9
      </span>
      <button style={navBtn()}><Icon name="chevRight" size={15} color="var(--fg-muted)" /></button>
    </div>
  );
}
function navBtn() {
  return { width: 32, height: 32, borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 };
}

// Frame: dim Reports backdrop behind the centered overlay card.
function Frame({ children, align = 'flex-start', pad = '26px 20px' }) {
  return (
    <div style={{ ...SVARS, position: 'relative', width: '100%', height: '100%', background: 'var(--bg)', color: 'var(--fg)', fontFamily: 'var(--ui-font)', overflow: 'hidden' }}>
      <GhostPage />
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(8,10,13,0.66)', backdropFilter: 'blur(2px)', WebkitBackdropFilter: 'blur(2px)' }} />
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: align, justifyContent: 'center', padding: pad }}>{children}</div>
    </div>
  );
}
// Very faint suggestion of the Reports page under the overlay.
function GhostPage() {
  return (
    <div style={{ position: 'absolute', inset: 0, opacity: 0.5 }}>
      <div style={{ height: 50, borderBottom: '1px solid var(--border)', background: 'var(--surface)', display: 'flex', alignItems: 'center', gap: 10, padding: '0 16px' }}>
        <div style={{ width: 20, height: 20, borderRadius: 5, background: 'var(--accent)' }} />
        <div style={{ width: 120, height: 9, borderRadius: 5, background: 'var(--surface-3)' }} />
      </div>
      <div style={{ display: 'flex', height: 'calc(100% - 50px)' }}>
        <div style={{ width: 56, borderRight: '1px solid var(--border)', background: 'var(--surface)' }} />
        <div style={{ flex: 1, padding: 26 }}>
          <div style={{ width: 220, height: 22, borderRadius: 6, background: 'var(--surface-3)', marginBottom: 20 }} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 14 }}>
            {Array.from({ length: 4 }).map((_, i) => <div key={i} style={{ height: 96, borderRadius: 12, border: '1px solid var(--border)', background: 'var(--surface)' }} />)}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   DIRECTION A — Vertical day calendar (literal day view)
   ════════════════════════════════════════════════════════════════════════ */
const A_ROW = 48;                      // px per hour
const A_PPM = A_ROW / 60;
const aTop = (t) => (t - DAY_START) * A_PPM;

function layoutColumns(runs) {
  const evs = runs.map((r) => ({ ...r, start: r.time, end: r.time + 45 })).sort((a, b) => a.start - b.start);
  const colEnd = [];
  evs.forEach((e) => {
    let placed = false;
    for (let i = 0; i < colEnd.length; i++) { if (colEnd[i] <= e.start) { e.col = i; colEnd[i] = e.end; placed = true; break; } }
    if (!placed) { e.col = colEnd.length; colEnd.push(e.end); }
  });
  evs.forEach((e) => {
    const grp = evs.filter((o) => o.start < e.end && e.start < o.end);
    e.ncols = Math.max(...grp.map((o) => o.col)) + 1;
  });
  return evs;
}

function AEvent({ e }) {
  const f = SFMT[e.format]; const st = SSTAT[e.status];
  const wPct = 100 / e.ncols;
  const narrow = e.ncols > 1;
  const dim = e.status === 'done';
  const running = e.status === 'running';
  return (
    <div style={{ position: 'absolute', top: aTop(e.start) + 2, height: A_ROW - 5,
      left: `calc(${e.col * wPct}% + 2px)`, width: `calc(${wPct}% - 4px)`,
      display: 'flex', borderRadius: 8, overflow: 'hidden', cursor: 'pointer',
      background: running ? f.s : 'var(--surface)',
      border: `1px solid ${running ? f.c : (e.status === 'paused' ? 'var(--border-strong)' : 'var(--border)')}`,
      borderStyle: e.status === 'paused' ? 'dashed' : 'solid',
      opacity: dim ? 0.62 : 1, boxShadow: running ? '0 0 0 3px var(--accent-soft)' : 'none' }}>
      <span style={{ width: 3, flexShrink: 0, background: f.c }} />
      <span style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '0 9px' }}>
        <span style={{ width: 22, height: 22, borderRadius: 6, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: f.s, color: f.c }}>
          <Icon name={f.icon} size={12} />
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--fg)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.title}</span>
          {!narrow && <span style={{ display: 'block', fontSize: 10.5, color: 'var(--fg-muted)', fontFamily: 'var(--mono-font)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{hhmm(e.time)} · {e.runner} · {CADENCE[e.cadence].label}</span>}
        </span>
        {running
          ? <span className="b2-spin" style={{ display: 'inline-flex', flexShrink: 0 }}><Icon name="loader" size={13} color="var(--accent)" /></span>
          : <span style={{ flexShrink: 0, display: 'inline-flex' }}><Icon name={st.icon} size={12} color={st.c} /></span>}
      </span>
    </div>
  );
}

function DirectionA() {
  const evs = layoutColumns([...SCHEDULED_RUNS]);
  const nowTop = aTop(SCHED_NOW);
  return (
    <Frame>
      <div style={cardStyle(720)}>
        <SchedHeader sub={`${SCHED_DAY.weekday}, ${SCHED_DAY.date} · 11 runs · 4 schedules`} right={<Legend />} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '11px 22px', borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
          <DayNav />
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 11.5, color: 'var(--fg-muted)', fontFamily: 'var(--mono-font)' }}>
            <span className="b2-spin" style={{ display: 'inline-flex' }}><Icon name="loader" size={12} color="var(--accent)" /></span>
            1 running · 4 upcoming
          </span>
        </div>
        {/* day grid */}
        <div style={{ overflow: 'hidden', padding: '8px 22px 14px' }}>
          <div style={{ position: 'relative', display: 'flex' }}>
            {/* hour gutter */}
            <div style={{ width: 46, flexShrink: 0, position: 'relative', height: A_ROW * (HOURS.length - 1) }}>
              {HOURS.map((h, i) => (
                <div key={h} style={{ position: 'absolute', top: i * A_ROW - 6, right: 10, fontSize: 10.5, color: 'var(--fg-faint)', fontFamily: 'var(--mono-font)' }}>{String(h).padStart(2, '0')}:00</div>
              ))}
            </div>
            {/* event area */}
            <div style={{ position: 'relative', flex: 1, height: A_ROW * (HOURS.length - 1) }}>
              {HOURS.map((h, i) => (
                <div key={h} style={{ position: 'absolute', left: 0, right: 0, top: i * A_ROW, height: 1, background: 'var(--border)' }} />
              ))}
              {evs.map((e) => <AEvent key={e.id} e={e} />)}
              {/* now line */}
              <div style={{ position: 'absolute', left: -6, right: 0, top: nowTop, height: 0, borderTop: '2px solid var(--destructive)', zIndex: 5 }}>
                <span style={{ position: 'absolute', left: -44, top: -8, fontSize: 9.5, fontWeight: 700, fontFamily: 'var(--mono-font)', color: 'var(--destructive)' }}>{hhmm(SCHED_NOW)}</span>
                <span style={{ position: 'absolute', left: -8, top: -4, width: 7, height: 7, borderRadius: '50%', background: 'var(--destructive)' }} />
              </div>
            </div>
          </div>
        </div>
        <SchedFooter nextRun={SCHEDULED_RUNS.find((r) => r.status === 'scheduled')} />
      </div>
    </Frame>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   DIRECTION B — Horizontal 24h timeline ribbon + agenda
   ════════════════════════════════════════════════════════════════════════ */
const bPct = (t) => ((t - DAY_START) / (DAY_END - DAY_START)) * 100;
const B_WIN = [13 * 60, DAY_END]; // selected window: afternoon → evening

function DirectionB() {
  const inWin = SCHEDULED_RUNS.filter((r) => r.time >= B_WIN[0] && r.time <= B_WIN[1]).sort(sortRuns);
  const before = SCHEDULED_RUNS.filter((r) => r.time < B_WIN[0]).length;
  return (
    <Frame>
      <div style={cardStyle(720)}>
        <SchedHeader sub={`${SCHED_DAY.weekday}, ${SCHED_DAY.date} · 11 runs · 4 schedules`} right={<DayNav />} />

        {/* ── Timeline ribbon (the selector) ── */}
        <div style={{ padding: '20px 22px 16px', borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <span style={secLabel()}>Timeline · drag to scan the day</span>
            <Legend />
          </div>
          <div style={{ position: 'relative', height: 64, marginLeft: 4, marginRight: 4 }}>
            {/* baseline */}
            <div style={{ position: 'absolute', left: 0, right: 0, bottom: 18, height: 2, borderRadius: 2, background: 'var(--surface-3)' }} />
            {/* selection band */}
            <div style={{ position: 'absolute', top: 0, bottom: 14, left: `${bPct(B_WIN[0])}%`, right: 0, borderRadius: 8,
              background: 'var(--accent-soft)', border: '1px solid var(--accent-line)' }}>
              <span style={{ position: 'absolute', left: -3, top: '50%', transform: 'translateY(-50%)', width: 6, height: 26, borderRadius: 3, background: 'var(--accent)' }} />
              <span style={{ position: 'absolute', right: -3, top: '50%', transform: 'translateY(-50%)', width: 6, height: 26, borderRadius: 3, background: 'var(--accent)' }} />
            </div>
            {/* markers */}
            {SCHEDULED_RUNS.map((r, i) => {
              const f = SFMT[r.format]; const on = r.time >= B_WIN[0];
              return (
                <div key={r.id} style={{ position: 'absolute', bottom: 18, left: `${bPct(r.time)}%`, transform: 'translateX(-50%)', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <span style={{ width: r.status === 'running' ? 12 : 9, height: r.status === 'running' ? 12 : 9, borderRadius: '50%', background: f.c, opacity: on ? 1 : 0.4, border: '2px solid var(--surface)', boxShadow: r.status === 'running' ? '0 0 0 3px var(--accent-soft)' : 'none' }} />
                  <span style={{ width: 1, height: 8, background: f.c, opacity: on ? 0.5 : 0.25 }} />
                </div>
              );
            })}
            {/* now marker */}
            <div style={{ position: 'absolute', top: -2, bottom: 10, left: `${bPct(SCHED_NOW)}%`, width: 2, background: 'var(--destructive)', borderRadius: 2 }}>
              <span style={{ position: 'absolute', top: -14, left: '50%', transform: 'translateX(-50%)', fontSize: 9, fontWeight: 700, fontFamily: 'var(--mono-font)', color: 'var(--destructive)', whiteSpace: 'nowrap' }}>now</span>
            </div>
            {/* hour ticks */}
            {[6, 8, 10, 12, 14, 16, 18, 20].map((h) => (
              <span key={h} style={{ position: 'absolute', bottom: 0, left: `${bPct(h * 60)}%`, transform: 'translateX(-50%)', fontSize: 10, color: 'var(--fg-faint)', fontFamily: 'var(--mono-font)' }}>{String(h).padStart(2, '0')}</span>
            ))}
          </div>
        </div>

        {/* ── Agenda list for the selected window ── */}
        <div style={{ padding: '6px 22px 10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 0 6px' }}>
            <span style={secLabel()}>Afternoon → evening</span>
            <span style={{ fontSize: 11, color: 'var(--fg-muted)', fontFamily: 'var(--mono-font)' }}>· {inWin.length} runs in window</span>
            <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--fg-faint)', fontFamily: 'var(--mono-font)' }}>{before} earlier today</span>
          </div>
          {inWin.map((r, i) => <BRow key={r.id} r={r} border={i > 0} />)}
        </div>
        <SchedFooter nextRun={SCHEDULED_RUNS.find((r) => r.status === 'scheduled')} />
      </div>
    </Frame>
  );
}
function BRow({ r, border }) {
  const f = SFMT[r.format]; const st = SSTAT[r.status];
  const running = r.status === 'running';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '11px 8px', margin: '0 -8px', borderRadius: 9, borderTop: border ? '1px solid var(--border)' : 'none', cursor: 'pointer', background: running ? 'var(--accent-soft)' : 'transparent' }}>
      <span style={{ width: 52, flexShrink: 0, fontSize: 13, fontWeight: 700, fontFamily: 'var(--mono-font)', color: running ? 'var(--accent)' : 'var(--fg)' }}>{hhmm(r.time)}</span>
      <span style={{ width: 32, height: 32, borderRadius: 8, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: f.s, color: f.c }}><Icon name={f.icon} size={15} /></span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600, color: 'var(--fg)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.title}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 3, fontSize: 11, color: 'var(--fg-muted)', fontFamily: 'var(--mono-font)' }}>
          <Icon name="sparkles" size={10} color="var(--fg-faint)" /> {r.runner}
          <span style={{ color: 'var(--border-strong)' }}>·</span>{r.sources} sources
        </span>
      </span>
      <CadenceChip id={r.cadence} />
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, width: 78, fontSize: 11, fontWeight: 600, fontFamily: 'var(--mono-font)', color: st.c }}>
        {running ? <span className="b2-spin" style={{ display: 'inline-flex' }}><Icon name="loader" size={12} /></span> : <Icon name={st.icon} size={12} color={st.c} />}
        {st.label}
      </span>
      <button style={{ ...navBtn(), width: 30, height: 30 }}><Icon name={r.status === 'paused' ? 'play' : 'pause'} size={13} color="var(--fg-muted)" /></button>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   DIRECTION C — Agent swimlanes (who runs what, when)
   ════════════════════════════════════════════════════════════════════════ */
const AGENT_LANES = ['Researcher', 'Summariser', 'Editor', 'Archivist'];
const cPct = (t) => ((t - DAY_START) / (DAY_END - DAY_START)) * 100;

function laneLayout(runs) {
  const evs = runs.map((r) => ({ ...r, start: r.time, end: r.time + 50 })).sort((a, b) => a.start - b.start);
  evs.forEach((e) => {
    const clash = evs.find((o) => o !== e && o.start < e.end && e.start < o.end);
    e.row = 0;
    if (clash) { // stack the two — earlier on top
      e.stacked = true;
      e.row = e.start === clash.start ? (e.id > clash.id ? 1 : 0) : (e.start > clash.start ? 1 : 0);
    }
  });
  return evs;
}

function CBlock({ e, stacked }) {
  const f = SFMT[e.format]; const st = SSTAT[e.status];
  const running = e.status === 'running'; const dim = e.status === 'done';
  const h = stacked ? 22 : 40;
  const top = stacked ? (e.row === 0 ? 4 : 28) : 8;
  return (
    <div style={{ position: 'absolute', top, height: h, left: `${cPct(e.time)}%`, minWidth: 96, maxWidth: 150,
      display: 'flex', alignItems: 'center', gap: 6, padding: '0 8px', borderRadius: 7, cursor: 'pointer',
      background: running ? f.s : 'var(--surface-2)', border: `1px solid ${running ? f.c : (e.status === 'paused' ? 'var(--border-strong)' : 'var(--border)')}`,
      borderStyle: e.status === 'paused' ? 'dashed' : 'solid', borderLeft: `3px solid ${f.c}`, opacity: dim ? 0.55 : 1,
      boxShadow: running ? '0 0 0 3px var(--accent-soft)' : 'none', overflow: 'hidden' }}>
      <Icon name={f.icon} size={stacked ? 11 : 13} color={f.c} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: stacked ? 10.5 : 11.5, fontWeight: 600, color: 'var(--fg)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.2 }}>{e.title}</span>
        {!stacked && <span style={{ display: 'block', fontSize: 9.5, color: 'var(--fg-muted)', fontFamily: 'var(--mono-font)' }}>{hhmm(e.time)}</span>}
      </span>
      {running && <span className="b2-spin" style={{ display: 'inline-flex', flexShrink: 0 }}><Icon name="loader" size={11} color="var(--accent)" /></span>}
    </div>
  );
}

function DirectionC() {
  const byAgent = Object.fromEntries(AGENT_LANES.map((a) => [a, laneLayout(SCHEDULED_RUNS.filter((r) => r.runner === a))]));
  const agentMeta = Object.fromEntries(DATA.agents.map((a) => [a.name, a]));
  return (
    <Frame align="center" pad="22px">
      <div style={cardStyle(820)}>
        <SchedHeader sub={`${SCHED_DAY.weekday}, ${SCHED_DAY.date} · by agent · 4 agents busy`} right={<DayNav />} />

        {/* hour axis */}
        <div style={{ display: 'flex', padding: '12px 22px 0', background: 'var(--surface)' }}>
          <div style={{ width: 132, flexShrink: 0 }} />
          <div style={{ position: 'relative', flex: 1, height: 18 }}>
            {HOURS.filter((h) => h % 2 === 0).map((h) => (
              <span key={h} style={{ position: 'absolute', left: `${cPct(h * 60)}%`, transform: 'translateX(-50%)', fontSize: 10, color: 'var(--fg-faint)', fontFamily: 'var(--mono-font)' }}>{String(h).padStart(2, '0')}:00</span>
            ))}
          </div>
        </div>

        {/* lanes */}
        <div style={{ position: 'relative', padding: '0 22px 14px', background: 'var(--surface)' }}>
          {/* vertical gridlines + now line spanning lanes */}
          <div style={{ position: 'absolute', left: 154, right: 22, top: 0, bottom: 14, pointerEvents: 'none' }}>
            {HOURS.filter((h) => h % 2 === 0).map((h) => (
              <div key={h} style={{ position: 'absolute', top: 0, bottom: 0, left: `${cPct(h * 60)}%`, width: 1, background: 'var(--border)', opacity: 0.5 }} />
            ))}
            <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${cPct(SCHED_NOW)}%`, width: 2, background: 'var(--destructive)', borderRadius: 2 }}>
              <span style={{ position: 'absolute', top: -2, left: 4, fontSize: 9, fontWeight: 700, fontFamily: 'var(--mono-font)', color: 'var(--destructive)' }}>now</span>
            </div>
          </div>
          {AGENT_LANES.map((a, i) => {
            const meta = agentMeta[a]; const evs = byAgent[a];
            const conflict = evs.some((e) => e.stacked);
            return (
              <div key={a} style={{ display: 'flex', alignItems: 'stretch', borderTop: '1px solid var(--border)' }}>
                <div style={{ width: 132, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 9, padding: '0 12px 0 0', height: 56 }}>
                  <StatusDot status={meta ? meta.status : 'ready'} pulse={false} />
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--fg)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a}</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: conflict ? 'var(--warning)' : 'var(--fg-faint)', fontFamily: 'var(--mono-font)' }}>
                      {conflict && <Icon name="alert" size={9} color="var(--warning)" />}
                      {evs.length} run{evs.length === 1 ? '' : 's'}{conflict ? ' · clash' : ''}
                    </span>
                  </span>
                </div>
                <div style={{ position: 'relative', flex: 1, height: 56 }}>
                  {evs.map((e) => <CBlock key={e.id} e={e} stacked={e.stacked} />)}
                </div>
              </div>
            );
          })}
        </div>
        <SchedFooter nextRun={SCHEDULED_RUNS.find((r) => r.status === 'scheduled')} />
      </div>
    </Frame>
  );
}

function cardStyle(w) {
  return { width: w, maxWidth: '100%', display: 'flex', flexDirection: 'column', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, boxShadow: '0 28px 90px rgba(0,0,0,0.55)', overflow: 'hidden', fontFamily: 'var(--ui-font)' };
}

Object.assign(window, { DirectionA, DirectionB, DirectionC });
