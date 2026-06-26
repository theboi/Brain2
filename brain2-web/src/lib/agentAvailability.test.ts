import { describe, expect, it } from 'vitest';
import { agentAvailability } from './agentAvailability';

describe('agentAvailability', () => {
  it('counts total, free (idle), and online (non-offline)', () => {
    const agents = [
      { id: 'a', status: 'idle' },
      { id: 'b', status: 'busy' },
      { id: 'c', status: 'offline' },
    ] as any;
    expect(agentAvailability(agents)).toEqual({ total: 3, free: 1, online: 2 });
  });

  it('handles an empty roster', () => {
    expect(agentAvailability([])).toEqual({ total: 0, free: 0, online: 0 });
  });
});
