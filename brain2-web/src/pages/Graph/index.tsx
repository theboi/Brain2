/*
 * Brain2 Console — Graph page. Standalone full-screen org graph showing
 * workspaces, vaults, pages, people, and groups in one force-directed canvas.
 * Accessed from the Wiki header "Open graph" icon.
 */
import { useTheme } from '@/hooks/useTheme';
import { useMedia, MOBILE_QUERY } from '@/hooks/useMedia';
import { OrgGraphView } from './OrgGraphView';

export function GraphPage() {
  const { theme } = useTheme();
  const isMobile = useMedia(MOBILE_QUERY);

  return (
    <div style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden' }}>
      <OrgGraphView theme={theme} isMobile={isMobile} scope="org" />
    </div>
  );
}
