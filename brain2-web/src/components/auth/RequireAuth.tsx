import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { ensureToken } from '@/lib/auth';

type State = 'loading' | 'ok' | 'no-token' | 'must-change';

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<State>('loading');
  const location = useLocation();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const tok = await ensureToken();
      if (!tok) { if (!cancelled) setState('no-token'); return; }
      // Check must_change_password
      try {
        const r = await fetch('/api/v1/me', {
          headers: { 'Authorization': `Bearer ${tok}` },
        });
        if (r.ok) {
          const me = await r.json();
          if (!cancelled) setState(me.must_change_password ? 'must-change' : 'ok');
        } else {
          if (!cancelled) setState('no-token');
        }
      } catch {
        if (!cancelled) setState('ok'); // network error: let through, fail gracefully
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (state === 'loading') return <div style={{ padding: 24, color: 'var(--fg-muted)' }}>Loading…</div>;
  if (state === 'no-token') return <Navigate to="/login" state={{ from: location }} replace />;
  if (state === 'must-change') return <Navigate to="/account/change-password" replace />;
  return <>{children}</>;
}
