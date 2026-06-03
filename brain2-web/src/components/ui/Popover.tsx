/* Popover — click-to-open overlay with Escape-to-close support. */
import { useEffect, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface PopoverProps {
  onClose: () => void;
  children: ReactNode;
  style?: CSSProperties;
}

export function Popover({ onClose, children, style }: PopoverProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, zIndex: 300 }}
      />
      <div
        className="b2-anim-pop"
        style={{
          position: 'absolute',
          zIndex: 301,
          background: 'var(--surface)',
          border: '1px solid var(--border-strong)',
          borderRadius: 12,
          boxShadow: '0 14px 44px rgba(0,0,0,0.34)',
          ...style,
        }}
      >
        {children}
      </div>
    </>
  );
}

/* ModalOverlay — full-screen backdrop + centered content */
interface ModalOverlayProps {
  onClose: () => void;
  children: ReactNode;
}

export function ModalOverlay({ onClose, children }: ModalOverlayProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="b2-anim-fade"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 400,
        background: 'rgba(8,9,12,0.6)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '5vh 20px',
      }}
    >
      <div
        className="b2-anim-slide"
        onClick={(e) => e.stopPropagation()}
        style={{ maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

/* SegmentedControl — inline two/three-option selector */
interface SegmentedControlProps {
  value: string;
  options: string[];
  onChange: (v: string) => void;
}

export function SegmentedControl({ value, options, onChange }: SegmentedControlProps) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 2,
        padding: 2,
        background: 'var(--surface-2)',
        borderRadius: 8,
      }}
    >
      {options.map((o) => (
        <button
          key={o}
          onClick={() => onChange(o)}
          style={{
            height: 26,
            padding: '0 11px',
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer',
            fontFamily: 'var(--ui-font)',
            fontSize: 12.5,
            fontWeight: value === o ? 600 : 500,
            background: value === o ? 'var(--surface)' : 'transparent',
            color: value === o ? 'var(--fg)' : 'var(--fg-muted)',
            transition: 'background var(--duration-fast)',
          }}
        >
          {o}
        </button>
      ))}
    </div>
  );
}
