import { describe, expect, it } from 'vitest';
import { formatBytes, formatLastActive, plural, videoQueueSummary } from './adminDisplay';

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [512, '512 B'],
    [1536, '1.5 KB'],
    [20 * 1024 * 1024, '20 MB'],
    [100 * 1024 ** 3, '100 GB'],
  ])('formats %d as %s', (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });
});

describe('formatLastActive', () => {
  const now = new Date('2026-10-10T12:00:00Z');

  it.each([
    [null, 'Never'],
    ['2026-10-10T11:55:00Z', 'Just now'],
    ['2026-10-10T11:30:00Z', '30 min ago'],
    ['2026-10-10T07:00:00Z', '5 h ago'],
    ['2026-10-09T10:00:00Z', 'Yesterday'],
    ['2026-10-01T12:00:00Z', '9 days ago'],
    ['2026-08-01T12:00:00Z', '1 Aug 2026'],
    ['not a date', 'Unknown'],
  ])('describes %s as %s', (value, expected) => {
    expect(formatLastActive(value, now)).toBe(expected);
  });
});

describe('videoQueueSummary', () => {
  it('lists only the busy stages', () => {
    expect(
      videoQueueSummary({ queued: 2, normalizing: 1, stitching: 0, youtube_processing: 0 }),
    ).toBe('2 waiting · 1 encoding');
  });

  it('reports an empty queue as idle', () => {
    expect(videoQueueSummary({ queued: 0, normalizing: 0 })).toBe('Idle');
  });
});

describe('plural', () => {
  it('uses the singular only for one', () => {
    expect(plural(1, 'device')).toBe('1 device');
    expect(plural(0, 'device')).toBe('0 devices');
    expect(plural(3, 'device')).toBe('3 devices');
  });
});
