/*
 * RowMenu — 3-dot context menu anchored to its trigger button.
 * Shared across settings sections (people, models, …).
 */
import { useState, useRef } from 'react';
import { Icon } from '@/components/ui/Icon';
import type { IconName } from '@/components/ui/Icon';
import { Popover } from '@/components/ui/Popover';

export interface ActionItem {
  label: string;
  icon?: IconName;
  danger?: boolean;
  divider?: boolean;
  onClick: () => void;
}

export function RowMenu({ items }: { items: ActionItem[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);

  return (
    <span onClick={(e) => e.stopPropagation()} style={{ flexShrink: 0, display: 'inline-flex' }}>
      <button
        ref={ref}
        onClick={() => setOpen((o) => !o)}
        title="More actions"
        style={{
          width: 30, height: 30, borderRadius: 8,
          border: `1px solid ${open ? 'var(--border-strong)' : 'transparent'}`,
          background: open ? 'var(--surface-2)' : 'transparent',
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <Icon name="more" size={16} color="var(--fg-muted)" />
      </button>
      {open && (
        <Popover
          anchorRef={ref as React.RefObject<HTMLElement | null>}
          onClose={() => setOpen(false)}
          placement="bottom-end"
          style={{ width: 210, padding: 6 }}
        >
          {items.map((it, i) => (
            <div key={i}>
              {it.divider && <div style={{ height: 1, background: 'var(--border)', margin: '5px 6px' }} />}
              <button
                onClick={() => { it.onClick(); setOpen(false); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '8px 9px',
                  border: 'none', borderRadius: 8, cursor: 'pointer', textAlign: 'left',
                  background: 'transparent', fontFamily: 'var(--ui-font)',
                  color: it.danger ? 'var(--destructive)' : 'var(--fg)',
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-2)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
              >
                {it.icon && <Icon name={it.icon} size={14} color={it.danger ? 'var(--destructive)' : 'var(--fg-muted)'} />}
                <span style={{ fontSize: 12.5, fontWeight: 500 }}>{it.label}</span>
              </button>
            </div>
          ))}
        </Popover>
      )}
    </span>
  );
}
