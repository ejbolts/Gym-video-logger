import { describe, expect, it } from 'vitest';
import {
  inactiveWorkoutFinishAt,
  MAX_INACTIVE_WORKOUT_MS,
  RECENT_WORKOUT_ACTIVITY_MS,
  shouldAutoFinishWorkout,
} from './activeWorkoutTimeout';

describe('inactive workout timeout', () => {
  const startedAt = Date.UTC(2026, 8, 19, 9);

  it('finishes an inactive workout at three hours', () => {
    expect(shouldAutoFinishWorkout(startedAt, startedAt, startedAt + MAX_INACTIVE_WORKOUT_MS)).toBe(
      true,
    );
  });

  it('allows a workout to continue past three hours after recent use', () => {
    const lastActiveAt = startedAt + MAX_INACTIVE_WORKOUT_MS - 20 * 60 * 1000;

    expect(
      shouldAutoFinishWorkout(startedAt, lastActiveAt, startedAt + MAX_INACTIVE_WORKOUT_MS),
    ).toBe(false);
    expect(inactiveWorkoutFinishAt(startedAt, lastActiveAt)).toBe(
      lastActiveAt + RECENT_WORKOUT_ACTIVITY_MS,
    );
  });

  it('finishes after the extended workout becomes inactive', () => {
    const lastActiveAt = startedAt + MAX_INACTIVE_WORKOUT_MS + 25 * 60 * 1000;
    const finishAt = lastActiveAt + RECENT_WORKOUT_ACTIVITY_MS;

    expect(shouldAutoFinishWorkout(startedAt, lastActiveAt, finishAt - 1)).toBe(false);
    expect(shouldAutoFinishWorkout(startedAt, lastActiveAt, finishAt)).toBe(true);
  });
});
