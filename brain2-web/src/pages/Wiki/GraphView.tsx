/*
 * Brain2 Console — Wiki graph tab. Vault-scoped graph using the shared
 * OrgGraphView component. Pages always on, Sources toggle only, merged
 * re-run button, open-graph icon linking to the standalone Graph page.
 * Faithful port of docs/design/v1 wiki graph tab updates (chat29–chat30).
 */
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useTheme } from '@/hooks/useTheme';
import { OrgGraphView } from '@/pages/Graph/OrgGraphView';
import { PROJECT_TO_VAULT } from '@/pages/Graph/mockData';

export function GraphView({ isMobile }: { isMobile?: boolean }) {
  const { projectId } = useWorkspace();
  const { theme } = useTheme();
  const scope = (projectId && PROJECT_TO_VAULT[projectId]) ?? PROJECT_TO_VAULT['default'] ?? 'v_general';

  return (
    <OrgGraphView
      theme={theme}
      isMobile={isMobile}
      scope={scope}
      openGraphHref="/graph"
      wikiScope={true}
    />
  );
}
