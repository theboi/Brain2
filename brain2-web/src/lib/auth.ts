// brain2-web/src/lib/auth.ts
const STORAGE_KEY = 'b2-token';
const REFRESH_KEY = 'b2-refresh';
const TENANT_ID = import.meta.env.VITE_TENANT_ID ?? 'default';

let memToken: string | null = null;
let memRefresh: string | null = null;

function readStorage(): { token: string | null; refresh: string | null } {
  try {
    return {
      token: localStorage.getItem(STORAGE_KEY),
      refresh: localStorage.getItem(REFRESH_KEY),
    };
  } catch {
    return { token: null, refresh: null };
  }
}

function writeStorage(token: string | null, refresh: string | null) {
  try {
    if (token) localStorage.setItem(STORAGE_KEY, token);
    else localStorage.removeItem(STORAGE_KEY);
    if (refresh) localStorage.setItem(REFRESH_KEY, refresh);
    else localStorage.removeItem(REFRESH_KEY);
  } catch { /* ignore */ }
}

export function clearToken() {
  memToken = null;
  memRefresh = null;
  writeStorage(null, null);
}

export async function login(email: string, password: string): Promise<void> {
  const r = await fetch('/api/v1/auth/tokens', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenant_id: TENANT_ID, email, password }),
  });
  if (!r.ok) throw new Error(`${r.status}`);
  const body = await r.json();
  memToken = body.token;
  memRefresh = body.refresh_token ?? null;
  writeStorage(memToken, memRefresh);
}

let refreshInFlight: Promise<void> | null = null;

// Single-flight: when many requests 401 at once they would each POST the same
// rotating refresh token. The server consumes the first and treats the rest as
// theft, revoking the whole token family and signing the user out. Coalescing
// concurrent callers onto one rotation keeps a single refresh token in play.
export function refresh(): Promise<void> {
  if (!refreshInFlight) {
    refreshInFlight = _doRefresh().finally(() => { refreshInFlight = null; });
  }
  return refreshInFlight;
}

async function _doRefresh(): Promise<void> {
  if (!memRefresh) {
    const { refresh: stored } = readStorage();
    memRefresh = stored;
  }
  if (!memRefresh) throw new Error('no refresh token');
  const r = await fetch('/api/v1/auth/tokens/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: memRefresh }),
  });
  if (!r.ok) {
    clearToken();
    throw new Error(`refresh failed: ${r.status}`);
  }
  const body = await r.json();
  memToken = body.token;
  memRefresh = body.refresh_token ?? memRefresh;
  writeStorage(memToken, memRefresh);
}

export async function ensureToken(): Promise<string | null> {
  if (memToken) return memToken;
  const { token, refresh: r } = readStorage();
  if (token) {
    memToken = token;
    memRefresh = r;
    return memToken;
  }
  return null; // No token — caller (RequireAuth) redirects to login
}

export async function logout(): Promise<void> {
  const tok = memToken ?? readStorage().token;
  if (tok) {
    try {
      await fetch('/api/v1/auth/tokens', {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${tok}` },
      });
    } catch { /* ignore network errors on logout */ }
  }
  clearToken();
}

export function currentToken(): string | null { return memToken; }
