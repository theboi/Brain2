/*
 * Button — primary, secondary (ghost), danger, and icon variants.
 * All are keyboard-accessible and have explicit focus rings.
 */
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Icon } from './Icon';
import type { IconName } from './Icon';

export type ButtonVariant = 'primary' | 'ghost' | 'danger' | 'icon';

const BASE: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  border: '1px solid transparent',
  borderRadius: 'var(--radius-md)',
  cursor: 'pointer',
  fontFamily: 'var(--ui-font)',
  fontWeight: 600,
  fontSize: 13,
  lineHeight: 1,
  transition: 'opacity var(--duration-fast), background var(--duration-fast), border-color var(--duration-fast)',
  outline: 'none',
};

const VARIANTS: Record<ButtonVariant, React.CSSProperties> = {
  primary: {
    ...BASE,
    height: 34,
    padding: '0 14px',
    background: 'var(--accent)',
    color: '#fff',
  },
  ghost: {
    ...BASE,
    height: 32,
    padding: '0 12px',
    background: 'transparent',
    color: 'var(--fg)',
    borderColor: 'var(--border)',
  },
  danger: {
    ...BASE,
    height: 32,
    padding: '0 12px',
    background: 'transparent',
    color: 'var(--destructive)',
    borderColor: 'var(--border)',
  },
  icon: {
    ...BASE,
    width: 32,
    height: 32,
    padding: 0,
    background: 'transparent',
    color: 'var(--fg-muted)',
    borderRadius: 'var(--radius-md)',
  },
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  icon?: IconName;
  iconRight?: IconName;
  children?: ReactNode;
  loading?: boolean;
  size?: 'sm' | 'md';
}

export function Button({
  variant = 'ghost',
  icon,
  iconRight,
  children,
  loading,
  size,
  style,
  ...rest
}: ButtonProps) {
  const sizeOverride: React.CSSProperties = size === 'sm'
    ? { height: 28, padding: '0 10px', fontSize: 12 }
    : {};

  return (
    <button
      style={{ ...VARIANTS[variant], ...sizeOverride, ...style }}
      disabled={loading || rest.disabled}
      {...rest}
    >
      {loading
        ? <Icon name="loader" size={14} className="b2-spin" />
        : icon && <Icon name={icon} size={14} />}
      {children}
      {iconRight && <Icon name={iconRight} size={14} />}
    </button>
  );
}
