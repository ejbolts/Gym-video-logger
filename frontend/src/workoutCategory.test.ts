import { describe, expect, it } from 'vitest';
import type { WorkoutCategory } from './types';
import {
  finalizeWorkoutIdentity,
  inferWorkoutCategory,
  workoutNameForCategory,
} from './workoutCategory';

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

  it('provides the matching automatic workout name', () => {
    expect(workoutNameForCategory('pull')).toBe('Pull workout');
    expect(workoutNameForCategory('upper')).toBe('Upper body workout');
    expect(workoutNameForCategory('full_body')).toBe('Full body workout');
  });

  it('applies the inferred type and automatic name only at completion', () => {
    expect(
      finalizeWorkoutIdentity(exercises('pull', 'pull'), 'push', 'Push workout', true),
    ).toEqual({ category: 'pull', name: 'Pull workout' });
    expect(
      finalizeWorkoutIdentity(exercises('pull', 'pull'), 'push', 'Push workout', false),
    ).toEqual({ category: 'push', name: 'Push workout' });
  });

  it('keeps a custom workout name when applying the completed type', () => {
    expect(
      finalizeWorkoutIdentity(exercises('pull', 'pull'), 'push', 'Tuesday training', true),
    ).toEqual({ category: 'pull', name: 'Tuesday training' });
  });
});
