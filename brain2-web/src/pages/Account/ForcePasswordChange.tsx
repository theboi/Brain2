import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ensureToken } from '@/lib/auth';

export function ForcePasswordChange() {
  const navigate = useNavigate();

  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (newPw !== confirmPw) {
      setError('New passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      const tok = await ensureToken();
      if (!tok) {
        setError('Your session expired. Please sign in again.');
        return;
      }
      const r = await fetch('/api/v1/me/password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tok}`,
        },
        body: JSON.stringify({ current_password: currentPw, new_password: newPw }),
      });

      if (r.status === 401) {
        setError('Current password is incorrect.');
        return;
      }
      if (r.status === 429) {
        setError('Too many attempts, please wait.');
        return;
      }
      if (!r.ok) {
        setError('Failed to update password. Please try again.');
        return;
      }

      navigate('/', { replace: true });
    } catch {
      setError('Network error. Please try again.');
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
          Change your password
        </h1>
        <p style={{ margin: '0 0 24px', fontSize: 13, color: 'var(--fg-muted)' }}>
          You must set a new password before continuing.
        </p>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 12, color: 'var(--fg-muted)', fontWeight: 500 }}>Current password</span>
            <input
              type="password" required autoFocus
              value={currentPw} onChange={e => setCurrentPw(e.target.value)}
              style={{ height: 36, padding: '0 12px', borderRadius: 'var(--radius-md)',
                       border: '1px solid var(--border)', background: 'var(--input-bg)',
                       color: 'var(--fg)', fontSize: 13, fontFamily: 'var(--ui-font)' }}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 12, color: 'var(--fg-muted)', fontWeight: 500 }}>New password</span>
            <input
              type="password" required
              value={newPw} onChange={e => setNewPw(e.target.value)}
              style={{ height: 36, padding: '0 12px', borderRadius: 'var(--radius-md)',
                       border: '1px solid var(--border)', background: 'var(--input-bg)',
                       color: 'var(--fg)', fontSize: 13, fontFamily: 'var(--ui-font)' }}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 12, color: 'var(--fg-muted)', fontWeight: 500 }}>Confirm new password</span>
            <input
              type="password" required
              value={confirmPw} onChange={e => setConfirmPw(e.target.value)}
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
            {loading ? 'Saving…' : 'Set new password'}
          </button>
        </form>
      </div>
    </div>
  );
}
