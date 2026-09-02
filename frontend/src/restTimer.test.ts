import { describe, expect, it, vi } from 'vitest';
import { cancelRestTimerPushSchedule } from './restTimer';

describe('rest timer push cancellation', () => {
  it('cancels immediately and again after an in-flight schedule completes', async () => {
    let finishSchedule!: () => void;
    const pendingSchedule = new Promise<void>((resolve) => {
      finishSchedule = resolve;
    });
    const cancel = vi.fn(async () => undefined);

    const cancellation = cancelRestTimerPushSchedule(cancel, [pendingSchedule]);
    expect(cancel).toHaveBeenCalledTimes(1);

    finishSchedule();
    await cancellation;
    expect(cancel).toHaveBeenCalledTimes(2);
  });

  it('retries even when the first cancellation request fails', async () => {
    const cancel = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(undefined);

    await cancelRestTimerPushSchedule(cancel, []);

    expect(cancel).toHaveBeenCalledTimes(2);
  });
});
