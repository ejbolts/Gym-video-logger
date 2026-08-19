import { describe, expect, it } from 'vitest';
import {
  formatBytes,
  formatMinutesDuration,
  formatSeconds,
  mergeUniqueById,
  reorder,
} from './utils';

describe('display formatting', () => {
  it('formats a video size and a timestamp', () => {
    expect(formatBytes(1.5 * 1024 * 1024)).toBe('1.5 MB');
    expect(formatSeconds(3599)).toBe('59:59');
    expect(formatSeconds(3600)).toBe('1:00:00');
    expect(formatSeconds(3661)).toBe('1:01:01');
  });

  it('formats completed workout durations in hours and minutes', () => {
    expect(formatMinutesDuration(45)).toBe('45min');
    expect(formatMinutesDuration(75)).toBe('1h 15min');
    expect(formatMinutesDuration(120)).toBe('2h');
    expect(formatMinutesDuration(null)).toBe('–');
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
