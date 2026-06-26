import { describe, expect, it, vi } from 'vitest';
import { Checkbox } from './Checkbox';

describe('Checkbox', () => {
  it('toggles and never renders a circular border', () => {
    const onChange = vi.fn();
    const stopPropagation = vi.fn();
    const element = Checkbox({ checked: false, onChange });

    element.props.onClick({ stopPropagation });

    expect(element.props.role).toBe('checkbox');
    expect(element.props['aria-checked']).toBe(false);
    expect(onChange).toHaveBeenCalled();
    expect(stopPropagation).toHaveBeenCalled();
    expect(element.props.style.borderRadius).not.toBe('50%');
  });
});
