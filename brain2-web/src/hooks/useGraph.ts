import { useQuery } from '@tanstack/react-query';
import { ops } from '@/lib/api';
import { qk } from '@/lib/queryClient';
import type { OrgGraphResponse, VaultGraphResponse } from '@/lib/types';

export function useOrgGraph() {
  return useQuery({
    queryKey: qk.orgGraph(),
    queryFn: () => ops<OrgGraphResponse>('graph:org'),
  });
}

export function useVaultGraphData(projectId: string | null) {
  return useQuery({
    queryKey: projectId ? qk.liveVaultGraph(projectId) : ['graph', 'vault', '_'],
    queryFn: () => ops<VaultGraphResponse>('graph:vault', { project_id: projectId }),
    enabled: !!projectId,
  });
}
