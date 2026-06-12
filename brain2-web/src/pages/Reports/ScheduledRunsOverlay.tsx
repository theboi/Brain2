/*
 * Scheduled runs overlay — visual port of scheduled-overlay.jsx.
 * A multi-day timeline strip that scrolls horizontally beneath a fixed selector
 * lens. The agenda list shows every run currently under the lens. Header date is
 * clickable → calendar to jump to a date. Upcoming-soon runs flash on the
 * timeline. Each row has an on/off switch plus a ⋯ menu (Skip / Delete).
 *
 * Fully interactive against mock React state — wiring to `schedules:list` later.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '@/components/ui/Icon';
import type { IconName } from '@/components/ui/Icon';
import { SCHEDULES, SCHED_NOW, hhmm, type Schedule, type SchedFormat } from './scheduledMock';

// ── Format metadata ───────────────────────────────────────────────────────
const SO_FMT: Record<SchedFormat, { c: string; s: string; icon: IconName; label: string }> = {
  doc: { c: 'var(--accent)', s: 'var(--accent-soft)', icon: 'file', label: 'Doc' },
  deck: { c: 'var(--success)', s: 'var(--success-soft)', icon: 'presentation', label: 'Deck' },
  video: { c: 'var(--warning)', s: 'var(--warning-soft)', icon: 'play', label: 'Video' },
};

// ── Timeline geometry ───────────────────────────────────────────────────────
const WH_START = 6 * 60; // 06:00 — working-day window mapped across each day
const WH_END = 20 * 60; // 20:00
const WH_SPAN = WH_END - WH_START;
const DAY_W = 264; // px per day column
const DAY_PAD = 24; // inner horizontal padding inside a day column
const INNER_W = DAY_W - DAY_PAD * 2;
const HOUR_TICKS = [8, 12, 16];
const SOON_MIN = 180; // a run is "upcoming soon" within this many minutes

// Date model — a window of days around today (Jun 9, 2026 = day 9).
const RANGE_START_DAY = 4; // Jun 4
const RANGE_END_DAY = 13; // Jun 13
const TODAY_DAY = 9; // Jun 9
const WD_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WD_MIN = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

interface DayMeta {
  idx: number; day: number; wd: number; weekday: string; label: string; short: string;
}

const DAYS: DayMeta[] = [];
for (let d = RANGE_START_DAY; d <= RANGE_END_DAY; d++) {
  const date = new Date(2026, 5, d);
  DAYS.push({
    idx: DAYS.length, day: d, wd: date.getDay(), weekday: WD_SHORT[date.getDay()],
    label: `${WD_SHORT[date.getDay()]} Jun ${d}`, short: `Jun ${d}`,
  });
}
const TODAY_IDX = TODAY_DAY - RANGE_START_DAY;
const NOW_ABS = TODAY_IDX * 1440 + SCHED_NOW;
const TOTAL_W = DAYS.length * DAY_W;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const xOf = (dayIndex: number, time: number) =>
  dayIndex * DAY_W + DAY_PAD + clamp01((time - WH_START) / WH_SPAN) * INNER_W;
const xToMoment = (x: number) => {
  const dayIndex = Math.max(0, Math.min(DAYS.length - 1, Math.floor(x / DAY_W)));
  const within = x - dayIndex * DAY_W;
  const minutes = WH_START + clamp01((within - DAY_PAD) / INNER_W) * WH_SPAN;
  return { dayIndex, minutes: Math.round(minutes) };
};
const NOW_X = xOf(TODAY_IDX, SCHED_NOW);

// Parse a cron expr → { dom, dow } fields (m h dom mon dow).
function cronFields(expr: string) {
  const p = expr.split(/\s+/);
  return { dom: p[2], dow: p[4] || '*' };
}
// Does a schedule fire on this calendar day?
function fires(sched: Schedule, dayMeta: DayMeta) {
  const { dom, dow } = cronFields(sched.cronExpr);
  if (sched.cadenceId === 'daily') return true;
  if (sched.cadenceId === 'weekdays') return dayMeta.wd >= 1 && dayMeta.wd <= 5;
  if (dow && dow !== '*') {
    const base = parseInt(dow, 10);
    if (!isNaN(base)) return dayMeta.wd === base;
  }
  if (dom && dom !== '*') return dayMeta.day === parseInt(dom, 10);
  return false;
}

interface Occurrence {
  key: string;
  sched: Schedule;
  dayIndex: number;
  day: DayMeta;
  time: number;
  absMin: number;
  x: number;
}

// Build the flat list of run occurrences across every day in range.
function buildOccurrences(schedules: Schedule[]): Occurrence[] {
  const out: Occurrence[] = [];
  DAYS.forEach((dm) => {
    schedules.forEach((s) => {
      if (!fires(s, dm)) return;
      out.push({
        key: `${s.id}@${dm.day}`, sched: s, dayIndex: dm.idx, day: dm,
        time: s.time, absMin: dm.idx * 1440 + s.time, x: xOf(dm.idx, s.time),
      });
    });
  });
  return out.sort((a, b) => a.absMin - b.absMin);
}

interface Status { kind: 'ran' | 'off' | 'skipped' | 'queued'; label: string; icon: IconName; c: string }

// ── Small atoms ───────────────────────────────────────────────────────────
function SchedToggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      title={checked ? 'Schedule on — runs will fire' : 'Schedule off — subsequent runs paused'}
      style={{
        position: 'relative', width: 38, height: 22, borderRadius: 11, border: 'none', cursor: 'pointer',
        background: checked ? 'var(--accent)' : 'var(--surface-3)', transition: 'background 0.15s', flexShrink: 0, padding: 0,
      }}
    >
      <span style={{ position: 'absolute', top: 3, left: checked ? 19 : 3, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left 0.15s', display: 'block' }} />
    </button>
  );
}

function soBtn(extra?: React.CSSProperties): React.CSSProperties {
  return {
    width: 32, height: 32, borderRadius: 8, border: '1px solid var(--border)', background: 'transparent',
    display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0, ...extra,
  };
}

function CadenceChip({ sched }: { sched: Schedule }) {
  const custom = sched.cadenceId === 'custom';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, fontWeight: 600,
      fontFamily: 'var(--mono-font)', color: 'var(--fg-muted)', background: 'var(--surface-2)',
      border: '1px solid var(--border)', borderRadius: 6, padding: '2px 7px', whiteSpace: 'nowrap', flexShrink: 0,
    }}>
      <Icon name={custom ? 'sliders' : 'repeat'} size={10} color="var(--fg-faint)" />
      {sched.cadenceDetail}
    </span>
  );
}

// ── Local popover (absolute, positioned via style; backdrop for outside-click) ─
function Pop({ onClose, style, children }: { onClose: () => void; style?: React.CSSProperties; children: React.ReactNode }) {
  return (
    <>
      <div onClick={(e) => { e.stopPropagation(); onClose(); }} style={{ position: 'fixed', inset: 0, zIndex: 305 }} />
      <div
        className="b2-anim-pop"
        style={{
          position: 'absolute', zIndex: 306, background: 'var(--surface)',
          border: '1px solid var(--border-strong)', borderRadius: 12,
          boxShadow: '0 18px 50px rgba(0,0,0,0.45)', ...style,
        }}
      >
        {children}
      </div>
    </>
  );
}

// ── Calendar popover (day → month → year drill-down) ─────────────────────────
const CAL_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const CAL_MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DATA_YEAR = 2026;
const DATA_MONTH = 5; // June — the only month with schedulable days

function CalendarPopover({ focusDay, onPick, onClose }: { focusDay: number; onPick: (dayIndex: number) => void; onClose: () => void }) {
  const [mode, setMode] = useState<'days' | 'months' | 'years'>('days');
  const [vYear, setVYear] = useState(DATA_YEAR);
  const [vMon, setVMon] = useState(DATA_MONTH);
  const [yearBase, setYearBase] = useState(DATA_YEAR - 4);

  const isDataMonth = vYear === DATA_YEAR && vMon === DATA_MONTH;
  const inRange = (d: number) => isDataMonth && d >= RANGE_START_DAY && d <= RANGE_END_DAY;

  const firstDow = new Date(vYear, vMon, 1).getDay();
  const daysInMonth = new Date(vYear, vMon + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const stepMonth = (dir: number) => {
    let m = vMon + dir; let y = vYear;
    if (m < 0) { m = 11; y--; }
    if (m > 11) { m = 0; y++; }
    setVMon(m); setVYear(y);
  };

  const headerLabel = mode === 'days' ? `${CAL_MONTHS[vMon]} ${vYear}`
    : mode === 'months' ? `${vYear}`
      : `${yearBase} – ${yearBase + 11}`;
  const onHeaderClick = () => setMode(mode === 'days' ? 'months' : mode === 'months' ? 'years' : 'years');
  const nav = (dir: number) => {
    if (mode === 'days') stepMonth(dir);
    else if (mode === 'months') setVYear((y) => y + dir);
    else setYearBase((b) => b + dir * 12);
  };

  return (
    <Pop onClose={onClose} style={{ top: 'calc(100% + 8px)', right: 0, width: 268, padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <button onClick={() => nav(-1)} style={soBtn({ width: 28, height: 28 })}><Icon name="chevLeft" size={14} color="var(--fg-muted)" /></button>
        <button
          onClick={onHeaderClick}
          style={{ height: 28, padding: '0 10px', display: 'inline-flex', alignItems: 'center', gap: 6, border: 'none', background: 'transparent', cursor: mode === 'years' ? 'default' : 'pointer', fontSize: 13.5, fontWeight: 700, fontFamily: 'var(--display-font)', letterSpacing: 'var(--display-track)', color: 'var(--fg)', borderRadius: 7 }}
        >
          {headerLabel}
          {mode !== 'years' && <Icon name="chevDown" size={12} color="var(--fg-muted)" />}
        </button>
        <button onClick={() => nav(1)} style={soBtn({ width: 28, height: 28 })}><Icon name="chevRight" size={14} color="var(--fg-muted)" /></button>
      </div>

      {mode === 'days' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2, marginBottom: 6 }}>
            {WD_MIN.map((w, i) => (
              <span key={i} style={{ textAlign: 'center', fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', color: 'var(--fg-faint)', fontFamily: 'var(--mono-font)' }}>{w}</span>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2 }}>
            {cells.map((d, i) => {
              if (d === null) return <span key={`b${i}`} />;
              const ok = inRange(d);
              const today = isDataMonth && d === TODAY_DAY;
              const sel = isDataMonth && d === focusDay;
              return (
                <button
                  key={d}
                  disabled={!ok}
                  onClick={() => { if (ok) { onPick(d - RANGE_START_DAY); onClose(); } }}
                  style={{
                    position: 'relative', height: 32, borderRadius: 7, border: 'none', cursor: ok ? 'pointer' : 'default',
                    fontFamily: 'var(--mono-font)', fontSize: 12.5, fontWeight: today ? 700 : 500,
                    background: sel ? 'var(--accent)' : 'transparent',
                    color: sel ? '#fff' : ok ? 'var(--fg)' : 'var(--fg-faint)',
                    opacity: ok ? 1 : 0.4,
                  }}
                >
                  {d}
                  {today && !sel && <span style={{ position: 'absolute', bottom: 4, left: '50%', transform: 'translateX(-50%)', width: 4, height: 4, borderRadius: '50%', background: 'var(--accent)' }} />}
                </button>
              );
            })}
          </div>
        </>
      )}

      {mode === 'months' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6 }}>
          {CAL_MONTH_SHORT.map((m, i) => {
            const hasData = vYear === DATA_YEAR && i === DATA_MONTH;
            const cur = i === vMon;
            return (
              <button
                key={m}
                onClick={() => { setVMon(i); setMode('days'); }}
                style={{ position: 'relative', height: 42, borderRadius: 8, cursor: 'pointer', border: `1px solid ${cur ? 'var(--accent)' : 'var(--border)'}`, background: cur ? 'var(--accent-soft)' : 'transparent', color: cur ? 'var(--accent)' : 'var(--fg)', fontFamily: 'var(--ui-font)', fontSize: 12.5, fontWeight: 600 }}
              >
                {m}
                {hasData && !cur && <span style={{ position: 'absolute', bottom: 6, left: '50%', transform: 'translateX(-50%)', width: 4, height: 4, borderRadius: '50%', background: 'var(--accent)' }} />}
              </button>
            );
          })}
        </div>
      )}

      {mode === 'years' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6 }}>
          {Array.from({ length: 12 }, (_, i) => yearBase + i).map((y) => {
            const hasData = y === DATA_YEAR;
            const cur = y === vYear;
            return (
              <button
                key={y}
                onClick={() => { setVYear(y); setMode('months'); }}
                style={{ position: 'relative', height: 42, borderRadius: 8, cursor: 'pointer', border: `1px solid ${cur ? 'var(--accent)' : 'var(--border)'}`, background: cur ? 'var(--accent-soft)' : 'transparent', color: cur ? 'var(--accent)' : 'var(--fg)', fontFamily: 'var(--mono-font)', fontSize: 12.5, fontWeight: 600 }}
              >
                {y}
                {hasData && !cur && <span style={{ position: 'absolute', bottom: 6, left: '50%', transform: 'translateX(-50%)', width: 4, height: 4, borderRadius: '50%', background: 'var(--accent)' }} />}
              </button>
            );
          })}
        </div>
      )}

      <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--fg-faint)', fontFamily: 'var(--mono-font)', textAlign: 'center' }}>
        Scheduling window · Jun 4 – Jun 13
      </div>
    </Pop>
  );
}

function menuBtn(color?: string): React.CSSProperties {
  return {
    display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '9px 10px', border: 'none',
    borderRadius: 8, background: 'transparent', cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--ui-font)',
    fontSize: 13, fontWeight: 500, color: color || 'var(--fg)',
  };
}

// ── Row overflow menu ───────────────────────────────────────────────────────
function RowMenu({ onEdit, onRunNow, onSkip, onUnskip, onDelete, isSkipped, isPast }: {
  onEdit: () => void; onRunNow: () => void; onSkip: () => void; onUnskip: () => void; onDelete: () => void;
  isSkipped: boolean; isPast: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        title="More"
        style={soBtn({ width: 30, height: 30, border: `1px solid ${open ? 'var(--border-strong)' : 'transparent'}`, background: open ? 'var(--surface-2)' : 'transparent' })}
      >
        <Icon name="more" size={16} color="var(--fg-muted)" />
      </button>
      {open && (
        <Pop onClose={() => setOpen(false)} style={{ top: 'calc(100% + 4px)', right: 0, width: 212, padding: 6 }}>
          <button onClick={(e) => { e.stopPropagation(); onEdit(); setOpen(false); }} style={menuBtn()}>
            <Icon name="pencil" size={15} color="var(--fg-muted)" />
            <span style={{ flex: 1 }}>Edit schedule</span>
          </button>
          {!isPast && (
            <button onClick={(e) => { e.stopPropagation(); onRunNow(); setOpen(false); }} style={menuBtn()}>
              <Icon name="zap" size={15} color="var(--fg-muted)" />
              <span style={{ flex: 1 }}>Run now</span>
            </button>
          )}
          {isPast ? (
            <div style={{ padding: '9px 10px', fontSize: 12, color: 'var(--fg-faint)', fontFamily: 'var(--ui-font)' }}>This run has already happened.</div>
          ) : (
            <button onClick={(e) => { e.stopPropagation(); (isSkipped ? onUnskip : onSkip)(); setOpen(false); }} style={menuBtn()}>
              <Icon name={isSkipped ? 'refresh' : 'pause'} size={15} color="var(--fg-muted)" />
              <span style={{ flex: 1 }}>{isSkipped ? 'Restore this run' : 'Skip this run'}</span>
            </button>
          )}
          <div style={{ height: 1, background: 'var(--border)', margin: '5px 4px' }} />
          <button onClick={(e) => { e.stopPropagation(); onDelete(); setOpen(false); }} style={menuBtn('var(--destructive)')}>
            <Icon name="trash" size={15} color="var(--destructive)" />
            <span style={{ flex: 1 }}>Delete schedule</span>
          </button>
          <div style={{ padding: '4px 10px 2px', fontSize: 10, color: 'var(--fg-faint)', fontFamily: 'var(--mono-font)', lineHeight: 1.4 }}>
            Removes all upcoming runs · past runs kept
          </div>
        </Pop>
      )}
    </div>
  );
}

const dm_label = (o: Occurrence) => (o.dayIndex === TODAY_IDX ? 'Today' : o.day.label);

type LensState = [number, number] | null;

// ── Timeline strip — multi-day, scrolls under a fixed lens ───────────────────
function TimelineStrip({ occ, nextKey, soonKeys, scrollLeft, setScrollLeft, lens, setLens, cw, setCw, statusOf }: {
  occ: Occurrence[];
  nextKey: string | null;
  soonKeys: Set<string>;
  scrollLeft: number;
  setScrollLeft: React.Dispatch<React.SetStateAction<number>>;
  lens: LensState;
  setLens: React.Dispatch<React.SetStateAction<LensState>>;
  cw: number;
  setCw: React.Dispatch<React.SetStateAction<number>>;
  statusOf: (o: Occurrence) => Status;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ mode: 'pan' | 'start' | 'end'; startX: number; base: number } | null>(null);

  // Measure container width.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setCw(el.clientWidth);
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [setCw]);

  const maxScroll = Math.max(0, TOTAL_W - cw);
  const clampScroll = (x: number) => Math.max(0, Math.min(maxScroll, x));

  // Lens / pan dragging.
  useEffect(() => {
    if (!drag) return;
    const onMove = (e: MouseEvent) => {
      const dx = e.clientX - drag.startX;
      if (drag.mode === 'pan') setScrollLeft(clampScroll(drag.base - dx));
      else if (drag.mode === 'start' && lens) setLens([Math.max(0, Math.min(drag.base + dx, lens[1] - 60)), lens[1]]);
      else if (drag.mode === 'end' && lens) setLens([lens[0], Math.min(cw, Math.max(drag.base + dx, lens[0] + 60))]);
    };
    const onUp = () => setDrag(null);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [drag, lens, cw, maxScroll, setLens, setScrollLeft]);

  const onWheel = (e: React.WheelEvent) => {
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    setScrollLeft((x) => clampScroll(x + d));
  };

  return (
    <div style={{ padding: '16px 0 18px', borderBottom: '1px solid var(--border)', background: 'var(--surface)', flexShrink: 0 }}>
      {/* Label + legend */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '0 24px 14px' }}>
        <span style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--fg-faint)' }}>
          Timeline · scroll to scan days
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {(['doc', 'deck', 'video'] as SchedFormat[]).map((id) => {
            const f = SO_FMT[id];
            return (
              <span key={id} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--fg-muted)', fontFamily: 'var(--mono-font)' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: f.c }} /> {f.label}
              </span>
            );
          })}
        </div>
      </div>

      {/* Scroll viewport with fixed lens overlay */}
      <div style={{ position: 'relative' }}>
        <div
          ref={scrollRef}
          onWheel={onWheel}
          onMouseDown={(e) => { setDrag({ mode: 'pan', startX: e.clientX, base: scrollLeft }); }}
          style={{ overflow: 'hidden', cursor: drag && drag.mode === 'pan' ? 'grabbing' : 'grab', userSelect: 'none' }}
        >
          <div style={{ position: 'relative', width: TOTAL_W, height: 96, transform: `translateX(${-scrollLeft}px)`, willChange: 'transform' }}>
            {/* Day columns: separators, labels */}
            {DAYS.map((dm) => {
              const isToday = dm.idx === TODAY_IDX;
              const isPast = dm.idx < TODAY_IDX;
              return (
                <div key={dm.idx} style={{ position: 'absolute', top: 0, bottom: 0, left: dm.idx * DAY_W, width: DAY_W, borderLeft: '1px solid var(--border)', background: isToday ? 'var(--accent-soft)' : isPast ? 'var(--surface-2)' : 'transparent' }}>
                  <span style={{ position: 'absolute', top: 6, left: DAY_PAD, fontSize: 11, fontWeight: 700, fontFamily: 'var(--mono-font)', color: isToday ? 'var(--accent)' : 'var(--fg-muted)' }}>
                    {isToday ? 'Today' : dm.weekday} <span style={{ fontWeight: 500, color: 'var(--fg-faint)' }}>· Jun {dm.day}</span>
                  </span>
                </div>
              );
            })}

            {/* Baseline */}
            <div style={{ position: 'absolute', left: 0, width: TOTAL_W, bottom: 24, height: 2, background: 'var(--surface-3)' }} />

            {/* Hour ticks per day */}
            {DAYS.map((dm) => HOUR_TICKS.map((h) => (
              <span key={`${dm.idx}-${h}`} style={{ position: 'absolute', bottom: 6, left: xOf(dm.idx, h * 60), transform: 'translateX(-50%)', fontSize: 9.5, color: 'var(--fg-faint)', fontFamily: 'var(--mono-font)' }}>{String(h).padStart(2, '0')}</span>
            )))}

            {/* Run markers */}
            {occ.map((o) => {
              const f = SO_FMT[o.sched.format];
              const st = statusOf(o);
              const soon = soonKeys.has(o.key);
              const isNext = o.key === nextKey;
              const grey = st.kind === 'off' || st.kind === 'skipped';
              const size = (isNext || soon) ? 13 : 10;
              return (
                <div key={o.key} title={`${dm_label(o)} ${hhmm(o.time)} · ${o.sched.title}`} style={{ position: 'absolute', bottom: 24, left: o.x, transform: 'translateX(-50%)', zIndex: 3, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <span style={{ position: 'relative', width: size, height: size, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {soon && <span className="b2-flash" style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: f.c }} />}
                    <span style={{ position: 'relative', width: size, height: size, borderRadius: '50%', border: '2px solid var(--surface)', background: grey ? 'var(--surface-3)' : f.c, opacity: grey ? 0.55 : st.kind === 'ran' ? 0.42 : 1, boxShadow: isNext && !soon ? `0 0 0 4px ${f.s}` : 'none' }} />
                  </span>
                  <span style={{ width: 1, height: 7, background: grey ? 'var(--surface-3)' : f.c, opacity: 0.4 }} />
                </div>
              );
            })}

            {/* Now line */}
            <div style={{ position: 'absolute', top: 22, bottom: 16, left: NOW_X, width: 2, background: 'var(--destructive)', zIndex: 4 }}>
              <span style={{ position: 'absolute', top: -15, left: '50%', transform: 'translateX(-50%)', fontSize: 9, fontWeight: 700, fontFamily: 'var(--mono-font)', color: 'var(--destructive)', whiteSpace: 'nowrap' }}>now</span>
            </div>
          </div>
        </div>

        {/* Fixed selector lens (does not scroll) */}
        {cw > 0 && lens && (
          <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, pointerEvents: 'none' }}>
            <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: lens[0], background: 'rgba(8,10,13,0.28)' }} />
            <div style={{ position: 'absolute', top: 0, bottom: 0, left: lens[1], right: 0, background: 'rgba(8,10,13,0.28)' }} />
            <div style={{ position: 'absolute', top: 0, bottom: 0, left: lens[0], width: lens[1] - lens[0], border: '1.5px solid var(--accent)', borderRadius: 10, boxShadow: '0 0 0 1px rgba(0,0,0,0.2)' }} />
            {([['start', lens[0]], ['end', lens[1]]] as const).map(([side, pos]) => (
              <div
                key={side}
                onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); setDrag({ mode: side, startX: e.clientX, base: pos }); }}
                style={{ position: 'absolute', top: 0, bottom: 0, left: pos - 7, width: 14, cursor: 'ew-resize', pointerEvents: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <span style={{ width: 5, height: 34, borderRadius: 3, background: 'var(--accent)', boxShadow: '0 1px 5px rgba(0,0,0,0.4)' }} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Agenda row ────────────────────────────────────────────────────────────
function AgendaRow({ occ, status, isNext, onToggle, onEdit, onRunNow, onSkip, onUnskip, onDelete, border }: {
  occ: Occurrence; status: Status; isNext: boolean;
  onToggle: (id: string) => void; onEdit: (id: string) => void; onRunNow: (key: string) => void;
  onSkip: (key: string) => void; onUnskip: (key: string) => void; onDelete: (id: string) => void; border: boolean;
}) {
  const f = SO_FMT[occ.sched.format];
  const dim = status.kind === 'ran' || status.kind === 'off' || status.kind === 'skipped';
  const struck = status.kind === 'skipped';

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 13, padding: '11px 10px', margin: '0 -10px', borderRadius: 9,
      borderTop: border ? '1px solid var(--border)' : 'none',
      background: isNext ? 'var(--accent-soft)' : 'transparent', opacity: status.kind === 'off' ? 0.55 : 1,
    }}>
      <span style={{ width: 48, flexShrink: 0, fontSize: 13.5, fontWeight: 700, fontFamily: 'var(--mono-font)', color: isNext ? 'var(--accent)' : dim ? 'var(--fg-faint)' : 'var(--fg)', textDecoration: struck ? 'line-through' : 'none' }}>
        {hhmm(occ.time)}
      </span>
      <span style={{ width: 32, height: 32, borderRadius: 8, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: dim ? 'var(--surface-2)' : f.s, color: dim ? 'var(--fg-faint)' : f.c }}>
        <Icon name={f.icon} size={15} />
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600, color: 'var(--fg)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textDecoration: struck ? 'line-through' : 'none' }}>{occ.sched.title}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 3, fontSize: 11, color: 'var(--fg-muted)', fontFamily: 'var(--mono-font)' }}>
          <Icon name="sparkles" size={10} color="var(--fg-faint)" /> {occ.sched.runner}
          <span style={{ color: 'var(--border-strong)' }}>·</span> {occ.sched.sources} sources
        </span>
      </span>
      <CadenceChip sched={occ.sched} />
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, width: 70, fontSize: 11, fontWeight: 600, fontFamily: 'var(--mono-font)', color: status.c }}>
        <Icon name={status.icon} size={12} color={status.c} /> {status.label}
      </span>
      <SchedToggle checked={occ.sched.enabled} onChange={() => onToggle(occ.sched.id)} />
      <RowMenu
        isSkipped={status.kind === 'skipped'} isPast={status.kind === 'ran'}
        onEdit={() => onEdit(occ.sched.id)} onRunNow={() => onRunNow(occ.key)}
        onSkip={() => onSkip(occ.key)} onUnskip={() => onUnskip(occ.key)} onDelete={() => onDelete(occ.sched.id)}
      />
    </div>
  );
}

// ── Main overlay ──────────────────────────────────────────────────────────
export function ScheduledRunsOverlay({ onClose }: { onClose: () => void }) {
  const [schedules, setSchedules] = useState<Schedule[]>(SCHEDULES);
  const [skipped, setSkipped] = useState<Set<string>>(() => new Set());
  const [deleted, setDeleted] = useState<Set<string>>(() => new Set());
  const [scrollLeft, setScrollLeft] = useState(Math.max(0, NOW_X - 360));
  const [lens, setLens] = useState<LensState>(null);
  const [cw, setCw] = useState(0);
  const [calOpen, setCalOpen] = useState(false);
  const [notice, setNotice] = useState<{ icon: IconName; text: string } | null>(null);

  // Transient confirmation toast (Edit / Run now).
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 2400);
    return () => clearTimeout(t);
  }, [notice]);

  // Initialise lens + centre "now" once the container width is known.
  useEffect(() => {
    if (cw > 0 && lens === null) {
      const w = Math.min(340, Math.max(220, cw * 0.42));
      const l = (cw - w) / 2;
      setLens([l, l + w]);
      setScrollLeft(Math.max(0, Math.min(TOTAL_W - cw, NOW_X - (l + w / 2))));
    }
  }, [cw, lens]);

  const occ = useMemo(() => {
    const all = buildOccurrences(schedules);
    return all.filter((o) => !(deleted.has(o.sched.id) && o.absMin > NOW_ABS));
  }, [schedules, deleted]);

  // Status resolver for an occurrence.
  const statusOf = (o: Occurrence): Status => {
    if (o.absMin <= NOW_ABS) return { kind: 'ran', label: 'Ran', icon: 'check', c: 'var(--fg-faint)' };
    if (!o.sched.enabled) return { kind: 'off', label: 'Off', icon: 'pause', c: 'var(--fg-faint)' };
    if (skipped.has(o.key)) return { kind: 'skipped', label: 'Skipped', icon: 'pause', c: 'var(--warning)' };
    return { kind: 'queued', label: 'Queued', icon: 'clock', c: 'var(--fg-muted)' };
  };

  const nextKey = useMemo(() => {
    const c = occ.filter((o) => o.sched.enabled && o.absMin > NOW_ABS && !skipped.has(o.key));
    return c.length ? c[0].key : null;
  }, [occ, skipped]);

  const soonKeys = useMemo(() => {
    const s = new Set<string>();
    occ.forEach((o) => {
      if (o.sched.enabled && !skipped.has(o.key) && o.absMin > NOW_ABS && (o.absMin - NOW_ABS) <= SOON_MIN) s.add(o.key);
    });
    return s;
  }, [occ, skipped]);

  // Window under the lens.
  const lensReady = lens !== null && cw > 0;
  const loX = lensReady && lens ? scrollLeft + lens[0] : 0;
  const hiX = lensReady && lens ? scrollLeft + lens[1] : TOTAL_W;
  const visible = occ.filter((o) => o.x >= loX && o.x <= hiX);

  const mLo = xToMoment(loX); const mHi = xToMoment(hiX);
  const focusMoment = xToMoment(loX + (hiX - loX) / 2);
  const focusDayMeta = DAYS[focusMoment.dayIndex];
  const winLabel = mLo.dayIndex === mHi.dayIndex
    ? `${DAYS[mLo.dayIndex].label} · ${hhmm(mLo.minutes)}–${hhmm(mHi.minutes)}`
    : `${DAYS[mLo.dayIndex].short} ${hhmm(mLo.minutes)} – ${DAYS[mHi.dayIndex].short} ${hhmm(mHi.minutes)}`;

  // Counts.
  const upcomingN = occ.filter((o) => o.sched.enabled && o.absMin > NOW_ABS && !skipped.has(o.key)).length;
  const skippedN = skipped.size;
  const activeN = schedules.filter((s) => s.enabled && !deleted.has(s.id)).length;

  // Actions.
  const toggleEnabled = (id: string) => setSchedules((ss) => ss.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s)));
  const skip = (key: string) => setSkipped((s) => new Set(s).add(key));
  const unskip = (key: string) => setSkipped((s) => { const n = new Set(s); n.delete(key); return n; });
  const del = (id: string) => setDeleted((d) => new Set(d).add(id));
  const editSched = (id: string) => { const s = schedules.find((x) => x.id === id); setNotice({ icon: 'pencil', text: `Opening editor for “${s ? s.title : 'schedule'}”…` }); };
  const runNow = (key: string) => { const o = occ.find((x) => x.key === key); setNotice({ icon: 'zap', text: `Queued “${o ? o.sched.title : 'run'}” to run now` }); };

  // Scroll helpers (clamp to content).
  const centreLens = () => (lensReady && lens ? (lens[0] + lens[1]) / 2 : cw / 2);
  const scrollTo = (x: number) => setScrollLeft(Math.max(0, Math.min(TOTAL_W - cw, x)));
  const nudgeDay = (dir: number) => scrollTo(scrollLeft + dir * DAY_W);
  const jumpToDay = (dayIndex: number) => scrollTo(dayIndex * DAY_W + DAY_W / 2 - centreLens());

  // Group visible occurrences by day for the agenda.
  const groups: { dayIndex: number; day: DayMeta; items: Occurrence[] }[] = [];
  visible.forEach((o) => {
    const last = groups[groups.length - 1];
    if (last && last.dayIndex === o.dayIndex) last.items.push(o);
    else groups.push({ dayIndex: o.dayIndex, day: o.day, items: [o] });
  });

  return createPortal(
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(8,10,13,0.62)', backdropFilter: 'blur(2px)', WebkitBackdropFilter: 'blur(2px)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '5vh 16px 16px' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="b2-anim-slide"
        style={{ width: '100%', maxWidth: 820, maxHeight: '90vh', display: 'flex', flexDirection: 'column', position: 'relative', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, boxShadow: '0 30px 90px rgba(0,0,0,0.55)', overflow: 'hidden', fontFamily: 'var(--ui-font)' }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 22px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <span style={{ width: 36, height: 36, borderRadius: 9, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--accent-soft)', color: 'var(--accent)' }}>
            <Icon name="calendar" size={18} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700, fontFamily: 'var(--display-font)', letterSpacing: 'var(--display-track)', color: 'var(--fg)' }}>Scheduled runs</div>
            <div style={{ fontSize: 11.5, color: 'var(--fg-muted)', marginTop: 1, fontFamily: 'var(--mono-font)' }}>{upcomingN} upcoming{skippedN ? ` · ${skippedN} skipped` : ''} · {activeN} active schedules</div>
          </div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, position: 'relative' }}>
            <button onClick={() => nudgeDay(-1)} style={soBtn()}><Icon name="chevLeft" size={15} color="var(--fg-muted)" /></button>
            <button
              onClick={() => setCalOpen((o) => !o)}
              style={{ height: 32, padding: '0 12px', display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5, fontWeight: 600, color: 'var(--fg)', border: `1px solid ${calOpen ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 8, background: 'var(--bg)', cursor: 'pointer', fontFamily: 'var(--ui-font)' }}
            >
              {focusDayMeta && focusDayMeta.idx === TODAY_IDX && <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--accent)' }}>Today</span>}
              {focusDayMeta ? focusDayMeta.label : '—'}
              <Icon name="chevDown" size={13} color="var(--fg-muted)" />
            </button>
            <button onClick={() => nudgeDay(1)} style={soBtn()}><Icon name="chevRight" size={15} color="var(--fg-muted)" /></button>
            {calOpen && <CalendarPopover focusDay={focusDayMeta ? focusDayMeta.day : TODAY_DAY} onPick={jumpToDay} onClose={() => setCalOpen(false)} />}
          </div>
          <button onClick={onClose} style={soBtn()}><Icon name="x" size={16} color="var(--fg-muted)" /></button>
        </div>

        {/* Timeline strip */}
        <TimelineStrip
          occ={occ} nextKey={nextKey} soonKeys={soonKeys}
          scrollLeft={scrollLeft} setScrollLeft={setScrollLeft}
          lens={lens} setLens={setLens} cw={cw} setCw={setCw} statusOf={statusOf}
        />

        {/* Window summary */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 22px 4px', flexShrink: 0 }}>
          <span style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--fg-faint)' }}>
            {winLabel}
          </span>
          <span style={{ fontSize: 11, color: 'var(--fg-muted)', fontFamily: 'var(--mono-font)' }}>· {visible.length} run{visible.length === 1 ? '' : 's'} in view</span>
          <button
            onClick={() => scrollTo(NOW_X - centreLens())}
            style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--ui-font)', fontWeight: 600, padding: 0 }}
          >
            <Icon name="clock" size={12} color="var(--accent)" /> Jump to now
          </button>
        </div>

        {/* Agenda list */}
        <div style={{ overflowY: 'auto', overflowX: 'hidden', padding: '2px 22px 8px', flex: 1 }}>
          {visible.length === 0
            ? <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--fg-muted)', fontSize: 13 }}>No runs under the selector. Scroll the timeline or widen the window.</div>
            : groups.map((g) => (
              <div key={g.dayIndex}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 0 6px' }}>
                  <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: g.dayIndex === TODAY_IDX ? 'var(--accent)' : 'var(--fg-faint)' }}>
                    {g.dayIndex === TODAY_IDX ? 'Today' : g.day.label}
                  </span>
                  <span style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                </div>
                {g.items.map((o, i) => (
                  <AgendaRow
                    key={o.key} occ={o} status={statusOf(o)} isNext={o.key === nextKey}
                    onToggle={toggleEnabled} onEdit={editSched} onRunNow={runNow} onSkip={skip} onUnskip={unskip} onDelete={del} border={i > 0}
                  />
                ))}
              </div>
            ))}
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 22px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--fg-muted)', fontFamily: 'var(--mono-font)' }}>
            <span style={{ position: 'relative', width: 8, height: 8, display: 'inline-flex' }}>
              <span className="b2-flash" style={{ position: 'absolute', inset: -1, borderRadius: '50%', background: 'var(--accent)' }} />
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)' }} />
            </span>
            Flashing = upcoming soon
          </span>
          <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--fg-faint)' }}>
            <Icon name="plus" size={12} color="var(--fg-faint)" />
            Add new runs from the report page
          </span>
        </div>

        {/* Transient action toast */}
        {notice && (
          <div style={{ position: 'absolute', left: '50%', bottom: 64, transform: 'translateX(-50%)', zIndex: 20, display: 'inline-flex', alignItems: 'center', gap: 9, padding: '10px 15px', borderRadius: 10, background: 'var(--fg)', color: 'var(--bg)', fontSize: 12.5, fontWeight: 600, fontFamily: 'var(--ui-font)', boxShadow: '0 12px 34px rgba(0,0,0,0.4)', whiteSpace: 'nowrap' }}>
            <Icon name={notice.icon} size={14} color="var(--bg)" />
            {notice.text}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
