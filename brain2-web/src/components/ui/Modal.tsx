/*
 * Brain2 Console — shared Modal shell. The single overlay primitive: fixed
 * backdrop, centered animated panel, Escape + backdrop-click to close, portalled
 * to document.body so the backdrop's blur never becomes a containing block for
 * the panel or for any position:fixed dropdowns rendered inside it.
 *
 * All app overlays should be built on this. Use `header` for a fully custom
 * header, or `icon`+`title` for the standard one.
 */
import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '@/components/ui/Icon';
import type { IconName } from '@/components/ui/Icon';

export interface ModalProps {
  onClose: () => void;
  children: ReactNode;
  icon?: IconName;
  title?: ReactNode;
  width?: number;
  footer?: ReactNode;
  header?: ReactNode;            // overrides icon/title when provided
  closeOnBackdrop?: boolean;     // default true
}

export function Modal({
  onClose, children, icon, title, width = 760, footer, header,
  closeOnBackdrop = true,
}: ModalProps) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [onClose]);

  return createPortal(
    <div
      className="b2-anim-fade"
      onClick={closeOnBackdrop ? onClose : undefined}
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(8,9,12,0.55)', backdropFilter: 'blur(3px)',
        WebkitBackdropFilter: 'blur(3px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}
    >
      <div
        className="b2-anim-slide"
        onClick={(e) => e.stopPropagation()}
        style={{
          width, maxWidth: '100%', maxHeight: '90vh',
          display: 'flex', flexDirection: 'column',
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 16, boxShadow: '0 24px 80px rgba(0,0,0,0.5)', overflow: 'hidden',
        }}
      >
        {header ?? (
          (icon || title) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 20px 14px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
              {icon && <Icon name={icon} size={18} color="var(--accent)" />}
              {title && <span style={{ fontFamily: 'var(--display-font)', fontSize: 16, fontWeight: 600, color: 'var(--fg)' }}>{title}</span>}
              <span style={{ marginLeft: 'auto' }}>
                <button
                  onClick={onClose}
                  style={{ width: 30, height: 30, borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--fg-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <Icon name="x" size={15} />
                </button>
              </span>
            </div>
          )
        )}
        <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {children}
        </div>
        {footer && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 20px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
