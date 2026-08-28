import { describe, expect, it } from 'vitest';
import { workoutPageForId } from './workoutHistory';

describe('workout history navigation', () => {
  const workouts = Array.from({ length: 17 }, (_, index) => ({ id: `workout-${index}` }));

  it('finds the matching page in displayed workout order, including page boundaries', () => {
    expect(workoutPageForId(workouts, 'workout-0', 8)).toBe(1);
    expect(workoutPageForId(workouts, 'workout-7', 8)).toBe(1);
    expect(workoutPageForId(workouts, 'workout-8', 8)).toBe(2);
    expect(workoutPageForId(workouts, 'workout-16', 8)).toBe(3);
  });

  it('targets the exact workout ID even when workouts share a date', () => {
    const sameDayWorkouts = [
      { id: 'evening', workout_date: '2026-08-27' },
      { id: 'morning', workout_date: '2026-08-27' },
    ];
    expect(workoutPageForId(sameDayWorkouts, 'morning', 1)).toBe(2);
    expect(workoutPageForId(sameDayWorkouts, 'evening', 1)).toBe(1);
  });

  it('does not navigate to an unrelated workout when the target is missing', () => {
    expect(workoutPageForId(workouts, 'deleted', 8)).toBeNull();
    expect(workoutPageForId(workouts, null, 8)).toBeNull();
    expect(workoutPageForId([], 'workout-0', 8)).toBeNull();
  });
});
