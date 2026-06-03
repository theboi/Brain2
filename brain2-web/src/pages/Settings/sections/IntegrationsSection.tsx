import { useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { Button } from '@/components/ui/Button';
import { Toggle } from '@/components/ui/Toggle';
import { Field } from '@/components/ui/Field';
import { SCard, SRow, Integration } from '@/components/settings/SettingsCard';

type TgState = 'idle' | 'linking' | 'connected';

export function IntegrationsSection() {
  const [tg, setTg] = useState<TgState>('idle');

  return (
    <SCard
      title="Integrations"
      desc="Connect Brain2 to the tools your team already uses. Agents can post and receive messages through linked channels."
    >
      <Integration icon="bell" name="Telegram" desc="Chat with your agents and ingest forwarded messages from a Telegram bot.">
        {tg === 'connected' ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, padding: '10px 12px', borderRadius: 9, background: 'var(--success-soft)', border: '1px solid var(--border)' }}>
            <Icon name="check" size={15} color="var(--success)" />
            <span style={{ fontSize: 13, color: 'var(--fg)' }}>Connected as <b style={{ fontFamily: 'var(--mono-font)' }}>@brain2_ops_bot</b></span>
            <Button variant="ghost" size="sm" style={{ marginLeft: 'auto' }} onClick={() => setTg('idle')}>Disconnect</Button>
          </div>
        ) : tg === 'linking' ? (
          <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}><Field placeholder="Paste bot token from @BotFather" mono /></div>
            <Button variant="primary" onClick={() => setTg('connected')}>Link bot</Button>
            <Button variant="ghost" onClick={() => setTg('idle')}>Cancel</Button>
          </div>
        ) : (
          <Button variant="primary" icon="plug" style={{ marginTop: 12 }} onClick={() => setTg('linking')}>
            Connect Telegram
          </Button>
        )}
      </Integration>

      <Integration icon="chats" name="Slack" desc="Post audit results and activity to a Slack channel.">
        <Button variant="ghost" icon="plug" style={{ marginTop: 12 }}>Connect</Button>
      </Integration>

      <Integration icon="mail" name="Email digest" desc="A daily summary of ingests, audits and agent activity.">
        <Button variant="ghost" icon="plug" style={{ marginTop: 12 }}>Connect</Button>
      </Integration>

      <div style={{ paddingTop: 16 }}>
        <SRow label="Outgoing webhook" desc="POST events to your own endpoint." last>
          <Toggle on={false} onClick={() => {}} aria-label="Outgoing webhook" />
        </SRow>
      </div>
    </SCard>
  );
}
