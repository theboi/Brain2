import { describe, it, expect } from 'vitest';
import { parsePersona } from './persona';

describe('parsePersona', () => {
  it('treats empty/whitespace content as unset', () => {
    expect(parsePersona('')).toEqual({ summary: '', signals: [], isEmpty: true });
    expect(parsePersona('   \n  ')).toEqual({ summary: '', signals: [], isEmpty: true });
  });

  it('uses the first non-bullet line as the summary, stripping heading marks', () => {
    const parsed = parsePersona('# Operations lead\nfocused on finance');
    expect(parsed.summary).toBe('Operations lead');
    expect(parsed.signals).toEqual([]);
    expect(parsed.isEmpty).toBe(false);
  });

  it('collects bullet lines as signals, stripping markers and append date stamps', () => {
    const content = [
      'Finance & ops lead.',
      '- [2026-06-08] Owns 12 finance sources',
      '* Opens Q2 docs daily',
    ].join('\n');
    const parsed = parsePersona(content);
    expect(parsed.summary).toBe('Finance & ops lead.');
    expect(parsed.signals).toEqual(['Owns 12 finance sources', 'Opens Q2 docs daily']);
  });

  it('caps signals at four', () => {
    const content = ['lead', '- a', '- b', '- c', '- d', '- e'].join('\n');
    expect(parsePersona(content).signals).toEqual(['a', 'b', 'c', 'd']);
  });

  it('handles a bullets-only document (no summary)', () => {
    const parsed = parsePersona('- only a note');
    expect(parsed.summary).toBe('');
    expect(parsed.signals).toEqual(['only a note']);
    expect(parsed.isEmpty).toBe(false);
  });
});
