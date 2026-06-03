/* Field — labeled text input. Visible label per accessibility guidelines. */
import type { InputHTMLAttributes } from 'react';

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  mono?: boolean;
  wide?: boolean;
}

export function Field({ label, mono, wide, style, ...rest }: FieldProps) {
  return (
    <label style={{ display: 'block', width: wide ? '100%' : 'auto' }}>
      {label && (
        <span
          style={{
            display: 'block',
            fontSize: 12,
            color: 'var(--fg-muted)',
            marginBottom: 6,
          }}
        >
          {label}
        </span>
      )}
      <input
        style={{
          width: '100%',
          height: 36,
          padding: '0 12px',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border)',
          background: 'var(--bg)',
          color: 'var(--fg)',
          fontFamily: mono ? 'var(--mono-font)' : 'var(--ui-font)',
          fontSize: 13,
          outline: 'none',
          transition: 'border-color var(--duration-fast)',
          ...style,
        }}
        {...rest}
      />
    </label>
  );
}
