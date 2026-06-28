// brain2-web/src/contexts/WorkspaceContext.tsx
import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { qk, queryClient } from '@/lib/queryClient';
import type { MeResponse } from '@/lib/types';
import { projKey, scopeFromMe, wsKey } from './workspaceStorageKey';

function readStored(key: string) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function writeStored(key: string, value: string | null) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch { /* ignore */ }
}

function currentScopeFromCache() {
  return scopeFromMe(queryClient.getQueryData<MeResponse>(qk.me()) ?? null);
}

function useCachedScope() {
  return useSyncExternalStore(
    (onStoreChange) => queryClient.getQueryCache().subscribe(onStoreChange),
    currentScopeFromCache,
    () => '__global__',
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
  const scope = useCachedScope();
  const storageScope = scope;
  const [loadedScope, setLoadedScope] = useState(storageScope);
  const [workspaceId, setWid] = useState<string | null>(() => readStored(wsKey('__global__')));
  const [projectId, setPid] = useState<string | null>(() => readStored(projKey('__global__')));

  useEffect(() => {
    setWid(readStored(wsKey(scope)));
    setPid(readStored(projKey(scope)));
    setLoadedScope(storageScope);
  }, [storageScope, scope]);

  useEffect(() => {
    if (loadedScope !== storageScope) return;
    writeStored(wsKey(scope), workspaceId);
  }, [loadedScope, storageScope, scope, workspaceId]);

  useEffect(() => {
    if (loadedScope !== storageScope) return;
    writeStored(projKey(scope), projectId);
  }, [loadedScope, storageScope, scope, projectId]);

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
