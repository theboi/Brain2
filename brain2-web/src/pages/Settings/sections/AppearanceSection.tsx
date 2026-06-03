import { Icon } from '@/components/ui/Icon';
import { Toggle } from '@/components/ui/Toggle';
import { SCard, SRow } from '@/components/settings/SettingsCard';
import { SegmentedControl } from '@/components/ui/Popover';
import { ACCENT_LABELS, ACCENT_COLORS } from '@/lib/tokens';
import type { Theme, Accent } from '@/lib/tokens';

interface AppearanceSectionProps {
  theme: Theme;
  setTheme: (t: Theme) => void;
  accent: Accent;
  setAccent: (a: Accent) => void;
}

export function AppearanceSection({ theme, setTheme, accent, setAccent }: AppearanceSectionProps) {
  return (
    <div>
      <SCard title="Theme" desc="Switch between light and dark. Honors your system setting on first load.">
        <div style={{ display: 'flex', gap: 12 }}>
          {(['dark', 'light'] as Theme[]).map((k) => {
            const on = theme === k;
            const icon = k === 'dark' ? 'moon' : 'sun';
            const label = k === 'dark' ? 'Dark' : 'Light';
            return (
              <button
                key={k}
                onClick={() => setTheme(k)}
                style={{
                  flex: 1, display: 'flex', alignItems: 'center', gap: 10, padding: 14,
                  borderRadius: 10, cursor: 'pointer', background: 'var(--bg)',
                  border: `1.5px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
                  fontFamily: 'var(--ui-font)',
                  transition: 'border-color var(--duration-fast)',
                }}
              >
                <span style={{ width: 34, height: 34, borderRadius: 8, background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: on ? 'var(--accent)' : 'var(--fg-muted)' }}>
                  <Icon name={icon} size={17} />
                </span>
                <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--fg)' }}>{label}</span>
                {on && <span style={{ marginLeft: 'auto' }}><Icon name="check" size={16} color="var(--accent)" /></span>}
              </button>
            );
          })}
        </div>
      </SCard>

      <SCard title="Accent color" desc="Used for primary actions, links and selection across the console.">
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {(Object.keys(ACCENT_LABELS) as Accent[]).map((k) => {
            const on = accent === k;
            const col = theme === 'light' ? ACCENT_COLORS[k].light : ACCENT_COLORS[k].dark;
            return (
              <button
                key={k}
                onClick={() => setAccent(k)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 9, padding: '9px 14px 9px 10px',
                  borderRadius: 10, cursor: 'pointer', background: 'var(--bg)',
                  border: `1.5px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
                  fontFamily: 'var(--ui-font)',
                  transition: 'border-color var(--duration-fast)',
                }}
              >
                <span style={{ width: 22, height: 22, borderRadius: '50%', background: col }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>{ACCENT_LABELS[k]}</span>
                {on && <Icon name="check" size={15} color="var(--accent)" />}
              </button>
            );
          })}
        </div>
      </SCard>

      <SCard title="Interface">
        <SRow label="Density" desc="Comfortable spacing, or compact for more on screen.">
          <SegmentedControl value="Comfortable" options={['Comfortable', 'Compact']} onChange={() => {}} />
        </SRow>
        <SRow label="Reduce motion" desc="Minimise animations and transitions." last>
          <Toggle on={false} onClick={() => {}} aria-label="Reduce motion" />
        </SRow>
      </SCard>
    </div>
  );
}
