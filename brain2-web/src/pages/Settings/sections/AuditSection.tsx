import { Button } from '@/components/ui/Button';
import { SCard } from '@/components/settings/SettingsCard';
import { useAuditEvents } from '@/hooks/useActivity';
import type { AuditEvent } from '@/lib/activity';

function hhmm(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--:--';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

function detail(event: AuditEvent): string {
  const parts = [];
  const mode = event.payload.mode;
  const projectId = event.payload.project_id;
  const error = event.payload.error;
  if (typeof mode === 'string' && mode) parts.push(mode);
  if (typeof projectId === 'string' && projectId) parts.push(`project ${projectId.slice(0, 8)}`);
  if (typeof error === 'string' && error) parts.push(error);
  if (!parts.length && event.resource_id) parts.push(event.resource_id);
  return parts.join(' - ') || 'audit event';
}

function AuditRow({ event, isLast }: { event: AuditEvent; isLast: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '11px 0',
        borderBottom: isLast ? 'none' : '1px solid var(--border)',
      }}
    >
      <span style={{ fontFamily: 'var(--mono-font)', fontSize: 11.5, color: 'var(--fg-faint)', width: 40 }}>
        {hhmm(event.ts)}
      </span>
      <span style={{ fontFamily: 'var(--mono-font)', fontSize: 12, color: 'var(--accent)', width: 130, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {event.action || 'audit'}
      </span>
      <span style={{ flex: 1, fontSize: 13, color: 'var(--fg)', minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {detail(event)}
      </span>
      <span style={{ fontSize: 12, color: 'var(--fg-muted)', fontFamily: 'var(--mono-font)', flexShrink: 0 }}>
        {event.actor_id || 'system'}
      </span>
    </div>
  );
}

export function AuditSection() {
  const audit = useAuditEvents(50);
  const events = audit.data?.events ?? [];

  return (
    <SCard
      title="Audit log"
      desc="Every mutation, from the events outbox."
      action={<Button variant="ghost" icon="download" size="sm">Export</Button>}
    >
      {audit.isLoading && (
        <div style={{ padding: '11px 0', fontSize: 13, color: 'var(--fg-muted)' }}>
          Loading audit events...
        </div>
      )}
      {audit.isError && (
        <div style={{ padding: '11px 0', fontSize: 13, color: 'var(--danger, #B91C1C)' }}>
          Audit events could not be loaded.
        </div>
      )}
      {!audit.isLoading && !audit.isError && events.length === 0 && (
        <div style={{ padding: '11px 0', fontSize: 13, color: 'var(--fg-muted)' }}>
          No audit events yet.
        </div>
      )}
      {!audit.isLoading && !audit.isError && events.map((event, i) => (
        <AuditRow key={event.id} event={event} isLast={i === events.length - 1} />
      ))}
    </SCard>
  );
}
