/*
 * StatusDot — color + glyph indicator for agent status.
 * Color is NEVER the only signal (accessibility requirement).
 */
import type { CSSProperties } from 'react';
import type { AgentStatus } from '@/lib/mockData';

interface StatusConfig {
  color: string;
  fill: boolean;
}

const STATUS_CONFIG: Record<AgentStatus, StatusConfig> = {
  active:   { color: 'var(--success)',     fill: true  },
  ready:    { color: 'var(--fg-muted)',    fill: false },
  idle:     { color: 'var(--fg-faint)',    fill: false },
  degraded: { color: 'var(--warning)',     fill: true  },
  error:    { color: 'var(--destructive)', fill: true  },
};

interface StatusDotProps {
  status: AgentStatus;
  pulse?: boolean;
  style?: CSSProperties;
}

export function StatusDot({ status, pulse = true, style }: StatusDotProps) {
  const s = STATUS_CONFIG[status] ?? STATUS_CONFIG.ready;
  const shouldPulse = s.fill && pulse && status === 'active';

  return (
    <span
      style={{
        position: 'relative',
        width: 9,
        height: 9,
        display: 'inline-flex',
        flexShrink: 0,
        ...style,
      }}
    >
      {shouldPulse && (
        <span
          className="b2-pulse"
          style={{
            position: 'absolute',
            inset: -2,
            borderRadius: '50%',
            background: s.color,
            opacity: 0.4,
          }}
        />
      )}
      <span
        style={{
          width: 9,
          height: 9,
          borderRadius: '50%',
          background: s.fill ? s.color : 'transparent',
          border: s.fill ? 'none' : `1.6px solid ${s.color}`,
        }}
      />
    </span>
  );
}
