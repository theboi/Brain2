/*
 * Popover — click-to-open overlay anchored to a trigger element.
 *
 * Portalled to document.body so it is never clipped by an ancestor's overflow
 * (e.g. a Modal's scroll container). Because it lives at the body, it can't rely
 * on a positioned parent — instead it measures the anchor's bounding rect and
 * pins itself with position:fixed, re-measuring on scroll/resize so it stays put.
 */
import {
  useEffect, useLayoutEffect, useState,
  type CSSProperties, type ReactNode, type RefObject,
} from 'react';
import { createPortal } from 'react-dom';

type Placement = 'bottom-start' | 'bottom-end';

interface PopoverProps {
  onClose: () => void;
  children: ReactNode;
  anchorRef: RefObject<HTMLElement | null>;
  placement?: Placement;
  gap?: number;
  style?: CSSProperties;   // width / padding / appearance only — not positioning
}

interface Pos { top: number; left?: number; right?: number }

export function Popover({
  onClose, children, anchorRef, placement = 'bottom-start', gap = 6, style,
}: PopoverProps) {
  const [pos, setPos] = useState<Pos | null>(null);

  useLayoutEffect(() => {
    const compute = () => {
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const top = r.bottom + gap;
      setPos(placement === 'bottom-end'
        ? { top, right: Math.max(8, window.innerWidth - r.right) }
        : { top, left: r.left });
    };
    compute();
    window.addEventListener('resize', compute);
    window.addEventListener('scroll', compute, true);
    return () => {
      window.removeEventListener('resize', compute);
      window.removeEventListener('scroll', compute, true);
    };
  }, [anchorRef, placement, gap]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <>
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, zIndex: 300 }}
      />
      <div
        className="b2-anim-pop"
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border-strong)',
          borderRadius: 12,
          boxShadow: '0 14px 44px rgba(0,0,0,0.34)',
          ...style,
          position: 'fixed',
          zIndex: 301,
          top: pos?.top,
          left: pos?.left,
          right: pos?.right,
          visibility: pos ? 'visible' : 'hidden',
        }}
      >
        {children}
      </div>
    </>,
    document.body,
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
