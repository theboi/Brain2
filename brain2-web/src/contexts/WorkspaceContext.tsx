// brain2-web/src/contexts/WorkspaceContext.tsx
import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { qk, queryClient } from '@/lib/queryClient';
import type { MeResponse } from '@/lib/types';

function wsKey(userId: string | null) {
  return userId ? `b2-workspace-id:${userId}` : 'b2-workspace-id';
}

function projKey(userId: string | null) {
  return userId ? `b2-project-id:${userId}` : 'b2-project-id';
}

function readStored(key: string) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function writeStored(key: string, value: string | null) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch { /* ignore */ }
}

function currentUserIdFromCache() {
  return queryClient.getQueryData<MeResponse>(qk.me())?.user_id ?? null;
}

function useCachedUserId() {
  return useSyncExternalStore(
    (onStoreChange) => queryClient.getQueryCache().subscribe(onStoreChange),
    currentUserIdFromCache,
    () => null,
  );
}

interface Ctx {
  workspaceId: string | null;
  projectId: string | null;
  setWorkspaceId: (id: string | null) => void;
  setProjectId: (id: string | null) => void;
}

const WorkspaceCtx = createContext<Ctx | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const userId = useCachedUserId();
  const storageScope = userId ?? '__global__';
  const [loadedScope, setLoadedScope] = useState(storageScope);
  const [workspaceId, setWid] = useState<string | null>(() => readStored(wsKey(null)));
  const [projectId, setPid] = useState<string | null>(() => readStored(projKey(null)));

  useEffect(() => {
    setWid(readStored(wsKey(userId)));
    setPid(readStored(projKey(userId)));
    setLoadedScope(storageScope);
  }, [storageScope, userId]);

  useEffect(() => {
    if (loadedScope !== storageScope) return;
    writeStored(wsKey(userId), workspaceId);
  }, [loadedScope, storageScope, userId, workspaceId]);

  useEffect(() => {
    if (loadedScope !== storageScope) return;
    writeStored(projKey(userId), projectId);
  }, [loadedScope, storageScope, userId, projectId]);

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
