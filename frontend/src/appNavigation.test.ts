import { describe, expect, it } from 'vitest';
import {
  appTabFromHash,
  createAppHistoryState,
  isAppHistoryState,
  isAppTab,
} from './appNavigation';

describe('app navigation history', () => {
  it('recognises app tabs and falls back to the dashboard for unknown hashes', () => {
    expect(isAppTab('history')).toBe(true);
    expect(isAppTab('unknown')).toBe(false);
    expect(appTabFromHash('#progress')).toBe('dashboard');
    expect(appTabFromHash('#log')).toBe('log');
  });

  it('creates and validates app-owned history entries', () => {
    const state = createAppHistoryState('body', 3);

    expect(state).toEqual({ gymLogger: true, index: 3, tab: 'body' });
    expect(isAppHistoryState(state)).toBe(true);
    expect(isAppHistoryState({ gymLogger: true, index: -1, tab: 'body' })).toBe(false);
    expect(isAppHistoryState({ gymLogger: true, index: 2, tab: 'missing' })).toBe(false);
  });
});
