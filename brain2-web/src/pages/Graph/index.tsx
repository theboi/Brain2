/*
 * Brain2 Console — Graph page. Standalone full-screen graph. Defaults to the
 * full org graph (workspaces, vaults, pages, people, groups). When opened with
 * a `?vault=<projectId>` query param (the quick-access button on the Wiki and
 * Sources pages) it renders that vault's wiki-link graph instead.
 */
import { useSearchParams } from 'react-router-dom';
import { useTheme } from '@/hooks/useTheme';
import { useMedia, MOBILE_QUERY } from '@/hooks/useMedia';
import { useOrgGraph, useVaultGraphData } from '@/hooks/useGraph';
import { OrgGraphView } from './OrgGraphView';
import { installOrgGraphData, installVaultGraphData } from './graphDataset';

export function GraphPage() {
  const { theme } = useTheme();
  const isMobile = useMedia(MOBILE_QUERY);
  const [params] = useSearchParams();
  const vault = params.get('vault');
  const isVault = !!vault;

  const org = useOrgGraph(!isVault);
  const vaultGraph = useVaultGraphData(vault);
  const active = isVault ? vaultGraph : org;
  const { isLoading, error } = active;

  if (isVault) {
    if (vaultGraph.data) installVaultGraphData(vaultGraph.data);
  } else if (org.data) {
    installOrgGraphData(org.data);
  }

  const ready = isVault ? !!vaultGraph.data : !!org.data;

  return (
    <div style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden' }}>
      {isLoading && <div style={{ padding: 16, color: 'var(--fg-muted)' }}>Loading graph...</div>}
      {error && <div style={{ padding: 16, color: 'var(--destructive)' }}>Graph could not be loaded.</div>}
      {ready && (
        <OrgGraphView
          theme={theme}
          isMobile={isMobile}
          scope={isVault ? vault! : 'org'}
          wikiScope={isVault}
        />
      )}
    </div>
  );
}
