import { Icon } from '@/components/ui/Icon';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { SCard } from '@/components/settings/SettingsCard';

const PROVIDERS = [
  { name: 'Anthropic',     desc: 'Claude models · cloud', set: true,  key: 'sk-ant-••••••••••••3f2a' },
  { name: 'Google Gemini', desc: 'Gemini models · cloud', set: true,  key: 'AIza••••••••••••9kL2' },
  { name: 'OpenAI',        desc: 'GPT models · cloud',    set: false, key: '' },
];

export function ProvidersSection() {
  return (
    <div>
      <SCard title="Model providers" desc="API keys are encrypted at rest (AES-256-GCM) and never shown again after saving.">
        {PROVIDERS.map((p, i) => (
          <div
            key={p.name}
            style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 0', borderBottom: i === PROVIDERS.length - 1 ? 'none' : '1px solid var(--border)' }}
          >
            <div style={{ width: 150, flexShrink: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--fg)' }}>{p.name}</div>
              <div style={{ fontSize: 11.5, color: 'var(--fg-muted)' }}>{p.desc}</div>
            </div>
            <div style={{ flex: 1 }}>
              <Field defaultValue={p.key} placeholder="Paste API key…" mono type={p.set ? 'password' : 'text'} />
            </div>
            {p.set
              ? <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--success)', flexShrink: 0 }}><Icon name="check" size={13} /> Saved</span>
              : <span style={{ fontSize: 12, color: 'var(--fg-faint)', flexShrink: 0 }}>Not set</span>
            }
            <Button variant="ghost" size="sm">Test</Button>
          </div>
        ))}
      </SCard>

      <SCard title="Local runtime" desc="Ollama endpoint for local models.">
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <Field label="Ollama base URL" defaultValue="http://localhost:11434" mono />
          </div>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--success)', height: 36, flexShrink: 0 }}>
            <Icon name="check" size={13} /> Reachable
          </span>
          <Button variant="ghost" size="sm">Test</Button>
        </div>
      </SCard>
    </div>
  );
}
