/*
 * BottomNav — mobile bottom tab bar (≤820px).
 * Full viewport width. Handles overflow into a "More" dropup.
 * Respects safe-area-inset-bottom for notched devices.
 */
import { useState, useRef, useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import type { IconName } from '@/components/ui/Icon';

interface NavItem {
  id: string;
  icon: IconName;
  label: string;
  href: string;
  badge?: number;
}

const ITEMS: NavItem[] = [
  { id: 'home',     icon: 'home',     label: 'Home',    href: '/' },
  { id: 'sources',  icon: 'sources',  label: 'Sources', href: '/sources' },
  { id: 'wiki',     icon: 'wiki',     label: 'Wiki',    href: '/wiki' },
  { id: 'agents',   icon: 'robot',    label: 'Agents',  href: '/agents', badge: 3 },
  { id: 'reports',  icon: 'file',     label: 'Reports', href: '/reports' },
  { id: 'settings', icon: 'settings', label: 'Settings', href: '/settings' },
];

const MIN_TAB = 64;

function Tab({ it }: { it: NavItem }) {
  const location = useLocation();
  const isActive = it.href === '/' ? location.pathname === '/' : location.pathname.startsWith(it.href);

  return (
    <NavLink
      to={it.href}
      style={{
        position: 'relative',
        flex: 1,
        minWidth: 0,
        textDecoration: 'none',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        padding: '9px 4px 8px',
        minHeight: 56,
        color: isActive ? 'var(--accent)' : 'var(--fg-muted)',
      }}
    >
      <span style={{ position: 'relative', display: 'flex' }}>
        <Icon name={it.icon} size={21} />
        {it.badge && (
          <span
            style={{
              position: 'absolute', top: -5, right: -8,
              minWidth: 15, height: 15, padding: '0 4px',
              borderRadius: 8, background: 'var(--accent)', color: '#fff',
              fontSize: 9.5, fontWeight: 700, fontFamily: 'var(--mono-font)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: '2px solid var(--surface)',
            }}
          >
            {it.badge}
          </span>
        )}
      </span>
      <span
        style={{
          fontSize: 10.5,
          fontWeight: isActive ? 600 : 500,
          fontFamily: 'var(--ui-font)',
          whiteSpace: 'nowrap',
        }}
      >
        {it.label}
      </span>
    </NavLink>
  );
}

export function BottomNav() {
  const navRef = useRef<HTMLElement>(null);
  const [width, setWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 0);
  const [openMore, setOpenMore] = useState(false);
  const location = useLocation();

  useEffect(() => {
    const measure = () => setWidth(window.innerWidth);
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  useEffect(() => {
    if (!openMore) return;
    const onDoc = (e: PointerEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) setOpenMore(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpenMore(false); };
    document.addEventListener('pointerdown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [openMore]);

  let visible = ITEMS;
  let overflow: NavItem[] = [];
  if (width > 0) {
    const fit = Math.max(1, Math.floor(width / MIN_TAB));
    if (fit < ITEMS.length) {
      const primaryCount = Math.max(1, fit - 1);
      visible = ITEMS.slice(0, primaryCount);
      overflow = ITEMS.slice(primaryCount);
    }
  }

  const overflowActive = overflow.some((it) =>
    it.href === '/' ? location.pathname === '/' : location.pathname.startsWith(it.href),
  );

  return (
    <nav
      ref={navRef}
      className="b2-show-sm"
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 60,
        display: 'flex',
        flexDirection: 'column',   /* nav is a flex column; inner row fills width */
        borderTop: '1px solid var(--border)',
        background: 'var(--surface)',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        boxShadow: '0 -2px 16px rgba(0,0,0,0.18)',
      }}
    >
      {/* Dropup panel */}
      {openMore && overflow.length > 0 && (
        <div
          className="b2-anim-dropup"
          style={{
            position: 'absolute',
            right: 8,
            bottom: 'calc(100% + 8px)',
            zIndex: 70,
            minWidth: 184,
            padding: 6,
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 12,
            boxShadow: '0 8px 28px rgba(0,0,0,0.3)',
          }}
        >
          {overflow.map((it) => {
            const isActive = it.href === '/' ? location.pathname === '/' : location.pathname.startsWith(it.href);
            return (
              <NavLink
                key={it.id}
                to={it.href}
                onClick={() => setOpenMore(false)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 11,
                  padding: '10px 11px',
                  borderRadius: 8,
                  textDecoration: 'none',
                  background: isActive ? 'var(--accent-soft)' : 'transparent',
                  color: isActive ? 'var(--accent)' : 'var(--fg-muted)',
                }}
              >
                <Icon name={it.icon} size={19} />
                <span style={{ fontSize: 13.5, fontWeight: isActive ? 600 : 500, fontFamily: 'var(--ui-font)' }}>
                  {it.label}
                </span>
              </NavLink>
            );
          })}
        </div>
      )}

      {/* Tab row — width: 100% ensures it fills the fixed-positioned nav */}
      <div style={{ display: 'flex', alignItems: 'stretch', width: '100%' }}>
        {visible.map((it) => <Tab key={it.id} it={it} />)}
        {overflow.length > 0 && (
          <button
            onClick={() => setOpenMore((v) => !v)}
            aria-label="More tabs"
            aria-expanded={openMore}
            style={{
              flex: 1,
              minWidth: 0,
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              padding: '9px 4px 8px',
              minHeight: 56,
              fontFamily: 'var(--ui-font)',
              color: (openMore || overflowActive) ? 'var(--accent)' : 'var(--fg-muted)',
            }}
          >
            <Icon name="more" size={21} />
            <span style={{ fontSize: 10.5, fontWeight: (openMore || overflowActive) ? 600 : 500, whiteSpace: 'nowrap' }}>
              More
            </span>
          </button>
        )}
      </div>
    </nav>
  );
}
