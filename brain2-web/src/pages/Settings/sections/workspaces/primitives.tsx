/*
 * Shared primitives for the Workspaces page — ported from components.jsx /
 * settings.jsx / workspaces-panels.jsx so the page is self-contained.
 *   useStored, sbtn/iconBtn/ingPill/ingRowBtn (style helpers), IngMenu (popover),
 *   Avatar, OverlayShell + WsDrawer (overlay chrome), MiniSelect, LevelSelect,
 *   AddPersonBar, AccessRow.
 */
import {
  useEffect, useLayoutEffect, useRef, useState,
  type CSSProperties, type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '@/components/ui/Icon';
import type { IconName } from '@/components/ui/Icon';

// ── localStorage-backed state ───────────────────────────────────────────────
export function useStored<T extends string>(key: string, init: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try { return (localStorage.getItem(key) as T | null) || init; } catch { return init; }
  });
  useEffect(() => { try { localStorage.setItem(key, v); } catch { /* ignore */ } }, [key, v]);
  return [v, setV];
}

// ── style helpers ───────────────────────────────────────────────────────────
export function sbtn(kind?: 'primary' | 'danger'): CSSProperties {
  const base: CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 6, height: 32, padding: '0 13px', borderRadius: 8,
    fontFamily: 'var(--ui-font)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', border: '1px solid transparent', whiteSpace: 'nowrap',
  };
  if (kind === 'primary') return { ...base, background: 'var(--accent)', color: '#fff' };
  if (kind === 'danger') return { ...base, background: 'transparent', color: 'var(--destructive)', borderColor: 'var(--border)' };
  return { ...base, background: 'transparent', color: 'var(--fg)', borderColor: 'var(--border)' };
}

export function iconBtn(): CSSProperties {
  return {
    width: 33, height: 33, borderRadius: 8, border: '1px solid var(--border)', background: 'transparent',
    display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
  };
}

export function ingPill(open: boolean, full?: boolean): CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 6, width: full ? '100%' : 'auto', maxWidth: '100%', height: 28, padding: '0 9px',
    borderRadius: 7, border: `1px solid ${open ? 'var(--accent)' : 'var(--border)'}`, background: 'var(--surface)', color: 'var(--fg)',
    fontFamily: 'var(--ui-font)', fontSize: 12, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap',
  };
}

export function ingRowBtn(): CSSProperties {
  return {
    display: 'flex', alignItems: 'center', gap: 9, width: '100%', minHeight: 34, padding: '0 9px', borderRadius: 8,
    border: 'none', background: 'transparent', color: 'var(--fg)', fontFamily: 'var(--ui-font)', fontSize: 12.5, cursor: 'pointer', textAlign: 'left',
  };
}

// ── Lightweight fixed-position popover. children is (close) => content ───────
export function IngMenu({ trigger, width = 240, align = 'left', full = false, children }: {
  trigger: (open: boolean) => ReactNode;
  width?: number;
  align?: 'left' | 'right';
  full?: boolean;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  useLayoutEffect(() => {
    if (open && ref.current) {
      const r = ref.current.getBoundingClientRect();
      let left = align === 'right' ? r.right - width : r.left;
      left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
      let top = r.bottom + 6;
      if (top + 280 > window.innerHeight) top = Math.max(8, r.top - 6 - 280);
      setPos({ left, top });
    }
  }, [open, align, width]);
  const close = () => setOpen(false);
  return (
    <>
      <div ref={ref} onClick={() => setOpen((o) => !o)} style={{ display: full ? 'block' : 'inline-flex', width: full ? '100%' : 'auto', minWidth: 0 }}>
        {trigger(open)}
      </div>
      {open && createPortal(
        <>
          <div onClick={close} style={{ position: 'fixed', inset: 0, zIndex: 305 }} />
          <div className="b2-anim-pop" style={{ position: 'fixed', left: pos.left, top: pos.top, width, zIndex: 306, background: 'var(--surface)', border: '1px solid var(--border-strong)', borderRadius: 12, boxShadow: '0 18px 50px rgba(0,0,0,0.45)', overflow: 'hidden' }}>
            {children(close)}
          </div>
        </>,
        document.body,
      )}
    </>
  );
}

// ── Avatar ──────────────────────────────────────────────────────────────────
export function Avatar({ u, label, size = 32 }: { u: string; label?: string; size?: number }) {
  const initial = (label || u || '?')[0].toUpperCase();
  return (
    <span style={{ width: size, height: size, flexShrink: 0, borderRadius: '50%', background: 'var(--surface-2)', color: 'var(--fg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.4, fontWeight: 600 }}>
      {initial}
    </span>
  );
}

interface ShellProps {
  title: ReactNode;
  sub?: string;
  icon: IconName;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}

// ── Generic right slide-over ────────────────────────────────────────────────
export function WsDrawer({ title, sub, icon, onClose, children, footer, width = 452 }: ShellProps) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const r = requestAnimationFrame(() => setShown(true));
    const t = setTimeout(() => setShown(true), 30);
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', k);
    return () => { cancelAnimationFrame(r); clearTimeout(t); document.removeEventListener('keydown', k); };
  }, [onClose]);
  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 200 }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(8,9,12,0.5)', backdropFilter: 'blur(2px)', opacity: shown ? 1 : 0, transition: 'opacity .2s' }} />
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: `min(${width}px, 94vw)`, background: 'var(--surface)', borderLeft: '1px solid var(--border-strong)', boxShadow: '-16px 0 48px rgba(0,0,0,0.34)', display: 'flex', flexDirection: 'column', transform: shown ? 'none' : 'translateX(100%)', transition: 'transform .26s cubic-bezier(.32,.72,0,1)' }}>
        <ShellHeader title={title} sub={sub} icon={icon} onClose={onClose} />
        <div style={{ flex: 1, overflowY: 'auto', padding: 18 }}>{children}</div>
        {footer && <div style={{ flexShrink: 0, padding: '14px 18px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

// ── Centered overlay shell (same prop surface as WsDrawer) ───────────────────
export function OverlayShell({ title, sub, icon, onClose, children, footer, width = 520 }: ShellProps) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const r = requestAnimationFrame(() => setShown(true));
    const t = setTimeout(() => setShown(true), 30);
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', k);
    return () => { cancelAnimationFrame(r); clearTimeout(t); document.removeEventListener('keydown', k); };
  }, [onClose]);
  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(8,9,12,0.55)', backdropFilter: 'blur(3px)', WebkitBackdropFilter: 'blur(3px)', opacity: shown ? 1 : 0, transition: 'opacity .2s' }} />
      <div style={{ position: 'relative', width, maxWidth: '100%', maxHeight: '88vh', background: 'var(--surface)', border: '1px solid var(--border-strong)', borderRadius: 16, boxShadow: '0 28px 80px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', overflow: 'hidden', transform: shown ? 'none' : 'translateY(10px) scale(.985)', opacity: shown ? 1 : 0, transition: 'all .22s cubic-bezier(.32,.72,0,1)' }}>
        <ShellHeader title={title} sub={sub} icon={icon} onClose={onClose} />
        <div style={{ flex: 1, overflowY: 'auto', padding: 18 }}>{children}</div>
        {footer && <div style={{ flexShrink: 0, padding: '14px 18px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

function ShellHeader({ title, sub, icon, onClose }: { title: ReactNode; sub?: string; icon: IconName; onClose: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 18px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
      <span style={{ width: 36, height: 36, borderRadius: 9, background: 'var(--accent-soft)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name={icon} size={18} /></span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--fg)', fontFamily: 'var(--display-font)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
        {sub && <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 1 }}>{sub}</div>}
      </div>
      <button onClick={onClose} style={{ ...iconBtn(), width: 32, height: 32 }} title="Close"><Icon name="x" size={16} color="var(--fg-muted)" /></button>
    </div>
  );
}

export type Shell = typeof OverlayShell;

// ── Select option shape ─────────────────────────────────────────────────────
export interface SelectOption {
  id: string;
  label: string;
  icon?: IconName;
  desc?: string;
  danger?: boolean;
  divider?: boolean;
}

// ── tiny dropdown (role / access level / workspace) ─────────────────────────
export function MiniSelect({ value, options, onPick, disabled, width = 168, align = 'right', icon }: {
  value: string;
  options: SelectOption[];
  onPick: (id: string) => void;
  disabled?: boolean;
  width?: number;
  align?: 'left' | 'right';
  icon?: IconName;
}) {
  const cur = options.find((o) => o.id === value) || options[0];
  if (disabled) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 28, padding: '0 9px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--fg-muted)', fontSize: 12, fontWeight: 500 }}>
        {icon && <Icon name={cur.icon || icon} size={13} color="var(--fg-faint)" />}{cur.label}
      </span>
    );
  }
  return (
    <IngMenu width={width} align={align} trigger={(open) => (
      <button style={ingPill(open)}>
        {(icon || cur.icon) && <Icon name={(cur.icon || icon) as IconName} size={13} color="var(--fg-muted)" />}
        <span>{cur.label}</span>
        <Icon name="chevDown" size={12} color="var(--fg-muted)" />
      </button>
    )}>
      {(close) => (
        <div style={{ padding: 6 }}>
          {options.map((o) => (
            <div key={o.id}>
              {o.divider && <div style={{ height: 1, background: 'var(--border)', margin: '5px 6px' }} />}
              <button onClick={() => { onPick(o.id); close(); }} style={{ ...ingRowBtn(), alignItems: 'flex-start', padding: '8px 9px' }}>
                {o.icon && <Icon name={o.icon} size={14} color={o.danger ? 'var(--destructive)' : (value === o.id ? 'var(--accent)' : 'var(--fg-muted)')} style={{ marginTop: 1 }} />}
                <span style={{ flex: 1 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <b style={{ fontWeight: 600, fontSize: 12.5, color: o.danger ? 'var(--destructive)' : 'var(--fg)' }}>{o.label}</b>
                    {value === o.id && !o.danger && <Icon name="check" size={13} color="var(--accent)" />}
                  </span>
                  {o.desc && <span style={{ display: 'block', fontSize: 11, color: 'var(--fg-muted)', marginTop: 2, lineHeight: 1.4 }}>{o.desc}</span>}
                </span>
              </button>
            </div>
          ))}
        </div>
      )}
    </IngMenu>
  );
}

// ── level / role dropdown sized to sit beside the add-member input ──────────
export function LevelSelect({ value, options, onPick, width = 200 }: {
  value: string;
  options: SelectOption[];
  onPick: (id: string) => void;
  width?: number;
}) {
  const cur = options.find((o) => o.id === value) || options[0];
  return (
    <IngMenu width={width} align="right" trigger={(open) => (
      <button style={{ display: 'inline-flex', alignItems: 'center', gap: 7, height: 38, padding: '0 11px', borderRadius: 9, border: `1px solid ${open ? 'var(--accent)' : 'var(--border)'}`, background: 'var(--bg)', color: 'var(--fg)', fontFamily: 'var(--ui-font)', fontSize: 12.5, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>
        <Icon name={cur.icon || 'shield'} size={13} color="var(--fg-muted)" />
        <span>{cur.label}</span>
        <Icon name="chevDown" size={12} color="var(--fg-muted)" />
      </button>
    )}>
      {(close) => (
        <div style={{ padding: 6 }}>
          {options.map((o) => (
            <button key={o.id} onClick={() => { onPick(o.id); close(); }} style={{ ...ingRowBtn(), alignItems: 'flex-start', padding: '8px 9px' }}>
              <Icon name={o.icon || 'shield'} size={14} color={value === o.id ? 'var(--accent)' : 'var(--fg-muted)'} style={{ marginTop: 1 }} />
              <span style={{ flex: 1 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <b style={{ fontWeight: 600, fontSize: 12.5, color: 'var(--fg)' }}>{o.label}</b>
                  {value === o.id && <Icon name="check" size={13} color="var(--accent)" />}
                </span>
                {o.desc && <span style={{ display: 'block', fontSize: 11, color: 'var(--fg-muted)', marginTop: 2, lineHeight: 1.4 }}>{o.desc}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </IngMenu>
  );
}

export interface Candidate { u: string; name: string; email: string }

// ── Add-member bar ──────────────────────────────────────────────────────────
// Type a name or email → live suggestions → pick a level → press "+" to add.
// onAdd(key, level): key is a directory id for known people, or the raw email.
export function AddPersonBar({ candidates, levelOptions, defaultLevel, onAdd, placeholder = 'Enter email or name' }: {
  candidates: Candidate[];
  levelOptions: SelectOption[];
  defaultLevel: string;
  onAdd: (key: string, level: string) => void;
  placeholder?: string;
}) {
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Candidate | null>(null);
  const [level, setLevel] = useState(defaultLevel);
  const [focused, setFocused] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const blurT = useRef<ReturnType<typeof setTimeout> | null>(null);

  const q = query.trim().toLowerCase();
  const matches = (q
    ? candidates.filter((c) => c.name.toLowerCase().includes(q) || (c.email || '').toLowerCase().includes(q))
    : candidates).slice(0, 6);
  const isEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(query.trim());
  const exact = candidates.find((c) => c.name.toLowerCase() === q || (c.email || '').toLowerCase() === q);
  const showExternal = isEmail && !exact;
  const open = focused && !picked && (matches.length > 0 || showExternal);
  const canAdd = !!picked || !!exact || showExternal;

  const pick = (c: Candidate) => { setPicked(c); setQuery(c.name); setFocused(false); setActiveIdx(0); };
  const reset = () => { setPicked(null); setQuery(''); setActiveIdx(0); };
  const commit = () => {
    if (picked) onAdd(picked.u, level);
    else if (exact) onAdd(exact.u, level);
    else if (showExternal) onAdd(query.trim(), level);
    else return;
    reset();
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setFocused(true); setActiveIdx((i) => Math.min(i + 1, matches.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (open && matches[activeIdx]) pick(matches[activeIdx]); else commit(); }
    else if (e.key === 'Escape') { setFocused(false); }
  };

  const inputStyle: CSSProperties = { width: '100%', height: 38, padding: '0 34px 0 12px', borderRadius: 9, border: `1px solid ${focused ? 'var(--accent)' : 'var(--border)'}`, background: 'var(--bg)', color: 'var(--fg)', fontFamily: 'var(--ui-font)', fontSize: 13, outline: 'none', boxShadow: focused ? '0 0 0 3px var(--accent-soft)' : 'none', transition: 'border-color .12s, box-shadow .12s' };

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
      <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
        <input
          value={query} placeholder={placeholder} style={inputStyle}
          onChange={(e) => { setQuery(e.target.value); setPicked(null); setActiveIdx(0); }}
          onFocus={() => { if (blurT.current) clearTimeout(blurT.current); setFocused(true); }}
          onBlur={() => { blurT.current = setTimeout(() => setFocused(false), 130); }}
          onKeyDown={onKey}
        />
        {picked
          ? <span style={{ position: 'absolute', right: 11, top: 11, color: 'var(--accent)' }}><Icon name="check" size={16} color="var(--accent)" /></span>
          : <span style={{ position: 'absolute', right: 11, top: 11, color: 'var(--fg-faint)', pointerEvents: 'none' }}><Icon name="search" size={15} color="var(--fg-faint)" /></span>}
        {open && (
          <div style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0, zIndex: 50, background: 'var(--surface)', border: '1px solid var(--border-strong)', borderRadius: 11, boxShadow: '0 18px 50px rgba(0,0,0,0.4)', overflow: 'hidden', padding: 5 }}>
            {matches.map((c, i) => (
              <button
                key={c.u}
                onMouseDown={(e) => { e.preventDefault(); pick(c); }}
                onMouseEnter={() => setActiveIdx(i)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '7px 8px', border: 'none', borderRadius: 8, background: activeIdx === i ? 'var(--surface-2)' : 'transparent', cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--ui-font)' }}
              >
                <Avatar u={c.u} label={c.name} size={28} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--fg)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</span>
                  {c.email && <span style={{ display: 'block', fontSize: 11, color: 'var(--fg-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.email}</span>}
                </span>
              </button>
            ))}
            {showExternal && (
              <button
                onMouseDown={(e) => { e.preventDefault(); onAdd(query.trim(), level); reset(); }}
                style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '8px 8px', border: 'none', borderRadius: 8, background: 'transparent', cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--ui-font)' }}
              >
                <span style={{ width: 28, height: 28, borderRadius: '50%', flexShrink: 0, background: 'var(--accent-soft)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="plus" size={14} color="var(--accent)" /></span>
                <span style={{ fontSize: 12.5, color: 'var(--fg)' }}>Invite <b style={{ fontWeight: 600 }}>{query.trim()}</b> by email</span>
              </button>
            )}
          </div>
        )}
      </div>
      <LevelSelect value={level} options={levelOptions} onPick={setLevel} />
      <button
        onMouseDown={(e) => e.preventDefault()} onClick={commit} disabled={!canAdd} title="Add to list"
        style={{ width: 38, height: 38, flexShrink: 0, borderRadius: 9, border: 'none', background: canAdd ? 'var(--accent)' : 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: canAdd ? 'pointer' : 'not-allowed' }}
      >
        <Icon name="plus" size={18} color={canAdd ? '#fff' : 'var(--fg-faint)'} />
      </button>
    </div>
  );
}

// ── shared access row — used by workspace members AND vault access ───────────
export function AccessRow({ u, name, sub, tag, value, options, locked, badge, canRemove, onChange, onRemove, avatarSize = 32 }: {
  u: string;
  name: ReactNode;
  sub?: string;
  tag?: ReactNode;
  value: string;
  options: SelectOption[];
  locked?: boolean;
  badge?: ReactNode;
  canRemove?: boolean;
  onChange: (id: string) => void;
  onRemove: () => void;
  avatarSize?: number;
}) {
  const opts: SelectOption[] = canRemove
    ? [...options, { id: '__remove', label: 'Remove access', icon: 'trash', danger: true, divider: true }]
    : options;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '10px 4px', borderBottom: '1px solid var(--border)' }}>
      <Avatar u={u} size={avatarSize} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--fg)', display: 'flex', alignItems: 'center', gap: 7 }}>{name}{tag}</div>
        {sub && <div style={{ fontSize: 12, color: 'var(--fg-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</div>}
      </div>
      {locked
        ? badge
        : <MiniSelect value={value} width={188} icon="shield" options={opts} onPick={(v) => { if (v === '__remove') onRemove(); else onChange(v); }} />}
    </div>
  );
}
