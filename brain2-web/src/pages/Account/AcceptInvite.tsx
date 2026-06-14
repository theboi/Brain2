import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

export function AcceptInvite() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!token || password.length < 8) return;
    setSaving(true);
    setError(null);
    try {
      const r = await fetch('/api/v1/auth/accept-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      if (!r.ok) throw new Error(await r.text());
      navigate('/login', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invite could not be accepted');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'grid',
      placeItems: 'center',
      background: 'var(--bg)',
      color: 'var(--fg)',
      padding: 24,
    }}>
      <form onSubmit={submit} style={{
        width: 'min(420px, 100%)',
        border: '1px solid var(--border)',
        background: 'var(--surface)',
        borderRadius: 12,
        padding: 24,
        boxShadow: 'var(--shadow-card)',
        fontFamily: 'var(--ui-font)',
      }}>
        <h1 style={{ margin: 0, fontSize: 24, fontFamily: 'var(--display-font)' }}>
          Accept invite
        </h1>
        <label style={{ display: 'block', marginTop: 20, fontSize: 12, color: 'var(--fg-muted)' }}>
          Password
        </label>
        <input
          autoFocus
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            height: 40,
            marginTop: 6,
            borderRadius: 8,
            border: '1px solid var(--border)',
            background: 'var(--bg)',
            color: 'var(--fg)',
            padding: '0 12px',
            fontFamily: 'var(--ui-font)',
          }}
        />
        {error && <div style={{ marginTop: 12, color: 'var(--destructive)', fontSize: 12 }}>{error}</div>}
        <button
          type="submit"
          disabled={!token || password.length < 8 || saving}
          style={{
            width: '100%',
            height: 40,
            marginTop: 18,
            border: 'none',
            borderRadius: 8,
            background: 'var(--accent)',
            color: '#fff',
            fontFamily: 'var(--ui-font)',
            fontWeight: 700,
            cursor: (!token || password.length < 8 || saving) ? 'not-allowed' : 'pointer',
            opacity: (!token || password.length < 8 || saving) ? 0.55 : 1,
          }}
        >
          {saving ? 'Accepting...' : 'Accept invite'}
        </button>
      </form>
    </div>
  );
}
