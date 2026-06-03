import { Button } from '@/components/ui/Button';
import { SCard } from '@/components/settings/SettingsCard';

const AUDIT_EVENTS = [
  { t: '14:02', who: 'alice',  ev: 'agent.message', detail: 'Researcher · 1,840 tok' },
  { t: '13:31', who: 'alice',  ev: 'wiki.put',       detail: 'Cell theory v7 (LLM audit)' },
  { t: '13:12', who: 'system', ev: 'breaker.open',   detail: 'Archivist · per-tenant limit' },
  { t: '11:46', who: 'bob',    ev: 'source.ingest',  detail: 'standup-04-12.md' },
  { t: '09:20', who: 'alice',  ev: 'member.role',    detail: 'carol → Editor' },
];

export function AuditSection() {
  return (
    <SCard
      title="Audit log"
      desc="Every mutation, from the events outbox."
      action={<Button variant="ghost" icon="download" size="sm">Export</Button>}
    >
      {AUDIT_EVENTS.map((e, i) => (
        <div
          key={i}
          style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 0', borderBottom: i === AUDIT_EVENTS.length - 1 ? 'none' : '1px solid var(--border)' }}
        >
          <span style={{ fontFamily: 'var(--mono-font)', fontSize: 11.5, color: 'var(--fg-faint)', width: 40 }}>{e.t}</span>
          <span style={{ fontFamily: 'var(--mono-font)', fontSize: 12, color: 'var(--accent)', width: 130, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.ev}</span>
          <span style={{ flex: 1, fontSize: 13, color: 'var(--fg)', minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.detail}</span>
          <span style={{ fontSize: 12, color: 'var(--fg-muted)', fontFamily: 'var(--mono-font)', flexShrink: 0 }}>{e.who}</span>
        </div>
      ))}
    </SCard>
  );
}
