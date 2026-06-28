import type { MeResponse } from '@/lib/types';

/** Scope selection storage by tenant + user so switching tenants never restores
 *  another tenant's workspace/project selection. */
export function scopeFromMe(me: Pick<MeResponse, 'tenant_id' | 'user_id'> | null): string {
  if (me && me.tenant_id && me.user_id) return `${me.tenant_id}:${me.user_id}`;
  return '__global__';
}

export function wsKey(scope: string): string {
  return scope === '__global__' ? 'b2-workspace-id' : `b2-workspace-id:${scope}`;
}

export function projKey(scope: string): string {
  return scope === '__global__' ? 'b2-project-id' : `b2-project-id:${scope}`;
}
