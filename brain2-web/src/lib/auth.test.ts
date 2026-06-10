import { describe, it, expect, vi, beforeEach } from 'vitest';
import { login, refresh } from './auth';

// Minimal localStorage stub for the node test environment.
const storage: Record<string, string> = {};
(globalThis as any).localStorage = {
  getItem: (k: string) => (k in storage ? storage[k] : null),
  setItem: (k: string, v: string) => { storage[k] = v; },
  removeItem: (k: string) => { delete storage[k]; },
};

const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => data });
const fail = (status: number) => ({ ok: false, status, json: async () => ({}) });

describe('auth refresh single-flight', () => {
  beforeEach(() => {
    for (const k of Object.keys(storage)) delete storage[k];
  });

  it('coalesces concurrent refreshes into a single rotation (no reuse)', async () => {
    let refreshCalls = 0;
    let rotation = 0; // server has issued R0 after login; rotation tracks newest valid token

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/auth/tokens')) {
        return ok({ token: 'A0', refresh_token: 'R0' }); // login
      }
      if (url.endsWith('/auth/tokens/refresh')) {
        refreshCalls += 1;
        const body = JSON.parse(init!.body as string);
        // The server rotates R{n} -> R{n+1}. Submitting an already-consumed
        // refresh token is treated as theft and the family is revoked (401).
        if (body.refresh_token !== `R${rotation}`) return fail(401);
        rotation += 1;
        return ok({ token: `A${rotation}`, refresh_token: `R${rotation}` });
      }
      return fail(404);
    });
    (globalThis as any).fetch = fetchMock;

    await login('e@x.com', 'pw'); // seeds the rotating refresh token R0

    // Five in-flight requests hit a 401 at once and each ask to refresh.
    await Promise.all([refresh(), refresh(), refresh(), refresh(), refresh()]);

    // Without single-flight, all five POST the same R0; the server consumes the
    // first and flags the rest as reuse, revoking the family and signing the
    // user out. With single-flight, exactly one rotation happens.
    expect(refreshCalls).toBe(1);
  });
});
