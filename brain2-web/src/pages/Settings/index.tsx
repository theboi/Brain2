/*
 * Settings page — two-column layout:
 *   Left: secondary nav (sections)
 *   Right: scrollable section content (max-width 760px)
 *
 * Sections: Profile · People · Members · Integrations · Providers · Appearance ·
 *           Tools · Audit log · Vault Access · Danger zone
 */
import { useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import type { IconName } from '@/components/ui/Icon';
import type { Theme, Accent } from '@/lib/tokens';
import { ProfileSection } from './sections/ProfileSection';
import { PeopleSection } from './sections/PeopleSection';
import { MembersSection } from './sections/MembersSection';
import { IntegrationsSection } from './sections/IntegrationsSection';
import { ProvidersSection } from './sections/ProvidersSection';
import { AppearanceSection } from './sections/AppearanceSection';
import { ToolsSection } from './sections/ToolsSection';
import { AuditSection } from './sections/AuditSection';
import { DangerSection } from './sections/DangerSection';
import { VaultAccessSection } from './sections/VaultAccessSection';
import { WorkspacesSection } from './sections/workspaces/WorkspacesSection';
import { useMe } from '@/hooks/me';

type SectionId = 'profile' | 'people' | 'members' | 'workspaces' | 'integrations' | 'providers' | 'appearance' | 'tools' | 'audit' | 'vault-access' | 'danger';

interface NavItem {
  id: SectionId;
  icon: IconName;
  label: string;
  subtitle: string;
}

const NAV: NavItem[] = [
  { id: 'profile',      icon: 'user',     label: 'Profile',      subtitle: 'Manage your personal details and sign-in.' },
  { id: 'people',       icon: 'users',    label: 'People',       subtitle: 'Manage tenant members and guests.' },
  { id: 'members',      icon: 'users',    label: 'Members',      subtitle: 'Invite teammates and manage their roles.' },
  { id: 'workspaces',   icon: 'layers',   label: 'Workspaces',   subtitle: 'Organise vaults into workspaces and manage access.' },
  { id: 'integrations', icon: 'plug',     label: 'Integrations', subtitle: 'Connect Telegram, Slack and other channels.' },
  { id: 'providers',    icon: 'key',      label: 'Providers',    subtitle: 'Bring your own model API keys.' },
  { id: 'appearance',   icon: 'sparkles', label: 'Appearance',   subtitle: 'Theme, accent and interface preferences.' },
  { id: 'tools',        icon: 'command',  label: 'Tools',        subtitle: 'Control which operations agents can call.' },
  { id: 'audit',        icon: 'history',  label: 'Audit log',    subtitle: 'A record of every change in this workspace.' },
  { id: 'vault-access', icon: 'shield',   label: 'Vault Access', subtitle: 'Manage who can access each vault.' },
  { id: 'danger',       icon: 'shield',   label: 'Danger zone',  subtitle: 'Irreversible, destructive actions.' },
];

interface SettingsPageProps {
  theme: Theme;
  setTheme: (t: Theme) => void;
  accent: Accent;
  setAccent: (a: Accent) => void;
}

export function SettingsPage({ theme, setTheme, accent, setAccent }: SettingsPageProps) {
  const [sec, setSec] = useState<SectionId>('profile');
  const { data: me } = useMe();

  const visibleNav = NAV.filter(n => {
    if (n.id === 'people') return me?.role === 'owner';
    return true;
  });

  const cur = visibleNav.find((n) => n.id === sec) ?? visibleNav[0];

  const body: Record<SectionId, React.ReactNode> = {
    profile:      <ProfileSection />,
    people:       <PeopleSection />,
    members:      <MembersSection />,
    workspaces:   <WorkspacesSection />,
    integrations: <IntegrationsSection />,
    providers:    <ProvidersSection />,
    appearance:   <AppearanceSection theme={theme} setTheme={setTheme} accent={accent} setAccent={setAccent} />,
    tools:        <ToolsSection />,
    audit:        <AuditSection />,
    'vault-access': <VaultAccessSection />,
    danger:       <DangerSection />,
  };

  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
      {/* Section nav */}
      <nav
        className="b2-hide-sm"
        style={{ width: 230, flexShrink: 0, flexDirection: 'column', borderRight: '1px solid var(--border)', background: 'var(--surface)', padding: '18px 12px', overflowY: 'auto' }}
      >
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-faint)', padding: '0 10px 10px' }}>
          Settings
        </div>
        {visibleNav.map((n) => {
          const on = n.id === sec;
          return (
            <button
              key={n.id}
              onClick={() => setSec(n.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 11, width: '100%', height: 38,
                padding: '0 12px', border: 'none', borderRadius: 9, cursor: 'pointer', marginBottom: 2,
                background: on ? 'var(--accent-soft)' : 'transparent',
                color: on ? 'var(--accent)' : 'var(--fg-muted)',
                fontFamily: 'var(--ui-font)',
                transition: 'background var(--duration-fast)',
              }}
            >
              <Icon name={n.icon} size={17} />
              <span style={{ fontSize: 13.5, fontWeight: on ? 600 : 500, color: on ? 'var(--fg)' : 'var(--fg-muted)' }}>
                {n.label}
              </span>
            </button>
          );
        })}
      </nav>

      {/* Section content */}
      <main style={{ flex: 1, minWidth: 0, overflowY: 'auto', background: 'var(--bg)' }}>
        <div style={{ maxWidth: 760, margin: '0 auto', padding: '28px 28px 96px' }}>
          <h1 style={{ margin: '0 0 4px', fontFamily: 'var(--display-font)', fontSize: 24, fontWeight: 700, letterSpacing: 'var(--display-track)', color: 'var(--fg)' }}>
            {cur.label}
          </h1>
          <div style={{ fontSize: 13, color: 'var(--fg-muted)', marginBottom: 22 }}>
            {cur.subtitle}
          </div>
          {body[sec]}
        </div>
      </main>
    </div>
  );
}
