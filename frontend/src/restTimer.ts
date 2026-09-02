export async function cancelRestTimerPushSchedule(
  cancel: () => Promise<void>,
  pendingSchedules: Iterable<Promise<void>>,
): Promise<void> {
  const firstCancellation = cancel().catch(() => undefined);
  await Promise.allSettled([firstCancellation, ...pendingSchedules]);
  await cancel().catch(() => undefined);
}
