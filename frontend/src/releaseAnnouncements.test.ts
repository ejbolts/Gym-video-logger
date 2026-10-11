import { afterEach, describe, expect, it, vi } from 'vitest';
import metadata from '../release.json';
import {
  canShowReleaseAnnouncement,
  fetchRelease,
  hasSeenRelease,
  rememberRelease,
  watchReleases,
} from './releaseAnnouncements';
import { parseRelease } from './releaseMetadata';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('release announcements', () => {
  it('accepts the shipped notes and rejects incomplete metadata and unsafe URLs', () => {
    expect(parseRelease(metadata)).toEqual(metadata);
    for (const invalid of [
      null,
      {},
      { ...metadata, version: '' },
      { ...metadata, changes: [] },
      { ...metadata, changes: [null] },
      { ...metadata, summary: ' ' },
      { ...metadata, url: 'javascript:alert(1)' },
      { ...metadata, url: 'https://github.com.example.com/' },
      { ...metadata, url: 'http://github.com/' },
      { ...metadata, url: 'https://user@github.com/' },
    ]) {
      expect(parseRelease(invalid)).toBeNull();
    }
  });

  it('remembers dismissal per account and version, including on another browser session', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    vi.stubGlobal('window', { localStorage: storage });
    expect(hasSeenRelease('alice', '0.2.0')).toBe(false);
    rememberRelease('alice', '0.2.0');
    expect(hasSeenRelease('alice', '0.2.0')).toBe(true);
    expect(hasSeenRelease('bob', '0.2.0')).toBe(false);
    expect(hasSeenRelease('alice', '0.3.0')).toBe(false);
    // This version was dismissed in a previous page load, outside the in-memory set.
    storage.setItem('gym-logger-release-seen:alice:0.1.0', '1');
    expect(hasSeenRelease('alice', '0.1.0')).toBe(true);
  });

  it('still dismisses for the current session when browser storage is denied', () => {
    vi.stubGlobal('window', {
      get localStorage() {
        throw new Error('storage denied');
      },
    });
    expect(hasSeenRelease('private-user', '0.2.0')).toBe(false);
    expect(() => rememberRelease('private-user', '0.2.0')).not.toThrow();
    expect(hasSeenRelease('private-user', '0.2.0')).toBe(true);
  });

  it('reads deployed metadata without using the browser cache and ignores bad responses', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => metadata });
    vi.stubGlobal('fetch', fetch);
    expect(await fetchRelease()).toEqual(metadata);
    expect(fetch).toHaveBeenCalledWith('/release.json', {
      cache: 'no-store',
      signal: expect.any(AbortSignal),
    });
    fetch.mockResolvedValue({ ok: false });
    expect(await fetchRelease()).toBeNull();
    fetch.mockResolvedValue({ ok: true, json: async () => ({ version: 'bad' }) });
    expect(await fetchRelease()).toBeNull();
  });

  it('aborts a stalled release request so a later reconnect can retry', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn((_url, options: RequestInit) => {
      return new Promise((_resolve, reject) => {
        options.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    });
    vi.stubGlobal('fetch', fetch);
    const result = expect(fetchRelease()).rejects.toThrow('aborted');
    await vi.advanceTimersByTimeAsync(10_000);
    await result;
  });

  it('waits while loading, logging a workout, uploading videos or showing another dialog', () => {
    const ready = { loading: false, tab: 'dashboard', hasOtherDialog: false };
    expect(canShowReleaseAnnouncement(ready)).toBe(true);
    expect(canShowReleaseAnnouncement({ ...ready, tab: 'settings' })).toBe(true);
    expect(canShowReleaseAnnouncement({ ...ready, loading: true })).toBe(false);
    expect(canShowReleaseAnnouncement({ ...ready, tab: 'log' })).toBe(false);
    expect(canShowReleaseAnnouncement({ ...ready, tab: 'videos' })).toBe(false);
    expect(canShowReleaseAnnouncement({ ...ready, hasOtherDialog: true })).toBe(false);
  });
});

function browser() {
  const window = new EventTarget();
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const navigator = { onLine: true };
  vi.stubGlobal('window', window);
  vi.stubGlobal('document', document);
  vi.stubGlobal('navigator', navigator);
  return { window, document, navigator };
}

describe('release reconnection checks', () => {
  it('checks at startup and on focus, resume and reconnect; skips offline and hidden checks', async () => {
    const { window, document, navigator } = browser();
    const load = vi.fn().mockResolvedValue(metadata);
    const received = vi.fn();
    const stop = watchReleases(received, load);
    await Promise.resolve();
    expect(received).toHaveBeenLastCalledWith(metadata);
    window.dispatchEvent(new Event('focus'));
    await Promise.resolve();
    document.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();
    navigator.onLine = false;
    window.dispatchEvent(new Event('focus'));
    await Promise.resolve();
    navigator.onLine = true;
    document.visibilityState = 'hidden';
    window.dispatchEvent(new Event('online'));
    await Promise.resolve();
    expect(load).toHaveBeenCalledTimes(3);
    document.visibilityState = 'visible';
    load.mockResolvedValue({ ...metadata, version: '0.3.0' });
    window.dispatchEvent(new Event('online'));
    await Promise.resolve();
    expect(received).toHaveBeenLastCalledWith({ ...metadata, version: '0.3.0' });
    stop();
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('online'));
    expect(load).toHaveBeenCalledTimes(4);
  });

  it('retries after an unavailable server and ignores a response after unmount or sign-out', async () => {
    const { window } = browser();
    const load = vi.fn().mockRejectedValue(new Error('offline'));
    const received = vi.fn();
    const stop = watchReleases(received, load);
    await Promise.resolve();
    expect(received).not.toHaveBeenCalled();
    let resolve: (value: typeof metadata) => void = () => undefined;
    load.mockImplementation(() => new Promise((done) => (resolve = done)));
    window.dispatchEvent(new Event('online'));
    window.dispatchEvent(new Event('focus'));
    expect(load).toHaveBeenCalledTimes(2);
    stop();
    resolve(metadata);
    await Promise.resolve();
    expect(received).not.toHaveBeenCalled();
  });
});
