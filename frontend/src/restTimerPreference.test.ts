import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { restTimerPreferenceEnabled, saveRestTimerPreference } from './restTimerPreference';

describe('rest timer preference', () => {
  const values = new Map<string, string>();

  beforeEach(() => {
    values.clear();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('defaults to enabled', () => {
    expect(restTimerPreferenceEnabled()).toBe(true);
  });

  it('persists disabled and enabled choices', () => {
    saveRestTimerPreference(false);
    expect(restTimerPreferenceEnabled()).toBe(false);

    saveRestTimerPreference(true);
    expect(restTimerPreferenceEnabled()).toBe(true);
  });
});
