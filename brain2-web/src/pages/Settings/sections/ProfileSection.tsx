import { useState, useEffect } from 'react';
import { Field } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { SCard } from '@/components/settings/SettingsCard';
import { RoleBadge } from '@/components/settings/SettingsCard';
import { useMe, useUpdateProfile, useChangePassword } from '@/hooks/me';
import { usePersona, useSetPersona } from '@/hooks/usePersona';
import { ApiError } from '@/lib/api';

export function ProfileSection() {
  const { data: me, isLoading, isError } = useMe();
  const { data: persona } = usePersona();
  const updateProfile = useUpdateProfile();
  const changePassword = useChangePassword();
  const setPersona = useSetPersona();

  // Profile form state
  const [displayName, setDisplayName] = useState('');
  const [profileSuccess, setProfileSuccess] = useState(false);
  const [profileError, setProfileError] = useState('');

  // Persona form state
  const [personaText, setPersonaText] = useState('');
  const [personaSaved, setPersonaSaved] = useState(false);
  const [personaError, setPersonaError] = useState('');

  // Password form state
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwSuccess, setPwSuccess] = useState(false);
  const [pwError, setPwError] = useState('');

  // Initialize display name from API data
  useEffect(() => {
    if (me?.display_name != null) {
      setDisplayName(me.display_name);
    }
  }, [me?.display_name]);

  useEffect(() => {
    if (persona?.content != null) {
      setPersonaText(persona.content);
    }
  }, [persona?.content]);

  function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    setProfileSuccess(false);
    setProfileError('');
    updateProfile.mutate(
      { display_name: displayName },
      {
        onSuccess: () => setProfileSuccess(true),
        onError: () => setProfileError('Failed to save profile. Please try again.'),
      },
    );
  }

  function handleSavePersona(e: React.FormEvent) {
    e.preventDefault();
    setPersonaSaved(false);
    setPersonaError('');
    setPersona.mutate(personaText, {
      onSuccess: () => setPersonaSaved(true),
      onError: () => setPersonaError('Failed to save persona. Please try again.'),
    });
  }

  function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwSuccess(false);
    setPwError('');

    if (newPw !== confirmPw) {
      setPwError('New passwords do not match.');
      return;
    }

    changePassword.mutate(
      { current_password: currentPw, new_password: newPw },
      {
        onSuccess: () => {
          setPwSuccess(true);
          setCurrentPw('');
          setNewPw('');
          setConfirmPw('');
        },
        onError: (err) => {
          if (err instanceof ApiError) {
            if (err.status === 401) {
              setPwError('Current password is incorrect.');
              return;
            }
            if (err.status === 429) {
              setPwError('Too many attempts, please wait.');
              return;
            }
          }
          setPwError('Failed to update password. Please try again.');
        },
      },
    );
  }

  if (isLoading) {
    return (
      <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--fg-muted)', fontSize: 13 }}>
        Loading profile…
      </div>
    );
  }

  if (isError) {
    return (
      <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--destructive)', fontSize: 13 }}>
        Failed to load profile. Please refresh and try again.
      </div>
    );
  }

  return (
    <div>
      <SCard title="Profile" desc="How you appear across the workspace.">
        <form onSubmit={handleSaveProfile}>
          {/* Role badge in top-right */}
          {me?.role && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
              <RoleBadge role={me.role as Parameters<typeof RoleBadge>[0]['role']} />
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Field
              label="Display name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
            <Field
              label="Email"
              value={me?.email ?? ''}
              type="email"
              readOnly
              style={{ opacity: 0.7, cursor: 'default' }}
            />
          </div>

          <p style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 14, marginBottom: 0 }}>
            Avatar, username, and bio fields are planned for a future release.
          </p>

          {profileError && (
            <p style={{ fontSize: 12.5, color: 'var(--destructive)', marginTop: 10, marginBottom: 0 }}>
              {profileError}
            </p>
          )}
          {profileSuccess && (
            <p style={{ fontSize: 12.5, color: 'var(--success, var(--accent))', marginTop: 10, marginBottom: 0 }}>
              Profile saved.
            </p>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
            <Button variant="primary" type="submit" disabled={updateProfile.isPending}>
              {updateProfile.isPending ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </form>
      </SCard>

      <SCard title="Persona" desc="A private note about you that is prepended to your AI requests.">
        <form onSubmit={handleSavePersona}>
          <label style={{ display: 'block' }}>
            <span style={{ display: 'block', fontSize: 12, color: 'var(--fg-muted)', marginBottom: 6 }}>
              Personal context
            </span>
            <textarea
              value={personaText}
              onChange={(e) => {
                setPersonaText(e.target.value);
                setPersonaSaved(false);
                setPersonaError('');
              }}
              placeholder="e.g. Operations & Finance lead. Prefers concise, board-ready output. Currently focused on Q2 planning."
              spellCheck={false}
              style={{ width: '100%', minHeight: 200, resize: 'vertical', padding: 14, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface-2)', fontFamily: 'var(--mono-font)', fontSize: 13, lineHeight: 1.6, color: 'var(--fg)', outline: 'none' }}
            />
          </label>

          {personaError && (
            <p style={{ fontSize: 12.5, color: 'var(--destructive)', marginTop: 10, marginBottom: 0 }}>
              {personaError}
            </p>
          )}
          {personaSaved && (
            <p style={{ fontSize: 12.5, color: 'var(--success, var(--accent))', marginTop: 10, marginBottom: 0 }}>
              Persona saved.
            </p>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
            <Button variant="primary" type="submit" disabled={setPersona.isPending}>
              {setPersona.isPending ? 'Saving…' : 'Save persona'}
            </Button>
          </div>
        </form>
      </SCard>

      <SCard title="Password" desc="Update your sign-in credentials.">
        <form onSubmit={handleChangePassword}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Field
              label="Current password"
              placeholder="••••••••"
              type="password"
              value={currentPw}
              onChange={(e) => setCurrentPw(e.target.value)}
              autoComplete="current-password"
            />
            <div />
            <Field
              label="New password"
              placeholder="••••••••"
              type="password"
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              autoComplete="new-password"
            />
            <Field
              label="Confirm new password"
              placeholder="••••••••"
              type="password"
              value={confirmPw}
              onChange={(e) => setConfirmPw(e.target.value)}
              autoComplete="new-password"
            />
          </div>

          {pwError && (
            <p style={{ fontSize: 12.5, color: 'var(--destructive)', marginTop: 10, marginBottom: 0 }}>
              {pwError}
            </p>
          )}
          {pwSuccess && (
            <p style={{ fontSize: 12.5, color: 'var(--success, var(--accent))', marginTop: 10, marginBottom: 0 }}>
              Password updated.
            </p>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
            <Button variant="primary" type="submit" disabled={changePassword.isPending}>
              {changePassword.isPending ? 'Updating…' : 'Update password'}
            </Button>
          </div>
        </form>
      </SCard>
    </div>
  );
}
