import { SCard } from '@/components/settings/SettingsCard';

export function IntegrationsSection() {
  return (
    <SCard
      title="Integrations"
      desc="Connect Brain2 to the tools your team already uses. Agents can post and receive messages through linked channels."
    >
      <div style={{ color: 'var(--fg-muted)', fontSize: 13, padding: '24px 0' }}>
        Integrations are not yet available.
      </div>
    </SCard>
  );
}
