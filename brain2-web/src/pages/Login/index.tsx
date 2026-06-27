import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { login } from '@/lib/auth';
import { queryClient } from '@/lib/queryClient';

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as any)?.from?.pathname ?? '/';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
      queryClient.clear();
      navigate(from, { replace: true });
    } catch (err: any) {
      const msg = err?.message ?? '';
      setError(msg.includes('401') ? 'Invalid email or password.' : 'Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg)', padding: 24,
    }}>
      <div style={{
        width: '100%', maxWidth: 360,
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 12, boxShadow: 'var(--shadow-card)', padding: 32,
      }}>
        <h1 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 700, fontFamily: 'var(--display-font)' }}>
          Sign in
        </h1>
        <p style={{ margin: '0 0 24px', fontSize: 13, color: 'var(--fg-muted)' }}>
          Enter your credentials to continue.
        </p>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 12, color: 'var(--fg-muted)', fontWeight: 500 }}>Email</span>
            <input
              type="email" required autoFocus
              value={email} onChange={e => setEmail(e.target.value)}
              style={{ height: 36, padding: '0 12px', borderRadius: 'var(--radius-md)',
                       border: '1px solid var(--border)', background: 'var(--input-bg)',
                       color: 'var(--fg)', fontSize: 13, fontFamily: 'var(--ui-font)' }}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 12, color: 'var(--fg-muted)', fontWeight: 500 }}>Password</span>
            <input
              type="password" required
              value={password} onChange={e => setPassword(e.target.value)}
              style={{ height: 36, padding: '0 12px', borderRadius: 'var(--radius-md)',
                       border: '1px solid var(--border)', background: 'var(--input-bg)',
                       color: 'var(--fg)', fontSize: 13, fontFamily: 'var(--ui-font)' }}
            />
          </label>
          {error && (
            <p style={{ margin: 0, fontSize: 12.5, color: 'var(--danger, crimson)' }}>{error}</p>
          )}
          <button
            type="submit" disabled={loading}
            style={{
              height: 36, borderRadius: 'var(--radius-md)', border: 'none',
              background: 'var(--accent)', color: '#fff', fontWeight: 600,
              fontSize: 13, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1,
              fontFamily: 'var(--ui-font)',
            }}
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
