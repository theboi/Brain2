/*
 * Brain2 Console — Wiki graph tab. Vault-scoped graph using the shared
 * OrgGraphView component. Pages always on, Sources toggle only, merged
 * re-run button, open-graph icon linking to the standalone Graph page.
 * Faithful port of docs/design/v1 wiki graph tab updates (chat29–chat30).
 */
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useTheme } from '@/hooks/useTheme';
import { useVaultGraphData } from '@/hooks/useGraph';
import { OrgGraphView } from '@/pages/Graph/OrgGraphView';
import { installVaultGraphData } from '@/pages/Graph/graphDataset';

export function GraphView({ isMobile }: { isMobile?: boolean }) {
  const { projectId } = useWorkspace();
  const { theme } = useTheme();
  const { data, isLoading, error } = useVaultGraphData(projectId);

  if (data) installVaultGraphData(data);
  if (isLoading) return <div style={{ padding: 16, color: 'var(--fg-muted)' }}>Loading graph...</div>;
  if (error || !projectId) return <div style={{ padding: 16, color: 'var(--destructive)' }}>Graph could not be loaded.</div>;

  return (
    <OrgGraphView
      theme={theme}
      isMobile={isMobile}
      scope={projectId}
      openGraphHref="/graph"
      wikiScope={true}
    />
  );
}
