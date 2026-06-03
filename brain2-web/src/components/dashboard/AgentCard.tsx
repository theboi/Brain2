/* AgentCard — card-with-sparkline variant (spec's recommended pick). */
import type { CSSProperties } from 'react';
import { Icon } from '@/components/ui/Icon';
import { StatusDot } from '@/components/ui/StatusDot';
import { Sparkline } from '@/components/charts/Sparkline';
import type { Agent } from '@/lib/mockData';

const STATUS_COLORS: Record<string, string> = {
  active:   'var(--success)',
  ready:    'var(--fg-muted)',
  idle:     'var(--fg-faint)',
  degraded: 'var(--warning)',
  error:    'var(--destructive)',
};

interface AgentCardProps {
  agent: Agent;
  onClick?: () => void;
}

export function AgentCard({ agent: a, onClick }: AgentCardProps) {
  const noteColor = STATUS_COLORS[a.status] ?? 'var(--fg-muted)';
  const sparkColor = a.status === 'idle' ? 'var(--fg-faint)' : 'var(--accent)';

  return (
    <div
      onClick={onClick}
      style={{
        position: 'relative', display: 'flex', flexDirection: 'column',
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 12, padding: 16, boxShadow: 'var(--shadow-card)',
        cursor: 'pointer', overflow: 'hidden',
        transition: 'border-color var(--duration-fast)',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--border-strong)')}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <StatusDot status={a.status} />
        <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--fg)', fontFamily: 'var(--display-font)', letterSpacing: 'var(--display-track)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {a.name}
        </span>
        <span style={{ color: 'var(--fg-faint)', display: 'flex', flexShrink: 0 }}>
          <Icon name="more" size={16} />
        </span>
      </div>

      {/* Model info */}
      <div style={{ fontSize: 12.5, color: 'var(--fg-muted)', marginTop: 6, fontFamily: 'var(--mono-font)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {a.model}
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--fg-faint)', marginTop: 2 }}>{a.provider}</div>

      {/* Divider */}
      <div style={{ height: 1, background: 'var(--border)', margin: '13px 0 11px' }} />

      {/* Metrics */}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: 'var(--fg-muted)' }}>
        <span>{a.msgs} msgs · {a.last}</span>
        <span style={{ color: 'var(--fg)', fontVariantNumeric: 'tabular-nums' }}>{a.cost}</span>
      </div>

      {/* Status note */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 9, fontSize: 11.5, color: noteColor }}>
        {a.status === 'active' && <Icon name="loader" size={12} className="b2-spin" />}
        {a.status === 'degraded' && <Icon name="alert" size={12} />}
        <span style={{ fontFamily: 'var(--mono-font)' }}>{a.note ?? a.statusLabel}</span>
      </div>

      {/* Sparkline */}
      <div style={{ margin: '12px -2px 14px' }}>
        <Sparkline data={a.spark} w={240} h={26} stroke={sparkColor} fill />
      </div>

      {/* Open chat CTA */}
      <button
        onClick={(e) => { e.stopPropagation(); }}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
          height: 34, borderRadius: 8, border: '1px solid var(--border)',
          background: 'var(--surface-2)', color: 'var(--fg)',
          fontFamily: 'var(--ui-font)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
        }}
      >
        <Icon name="chats" size={14} color="var(--fg-muted)" /> Open chat
      </button>
    </div>
  );
}

/* AddAgentTile — dashed tile always shown as last in the agents grid */
interface AddAgentTileProps {
  onClick: () => void;
}

export function AddAgentTile({ onClick }: AddAgentTileProps) {
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', gap: 10,
        border: '1.5px dashed var(--border-strong)', borderRadius: 12,
        padding: 16, color: 'var(--fg-muted)', cursor: 'pointer', minHeight: 120,
        transition: 'border-color var(--duration-fast)',
      } as CSSProperties}
      onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)')}
      onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.borderColor = 'var(--border-strong)')}
    >
      <div style={{ width: 38, height: 38, borderRadius: 10, background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="plus" size={20} color="var(--fg-muted)" />
      </div>
      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>Add agent</span>
      <span style={{ fontSize: 11.5, fontFamily: 'var(--mono-font)' }}>Cloud · Local</span>
    </div>
  );
}
