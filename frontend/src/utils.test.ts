import { describe, expect, it } from 'vitest';
import { formatBytes, formatSeconds } from './utils';

describe('display formatting', () => {
  it('formats a video size and a timestamp', () => {
    expect(formatBytes(1.5 * 1024 * 1024)).toBe('1.5 MB');
    expect(formatSeconds(3661)).toBe('1:01:01');
  });
});
