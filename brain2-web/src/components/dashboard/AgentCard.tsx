/* AgentCard — configured-agent facts from the live runtime roster. */
import { Icon } from '@/components/ui/Icon';
import { StatusDot } from '@/components/ui/StatusDot';
import type { LiveAgentCardModel } from './liveAgentCard';

const STATUS_COLORS: Record<LiveAgentCardModel['status'], string> = {
  busy: 'var(--success)',
  idle: 'var(--fg-muted)',
  offline: 'var(--destructive)',
};

interface AgentCardProps {
  agent: LiveAgentCardModel;
}

export function AgentCard({ agent: a }: AgentCardProps) {
  const dotStatus = a.status === 'busy' ? 'active' : a.status === 'offline' ? 'error' : 'idle';

  return (
    <div
      style={{
        position: 'relative', display: 'flex', flexDirection: 'column',
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 12, padding: 16, boxShadow: 'var(--shadow-card)',
        minWidth: 0, overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9 }}>
        <StatusDot status={dotStatus} />
        <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--fg)', fontFamily: 'var(--display-font)', letterSpacing: 'var(--display-track)', flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
          {a.name}
        </span>
        <span style={{ color: STATUS_COLORS[a.status], fontFamily: 'var(--mono-font)', fontSize: 11.5, flexShrink: 0 }}>
          {a.status}
        </span>
      </div>

      {/* Model info */}
      <div title={a.modelName ?? undefined} style={{ fontSize: 12.5, color: 'var(--fg-muted)', marginTop: 10, fontFamily: 'var(--mono-font)', overflowWrap: 'anywhere' }}>
        {a.modelName ?? 'Model unavailable'}
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--fg-faint)', marginTop: 3, overflowWrap: 'anywhere' }}>
        {a.modelProvider ?? 'Provider unavailable'}
      </div>

      {/* Divider */}
      <div style={{ height: 1, background: 'var(--border)', margin: '13px 0 11px' }} />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', fontSize: 12, color: 'var(--fg-muted)' }}>
        <span>Complexity</span>
        <strong style={{ color: 'var(--fg)', fontFamily: 'var(--mono-font)', fontWeight: 600 }}>{a.complexity}</strong>
      </div>

      {a.taskId && (
        <div title={a.taskId} style={{ display: 'flex', alignItems: 'flex-start', gap: 7, marginTop: 10, fontSize: 11.5, color: 'var(--fg-muted)', minWidth: 0 }}>
          {a.status === 'busy' && <Icon name="loader" size={12} className="b2-spin" />}
          <span style={{ fontFamily: 'var(--mono-font)', overflowWrap: 'anywhere', minWidth: 0 }}>Todo {a.taskId}</span>
        </div>
      )}
    </div>
  );
}
