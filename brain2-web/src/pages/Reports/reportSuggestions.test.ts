import { describe, expect, it } from 'vitest';
import { REPORT_SUGGESTIONS, reportSuggestionsFor } from './reportSuggestions';

describe('reportSuggestionsFor', () => {
  it('returns empty array when user has no accessible workspaces', () => {
    const result = reportSuggestionsFor({ role: 'member', accessibleWorkspaceNames: [] });

    expect(result).toEqual([]);
  });

  it('returns suggestions when user has at least one workspace', () => {
    const result = reportSuggestionsFor({
      role: 'member',
      accessibleWorkspaceNames: ['Finance & HR'],
    });

    expect(result.length).toBeGreaterThan(0);
    expect(result).toEqual(REPORT_SUGGESTIONS);
  });

  it('each suggestion has required fields', () => {
    const result = reportSuggestionsFor({
      role: 'owner',
      accessibleWorkspaceNames: ['Any'],
    });

    for (const suggestion of result) {
      expect(suggestion).toHaveProperty('id');
      expect(suggestion).toHaveProperty('title');
      expect(suggestion).toHaveProperty('formats');
      expect(suggestion).toHaveProperty('match');
    }
  });
});
