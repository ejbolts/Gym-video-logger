import { describe, expect, it } from 'vitest';
import { formatBytes, formatSeconds, mergeUniqueById, reorder } from './utils';

describe('display formatting', () => {
  it('formats a video size and a timestamp', () => {
    expect(formatBytes(1.5 * 1024 * 1024)).toBe('1.5 MB');
    expect(formatSeconds(3661)).toBe('1:01:01');
  });
});

describe('workout list helpers', () => {
  it('adds multiple selections predictably without duplicates', () => {
    const existing = [{ id: 'bench', name: 'Bench' }];
    const selected = [
      { id: 'squat', name: 'Squat' },
      { id: 'bench', name: 'Bench' },
      { id: 'row', name: 'Row' },
    ];
    expect(mergeUniqueById(existing, selected).map((item) => item.id)).toEqual([
      'bench',
      'squat',
      'row',
    ]);
  });

  it('reorders items without mutating the original list', () => {
    const original = ['a', 'b', 'c'];
    expect(reorder(original, 2, 0)).toEqual(['c', 'a', 'b']);
    expect(original).toEqual(['a', 'b', 'c']);
  });
});
