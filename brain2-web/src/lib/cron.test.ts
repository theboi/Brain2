import { describe, expect, it } from 'vitest';
import {
  CRON_PRESETS,
  buildCron,
  cadenceLabel,
  minutesToHHMM,
  parseCron,
} from './cron';

describe('cron helpers', () => {
  it('builds preset crons with a time-of-day', () => {
    expect(buildCron('daily', 6 * 60)).toBe('0 6 * * *');
    expect(buildCron('weekdays', 9 * 60)).toBe('0 9 * * 1-5');
    expect(buildCron('weekly', 9 * 60)).toBe('0 9 * * 1');
    expect(buildCron('monthly', 9 * 60)).toBe('0 9 1 * *');
    expect(buildCron('quarterly', 9 * 60)).toBe('0 9 1 1,4,7,10 *');
  });

  it('builds with explicit minutes', () => {
    expect(buildCron('daily', 7 * 60 + 30)).toBe('30 7 * * *');
  });

  it('parses a cron back into its time-of-day minutes', () => {
    expect(parseCron('30 7 * * *').minutes).toBe(7 * 60 + 30);
    expect(parseCron('0 9 * * 1').minutes).toBe(9 * 60);
  });

  it('detects the matching preset', () => {
    expect(parseCron('0 6 * * *').preset).toBe('daily');
    expect(parseCron('0 9 * * 1-5').preset).toBe('weekdays');
    expect(parseCron('0 9 * * 1').preset).toBe('weekly');
    expect(parseCron('0 9 1 * *').preset).toBe('monthly');
    expect(parseCron('0 9 1 1,4,7,10 *').preset).toBe('quarterly');
    expect(parseCron('30 19 * * 2/2').preset).toBe('custom');
  });

  it('formats minutes as HH:MM', () => {
    expect(minutesToHHMM(6 * 60)).toBe('06:00');
    expect(minutesToHHMM(14 * 60 + 18)).toBe('14:18');
  });

  it('produces a human cadence label', () => {
    expect(cadenceLabel('0 6 * * *')).toBe('Every day · 06:00');
    expect(cadenceLabel('0 9 * * 1')).toBe('Mondays · 09:00');
    expect(cadenceLabel('0 9 1 * *')).toBe('1st of month · 09:00');
  });

  it('CRON_PRESETS lists the five presets', () => {
    expect(CRON_PRESETS.map((p) => p.id)).toEqual([
      'daily',
      'weekdays',
      'weekly',
      'monthly',
      'quarterly',
    ]);
  });
});
