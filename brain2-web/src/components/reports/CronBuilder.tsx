/*
 * CronBuilder: preset buttons, time-of-day input, and raw custom cron editing.
 */
import { useMemo } from 'react';
import { Icon } from '@/components/ui/Icon';
import {
  CRON_PRESETS,
  buildCron,
  cadenceLabel,
  hhmmToMinutes,
  minutesToHHMM,
  parseCron,
  type CronChoice,
} from '@/lib/cron';

export function CronBuilder({ value, onChange }: { value: string; onChange: (cron: string) => void }) {
  const parsed = useMemo(() => parseCron(value), [value]);
  const choice: CronChoice = parsed.preset;
  const minutes = parsed.minutes;

  const setPreset = (id: CronChoice) => {
    if (id === 'custom') onChange(value);
    else onChange(buildCron(id, minutes));
  };

  const setTime = (hhmm: string) => {
    if (choice === 'custom') return;
    onChange(buildCron(choice, hhmmToMinutes(hhmm)));
  };

  const presetBtn = (active: boolean): React.CSSProperties => ({
    height: 34,
    padding: '0 12px',
    borderRadius: 8,
    cursor: 'pointer',
    fontFamily: 'var(--ui-font)',
    fontSize: 12.5,
    fontWeight: 600,
    border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
    background: active ? 'var(--accent-soft)' : 'var(--surface)',
    color: active ? 'var(--accent)' : 'var(--fg)',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
        {CRON_PRESETS.map((p) => (
          <button key={p.id} onClick={() => setPreset(p.id)} style={presetBtn(choice === p.id)}>
            {p.label}
          </button>
        ))}
        <button onClick={() => setPreset('custom')} style={presetBtn(choice === 'custom')}>
          <Icon name="sliders" size={12} color={choice === 'custom' ? 'var(--accent)' : 'var(--fg-muted)'} />
          Custom cron
        </button>
      </div>

      {choice !== 'custom' ? (
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5, color: 'var(--fg-muted)', fontFamily: 'var(--ui-font)' }}>
          <span style={{ fontWeight: 600, color: 'var(--fg-faint)', textTransform: 'uppercase', fontSize: 10.5, letterSpacing: '0.06em' }}>At (UTC)</span>
          <input
            type="time"
            value={minutesToHHMM(minutes)}
            onChange={(e) => setTime(e.target.value)}
            style={{ height: 34, padding: '0 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--fg)', fontFamily: 'var(--mono-font)', fontSize: 13 }}
          />
        </label>
      ) : (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="e.g. 30 19 * * 2/2"
          spellCheck={false}
          style={{ height: 38, padding: '0 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--fg)', fontFamily: 'var(--mono-font)', fontSize: 13.5, outline: 'none' }}
        />
      )}

      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--fg-faint)', fontFamily: 'var(--mono-font)' }}>
        <Icon name="repeat" size={11} color="var(--fg-faint)" />
        {cadenceLabel(value)}
      </div>
    </div>
  );
}
