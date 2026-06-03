/*
 * Badge — small status/role label chip.
 * Uses semantic color tokens; never raw hex.
 */
import type { CSSProperties, ReactNode } from 'react';

export type BadgeTone = 'accent' | 'success' | 'warning' | 'destructive' | 'muted';

const TONE_STYLES: Record<BadgeTone, CSSProperties> = {
  accent:      { color: 'var(--accent)',      background: 'var(--accent-soft)' },
  success:     { color: 'var(--success)',     background: 'var(--success-soft)' },
  warning:     { color: 'var(--warning)',     background: 'var(--warning-soft)' },
  destructive: { color: 'var(--destructive)', background: 'var(--destructive-soft)' },
  muted:       { color: 'var(--fg-muted)',    background: 'var(--surface-2)' },
};

interface BadgeProps {
  tone?: BadgeTone;
  children: ReactNode;
  mono?: boolean;
  style?: CSSProperties;
}

export function Badge({ tone = 'muted', children, mono, style }: BadgeProps) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontSize: 11,
        fontWeight: 600,
        borderRadius: 'var(--radius-sm)',
        padding: '2px 7px',
        fontFamily: mono ? 'var(--mono-font)' : 'var(--ui-font)',
        letterSpacing: '0.02em',
        ...TONE_STYLES[tone],
        ...style,
      }}
    >
      {children}
    </span>
  );
}
