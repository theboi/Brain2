/*
 * LeftRail — fixed 200px sidebar on desktop, always showing icon + label.
 * Active item: 2px left accent bar + accent-soft fill.
 * Hidden on mobile (BottomNav used instead).
 */
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
  { id: 'home',    icon: 'home',    label: 'Home',    href: '/' },
  { id: 'sources', icon: 'sources', label: 'Sources', href: '/sources' },
  { id: 'wiki',    icon: 'wiki',    label: 'Wiki',    href: '/wiki' },
  { id: 'chats',   icon: 'chats',   label: 'Chats',   href: '/chats', badge: 2 },
  { id: 'reports', icon: 'file',    label: 'Reports', href: '/reports' },
];

const BOTTOM: NavItem[] = [
  { id: 'settings', icon: 'settings', label: 'Settings', href: '/settings' },
];

function RailItem({ it }: { it: NavItem }) {
  const location = useLocation();
  const isActive = it.href === '/' ? location.pathname === '/' : location.pathname.startsWith(it.href) || (it.id === 'wiki' && location.pathname === '/graph');

  return (
    <NavLink
      to={it.href}
      style={{
        textDecoration: 'none',
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        height: 40,
        padding: '0 14px',
        borderRadius: 9,
        cursor: 'pointer',
        background: isActive ? 'var(--accent-soft)' : 'transparent',
        color: isActive ? 'var(--accent)' : 'var(--fg-muted)',
        transition: 'background var(--duration-fast)',
      }}
      onMouseEnter={(e) => {
        if (!isActive) (e.currentTarget as HTMLElement).style.background = 'var(--surface-2)';
      }}
      onMouseLeave={(e) => {
        if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent';
      }}
    >
      {isActive && (
        <span
          style={{
            position: 'absolute',
            left: -8,
            top: 9,
            bottom: 9,
            width: 2.5,
            borderRadius: 2,
            background: 'var(--accent)',
          }}
        />
      )}
      <Icon name={it.icon} size={19} />
      <span
        style={{
          fontSize: 13.5,
          fontWeight: isActive ? 600 : 500,
          color: isActive ? 'var(--fg)' : 'var(--fg-muted)',
          whiteSpace: 'nowrap',
          flex: 1,
        }}
      >
        {it.label}
      </span>
      {it.badge && (
        <span
          style={{
            minWidth: 17,
            height: 17,
            padding: '0 5px',
            borderRadius: 9,
            background: 'var(--accent)',
            color: '#fff',
            fontSize: 10.5,
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'var(--mono-font)',
          }}
        >
          {it.badge}
        </span>
      )}
    </NavLink>
  );
}

export function LeftRail() {
  return (
    <nav
      className="b2-hide-sm"
      style={{
        width: 200,
        flexShrink: 0,
        borderRight: '1px solid var(--border)',
        background: 'var(--surface)',
        display: 'flex',
        flexDirection: 'column',
        padding: '12px 8px',
        gap: 3,
        overflowY: 'auto',
      }}
    >
      {ITEMS.map((it) => <RailItem key={it.id} it={it} />)}
      <div style={{ height: 1, background: 'var(--border)', margin: '8px 6px' }} />
      {BOTTOM.map((it) => <RailItem key={it.id} it={it} />)}
      <div style={{ flex: 1 }} />
    </nav>
  );
}
