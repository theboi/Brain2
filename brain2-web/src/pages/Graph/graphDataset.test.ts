import { describe, expect, it } from 'vitest';
import { ORG_VAULT_INDEX, ORG_WS } from './mockData';
import { installOrgGraphData } from './graphDataset';

describe('graphDataset', () => {
  it('installs org graph workspaces and vault index', () => {
    installOrgGraphData({
      workspaces: [{ id: 'ws1', name: 'Eng', vaults: [{ id: 'p1', name: 'Runbooks', mode: 'wiki', items: 2 }] }],
      vault_pages: { p1: { pages: ['A'], links: [] } },
      vault_sources: { p1: [] },
      people: { u1: { name: 'User One', email: 'u1@example.com' } },
      members: [{ u: 'u1', ws: [{ w: 'ws1', role: 'member' }] }],
      groups: [],
      guests: [],
    });
    expect(ORG_WS[0].id).toBe('ws1');
    expect(ORG_VAULT_INDEX.p1.ws).toBe('ws1');
  });
});
