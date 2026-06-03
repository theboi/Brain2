/* Toggle — boolean switch control. */
interface ToggleProps {
  on: boolean;
  onClick: () => void;
  disabled?: boolean;
  'aria-label'?: string;
}

export function Toggle({ on, onClick, disabled, 'aria-label': label }: ToggleProps) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      style={{
        width: 40,
        height: 23,
        borderRadius: 12,
        border: 'none',
        cursor: disabled ? 'default' : 'pointer',
        padding: 2,
        background: on ? 'var(--accent)' : 'var(--surface-3)',
        transition: 'background var(--duration-base)',
        display: 'flex',
        justifyContent: on ? 'flex-end' : 'flex-start',
        opacity: disabled ? 0.5 : 1,
        flexShrink: 0,
      }}
    >
      <span
        style={{
          width: 19,
          height: 19,
          borderRadius: '50%',
          background: '#fff',
          boxShadow: '0 1px 2px rgba(0,0,0,0.3)',
          transition: 'transform var(--duration-base)',
        }}
      />
    </button>
  );
}
