/*
 * Settings-specific primitives: SCard, SRow, RoleBadge.
 * Separate from the dashboard Panel to keep styling intent clear.
 */
import type { CSSProperties, ReactNode } from 'react';
import { Icon } from '@/components/ui/Icon';
import { Button } from '@/components/ui/Button';
import type { IconName } from '@/components/ui/Icon';

/* SCard — settings section card with optional header action */
interface SCardProps {
  title?: string;
  desc?: string;
  action?: ReactNode;
  children?: ReactNode;
  pad?: number;
}

export function SCard({ title, desc, action, children, pad = 20 }: SCardProps) {
  return (
    <section
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        boxShadow: 'var(--shadow-card)',
        marginBottom: 18,
      }}
    >
      {(title || action) && (
        <div
          style={{
            display: 'flex', alignItems: 'flex-start', gap: 12,
            padding: `16px ${pad}px`,
            borderBottom: children ? '1px solid var(--border)' : 'none',
          }}
        >
          <div style={{ flex: 1 }}>
            {title && <h3 style={{ margin: 0, fontSize: 14.5, fontWeight: 600, color: 'var(--fg)', fontFamily: 'var(--display-font)' }}>{title}</h3>}
            {desc && <p style={{ margin: '3px 0 0', fontSize: 12.5, color: 'var(--fg-muted)', lineHeight: 1.5 }}>{desc}</p>}
          </div>
          {action}
        </div>
      )}
      {children && <div style={{ padding: pad }}>{children}</div>}
    </section>
  );
}

/* SRow — label + optional description + right-slot control */
interface SRowProps {
  label: ReactNode;
  desc?: string;
  children?: ReactNode;
  last?: boolean;
  style?: CSSProperties;
}

export function SRow({ label, desc, children, last, style }: SRowProps) {
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 16, padding: '13px 0',
        borderBottom: last ? 'none' : '1px solid var(--border)',
        ...style,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--fg)' }}>{label}</div>
        {desc && <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 2, lineHeight: 1.45 }}>{desc}</div>}
      </div>
      {children && (
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8 }}>{children}</div>
      )}
    </div>
  );
}

/* RoleBadge — member role chip */
type Role = 'Owner' | 'Admin' | 'Editor' | 'Viewer';
const ROLE_COLOR: Record<Role, string> = {
  Owner:  'var(--accent)',
  Admin:  'var(--accent)',
  Editor: 'var(--success)',
  Viewer: 'var(--fg-muted)',
};

export function RoleBadge({ role }: { role: Role }) {
  return (
    <span
      style={{
        fontSize: 11, fontWeight: 600, color: ROLE_COLOR[role],
        background: 'var(--surface-2)', borderRadius: 6, padding: '2px 8px',
      }}
    >
      {role}
    </span>
  );
}

/* Integration row — icon + name/desc + children */
interface IntegrationProps {
  icon: IconName;
  name: string;
  desc: string;
  children?: ReactNode;
}

export function Integration({ icon, name, desc, children }: IntegrationProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, padding: '16px 0', borderBottom: '1px solid var(--border)' }}>
      <span style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--surface-2)', color: 'var(--fg)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Icon name={icon} size={19} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--fg)' }}>{name}</div>
        <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 2, lineHeight: 1.45 }}>{desc}</div>
        {children}
      </div>
    </div>
  );
}

/* sbtn — settings button helper (kept as a function for inline usage) */
export function SBtn({ kind = 'ghost', children, onClick, icon, disabled, style }: {
  kind?: 'primary' | 'ghost' | 'danger';
  children?: ReactNode;
  onClick?: () => void;
  icon?: IconName;
  disabled?: boolean;
  style?: CSSProperties;
}) {
  return (
    <Button
      variant={kind === 'danger' ? 'danger' : kind === 'primary' ? 'primary' : 'ghost'}
      icon={icon}
      onClick={onClick}
      disabled={disabled}
      style={style}
    >
      {children}
    </Button>
  );
}
