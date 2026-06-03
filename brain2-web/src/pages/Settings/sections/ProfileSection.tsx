import { Field } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { SCard } from '@/components/settings/SettingsCard';
import { RoleBadge } from '@/components/settings/SettingsCard';

export function ProfileSection() {
  return (
    <div>
      <SCard title="Profile" desc="How you appear across the workspace.">
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
          <span style={{ width: 64, height: 64, borderRadius: '50%', background: 'var(--accent-soft)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, fontWeight: 700, fontFamily: 'var(--display-font)', flexShrink: 0 }}>A</span>
          <div>
            <Button variant="ghost" size="sm">Change avatar</Button>
            <div style={{ fontSize: 11.5, color: 'var(--fg-muted)', marginTop: 6 }}>PNG or JPG, up to 2 MB.</div>
          </div>
          <span style={{ marginLeft: 'auto' }}><RoleBadge role="Owner" /></span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <Field label="Display name" defaultValue="Alice Chen" />
          <Field label="Username" defaultValue="alice" mono />
          <Field label="Email" defaultValue="alice@brain2.dev" type="email" />
          <Field label="Timezone" defaultValue="UTC−5 · New York" />
        </div>
        <div style={{ marginTop: 14 }}>
          <Field label="Bio" defaultValue="Knowledge ops lead. Keeping the wiki honest." wide />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
          <Button variant="ghost">Cancel</Button>
          <Button variant="primary">Save changes</Button>
        </div>
      </SCard>

      <SCard title="Password" desc="Update your sign-in credentials.">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <Field label="Current password" placeholder="••••••••" type="password" />
          <div />
          <Field label="New password" placeholder="••••••••" type="password" />
          <Field label="Confirm new password" placeholder="••••••••" type="password" />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <Button variant="primary">Update password</Button>
        </div>
      </SCard>
    </div>
  );
}
