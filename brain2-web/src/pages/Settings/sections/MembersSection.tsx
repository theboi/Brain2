import { Icon } from '@/components/ui/Icon';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { SCard } from '@/components/settings/SettingsCard';
import { RoleBadge } from '@/components/settings/SettingsCard';

const MEMBERS = [
  { name: 'Alice Chen', email: 'alice@brain2.dev', role: 'Owner' as const, you: true,  status: 'active'  },
  { name: 'Bob Ng',     email: 'bob@brain2.dev',   role: 'Admin' as const, you: false, status: 'active'  },
  { name: 'Carol Diaz', email: 'carol@brain2.dev', role: 'Editor' as const,you: false, status: 'active'  },
  { name: 'Dan Park',   email: 'dan@brain2.dev',   role: 'Viewer' as const,you: false, status: 'invited' },
];

export function MembersSection() {
  return (
    <div>
      <SCard
        title="Members"
        desc="People with access to the default workspace. Roles map to the operations each member can call."
        action={<Button variant="primary" icon="plus">Invite</Button>}
      >
        {MEMBERS.map((m, i) => (
          <div
            key={m.email}
            style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 0', borderBottom: i === MEMBERS.length - 1 ? 'none' : '1px solid var(--border)' }}
          >
            <span style={{ width: 34, height: 34, borderRadius: '50%', background: 'var(--surface-2)', color: 'var(--fg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 600, flexShrink: 0 }}>
              {m.name[0]}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--fg)', display: 'flex', alignItems: 'center', gap: 7 }}>
                {m.name}
                {m.you && <span style={{ fontSize: 10.5, color: 'var(--fg-muted)' }}>you</span>}
              </div>
              <div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{m.email}</div>
            </div>
            {m.status === 'invited' && (
              <span style={{ fontSize: 11, color: 'var(--warning)', background: 'var(--warning-soft)', borderRadius: 6, padding: '2px 8px', display: 'flex', alignItems: 'center', gap: 4 }}>
                <Icon name="clock" size={11} /> invited
              </span>
            )}
            <button
              style={{ display: 'flex', alignItems: 'center', gap: 6, height: 30, padding: '0 10px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--fg)', cursor: m.you ? 'default' : 'pointer', fontFamily: 'var(--ui-font)', fontSize: 12.5, opacity: m.you ? 0.6 : 1 }}
              disabled={m.you}
            >
              <RoleBadge role={m.role} />
              {!m.you && <Icon name="chevDown" size={12} color="var(--fg-muted)" />}
            </button>
            <button style={{ width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', background: 'transparent', cursor: 'pointer', borderRadius: 7, opacity: m.you ? 0.4 : 1 }} disabled={m.you}>
              <Icon name="more" size={15} color="var(--fg-muted)" />
            </button>
          </div>
        ))}
      </SCard>

      <SCard title="Ownership" desc="Transfer ownership of this workspace to another admin. This cannot be undone.">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <Field placeholder="Select an admin to transfer to…" />
          </div>
          <Button variant="danger">Transfer ownership</Button>
        </div>
      </SCard>
    </div>
  );
}
