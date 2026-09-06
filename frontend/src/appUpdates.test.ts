import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerAppUpdates } from './appUpdates';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function setup({ online = true, readyState = 'complete' } = {}) {
  vi.stubEnv('PROD', true);
  const events = new Map<string, () => void>();
  const update = vi.fn().mockResolvedValue(undefined);
  const register = vi.fn().mockResolvedValue({ update });
  const document = {
    readyState,
    visibilityState: 'visible',
    addEventListener: vi.fn((name, callback) => events.set(name, callback)),
  };
  const window = {
    addEventListener: vi.fn((name, callback) => events.set(name, callback)),
    setInterval: vi.fn(),
    location: { reload: vi.fn() },
  };
  vi.stubGlobal('navigator', { serviceWorker: { register }, onLine: online });
  vi.stubGlobal('document', document);
  vi.stubGlobal('window', window);
  return { events, update, register, document, window };
}

describe('app updates', () => {
  it('bypasses cached worker scripts and checks for updates without reloading a workout', async () => {
    const { register, update, events, window } = setup();
    registerAppUpdates();
    await Promise.resolve();
    expect(register).toHaveBeenCalledWith('/sw.js', { updateViaCache: 'none' });
    expect(update).toHaveBeenCalledTimes(1);
    events.get('visibilitychange')!();
    events.get('online')!();
    expect(update).toHaveBeenCalledTimes(3);
    expect(window.location.reload).not.toHaveBeenCalled();
  });

  it('defers registration until page load and skips hidden/offline update checks', async () => {
    const { events, register, update, document } = setup({ readyState: 'loading' });
    registerAppUpdates();
    expect(register).not.toHaveBeenCalled();
    events.get('load')!();
    await Promise.resolve();
    document.visibilityState = 'hidden';
    events.get('visibilitychange')!();
    expect(update).toHaveBeenCalledTimes(1);
    document.visibilityState = 'visible';
    vi.stubGlobal('navigator', { serviceWorker: { register }, onLine: false });
    events.get('visibilitychange')!();
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('leaves the app usable if registration or an update fails', async () => {
    const { register, update, events, window } = setup();
    update.mockRejectedValue(new Error('offline'));
    registerAppUpdates();
    await Promise.resolve();
    events.get('online')!();
    register.mockRejectedValue(new Error('workers disabled'));
    registerAppUpdates();
    await Promise.resolve();
    expect(window.location.reload).not.toHaveBeenCalled();
  });

  it('does not install a production worker in the development server', () => {
    const { register } = setup();
    vi.stubEnv('PROD', false);
    registerAppUpdates();
    expect(register).not.toHaveBeenCalled();
  });
});
