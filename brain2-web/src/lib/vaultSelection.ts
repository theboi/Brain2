// Shared selection logic for the active vault (project) within a workspace.
// Used by the Wiki and Sources pages, which both keep the WorkspaceContext
// `projectId` in sync with the project list of the active workspace.

interface HasProjectId { project_id: string; }
interface HasIdName { project_id: string; name: string; }

/**
 * Decide which project should be selected given the project list for the
 * active workspace.
 *
 * - While the list is still loading (`projectsLoaded` false) we leave the
 *   current selection untouched so we never clobber a persisted projectId
 *   before its workspace's list has actually arrived.
 * - Once loaded, if the current selection is still in the list we keep it.
 * - Otherwise we fall back to the first project, or `null` when the workspace
 *   has no vaults at all. Returning `null` (rather than bailing out) is what
 *   clears a stale projectId after the selected vault is moved to another
 *   workspace and the source workspace becomes empty.
 */
export function resolveActiveProjectId(
  projectsLoaded: boolean,
  projects: HasProjectId[],
  current: string | null,
): string | null {
  if (!projectsLoaded) return current;
  const valid = current != null && projects.some((p) => p.project_id === current);
  if (valid) return current;
  return projects[0]?.project_id ?? null;
}

/** Resolve a vault's display name by project_id. Lookup is by id, so duplicate
 *  vault names never resolve to the wrong vault. */
export function vaultLabel(projects: HasIdName[], projectId: string | null): string {
  if (projectId == null) return '';
  return projects.find((p) => p.project_id === projectId)?.name ?? '';
}
