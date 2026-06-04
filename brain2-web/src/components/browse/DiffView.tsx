/*
 * Brain2 Console — line-level diff view shared by Wiki history + Audit cards.
 * Add/del rows use --diff-add/del tokens plus a leading +/− sign so the signal
 * is not colour-only (a11y). Faithful port of DiffView from wiki.jsx.
 */
import type { DiffHunk } from '@/lib/wiki';

export function DiffView({ hunks, compact = false }: { hunks: DiffHunk[]; compact?: boolean }) {
  const fs = compact ? 12 : 12.5;
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', fontFamily: 'var(--mono-font)', fontSize: fs, lineHeight: 1.7 }}>
      {hunks.map((h, i) => {
        const bg = h.type === 'add' ? 'var(--diff-add-bg)' : h.type === 'del' ? 'var(--diff-del-bg)' : 'transparent';
        const gut = h.type === 'add' ? 'var(--diff-add-gutter)' : h.type === 'del' ? 'var(--diff-del-gutter)' : 'transparent';
        const sign = h.type === 'add' ? '+' : h.type === 'del' ? '−' : ' ';
        const col = h.type === 'add' ? 'var(--success)' : h.type === 'del' ? 'var(--destructive)' : 'var(--fg-muted)';
        return (
          <div key={i} style={{ display: 'flex', background: bg }}>
            <span style={{ width: 26, flexShrink: 0, textAlign: 'center', color: col, background: gut, userSelect: 'none' }}>{sign}</span>
            <span style={{ padding: '0 12px', color: h.type === 'ctx' ? 'var(--fg-muted)' : 'var(--fg)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{h.text || ' '}</span>
          </div>
        );
      })}
    </div>
  );
}
