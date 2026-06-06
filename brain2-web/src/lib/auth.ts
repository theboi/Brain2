// brain2-web/src/lib/auth.ts
const STORAGE_KEY = 'b2-token';
const REFRESH_KEY = 'b2-refresh';
const DEV_TENANT = import.meta.env.VITE_DEV_TENANT ?? 'default';
const DEV_EMAIL = import.meta.env.VITE_DEV_EMAIL ?? 'alice@example.com';
const DEV_PASSWORD = import.meta.env.VITE_DEV_PASSWORD ?? 'change-me-please';

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

export async function login(): Promise<void> {
  const r = await fetch('/api/v1/auth/tokens', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenant_id: DEV_TENANT, email: DEV_EMAIL, password: DEV_PASSWORD }),
  });
  if (!r.ok) throw new Error(`login failed: ${r.status} ${await r.text()}`);
  const body = await r.json();
  memToken = body.token;
  memRefresh = body.refresh_token ?? null;
  writeStorage(memToken, memRefresh);
}

export async function refresh(): Promise<void> {
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

export async function ensureToken(): Promise<string> {
  if (memToken) return memToken;
  const { token, refresh: r } = readStorage();
  if (token) {
    memToken = token;
    memRefresh = r;
    return memToken;
  }
  await login();
  return memToken!;
}

export function currentToken(): string | null { return memToken; }
