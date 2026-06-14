/*
 * Cron helpers shared by the report Schedule dropdown and Scheduled-runs UI.
 * Cron is evaluated in UTC server-side; these helpers expose the same five-field
 * expression shape in the client.
 */
export type CronPreset = 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'quarterly';
export type CronChoice = CronPreset | 'custom';

export interface CronPresetDef {
  id: CronPreset;
  label: string;
  hint: string;
}

export const CRON_PRESETS: CronPresetDef[] = [
  { id: 'daily', label: 'Every day', hint: 'every day at the chosen time' },
  { id: 'weekdays', label: 'Weekdays', hint: 'Mon-Fri at the chosen time' },
  { id: 'weekly', label: 'Every week', hint: 'Mondays at the chosen time' },
  { id: 'monthly', label: 'Every month', hint: '1st of the month' },
  { id: 'quarterly', label: 'Every quarter', hint: '1st of Jan/Apr/Jul/Oct' },
];

const WEEKDAY_NAMES: Record<string, string> = {
  '0': 'Sundays',
  '1': 'Mondays',
  '2': 'Tuesdays',
  '3': 'Wednesdays',
  '4': 'Thursdays',
  '5': 'Fridays',
  '6': 'Saturdays',
  '7': 'Sundays',
};

const pad2 = (n: number) => String(n).padStart(2, '0');

export function minutesToHHMM(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}

export function hhmmToMinutes(value: string): number {
  const [h, m] = value.split(':').map((p) => parseInt(p, 10));
  return (h || 0) * 60 + (m || 0);
}

export function buildCron(preset: CronPreset, minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  const min = m % 60;
  const hour = Math.floor(m / 60);
  switch (preset) {
    case 'daily': return `${min} ${hour} * * *`;
    case 'weekdays': return `${min} ${hour} * * 1-5`;
    case 'weekly': return `${min} ${hour} * * 1`;
    case 'monthly': return `${min} ${hour} 1 * *`;
    case 'quarterly': return `${min} ${hour} 1 1,4,7,10 *`;
  }
}

export interface ParsedCron {
  preset: CronChoice;
  minutes: number;
}

export function parseCron(expr: string): ParsedCron {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return { preset: 'custom', minutes: 9 * 60 };
  const [min, hour, dom, mon, dow] = parts;
  const numericTime = /^\d+$/.test(min) && /^\d+$/.test(hour);
  const minutes = numericTime ? parseInt(hour, 10) * 60 + parseInt(min, 10) : 9 * 60;
  let preset: CronChoice = 'custom';
  if (numericTime) {
    if (dom === '*' && mon === '*' && dow === '*') preset = 'daily';
    else if (dom === '*' && mon === '*' && dow === '1-5') preset = 'weekdays';
    else if (dom === '*' && mon === '*' && dow === '1') preset = 'weekly';
    else if (dom === '1' && mon === '*' && dow === '*') preset = 'monthly';
    else if (dom === '1' && mon === '1,4,7,10' && dow === '*') preset = 'quarterly';
  }
  return { preset, minutes };
}

export function cadenceLabel(expr: string): string {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return expr;
  const [min, hour, dom, mon, dow] = parts;
  const time = /^\d+$/.test(min) && /^\d+$/.test(hour)
    ? ` · ${pad2(parseInt(hour, 10))}:${pad2(parseInt(min, 10))}`
    : '';
  if (dow === '1-5' && dom === '*') return `Weekdays${time}`;
  if (dow !== '*' && WEEKDAY_NAMES[dow]) return `${WEEKDAY_NAMES[dow]}${time}`;
  if (dom === '1' && mon === '*') return `1st of month${time}`;
  if (dom === '*' && dow === '*') return `Every day${time}`;
  return `Custom (${expr})`;
}
