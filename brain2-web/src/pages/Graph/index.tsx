/*
 * Brain2 Console — Graph page. Standalone full-screen org graph showing
 * workspaces, vaults, pages, people, and groups in one force-directed canvas.
 * Accessed from the Wiki header "Open graph" icon.
 */
import { useTheme } from '@/hooks/useTheme';
import { useMedia, MOBILE_QUERY } from '@/hooks/useMedia';
import { useOrgGraph } from '@/hooks/useGraph';
import { OrgGraphView } from './OrgGraphView';
import { installOrgGraphData } from './graphDataset';

export function GraphPage() {
  const { theme } = useTheme();
  const isMobile = useMedia(MOBILE_QUERY);
  const { data, isLoading, error } = useOrgGraph();

  if (data) installOrgGraphData(data);

  return (
    <div style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden' }}>
      {isLoading && <div style={{ padding: 16, color: 'var(--fg-muted)' }}>Loading graph...</div>}
      {error && <div style={{ padding: 16, color: 'var(--destructive)' }}>Graph could not be loaded.</div>}
      {data && <OrgGraphView theme={theme} isMobile={isMobile} scope="org" />}
    </div>
  );
}
