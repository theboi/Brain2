/*
 * LeftRail — fixed icon-only sidebar on desktop. Labels surface via tooltip
 * (title/aria-label) rather than inline text.
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
  { id: 'agents',  icon: 'robot',   label: 'Agents',  href: '/agents', badge: 3 },
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
      title={it.label}
      aria-label={it.label}
      style={{
        textDecoration: 'none',
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: 42,
        borderRadius: 10,
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
            left: -6,
            top: 10,
            bottom: 10,
            width: 2.5,
            borderRadius: 2,
            background: 'var(--accent)',
          }}
        />
      )}
      <Icon name={it.icon} size={19} color={isActive ? 'var(--accent)' : 'var(--fg-muted)'} />
      {it.badge && (
        <span
          style={{
            position: 'absolute',
            top: 6,
            right: 6,
            minWidth: 16,
            height: 16,
            padding: '0 4px',
            borderRadius: 8,
            background: 'var(--accent)',
            color: '#fff',
            fontSize: 10,
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'var(--mono-font)',
            border: '2px solid var(--surface)',
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
        width: 60,
        flexShrink: 0,
        borderRight: '1px solid var(--border)',
        background: 'var(--surface)',
        display: 'flex',
        flexDirection: 'column',
        padding: '12px 8px',
        gap: 4,
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
