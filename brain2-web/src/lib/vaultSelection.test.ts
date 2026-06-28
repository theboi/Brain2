import { describe, expect, it } from 'vitest';
import { resolveActiveProjectId, vaultLabel } from './vaultSelection';

const proj = (id: string) => ({ project_id: id });

describe('resolveActiveProjectId', () => {
  it('leaves the selection untouched while the list is still loading', () => {
    // Default [] during load must NOT clobber a persisted selection.
    expect(resolveActiveProjectId(false, [], 'X')).toBe('X');
    expect(resolveActiveProjectId(false, [proj('Y')], 'X')).toBe('X');
  });

  it('keeps the current selection when it is still in the loaded list', () => {
    expect(resolveActiveProjectId(true, [proj('X'), proj('Y')], 'X')).toBe('X');
  });

  it('falls back to the first project when the selection is no longer valid', () => {
    expect(resolveActiveProjectId(true, [proj('Y'), proj('Z')], 'X')).toBe('Y');
  });

  it('selects the first project when nothing is selected yet', () => {
    expect(resolveActiveProjectId(true, [proj('Y')], null)).toBe('Y');
  });

  // Regression: moving the last vault out of a workspace leaves its project
  // list empty. The stale projectId must be cleared to null, otherwise the
  // now-empty workspace keeps rendering the moved vault's content.
  it('clears the selection when the loaded workspace has no vaults', () => {
    expect(resolveActiveProjectId(true, [], 'X')).toBeNull();
    expect(resolveActiveProjectId(true, [], null)).toBeNull();
  });
});

describe('vaultLabel', () => {
  const projects = [
    { project_id: 'p1', name: 'Engineering' },
    { project_id: 'p2', name: 'Engineering' }, // duplicate name, distinct id
  ];

  it('resolves the label by id even when names collide', () => {
    expect(vaultLabel(projects, 'p2')).toBe('Engineering');
    expect(vaultLabel(projects, 'p1')).toBe('Engineering');
  });

  it('returns empty string when nothing is selected or found', () => {
    expect(vaultLabel(projects, null)).toBe('');
    expect(vaultLabel(projects, 'nope')).toBe('');
  });
});
