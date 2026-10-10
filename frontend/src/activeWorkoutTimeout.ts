export const MAX_INACTIVE_WORKOUT_MS = 3 * 60 * 60 * 1000;
export const RECENT_WORKOUT_ACTIVITY_MS = 30 * 60 * 1000;

export function inactiveWorkoutFinishAt(startedAt: number, lastActiveAt: number): number {
  return Math.max(startedAt + MAX_INACTIVE_WORKOUT_MS, lastActiveAt + RECENT_WORKOUT_ACTIVITY_MS);
}

export function shouldAutoFinishWorkout(
  startedAt: number,
  lastActiveAt: number,
  now = Date.now(),
): boolean {
  return now >= inactiveWorkoutFinishAt(startedAt, lastActiveAt);
}

export function extendInactiveWorkoutFinishAt(
  currentFinishAt: number,
  activityAt: number,
): number {
  if (activityAt >= currentFinishAt) return currentFinishAt;
  return Math.max(currentFinishAt, activityAt + RECENT_WORKOUT_ACTIVITY_MS);
}
