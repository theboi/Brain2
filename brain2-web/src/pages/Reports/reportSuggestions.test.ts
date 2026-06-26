import { describe, expect, it } from 'vitest';
import { reportSuggestionsFor } from './reportSuggestions';

describe('reportSuggestionsFor', () => {
  it('hides finance and board suggestions for an Engineering-only admin', () => {
    const out = reportSuggestionsFor({ role: 'member', accessibleWorkspaceNames: ['Engineering'] });
    expect(out.find((s) => /financial|board/i.test(s.title))).toBeUndefined();
    expect(out.map((s) => s.title)).toContain('Headcount & Cost Snapshot');
  });

  it('keeps owner suggestions even before workspace names load', () => {
    const out = reportSuggestionsFor({ role: 'owner', accessibleWorkspaceNames: [] });
    expect(out.find((s) => /financial/i.test(s.title))).toBeDefined();
    expect(out.find((s) => /board/i.test(s.title))).toBeDefined();
  });

  it('removes owner-implying copy for non-owners with finance access', () => {
    const out = reportSuggestionsFor({ role: 'member', accessibleWorkspaceNames: ['Finance'] });
    expect(out.find((s) => s.id === 'fin-q2')?.why).not.toMatch(/you own/i);
  });
});
