import { describe, expect, it } from 'vitest';
import { setKindOf, setNumberLabels, steppedValue } from './setFieldValues';

describe('set field values', () => {
  it('steps weights and reps without float noise and never below the minimum', () => {
    expect(steppedValue('62.5', 2.5)).toBe('65');
    expect(steppedValue('0.1', 0.2)).toBe('0.3');
    expect(steppedValue('1', -2.5)).toBe('0');
    expect(steppedValue('', 1)).toBe('1');
    expect(steppedValue('1', -1, 1)).toBe('1');
    expect(steppedValue('7,5', 2.5)).toBe('10');
  });

  it('numbers working sets and marks warm-up and drop sets', () => {
    const sets = [
      { set_type: 'warmup' as const, warmup: true },
      { set_type: 'normal' as const, warmup: false },
      { set_type: 'normal' as const, warmup: false },
      { set_type: 'drop' as const, warmup: false },
      { set_type: undefined, warmup: true },
    ];
    expect(setNumberLabels(sets)).toEqual(['W', '1', '2', 'D', 'W']);
    expect(setKindOf({ set_type: undefined, warmup: false })).toBe('normal');
  });
});
