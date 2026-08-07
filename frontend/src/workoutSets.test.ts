import { describe, expect, it } from 'vitest';
import type { WorkoutSetInput } from './types';
import { createWorkoutSet, isCompletedWorkingSet } from './workoutSets';

const previousSet: WorkoutSetInput = {
  reps: 8,
  weight_kg: 80,
  rpe: 8,
  rest_seconds: 180,
  duration_seconds: null,
  distance_km: null,
  incline_percent: null,
  speed_kph: null,
  notes: null,
  completed: true,
};

describe('new workout sets', () => {
  it('carry the previous set rest time into the next set', () => {
    const nextSet = createWorkoutSet('strength', previousSet);

    expect(nextSet.rest_seconds).toBe(180);
    expect(nextSet.completed).toBe(false);
  });

  it('use the standard rest time for the first set', () => {
    expect(createWorkoutSet('strength').rest_seconds).toBe(120);
  });

  it('carry treadmill settings into the next cardio set', () => {
    const nextSet = createWorkoutSet('cardio', {
      ...previousSet,
      duration_seconds: 1_200,
      distance_km: 1.8,
      incline_percent: 12.5,
      speed_kph: 5.4,
    });

    expect(nextSet.incline_percent).toBe(12.5);
    expect(nextSet.speed_kph).toBe(5.4);
  });
});

describe('completed working sets', () => {
  it('does not count completed warm-ups', () => {
    expect(
      isCompletedWorkingSet({ ...previousSet, set_type: 'warmup', warmup: true }),
    ).toBe(false);
  });

  it('counts completed normal and drop sets', () => {
    expect(isCompletedWorkingSet({ ...previousSet, set_type: 'normal' })).toBe(true);
    expect(isCompletedWorkingSet({ ...previousSet, set_type: 'drop' })).toBe(true);
  });

  it('only counts a failed set when at least one rep was completed', () => {
    expect(isCompletedWorkingSet({ ...previousSet, failed: true, reps: 0 })).toBe(false);
    expect(isCompletedWorkingSet({ ...previousSet, failed: true, reps: 1 })).toBe(true);
  });
});
