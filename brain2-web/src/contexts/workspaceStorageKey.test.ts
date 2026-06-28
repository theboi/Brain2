import { describe, expect, it } from 'vitest';
import { wsKey, projKey, scopeFromMe } from './workspaceStorageKey';

describe('selection storage keys', () => {
  it('scopes by tenant:user', () => {
    expect(scopeFromMe({ tenant_id: 't1', user_id: 'u1' })).toBe('t1:u1');
    expect(wsKey('t1:u1')).toBe('b2-workspace-id:t1:u1');
    expect(projKey('t1:u1')).toBe('b2-project-id:t1:u1');
  });

  it('two tenants for the same user do not share a key', () => {
    expect(wsKey('t1:u1')).not.toBe(wsKey('t2:u1'));
  });

  it('falls back to a global scope when identity is unknown', () => {
    expect(scopeFromMe(null)).toBe('__global__');
    expect(wsKey('__global__')).toBe('b2-workspace-id');
  });
});
