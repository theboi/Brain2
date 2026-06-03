/*
 * TopBar — brand + workspace switcher + global search + inbox bell + profile.
 * Matches the design spec exactly: 52px height, Inter Display brand mark,
 * pill-shaped workspace switcher, centered search bar (hidden on mobile),
 * notification bell with unread count badge, profile avatar chip.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '@/components/ui/Icon';
import { Popover } from '@/components/ui/Popover';
import type { Theme } from '@/lib/tokens';

const WORKSPACES = [
  { id: 'default',     name: 'default',     role: 'Owner', members: 6 },
  { id: 'research-q3', name: 'research-q3', role: 'Admin', members: 4 },
  { id: 'personal',    name: 'personal',    role: 'Owner', members: 1 },
];

const PALETTE_GROUPS = [
  { group: 'Pages', items: [
    { label: 'Home',     icon: 'home',     href: '/' },
    { label: 'Sources',  icon: 'sources',  href: '/sources' },
    { label: 'Wiki',     icon: 'wiki',     href: '/wiki' },
    { label: 'Chats',    icon: 'chats',    href: '/chats' },
    { label: 'Settings', icon: 'settings', href: '/settings' },
  ] },
  { group: 'Actions', items: [
    { label: 'Ingest a source', icon: 'download', href: '/sources' },
    { label: 'New chat',        icon: 'plus',     href: '/chats' },
    { label: 'Open settings',   icon: 'settings', href: '/settings' },
  ] },
] as const;

// ── Style helpers ────────────────────────────────────────────────────────────
const pillBtn = (): React.CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  gap: 7,
  height: 33,
  padding: '0 11px',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  color: 'var(--fg)',
  fontFamily: 'var(--ui-font)',
  fontSize: 13,
  cursor: 'pointer',
});

const iconBtn = (): React.CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 32,
  height: 32,
  borderRadius: 'var(--radius-md)',
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
});

// ── Sub-components ───────────────────────────────────────────────────────────
function WorkspaceMenu({ current, onPick, onClose }: {
  current: string;
  onPick: (name: string) => void;
  onClose: () => void;
}) {
  return (
    <Popover onClose={onClose} style={{ top: 44, left: 0, width: 240, padding: 6 }}>
      <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-faint)', padding: '6px 8px 4px' }}>
        Workspaces
      </div>
      {WORKSPACES.map((w) => (
        <button
          key={w.id}
          onClick={() => { onPick(w.name); onClose(); }}
          style={{
            display: 'flex', alignItems: 'center', gap: 10, width: '100%',
            padding: '8px', border: 'none', borderRadius: 8, cursor: 'pointer',
            background: w.name === current ? 'var(--accent-soft)' : 'transparent',
            fontFamily: 'var(--ui-font)', textAlign: 'left',
          }}
        >
          <span style={{ width: 24, height: 24, borderRadius: 6, background: 'var(--surface-2)', color: 'var(--fg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700 }}>
            {w.name[0].toUpperCase()}
          </span>
          <span style={{ flex: 1 }}>
            <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>{w.name}</span>
            <span style={{ display: 'block', fontSize: 11, color: 'var(--fg-muted)' }}>{w.role} · {w.members} members</span>
          </span>
          {w.name === current && <Icon name="check" size={14} color="var(--accent)" />}
        </button>
      ))}
    </Popover>
  );
}

function ProfileMenu({ theme, onToggleTheme, onClose }: {
  theme: Theme;
  onToggleTheme: () => void;
  onClose: () => void;
}) {
  const Item = ({ icon, label, href, onClick, danger }: {
    icon: string; label: string; href?: string; onClick?: () => void; danger?: boolean;
  }) => {
    const st: React.CSSProperties = {
      display: 'flex', alignItems: 'center', gap: 10, width: '100%',
      padding: '8px 9px', border: 'none', borderRadius: 8, background: 'transparent',
      cursor: 'pointer', textDecoration: 'none', fontFamily: 'var(--ui-font)',
      fontSize: 13, fontWeight: 500, color: danger ? 'var(--destructive)' : 'var(--fg)',
    };
    const inner = (
      <>
        <Icon name={icon as 'user'} size={15} color={danger ? 'var(--destructive)' : 'var(--fg-muted)'} />
        <span style={{ flex: 1, textAlign: 'left' }}>{label}</span>
      </>
    );
    return href
      ? <a href={href} style={st}>{inner}</a>
      : <button onClick={onClick} style={st}>{inner}</button>;
  };

  return (
    <Popover onClose={onClose} style={{ top: 44, right: 0, width: 244, padding: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 8px 10px' }}>
        <span style={{ width: 34, height: 34, borderRadius: '50%', background: 'var(--accent-soft)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 600 }}>A</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <b style={{ fontSize: 13.5, color: 'var(--fg)' }}>Alice Chen</b>
            <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--accent)', background: 'var(--accent-soft)', borderRadius: 5, padding: '1px 5px' }}>Owner</span>
          </span>
          <span style={{ display: 'block', fontSize: 11.5, color: 'var(--fg-muted)' }}>alice@brain2.dev</span>
        </span>
      </div>
      <div style={{ height: 1, background: 'var(--border)', margin: '0 4px 5px' }} />
      <Item icon="user" label="Profile & account" href="/settings" />
      <Item icon="settings" label="Settings" href="/settings" />
      <Item
        icon={theme === 'light' ? 'moon' : 'sun'}
        label={theme === 'light' ? 'Dark theme' : 'Light theme'}
        onClick={() => { onToggleTheme(); onClose(); }}
      />
      <div style={{ height: 1, background: 'var(--border)', margin: '5px 4px' }} />
      <Item icon="logout" label="Sign out" danger onClick={onClose} />
    </Popover>
  );
}

function CommandPalette({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('');
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => { ref.current?.focus(); }, []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [onClose]);

  const groups = PALETTE_GROUPS
    .map((g) => ({ ...g, items: g.items.filter((it) => it.label.toLowerCase().includes(q.toLowerCase())) }))
    .filter((g) => g.items.length > 0);

  return createPortal(
    <div
      className="b2-anim-fade"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 400,
        background: 'rgba(8,9,12,0.5)', backdropFilter: 'blur(3px)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: '12vh 20px 20px',
        fontFamily: 'var(--ui-font)',
      }}
    >
      <div
        className="b2-anim-slide"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 600, maxWidth: '100%', maxHeight: '70vh', display: 'flex', flexDirection: 'column',
          background: 'var(--surface)', border: '1px solid var(--border-strong)',
          borderRadius: 14, boxShadow: '0 24px 80px rgba(0,0,0,0.5)', overflow: 'hidden',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
          <Icon name="search" size={17} color="var(--fg-muted)" />
          <input
            ref={ref}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search pages, sources, wiki, chats…"
            style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', color: 'var(--fg)', fontSize: 15, fontFamily: 'var(--ui-font)' }}
          />
          <kbd style={{ fontSize: 10.5, color: 'var(--fg-faint)', background: 'var(--surface-2)', borderRadius: 5, padding: '2px 6px', fontFamily: 'var(--mono-font)' }}>Esc</kbd>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
          {groups.map((g) => (
            <div key={g.group} style={{ marginBottom: 6 }}>
              <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-faint)', padding: '6px 8px 4px' }}>{g.group}</div>
              {g.items.map((it) => (
                <a
                  key={it.label}
                  href={it.href}
                  onClick={onClose}
                  style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '9px 8px', borderRadius: 8, textDecoration: 'none', color: 'var(--fg)' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--accent-soft)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <span style={{ width: 26, height: 26, borderRadius: 7, background: 'var(--surface-2)', color: 'var(--fg-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name={it.icon as 'home'} size={14} />
                  </span>
                  <span style={{ flex: 1, fontSize: 13.5 }}>{it.label}</span>
                  <Icon name="arrowRight" size={14} color="var(--fg-faint)" />
                </a>
              ))}
            </div>
          ))}
          {!groups.length && (
            <div style={{ padding: '28px', textAlign: 'center', color: 'var(--fg-faint)', fontSize: 13.5 }}>
              No results for "{q}"
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── TopBar ───────────────────────────────────────────────────────────────────
interface TopBarProps {
  theme: Theme;
  onToggleTheme: () => void;
}

type MenuId = 'ws' | 'profile' | 'palette' | 'inbox' | null;

export function TopBar({ theme, onToggleTheme }: TopBarProps) {
  const [ws, setWs] = useState('default');
  const [menu, setMenu] = useState<MenuId>(null);
  const UNREAD = 3;

  const open = useCallback((id: MenuId) => setMenu((m) => (m === id ? null : id)), []);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setMenu('palette');
      }
    };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, []);

  return (
    <header
      style={{
        height: 52,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        position: 'relative',
        zIndex: 50,
        padding: '0 18px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--surface)',
      }}
    >
      {/* Brand */}
      <a href="/" style={{ display: 'flex', alignItems: 'center', gap: 9, textDecoration: 'none' }}>
        <div style={{ width: 22, height: 22, borderRadius: 6, background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ width: 9, height: 9, background: 'var(--surface)', borderRadius: 2, transform: 'rotate(45deg)' }} />
        </div>
        <span style={{ fontFamily: 'var(--display-font)', fontWeight: 700, fontSize: 15, letterSpacing: 'var(--display-track)', color: 'var(--fg)' }}>
          Brain2
        </span>
      </a>

      {/* Workspace switcher */}
      <div className="b2-hide-sm" style={{ position: 'relative' }}>
        <button style={pillBtn()} onClick={() => open('ws')}>
          <span style={{ color: 'var(--fg-muted)' }}>workspace</span>
          <span style={{ color: 'var(--fg)', fontWeight: 500 }}>{ws}</span>
          <Icon name="chevDown" size={13} color="var(--fg-muted)" />
        </button>
        {menu === 'ws' && (
          <WorkspaceMenu current={ws} onPick={setWs} onClose={() => setMenu(null)} />
        )}
      </div>

      {/* Search */}
      <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
        <button
          className="b2-hide-sm"
          onClick={() => setMenu('palette')}
          style={{
            display: 'flex', alignItems: 'center', gap: 10, width: 380, maxWidth: '46%',
            height: 33, padding: '0 12px', borderRadius: 8,
            border: '1px solid var(--border)', background: 'var(--bg)',
            color: 'var(--fg-muted)', fontFamily: 'var(--ui-font)', fontSize: 13, cursor: 'pointer',
          }}
        >
          <Icon name="search" size={15} />
          <span style={{ flex: 1, textAlign: 'left' }}>Search…</span>
          <kbd style={{ fontSize: 10.5, color: 'var(--fg-faint)', background: 'var(--surface-2)', borderRadius: 5, padding: '2px 6px', fontFamily: 'var(--mono-font)' }}>⌘K</kbd>
        </button>
      </div>

      {/* Mobile search icon */}
      <button
        className="b2-show-sm"
        onClick={() => setMenu('palette')}
        style={{ ...iconBtn(), display: 'none' }}
        aria-label="Search"
      >
        <Icon name="search" size={16} color="var(--fg-muted)" />
      </button>

      {/* Inbox bell */}
      <div style={{ position: 'relative' }}>
        <button
          style={{ ...iconBtn(), position: 'relative' }}
          onClick={() => open('inbox')}
          aria-label={`Inbox, ${UNREAD} unread`}
        >
          <Icon name="bell" size={16} color={menu === 'inbox' ? 'var(--fg)' : 'var(--fg-muted)'} />
          {UNREAD > 0 && (
            <span style={{
              position: 'absolute', top: -5, right: -5, minWidth: 16, height: 16,
              padding: '0 4px', borderRadius: 8, background: 'var(--destructive)',
              color: '#fff', fontSize: 10, fontWeight: 700, fontFamily: 'var(--mono-font)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: '2px solid var(--surface)',
            }}>
              {UNREAD}
            </span>
          )}
        </button>
        {menu === 'inbox' && (
          <Popover onClose={() => setMenu(null)} style={{ top: 44, right: 0, width: 340, padding: 12 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--fg)', marginBottom: 8 }}>Inbox</div>
            <div style={{ color: 'var(--fg-faint)', fontSize: 13 }}>3 unread notifications</div>
            <a href="/" style={{ display: 'block', marginTop: 12, textAlign: 'center', fontSize: 12.5, color: 'var(--accent)', textDecoration: 'none', fontWeight: 600 }}>
              View all →
            </a>
          </Popover>
        )}
      </div>

      {/* Profile */}
      <div style={{ position: 'relative' }}>
        <button
          onClick={() => open('profile')}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '3px 4px',
            borderRadius: 999, border: '1px solid var(--border)',
            background: menu === 'profile' ? 'var(--surface-2)' : 'transparent', cursor: 'pointer',
          }}
          aria-label="Account menu"
        >
          <span style={{ width: 26, height: 26, borderRadius: '50%', background: 'var(--accent-soft)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600, fontFamily: 'var(--ui-font)' }}>A</span>
          <span className="b2-hide-sm" style={{ fontSize: 13, color: 'var(--fg)', fontWeight: 500, paddingRight: 4 }}>alice</span>
        </button>
        {menu === 'profile' && (
          <ProfileMenu theme={theme} onToggleTheme={onToggleTheme} onClose={() => setMenu(null)} />
        )}
      </div>

      {menu === 'palette' && <CommandPalette onClose={() => setMenu(null)} />}
    </header>
  );
}
