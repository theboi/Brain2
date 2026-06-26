import { Icon } from '@/components/ui/Icon';

interface CheckboxProps {
  checked: boolean;
  onChange: () => void;
  size?: number;
}

export function Checkbox({ checked, onChange, size = 17 }: CheckboxProps) {
  return (
    <button
      role="checkbox"
      aria-checked={checked}
      onClick={(e) => {
        e.stopPropagation();
        onChange();
      }}
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: 5,
        border: `1.5px solid ${checked ? 'var(--accent)' : 'var(--border-strong)'}`,
        background: checked ? 'var(--accent)' : 'transparent',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        padding: 0,
      }}
    >
      {checked && <Icon name="check" size={Math.round(size * 0.65)} color="#fff" />}
    </button>
  );
}
