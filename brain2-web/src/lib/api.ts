// brain2-web/src/lib/api.ts
import { ensureToken, refresh, clearToken, currentToken } from './auth';

export class ApiError extends Error {
  constructor(public status: number, public body: string) {
    super(`api ${status}: ${body}`);
  }
}

async function _request<T>(path: string, init: RequestInit, retry = true): Promise<T> {
  const token = await ensureToken();
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  if (!headers.has('Content-Type') && init.body && typeof init.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }
  const r = await fetch(path, { ...init, headers });
  if (r.status === 401 && retry) {
    try { await refresh(); } catch { clearToken(); }
    return _request<T>(path, init, false);
  }
  const text = await r.text();
  if (!r.ok) throw new ApiError(r.status, text);
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

export function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  return _request<T>(path, init);
}

export function genIdempotencyKey(): string {
  return crypto.randomUUID();
}

export async function ops<T>(name: string, params: object = {},
                              opts: { idempotencyKey?: string } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
  return apiFetch<T>(`/api/v1/ops/${encodeURIComponent(name)}`, {
    method: 'POST',
    body: JSON.stringify(params),
    headers,
  });
}

export function sse(path: string,
                    onEvent: (e: MessageEvent) => void,
                    onError?: (e: Event) => void): () => void {
  const token = currentToken();
  const sep = path.includes('?') ? '&' : '?';
  const url = token ? `${path}${sep}token=${encodeURIComponent(token)}` : path;
  const es = new EventSource(url);
  es.onmessage = onEvent;
  if (onError) es.onerror = onError;
  return () => es.close();
}
