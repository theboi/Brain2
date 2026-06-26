export type SettingsSectionId =
  | 'workspaces'
  | 'people'
  | 'profile'
  | 'integrations'
  | 'models'
  | 'appearance'
  | 'tools'
  | 'audit'
  | 'danger';

const ALL_SECTIONS: SettingsSectionId[] = [
  'workspaces',
  'people',
  'profile',
  'integrations',
  'models',
  'appearance',
  'tools',
  'audit',
  'danger',
];

const OWNER_ONLY: SettingsSectionId[] = ['people', 'tools', 'audit', 'danger'];

export function visibleSectionIds(role: string): SettingsSectionId[] {
  if (role === 'owner') return ALL_SECTIONS;
  return ALL_SECTIONS.filter((id) => !OWNER_ONLY.includes(id));
}
