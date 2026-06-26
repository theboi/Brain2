/*
 * Settings page — two-column layout:
 *   Left: grouped secondary nav (Organization · Settings)
 *   Right: scrollable section content (max-width 760px)
 */
import { useEffect, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import type { IconName } from '@/components/ui/Icon';
import type { Theme, Accent } from '@/lib/tokens';
import { ProfileSection } from './sections/ProfileSection';
import { OrgPeopleSection } from './sections/OrgPeopleSection';
import { IntegrationsSection } from './sections/IntegrationsSection';
import { ModelsSection } from './sections/ModelsSection';
import { AppearanceSection } from './sections/AppearanceSection';
import { ToolsSection } from './sections/ToolsSection';
import { AuditSection } from './sections/AuditSection';
import { DangerSection } from './sections/DangerSection';
import { WorkspacesSection } from './sections/workspaces/WorkspacesSection';
import { useMe } from '@/hooks/me';
import { visibleSectionIds, type SettingsSectionId } from './settingsNav';

type SectionId = SettingsSectionId;

interface NavItem {
  id: SectionId;
  icon: IconName;
  label: string;
  subtitle: string;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    title: 'Organization',
    items: [
      { id: 'workspaces', icon: 'layers',  label: 'Workspaces', subtitle: 'Organise vaults into workspaces and manage access.' },
      { id: 'people',     icon: 'users',   label: 'People',     subtitle: 'Everyone in your organization and their org-wide role.' },
    ],
  },
  {
    title: 'Settings',
    items: [
      { id: 'profile',      icon: 'user',     label: 'Profile',      subtitle: 'Manage your personal details and sign-in.' },
      { id: 'integrations', icon: 'plug',     label: 'Integrations', subtitle: 'Connect Telegram, Slack and other channels.' },
      { id: 'models',       icon: 'cpu',      label: 'Models',       subtitle: 'Manage the cloud and local models your agents can run.' },
      { id: 'appearance',   icon: 'sparkles', label: 'Appearance',   subtitle: 'Theme, accent and interface preferences.' },
      { id: 'tools',        icon: 'command',  label: 'Tools',        subtitle: 'Control which operations agents can call.' },
      { id: 'audit',        icon: 'history',  label: 'Audit log',    subtitle: 'A record of every change in this workspace.' },
      { id: 'danger',       icon: 'shield',   label: 'Danger zone',  subtitle: 'Irreversible, destructive actions.' },
    ],
  },
];

const ALL_NAV = NAV_GROUPS.flatMap((g) => g.items);

interface SettingsPageProps {
  theme: Theme;
  setTheme: (t: Theme) => void;
  accent: Accent;
  setAccent: (a: Accent) => void;
}

export function SettingsPage({ theme, setTheme, accent, setAccent }: SettingsPageProps) {
  const [sec, setSec] = useState<SectionId>('profile');
  const { data: me, isSuccess: meLoaded } = useMe();
  const role = me?.role ?? 'member';
  const allowedSectionIds = visibleSectionIds(role);
  const allowed = new Set<SectionId>(allowedSectionIds);
  const navGroups = NAV_GROUPS
    .map((g) => ({ ...g, items: g.items.filter((it) => allowed.has(it.id)) }))
    .filter((g) => g.items.length > 0);

  useEffect(() => {
    const readHash = () => {
      const id = window.location.hash.replace(/^#/, '') as SectionId;
      if (ALL_NAV.some((item) => item.id === id)) setSec(id);
    };
    readHash();
    window.addEventListener('hashchange', readHash);
    return () => window.removeEventListener('hashchange', readHash);
  }, []);

  useEffect(() => {
    if (meLoaded && !allowed.has(sec)) selectSection('profile');
  }, [meLoaded, role, sec]);

  const selectSection = (id: SectionId) => {
    setSec(id);
    window.history.replaceState(null, '', `${window.location.pathname}#${id}`);
  };

  const activeSection = allowed.has(sec) ? sec : 'profile';
  const cur = ALL_NAV.find((n) => n.id === activeSection) ?? ALL_NAV[0];

  const body: Record<SectionId, React.ReactNode> = {
    workspaces:   <WorkspacesSection />,
    people:       <OrgPeopleSection />,
    profile:      <ProfileSection />,
    integrations: <IntegrationsSection />,
    models:       <ModelsSection />,
    appearance:   <AppearanceSection theme={theme} setTheme={setTheme} accent={accent} setAccent={setAccent} />,
    tools:        <ToolsSection />,
    audit:        <AuditSection />,
    danger:       <DangerSection />,
  };

  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
      {/* Section nav */}
      <nav
        className="b2-hide-sm"
        style={{
          // .b2-hide-sm sets display:flex (default row); force column so the
          // Organization / Settings nav groups stack vertically, not side by side.
          flexDirection: 'column',
          width: 230, flexShrink: 0,
          borderRight: '1px solid var(--border)',
          background: 'var(--surface)',
          padding: '18px 12px',
          overflowY: 'auto',
        }}
      >
        {navGroups.map((g, gi) => (
          <div key={g.title} style={{ marginTop: gi ? 18 : 0 }}>
            <div style={{
              fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase',
              color: 'var(--fg-faint)', padding: '0 10px 10px',
            }}>
              {g.title}
            </div>
            {g.items.map((n) => {
              const on = n.id === activeSection;
              return (
                <button
                  key={n.id}
                  onClick={() => selectSection(n.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 11,
                    width: '100%', height: 38, padding: '0 12px',
                    border: 'none', borderRadius: 9, cursor: 'pointer', marginBottom: 2,
                    background: on ? 'var(--accent-soft)' : 'transparent',
                    fontFamily: 'var(--ui-font)',
                    transition: 'background var(--duration-fast)',
                  }}
                >
                  <Icon name={n.icon} size={17} color={on ? 'var(--accent)' : 'var(--fg-muted)'} />
                  <span style={{ fontSize: 13.5, fontWeight: on ? 600 : 500, color: on ? 'var(--fg)' : 'var(--fg-muted)' }}>
                    {n.label}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Section content */}
      <main style={{ flex: 1, minWidth: 0, overflowY: 'auto', background: 'var(--bg)' }}>
        <div style={{ maxWidth: activeSection === 'workspaces' ? 'none' : 760, margin: '0 auto', padding: '28px 28px 96px' }}>
          <h1 style={{ margin: '0 0 4px', fontFamily: 'var(--display-font)', fontSize: 24, fontWeight: 700, letterSpacing: 'var(--display-track)', color: 'var(--fg)' }}>
            {cur.label}
          </h1>
          <div style={{ fontSize: 13, color: 'var(--fg-muted)', marginBottom: 22 }}>
            {cur.subtitle}
          </div>
          {body[activeSection]}
        </div>
      </main>
    </div>
  );
}
