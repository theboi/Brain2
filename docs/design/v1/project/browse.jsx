/* Brain2 Console — shared "browse" chrome for Sources + Wiki.
   One vocabulary for both pages:
   · Desktop  = Sidebar (button? + filter dropdown chips + collapsible project
                folders with nested items) ▸ detail pane.
   · Mobile   = filter dropdown chips + searchable list ▸ detail (back button).
   The active project/filter is ALWAYS visible (as chips), never hidden behind
   an icon, and mobile always lands on the list/picker — never an item. */

const BTONE = { accent: 'var(--accent)', success: 'var(--success)', warning: 'var(--warning)', destructive: 'var(--destructive)', muted: 'var(--fg-muted)' };
const BSOFT = { accent: 'var(--accent-soft)', success: 'var(--success-soft)', warning: 'var(--warning-soft)', destructive: 'var(--destructive-soft)', muted: 'var(--surface-2)' };

// ── A single filter dropdown chip (label reflects current selection) ──────────
function FilterChip({ icon, label, tone, active, open, size = 'm', onClick }) {
  const s = size === 's';
  const c = active ? (tone ? BTONE[tone] : 'var(--accent)') : 'var(--fg-muted)';
  const bg = active ? (tone ? BSOFT[tone] : 'var(--accent-soft)') : 'var(--surface)';
  const bd = open ? 'var(--accent)' : (active ? (tone ? BTONE[tone] : 'var(--accent-line)') : 'var(--border)');
  return (
    <button onClick={onClick} style={{ display: 'inline-flex', alignItems: 'center', gap: s ? 5 : 6, height: s ? 28 : 34, padding: s ? '0 9px' : '0 11px', borderRadius: 9, whiteSpace: 'nowrap', cursor: 'pointer', flexShrink: 0,
      border: `1px solid ${bd}`, background: bg, color: c, fontFamily: 'var(--ui-font)', fontSize: s ? 11.5 : 12.5, fontWeight: active ? 600 : 500 }}>
      {icon && <Icon name={icon} size={s ? 12 : 13} color={c} />}
      {label}
      <Icon name="chevDown" size={s ? 11 : 12} color={c} style={{ transition: 'transform .15s', transform: open ? 'rotate(180deg)' : 'none' }} />
    </button>
  );
}

// Fixed-position popover (escapes sidebar overflow via position:fixed; stays in
// the themed tree so CSS tokens resolve) anchored under a chip.
function ChipMenu({ rect, title, options, value, onPick, onClose, width = 188, align = 'left' }) {
  if (!rect) return null;
  const left = align === 'right' ? Math.max(8, rect.right - width) : Math.min(rect.left, window.innerWidth - width - 8);
  const top = Math.min(rect.bottom + 6, window.innerHeight - 12);
  return (
    <React.Fragment>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 300 }} />
      <div style={{ position: 'fixed', top, left, width, zIndex: 301, maxHeight: '60vh', overflowY: 'auto', background: 'var(--surface)', border: '1px solid var(--border-strong)', borderRadius: 12, boxShadow: '0 16px 40px rgba(0,0,0,0.42)', padding: 6, fontFamily: 'var(--ui-font)' }}>
        {title && <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-faint)', padding: '6px 9px 4px' }}>{title}</div>}
        {options.map((o) => {
          const on = o.value === value;
          return (
            <button key={o.value} onClick={() => { onPick(o.value); onClose(); }} style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', height: 36, padding: '0 9px', borderRadius: 8, border: 'none', cursor: 'pointer', background: on ? 'var(--accent-soft)' : 'transparent', fontFamily: 'var(--ui-font)' }}>
              <Icon name={o.icon || 'dot'} size={14} color={o.tone ? BTONE[o.tone] : (on ? 'var(--accent)' : 'var(--fg-muted)')} />
              <span style={{ flex: 1, textAlign: 'left', fontSize: 13, fontWeight: on ? 600 : 500, color: on ? 'var(--fg)' : 'var(--fg-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{o.label}</span>
              {o.count != null && <span style={{ fontSize: 11, fontFamily: 'var(--mono-font)', color: 'var(--fg-faint)' }}>{o.count}</span>}
              {on && <Icon name="check" size={14} color="var(--accent)" />}
            </button>
          );
        })}
      </div>
    </React.Fragment>
  );
}

/* A row of filter dropdown chips with self-managed open/close + popover.
   defs: [{ key, icon, label, tone, active, title, options:[{value,label,icon,count,tone}], value, onPick, align }] */
function FilterChips({ defs, size = 'm', style }) {
  const [open, setOpen] = React.useState(null); // { key, rect }
  return (
    <React.Fragment>
      <div className="b2-tabscroll" style={{ display: 'flex', gap: 8, alignItems: 'center', overflowX: 'auto', ...style }}>
        {defs.map((d) => (
          <FilterChip key={d.key} icon={d.icon} label={d.label} tone={d.tone} active={d.active} size={size} open={open && open.key === d.key}
            onClick={(e) => setOpen(open && open.key === d.key ? null : { key: d.key, rect: e.currentTarget.getBoundingClientRect() })} />
        ))}
      </div>
      {open && (() => {
        const d = defs.find((x) => x.key === open.key);
        return d ? <ChipMenu rect={open.rect} title={d.title} options={d.options} value={d.value} align={d.align} width={d.menuWidth} onPick={d.onPick} onClose={() => setOpen(null)} /> : null;
      })()}
    </React.Fragment>
  );
}

// ── Collapsible project folder (the "dropdown for each project", wiki-style) ──
function Folder({ icon = 'folder', label, count, open, onToggle, children }) {
  return (
    <div style={{ marginBottom: 2 }}>
      <button onClick={onToggle} style={{ display: 'flex', alignItems: 'center', gap: 7, width: '100%', height: 31, padding: '0 8px', borderRadius: 7, border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'var(--ui-font)' }}>
        <Icon name={open ? 'chevDown' : 'chevRight'} size={12} color="var(--fg-muted)" />
        <Icon name={icon} size={13} color="var(--fg-muted)" />
        <span style={{ flex: 1, textAlign: 'left', fontSize: 12.5, fontWeight: 600, color: 'var(--fg)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
        {count != null && <span style={{ fontSize: 11, color: 'var(--fg-faint)', fontFamily: 'var(--mono-font)' }}>{count}</span>}
      </button>
      {open && <div>{children}</div>}
    </div>
  );
}

// A nested item row inside a folder (sidebar) — icon + label + optional badge/meta.
function NestRow({ icon, iconTone, label, active, badge, meta, rightIcon, rightTone, onClick }) {
  return (
    <button onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', height: 31, padding: '0 10px 0 27px', borderRadius: 7, border: 'none', cursor: 'pointer',
      background: active ? 'var(--accent-soft)' : 'transparent', fontFamily: 'var(--ui-font)' }}>
      <Icon name={icon} size={13.5} color={iconTone ? BTONE[iconTone] : (active ? 'var(--accent)' : 'var(--fg-faint)')} />
      <span style={{ flex: 1, minWidth: 0, textAlign: 'left', fontSize: 12.5, fontWeight: active ? 600 : 500, color: active ? 'var(--fg)' : 'var(--fg-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
      {badge && <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--accent)', background: 'var(--accent-soft)', borderRadius: 5, padding: '1px 5px', letterSpacing: '0.04em', flexShrink: 0 }}>{badge}</span>}
      {meta && <span style={{ fontSize: 10.5, color: 'var(--fg-faint)', fontFamily: 'var(--mono-font)', flexShrink: 0 }}>{meta}</span>}
      {rightIcon && <Icon name={rightIcon} size={12.5} color={rightTone ? BTONE[rightTone] : 'var(--fg-faint)'} />}
    </button>
  );
}

// Sidebar search field (shared).
function SidebarSearch({ value, onChange, placeholder }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, height: 34, padding: '0 11px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)' }}>
      <Icon name="search" size={15} color="var(--fg-muted)" />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent', color: 'var(--fg)', fontSize: 13, fontFamily: 'var(--ui-font)' }} />
    </div>
  );
}

Object.assign(window, { BTONE, BSOFT, FilterChip, ChipMenu, FilterChips, Folder, NestRow, SidebarSearch });
