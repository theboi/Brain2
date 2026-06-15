/* QuickActions — one-tap plugin-powered action tiles + open-ended chat tile. */
import { useState } from 'react';
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
  const color = TONE_COLOR[a.tone] ?? 'var(--accent)';
  const soft = TONE_SOFT[a.tone] ?? 'var(--accent-soft)';

  return (
    <button
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      onClick={() => onRun(a)}
      style={{
        display: 'flex', flexDirection: 'column', gap: 12, textAlign: 'left',
        padding: 15, borderRadius: 12, border: `1px solid ${hov ? color : 'var(--border)'}`,
        background: 'var(--surface)', cursor: 'pointer', fontFamily: 'var(--ui-font)',
        transform: hov ? 'translateY(-2px)' : 'none',
        boxShadow: hov ? '0 8px 22px rgba(0,0,0,0.22)' : 'none',
        transition: 'transform var(--duration-fast), box-shadow var(--duration-fast), border-color var(--duration-fast)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ width: 34, height: 34, borderRadius: 9, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: soft, color }}>
          <Icon name={a.icon as IconName} size={17} />
        </span>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 600, fontFamily: 'var(--mono-font)', color: 'var(--fg-muted)', background: 'var(--surface-2)', borderRadius: 6, padding: '3px 7px' }}>
          <Icon name="plug" size={11} color="var(--fg-faint)" /> {a.plugin}
        </span>
      </div>
      <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: 'var(--fg)', lineHeight: 1.34 }}>{a.title}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11.5, fontFamily: 'var(--mono-font)', color: 'var(--fg-faint)', whiteSpace: 'nowrap', flexShrink: 0 }}>{a.est}</span>
        <span style={{ marginLeft: 'auto', flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: hov ? color : 'var(--fg-muted)' }}>
          Run
          <span style={{ width: 24, height: 24, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', background: hov ? color : 'var(--surface-2)', transition: 'background var(--duration-fast)' }}>
            <Icon name="arrowRight" size={14} color={hov ? '#fff' : 'var(--fg-muted)'} />
          </span>
        </span>
      </div>
    </button>
  );
}

function ChatTile({ onRun }: { onRun: () => void }) {
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
          <Icon name="chats" size={17} />
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 10.5, fontWeight: 600, fontFamily: 'var(--mono-font)', color: 'var(--fg-muted)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>Open-ended</span>
      </div>
      <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: 'var(--fg)', lineHeight: 1.34 }}>Ask anything else</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11.5, fontFamily: 'var(--mono-font)', color: 'var(--fg-faint)', whiteSpace: 'nowrap', flexShrink: 0 }}>chat with an agent</span>
        <span style={{ marginLeft: 'auto', flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: 'var(--accent)' }}>
          Chat
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
  const runAction = (_a: QuickAction) => { /* TODO: launch plugin job */ };
  const goChat = () => { window.location.href = '/agents'; };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(3, 1fr)', gap: isMobile ? 10 : 14 }}>
      {actions.map((a) => <ActionTile key={a.id} action={a} onRun={runAction} />)}
      <ChatTile onRun={goChat} />
    </div>
  );
}
