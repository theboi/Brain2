/* QuickActions — one-tap plugin-powered action tiles + open-ended chat tile. */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import type { QuickAction } from '@/lib/mockData';
import type { IconName } from '@/components/ui/Icon';

const TONE_COLOR: Record<string, string> = {
  accent:  'var(--accent)',
  warning: 'var(--warning)',
  muted:   'var(--fg-muted)',
};
const TONE_SOFT: Record<string, string> = {
  accent:  'var(--accent-soft)',
  warning: 'var(--warning-soft)',
  muted:   'var(--surface-2)',
};

interface ActionTileProps {
  action: QuickAction;
  onRun: (a: QuickAction) => void;
}

function ActionTile({ action: a, onRun }: ActionTileProps) {
  const [hov, setHov] = useState(false);
  const available = a.available;
  const color = TONE_COLOR[a.tone] ?? 'var(--accent)';
  const soft = TONE_SOFT[a.tone] ?? 'var(--accent-soft)';

  return (
    <button
      disabled={!available}
      aria-disabled={!available}
      title={available ? undefined : a.unavailableReason ?? 'Unavailable'}
      onMouseEnter={() => available && setHov(true)}
      onMouseLeave={() => setHov(false)}
      onClick={() => available && onRun(a)}
      style={{
        display: 'flex', flexDirection: 'column', gap: 12, textAlign: 'left',
        padding: 15, borderRadius: 12, border: `1px solid ${hov && available ? color : 'var(--border)'}`,
        background: 'var(--surface)', cursor: available ? 'pointer' : 'not-allowed', fontFamily: 'var(--ui-font)',
        transform: hov && available ? 'translateY(-2px)' : 'none',
        boxShadow: hov && available ? '0 8px 22px rgba(0,0,0,0.22)' : 'none',
        opacity: available ? 1 : 0.62,
        transition: 'transform var(--duration-fast), box-shadow var(--duration-fast), border-color var(--duration-fast)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ width: 34, height: 34, borderRadius: 9, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: soft, color }}>
          <Icon name={a.icon as IconName} size={17} />
        </span>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 600, fontFamily: 'var(--mono-font)', color: 'var(--fg-muted)', background: 'var(--surface-2)', borderRadius: 6, padding: '3px 7px' }}>
          <Icon name={available ? 'plug' : 'lock'} size={11} color="var(--fg-faint)" /> {available ? a.plugin : 'Unavailable'}
        </span>
      </div>
      <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: 'var(--fg)', lineHeight: 1.34 }}>{a.title}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11.5, fontFamily: 'var(--mono-font)', color: 'var(--fg-faint)', whiteSpace: 'nowrap', flexShrink: 0 }}>{a.est}</span>
        <span style={{ marginLeft: 'auto', flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: available && hov ? color : 'var(--fg-muted)' }}>
          {available ? 'Run' : 'Coming soon'}
          <span style={{ width: 24, height: 24, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', background: available && hov ? color : 'var(--surface-2)', transition: 'background var(--duration-fast)' }}>
            <Icon name={available ? 'arrowRight' : 'lock'} size={14} color={available && hov ? '#fff' : 'var(--fg-muted)'} />
          </span>
        </span>
      </div>
    </button>
  );
}

function AgentsTile({ onRun }: { onRun: () => void }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      onClick={onRun}
      style={{
        display: 'flex', flexDirection: 'column', gap: 12, textAlign: 'left',
        padding: 15, borderRadius: 12,
        border: `1px dashed ${hov ? 'var(--accent)' : 'var(--border-strong)'}`,
        background: hov ? 'var(--accent-soft)' : 'var(--surface-2)',
        cursor: 'pointer', fontFamily: 'var(--ui-font)',
        transition: 'background var(--duration-fast), border-color var(--duration-fast)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ width: 34, height: 34, borderRadius: 9, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface)', color: 'var(--accent)' }}>
          <Icon name="robot" size={17} />
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 10.5, fontWeight: 600, fontFamily: 'var(--mono-font)', color: 'var(--fg-muted)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>Agents</span>
      </div>
      <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: 'var(--fg)', lineHeight: 1.34 }}>Open agents queue</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11.5, fontFamily: 'var(--mono-font)', color: 'var(--fg-faint)', whiteSpace: 'nowrap', flexShrink: 0 }}>add or inspect todos</span>
        <span style={{ marginLeft: 'auto', flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: 'var(--accent)' }}>
          Open
          <span style={{ width: 24, height: 24, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--accent)' }}>
            <Icon name="arrowRight" size={14} color="#fff" />
          </span>
        </span>
      </div>
    </button>
  );
}

interface QuickActionsProps {
  actions: QuickAction[];
  isMobile?: boolean;
}

export function QuickActions({ actions, isMobile = false }: QuickActionsProps) {
  const navigate = useNavigate();
  const runAction = (_a: QuickAction) => { /* TODO: launch plugin job */ };
  const openAgents = () => navigate('/agents');

  if (actions.length === 0) return null;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(3, 1fr)', gap: isMobile ? 10 : 14 }}>
      {actions.map((a) => <ActionTile key={a.id} action={a} onRun={runAction} />)}
      <AgentsTile onRun={openAgents} />
    </div>
  );
}
