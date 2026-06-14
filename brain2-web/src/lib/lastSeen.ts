export type PresenceState = 'active' | 'offline';

export function presenceFromLastSeen(lastSeenAt: string | null | undefined, now = new Date()): PresenceState {
  if (!lastSeenAt) return 'offline';
  const seen = new Date(lastSeenAt).getTime();
  if (Number.isNaN(seen)) return 'offline';
  return now.getTime() - seen <= 5 * 60 * 1000 ? 'active' : 'offline';
}

export function formatLastSeen(lastSeenAt: string | null | undefined, now = new Date()): string {
  if (!lastSeenAt) return 'Never seen';
  const seen = new Date(lastSeenAt).getTime();
  if (Number.isNaN(seen)) return 'Never seen';
  const delta = Math.max(0, now.getTime() - seen);
  if (delta <= 5 * 60 * 1000) return 'Active now';
  const minutes = Math.round(delta / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.round(days / 7);
  return `${weeks}w ago`;
}
