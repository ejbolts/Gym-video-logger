import { describe, expect, it } from 'vitest';
import type { WorkoutCategory } from './types';
import { inferWorkoutCategory } from './workoutCategory';

const exercises = (...categories: WorkoutCategory[]) =>
  categories.map((category) => ({ category }));

describe('automatic workout category', () => {
  it('uses a focused type when one exercise family clearly dominates', () => {
    expect(inferWorkoutCategory(exercises('pull', 'pull', 'push'))).toBe('pull');
    expect(inferWorkoutCategory(exercises('push', 'push', 'pull'))).toBe('push');
    expect(inferWorkoutCategory(exercises('lower', 'lower', 'pull'))).toBe('lower');
    expect(inferWorkoutCategory(exercises('cardio', 'cardio', 'lower'))).toBe('cardio');
  });

  it('uses upper body for a balanced push and pull session', () => {
    expect(inferWorkoutCategory(exercises('push', 'pull'))).toBe('upper');
    expect(inferWorkoutCategory(exercises('push', 'push', 'pull', 'pull'))).toBe('upper');
  });

  it('uses full body for a balanced upper and lower session', () => {
    expect(inferWorkoutCategory(exercises('push', 'lower'))).toBe('full_body');
    expect(inferWorkoutCategory(exercises('pull', 'lower', 'cardio'))).toBe('full_body');
    expect(inferWorkoutCategory(exercises('full_body', 'pull', 'pull'))).toBe('full_body');
  });

  it('handles empty and uncategorized exercise lists', () => {
    expect(inferWorkoutCategory([])).toBeNull();
    expect(inferWorkoutCategory(exercises('other', 'other'))).toBe('other');
  });
});
