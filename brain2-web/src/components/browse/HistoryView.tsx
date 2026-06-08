/*
 * Shared history view: timeline plus always-visible diff.
 * Parents own fetching and pass the selected revision's hunks.
 */
import { useEffect, type ReactNode } from 'react';
import { Icon } from '@/components/ui/Icon';
import { btnGhost } from '@/components/browse/Browse';
import { DiffView } from '@/components/browse/DiffView';
import type { DiffHunk } from '@/lib/wiki';

export interface HistoryRevision {
  id: string;
  shortId: string;
  date: string;
  title: string;
  subtitle?: string;
}

export function HistoryView({
  revisions,
  selectedId,
  onSelect,
  hunks,
  diffLoading,
  onRevert,
  reverting,
  mobile,
  footer,
}: {
  revisions: HistoryRevision[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  hunks: DiffHunk[] | undefined;
  diffLoading?: boolean;
  onRevert?: (id: string) => void;
  reverting?: boolean;
  mobile?: boolean;
  footer?: ReactNode;
}) {
  useEffect(() => {
    const newest = revisions[0]?.id;
    if (newest && (!selectedId || !revisions.some((r) => r.id === selectedId))) {
      onSelect(newest);
    }
  }, [revisions, selectedId, onSelect]);

  const cur = revisions.find((r) => r.id === selectedId) ?? revisions[0];

  const timeline = (
    <div style={{ overflowY: mobile ? 'visible' : 'auto', paddingRight: 4 }}>
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-muted)', marginBottom: 12 }}>Timeline</div>
      <div style={{ position: 'relative' }}>
        <div style={{ position: 'absolute', left: 5, top: 6, bottom: 6, width: 2, background: 'var(--border)' }} />
        {revisions.length === 0 && <div style={{ padding: '8px 0 8px 21px', fontSize: 12.5, color: 'var(--fg-faint)' }}>No history yet.</div>}
        {revisions.map((r) => {
          const on = r.id === selectedId;
          return (
            <button key={r.id} onClick={() => onSelect(r.id)} style={{ position: 'relative', display: 'flex', alignItems: 'flex-start', gap: 12, width: '100%', padding: '8px 8px 8px 0', border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left', borderRadius: 8 }}>
              <span style={{ position: 'relative', zIndex: 1, marginTop: 3, width: 12, height: 12, borderRadius: '50%', flexShrink: 0, background: on ? 'var(--accent)' : 'var(--surface)', border: `2px solid ${on ? 'var(--accent)' : 'var(--border-strong)'}` }} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <b style={{ fontFamily: 'var(--mono-font)', fontSize: 12.5, fontWeight: 500, color: on ? 'var(--fg)' : 'var(--fg-muted)' }}>{r.shortId}</b>
                  <span style={{ fontSize: 11.5, color: 'var(--fg-faint)' }}>{r.date}</span>
                </span>
                <span style={{ display: 'block', fontSize: 12, color: on ? 'var(--fg)' : 'var(--fg-muted)', marginTop: 2 }}>{r.title || r.subtitle}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );

  const diffPanel = (
    <div style={{ overflowY: mobile ? 'visible' : 'auto', minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--fg)' }}>Diff</span>
      </div>
      {diffLoading && <div style={{ fontSize: 12.5, color: 'var(--fg-faint)', padding: '8px 0' }}>Loading diff...</div>}
      {!diffLoading && hunks && hunks.length > 0 && <DiffView hunks={hunks} />}
      {!diffLoading && hunks && hunks.length === 0 && <div style={{ fontSize: 12.5, color: 'var(--fg-faint)', padding: '8px 0' }}>No textual changes in this revision.</div>}
      {cur && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16, padding: '12px 0', borderTop: '1px solid var(--border)', flexWrap: 'wrap' }}>
          <div style={{ fontSize: 12.5, color: 'var(--fg-muted)' }}>
            {cur.subtitle && <>By <b style={{ color: 'var(--fg)' }}>{cur.subtitle}</b> · </>}{cur.date}
            {cur.title && <><br /><span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 4 }}>{cur.title}</span></>}
          </div>
          {onRevert && (
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <button onClick={() => onRevert(cur.id)} disabled={reverting} style={{ ...btnGhost(), opacity: reverting ? 0.6 : 1 }}>
                <Icon name="history" size={13} /> Revert to this
              </button>
            </span>
          )}
        </div>
      )}
      {footer}
    </div>
  );

  if (mobile) {
    return <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>{timeline}{diffPanel}</div>;
  }
  return <div style={{ display: 'grid', gridTemplateColumns: '260px minmax(0, 1fr)', gap: 20, height: '100%' }}>{timeline}{diffPanel}</div>;
}
