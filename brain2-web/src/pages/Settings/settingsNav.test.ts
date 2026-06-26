import { describe, expect, it } from 'vitest';
import { visibleSectionIds } from './settingsNav';

describe('visibleSectionIds', () => {
  it('owner sees every section', () => {
    expect(visibleSectionIds('owner')).toContain('people');
    expect(visibleSectionIds('owner')).toContain('danger');
  });

  it('non-owner hides owner-only sections', () => {
    const ids = visibleSectionIds('member');
    expect(ids).not.toContain('people');
    expect(ids).not.toContain('tools');
    expect(ids).not.toContain('audit');
    expect(ids).not.toContain('danger');
    expect(ids).toContain('workspaces');
    expect(ids).toContain('profile');
  });
});
