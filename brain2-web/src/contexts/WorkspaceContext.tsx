// brain2-web/src/contexts/WorkspaceContext.tsx
import { createContext, useContext, useEffect, useState, ReactNode } from 'react';

const WS_KEY = 'b2-workspace-id';
const PROJ_KEY = 'b2-project-id';

interface Ctx {
  workspaceId: string | null;
  projectId: string | null;
  setWorkspaceId: (id: string | null) => void;
  setProjectId: (id: string | null) => void;
}

const WorkspaceCtx = createContext<Ctx | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [workspaceId, setWid] = useState<string | null>(() => {
    try { return localStorage.getItem(WS_KEY); } catch { return null; }
  });
  const [projectId, setPid] = useState<string | null>(() => {
    try { return localStorage.getItem(PROJ_KEY); } catch { return null; }
  });

  useEffect(() => {
    try {
      if (workspaceId) localStorage.setItem(WS_KEY, workspaceId);
      else localStorage.removeItem(WS_KEY);
    } catch { /* ignore */ }
  }, [workspaceId]);

  useEffect(() => {
    try {
      if (projectId) localStorage.setItem(PROJ_KEY, projectId);
      else localStorage.removeItem(PROJ_KEY);
    } catch { /* ignore */ }
  }, [projectId]);

  const setWorkspaceId = (id: string | null) => {
    setWid(id);
    setPid(null); // reset project when workspace changes
  };

  return (
    <WorkspaceCtx.Provider value={{ workspaceId, projectId, setWorkspaceId, setProjectId: setPid }}>
      {children}
    </WorkspaceCtx.Provider>
  );
}

export function useWorkspace(): Ctx {
  const ctx = useContext(WorkspaceCtx);
  if (!ctx) throw new Error('useWorkspace must be used inside WorkspaceProvider');
  return ctx;
}
