/* Brain2 Console — Report history overlay.
   Opens from the "History" link on the Recent reports panel.
   115 entries, paginated 8/page, filterable by format + search + period.
   Format + period are dropdowns (same component family as the Generate overlay). */

const HIST_PAGE_SIZE = 8;

const HIST_FORMAT_PARAM = {
  id: 'format',
  label: 'Type',
  icon: 'file',
  options: [
    { id: 'all',   label: 'All types' },
    { id: 'doc',   label: 'Documents' },
    { id: 'deck',  label: 'Decks' },
    { id: 'video', label: 'Videos' },
  ],
};

const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// Build { year: [month, ...] } map from the dataset
function buildYMMap() {
  const map = {};
  REPORT_HISTORY.forEach((r) => {
    if (!map[r.year]) map[r.year] = new Set();
    map[r.year].add(r.month);
  });
  return Object.fromEntries(
    Object.entries(map).map(([y, ms]) => [Number(y), [...ms].sort((a, b) => b - a)])
  );
}

// Smart ellipsis page range → array of page indices + '…' strings
function buildPageRange(page, pages) {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i);
  const show = new Set(
    [0, pages - 1, page - 1, page, page + 1].filter((p) => p >= 0 && p < pages)
  );
  const sorted = [...show].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] > sorted[i - 1] + 1) out.push('…');
    out.push(sorted[i]);
  }
  return out;
}

// ── Status chip (only for non-ready) ──────────────────────────────────────
function HistStatus({ status }) {
  if (status === 'ready') return null;
  const cfg = {
    processing: { label: 'Generating', icon: 'loader', spin: true,  bg: 'var(--accent-soft)',      fg: 'var(--accent)'      },
    failed:     { label: 'Failed',     icon: 'alert',  spin: false, bg: 'var(--destructive-soft)', fg: 'var(--destructive)' },
  }[status];
  if (!cfg) return null;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 19, padding: '0 7px',
      borderRadius: 5, fontSize: 10, fontWeight: 700, fontFamily: 'var(--mono-font)', letterSpacing: '0.03em',
      color: cfg.fg, background: cfg.bg, flexShrink: 0 }}>
      <span className={cfg.spin ? 'b2-spin' : ''} style={{ display: 'inline-flex' }}>
        <Icon name={cfg.icon} size={10} />
      </span>
      {cfg.label}
    </span>
  );
}

function HistDot() {
  return <span style={{ color: 'var(--border-strong)', userSelect: 'none', flexShrink: 0 }}>·</span>;
}

function histIconBtn() {
  return {
    width: 30, height: 30, borderRadius: 7, border: '1px solid var(--border)',
    background: 'transparent', display: 'flex', alignItems: 'center',
    justifyContent: 'center', cursor: 'pointer', flexShrink: 0,
  };
}

// ── One history row — whole row opens in a new tab ─────────────────────────
function HistoryRow({ r, border }) {
  const f = fmtById(r.format);
  const dim = r.status !== 'ready';
  const openable = r.status === 'ready';

  const open = () => { if (openable) window.open('about:blank', '_blank'); };
  // stop row-open when an action button is pressed
  const stop = (e) => e.stopPropagation();

  return (
    <div
      onClick={open}
      role={openable ? 'button' : undefined}
      tabIndex={openable ? 0 : undefined}
      onKeyDown={(e) => { if (openable && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(); } }}
      className={openable ? 'b2-hist-row' : ''}
      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 8px', margin: '0 -4px',
        borderRadius: 9, borderTop: border ? '1px solid var(--border)' : 'none',
        cursor: openable ? 'pointer' : 'default' }}>

      {/* format icon */}
      <span style={{ width: 34, height: 34, borderRadius: 9, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: r.status === 'failed' ? 'var(--destructive-soft)' : 'var(--surface-2)',
        color:      r.status === 'failed' ? 'var(--destructive)'      : 'var(--accent)' }}>
        <Icon name={f.icon} size={16} />
      </span>

      {/* title + metadata — date lives here on the LEFT */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
          <span style={{ fontSize: 13.5, fontWeight: 600, color: dim ? 'var(--fg-muted)' : 'var(--fg)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0, flexShrink: 1 }}>
            {r.title}
          </span>
          <HistStatus status={r.status} />
        </div>

        {/* meta row — date first, aligned left */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 3,
          fontSize: 11.5, color: 'var(--fg-muted)', fontFamily: 'var(--mono-font)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          <span style={{ color: 'var(--fg-faint)', flexShrink: 0 }}>{r.date}</span>
          <HistDot />
          <span style={{ flexShrink: 0 }}>{f.label}</span>
          <HistDot />
          <span style={{ flexShrink: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.meta}</span>
          <HistDot />
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
            <Icon name={r.by === 'Schedule' ? 'calendar' : 'sparkles'} size={10} color="var(--fg-faint)" />
            {r.by}
          </span>
        </div>
      </div>

      {/* row actions */}
      <div style={{ display: 'flex', gap: 3, flexShrink: 0 }} onClick={stop}>
        {r.status === 'failed'     && <button title="Retry"    style={histIconBtn()}><Icon name="refresh"  size={14} color="var(--fg-muted)" /></button>}
        {r.status === 'processing' && <button title="Cancel"   style={histIconBtn()}><Icon name="x"        size={14} color="var(--fg-muted)" /></button>}
        {r.status === 'ready'      && (
          <button title="Download" onClick={stop} style={histIconBtn()}><Icon name="download" size={14} color="var(--fg-muted)" /></button>
        )}
      </div>
    </div>
  );
}

// ── Generic dropdown chip (same shape as Generate overlay's GenParamChip) ──
function HistDropdown({ icon, label, value, width = 250, children }) {
  const [open, setOpen] = React.useState(false);
  const active = value != null;
  return (
    <div style={{ position: 'relative', display: 'inline-flex' }}>
      <button onClick={() => setOpen((o) => !o)} style={{
        display: 'inline-flex', alignItems: 'center', gap: 7, height: 34, padding: '0 12px', borderRadius: 999, cursor: 'pointer',
        fontFamily: 'var(--ui-font)', fontSize: 12.5, fontWeight: 600, lineHeight: 1,
        border: `1px solid ${open || active ? 'var(--border-strong)' : 'var(--border)'}`,
        background: open ? 'var(--surface-3)' : 'var(--surface-2)', color: 'var(--fg)' }}>
        {icon && <Icon name={icon} size={13} color="var(--accent)" />}
        <span>{label}</span>
        <Icon name="chevDown" size={12} color="var(--fg-muted)" />
      </button>
      {open && (
        <Popover onClose={() => setOpen(false)} style={{ top: 'calc(100% + 6px)', left: 0, width, padding: 6 }}>
          {children({ close: () => setOpen(false) })}
        </Popover>
      )}
    </div>
  );
}

function histSectionLabel() {
  return { fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-faint)' };
}

function histOption(on, onClick, primary, hint) {
  return (
    <button onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', padding: '8px',
      border: 'none', borderRadius: 8, background: on ? 'var(--accent-soft)' : 'transparent',
      cursor: 'pointer', fontFamily: 'var(--ui-font)' }}>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: on ? 'var(--accent)' : 'var(--fg)' }}>{primary}</span>
        {hint && <span style={{ display: 'block', fontSize: 11, color: 'var(--fg-muted)', fontFamily: 'var(--mono-font)', marginTop: 1 }}>{hint}</span>}
      </span>
      {on && <Icon name="check" size={14} color="var(--accent)" />}
    </button>
  );
}

// ── Format-type dropdown ───────────────────────────────────────────────────
function FormatDropdown({ value, onChange, counts }) {
  const cur = HIST_FORMAT_PARAM.options.find((o) => o.id === value) || HIST_FORMAT_PARAM.options[0];
  return (
    <HistDropdown icon={HIST_FORMAT_PARAM.icon} label={cur.label} value={value === 'all' ? null : value} width={230}>
      {({ close }) => (
        <React.Fragment>
          <div style={{ ...histSectionLabel(), padding: '6px 8px 4px' }}>Document type</div>
          {HIST_FORMAT_PARAM.options.map((o) =>
            <React.Fragment key={o.id}>
              {histOption(o.id === value, () => { onChange(o.id); close(); }, o.label,
                counts[o.id] != null ? `${counts[o.id]} report${counts[o.id] === 1 ? '' : 's'}` : null)}
            </React.Fragment>
          )}
        </React.Fragment>
      )}
    </HistDropdown>
  );
}

// ── Period (year + optional month) dropdown ────────────────────────────────
function PeriodDropdown({ selYear, selMonth, onChange }) {
  const ymMap = React.useMemo(() => buildYMMap(), []);
  const years = Object.keys(ymMap).map(Number).sort((a, b) => b - a);
  const availMonths = selYear != null ? (ymMap[selYear] || []) : [];

  let label = 'All time';
  if (selYear != null && selMonth != null) label = `${MONTH_LABELS[selMonth]} ${selYear}`;
  else if (selYear != null) label = String(selYear);

  const monthChip = (active, onClick, text) => (
    <button key={text} onClick={onClick} style={{
      height: 28, borderRadius: 7, cursor: 'pointer',
      border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
      background: active ? 'var(--accent)' : 'transparent',
      color: active ? '#fff' : 'var(--fg-muted)',
      fontFamily: 'var(--mono-font)', fontSize: 11.5, fontWeight: 600,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    }}>{text}</button>
  );

  return (
    <HistDropdown icon="calendar" label={label} value={selYear == null ? null : selYear} width={272}>
      {({ close }) => (
        <React.Fragment>
          <div style={{ ...histSectionLabel(), padding: '6px 8px 4px' }}>Year</div>
          {histOption(selYear == null, () => { onChange(null, null); close(); }, 'All time',
            `${REPORT_HISTORY.length} reports`)}
          {years.map((y) =>
            <React.Fragment key={y}>
              {histOption(selYear === y, () => onChange(y, null), String(y),
                `${REPORT_HISTORY.filter((r) => r.year === y).length} reports`)}
            </React.Fragment>
          )}

          {selYear != null && (
            <React.Fragment>
              <div style={{ height: 1, background: 'var(--border)', margin: '6px 4px' }} />
              <div style={{ ...histSectionLabel(), padding: '2px 8px 7px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>Month</span>
                {selMonth != null && (
                  <button onClick={() => onChange(selYear, null)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--accent)', fontFamily: 'var(--ui-font)', fontSize: 11, fontWeight: 600, textTransform: 'none', letterSpacing: 0, padding: 0 }}>Clear</button>
                )}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 5, padding: '0 4px 4px' }}>
                {MONTH_LABELS.map((m, i) => {
                  const avail = availMonths.includes(i);
                  if (!avail) return (
                    <span key={m} style={{ height: 28, borderRadius: 7, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--mono-font)', fontSize: 11.5, fontWeight: 600, color: 'var(--fg-faint)', opacity: 0.4 }}>{m}</span>
                  );
                  return monthChip(selMonth === i, () => onChange(selYear, selMonth === i ? null : i), m);
                })}
              </div>
            </React.Fragment>
          )}
        </React.Fragment>
      )}
    </HistDropdown>
  );
}

// ── Ellipsis-aware paginator ───────────────────────────────────────────────
function Pager({ page, pages, onPage }) {
  if (pages <= 1) return null;
  const range = buildPageRange(page, pages);
  const btn = (active, disabled) => ({
    minWidth: 30, height: 30, padding: '0 4px', borderRadius: 7,
    cursor: disabled ? 'default' : 'pointer',
    border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
    background: active ? 'var(--accent)' : 'transparent',
    color: active ? '#fff' : disabled ? 'var(--fg-faint)' : 'var(--fg)',
    fontFamily: 'var(--mono-font)', fontSize: 12, fontWeight: 600,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    opacity: disabled ? 0.4 : 1, flexShrink: 0,
  });
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
      <button disabled={page === 0} onClick={() => onPage(page - 1)} style={btn(false, page === 0)}>
        <Icon name="chevLeft" size={14} />
      </button>
      {range.map((r, i) =>
        r === '…'
          ? <span key={`el${i}`} style={{ color: 'var(--fg-faint)', fontSize: 12, padding: '0 3px', userSelect: 'none', lineHeight: 1 }}>…</span>
          : <button key={r} onClick={() => onPage(r)} style={btn(r === page, false)}>{r + 1}</button>
      )}
      <button disabled={page === pages - 1} onClick={() => onPage(page + 1)} style={btn(false, page === pages - 1)}>
        <Icon name="chevRight" size={14} />
      </button>
    </div>
  );
}

// ── Main overlay ───────────────────────────────────────────────────────────
function HistoryOverlay({ onClose }) {
  const [filter,   setFilter]   = React.useState('all');
  const [query,    setQuery]    = React.useState('');
  const [page,     setPage]     = React.useState(0);
  const [selYear,  setSelYear]  = React.useState(null);
  const [selMonth, setSelMonth] = React.useState(null);

  // Esc to close
  React.useEffect(() => {
    const fn = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [onClose]);

  // 1. period filter
  const ymFiltered = React.useMemo(() =>
    REPORT_HISTORY.filter((r) =>
      (selYear  == null || r.year  === selYear) &&
      (selMonth == null || r.month === selMonth)
    ), [selYear, selMonth]);

  // 2. counts for format dropdown (based on period result, before format/search)
  const counts = React.useMemo(() => {
    const c = { all: ymFiltered.length, doc: 0, deck: 0, video: 0 };
    ymFiltered.forEach((r) => { c[r.format] = (c[r.format] || 0) + 1; });
    return c;
  }, [ymFiltered]);

  // 3. format + search filter
  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return ymFiltered.filter((r) =>
      (filter === 'all' || r.format === filter) &&
      (!q || r.title.toLowerCase().includes(q) || r.cat.toLowerCase().includes(q))
    );
  }, [ymFiltered, filter, query]);

  // Reset page when any filter changes
  React.useEffect(() => { setPage(0); }, [filter, query, selYear, selMonth]);

  const pages    = Math.max(1, Math.ceil(filtered.length / HIST_PAGE_SIZE));
  const safePage = Math.min(page, pages - 1);
  const start    = safePage * HIST_PAGE_SIZE;
  const shown    = filtered.slice(start, start + HIST_PAGE_SIZE);

  return (
    <div onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(8,10,13,0.55)',
        backdropFilter: 'blur(3px)', WebkitBackdropFilter: 'blur(3px)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '5vh 16px 16px' }}>

      <div onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 820, maxHeight: '90vh',
          display: 'flex', flexDirection: 'column', borderRadius: 16,
          border: '1px solid var(--border)', background: 'var(--bg)',
          boxShadow: '0 28px 90px rgba(0,0,0,0.55)', overflow: 'hidden',
          fontFamily: 'var(--ui-font)' }}>

        {/* ── Header ──────────────────────────────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '17px 22px',
          borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <span style={{ width: 34, height: 34, borderRadius: 9, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--accent-soft)', color: 'var(--accent)' }}>
            <Icon name="history" size={17} />
          </span>
          <div style={{ flex: 1, minWidth: 0, fontSize: 16, fontWeight: 700, fontFamily: 'var(--display-font)',
            letterSpacing: 'var(--display-track)', color: 'var(--fg)' }}>Report history</div>
          <button onClick={onClose}
            style={{ width: 33, height: 33, borderRadius: 8, border: '1px solid var(--border)',
              background: 'transparent', color: 'var(--fg-muted)', flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
            <Icon name="x" size={16} />
          </button>
        </div>

        {/* ── Toolbar: type + period dropdowns + search ───────────────── */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 12, padding: '12px 22px', borderBottom: '1px solid var(--border)',
          background: 'var(--surface)', flexWrap: 'wrap', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
            <FormatDropdown value={filter} onChange={setFilter} counts={counts} />
            <PeriodDropdown selYear={selYear} selMonth={selMonth}
              onChange={(y, m) => { setSelYear(y); setSelMonth(m); }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 34, padding: '0 11px',
            borderRadius: 999, border: '1px solid var(--border)', background: 'var(--bg)',
            width: 210, maxWidth: '100%' }}>
            <Icon name="search" size={14} color="var(--fg-muted)" />
            <input value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder="Search reports…"
              style={{ flex: 1, minWidth: 0, border: 'none', background: 'transparent',
                outline: 'none', color: 'var(--fg)', fontFamily: 'var(--ui-font)', fontSize: 13 }} />
            {query && (
              <button onClick={() => setQuery('')}
                style={{ border: 'none', background: 'transparent', cursor: 'pointer',
                  color: 'var(--fg-muted)', display: 'flex', padding: 0 }}>
                <Icon name="x" size={13} />
              </button>
            )}
          </div>
        </div>

        {/* ── List ────────────────────────────────────────────────────── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 22px 8px' }}>
          {shown.length > 0
            ? shown.map((r, i) => <HistoryRow key={r.id} r={r} border={i > 0} />)
            : (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center',
                gap: 10, padding: '52px 20px', textAlign: 'center' }}>
                <span style={{ width: 44, height: 44, borderRadius: 12,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'var(--surface-2)', color: 'var(--fg-faint)' }}>
                  <Icon name="search" size={20} />
                </span>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)' }}>No reports found</div>
                <div style={{ fontSize: 12.5, color: 'var(--fg-muted)' }}>Try a different type, period, or search term.</div>
              </div>
            )
          }
        </div>

        {/* ── Pagination row ───────────────────────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 12, padding: '11px 22px', borderTop: '1px solid var(--border)',
          background: 'var(--surface)', flexWrap: 'wrap', flexShrink: 0 }}>
          <span style={{ fontSize: 11.5, color: 'var(--fg-muted)', fontFamily: 'var(--mono-font)' }}>
            {filtered.length === 0
              ? 'No results'
              : `${start + 1}–${Math.min(start + HIST_PAGE_SIZE, filtered.length)} of ${filtered.length}`}
          </span>
          <Pager page={safePage} pages={pages} onPage={setPage} />
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { HistoryOverlay });
