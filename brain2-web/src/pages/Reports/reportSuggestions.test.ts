import { describe, expect, it } from 'vitest';
import { reportSuggestionsFor } from './reportSuggestions';

describe('reportSuggestionsFor', () => {
  it('returns no suggestions until the catalog is wired to live workspace IDs', () => {
    const out = reportSuggestionsFor({ role: 'member', accessibleWorkspaceNames: ['Engineering'] });
    expect(out).toEqual([]);
  });

  it('returns no owner suggestions from the static catalog', () => {
    const out = reportSuggestionsFor({ role: 'owner', accessibleWorkspaceNames: [] });
    expect(out).toEqual([]);
  });
});
