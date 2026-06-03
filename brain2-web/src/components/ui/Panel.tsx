/* Panel — generic card wrapper with optional header. */
import type { CSSProperties, ReactNode } from 'react';

interface PanelProps {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  style?: CSSProperties;
  pad?: number;
}

export function Panel({ title, action, children, style, pad = 18 }: PanelProps) {
  return (
    <section
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-card)',
        display: 'flex',
        flexDirection: 'column',
        ...style,
      }}
    >
      {title && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: `14px ${pad}px 0`,
          }}
        >
          <h3
            style={{
              margin: 0,
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--fg)',
              fontFamily: 'var(--ui-font)',
            }}
          >
            {title}
          </h3>
          {action}
        </div>
      )}
      <div
        style={{
          padding: pad,
          paddingTop: title ? 12 : pad,
          flex: 1,
        }}
      >
        {children}
      </div>
    </section>
  );
}

/* MoreLink — subtle "view all / manage" link used inside panels */
interface MoreLinkProps {
  children: ReactNode;
  onClick?: () => void;
  href?: string;
}

export function MoreLink({ children, onClick, href }: MoreLinkProps) {
  const style: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    color: 'var(--fg-muted)',
    fontFamily: 'var(--ui-font)',
    fontSize: 12,
    fontWeight: 500,
    textDecoration: 'none',
  };

  if (href) {
    return (
      <a href={href} style={style}>
        {children}
        <span style={{ fontSize: 12 }}>›</span>
      </a>
    );
  }

  return (
    <button onClick={onClick} style={style}>
      {children}
      <span style={{ fontSize: 12 }}>›</span>
    </button>
  );
}

/* SectionLabel — uppercase section heading used on the dashboard */
interface SectionLabelProps {
  children: ReactNode;
  action?: ReactNode;
}

export function SectionLabel({ children, action }: SectionLabelProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 14,
      }}
    >
      <h2
        style={{
          margin: 0,
          fontSize: 12,
          fontWeight: 600,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: 'var(--fg-muted)',
        }}
      >
        {children}
      </h2>
      {action}
    </div>
  );
}
