import { describe, expect, it } from 'vitest';
import { createWorkoutSet } from './workoutSets';
import { isWorkoutSetAutoSavable, workoutSetForAutoSave } from './workoutAutoSave';

describe('automatic workout saving', () => {
  it('does not save an untouched empty set', () => {
    expect(isWorkoutSetAutoSavable('strength', createWorkoutSet('strength'))).toBe(false);
    expect(isWorkoutSetAutoSavable('cardio', createWorkoutSet('cardio'))).toBe(false);
  });

  it('completes entered cardio data before automatically saving', () => {
    const set = { ...createWorkoutSet('cardio'), duration_seconds: 3720, distance_km: 4.77 };

    expect(isWorkoutSetAutoSavable('cardio', set)).toBe(true);
    expect(workoutSetForAutoSave('cardio', set).completed).toBe(true);
  });

  it('completes entered strength data before automatically saving', () => {
    const set = { ...createWorkoutSet('strength'), reps: 8, weight_kg: 80 };

    expect(isWorkoutSetAutoSavable('strength', set)).toBe(true);
    expect(workoutSetForAutoSave('strength', set).completed).toBe(true);
  });

  it('preserves a populated previous-set suggestion when the workout times out', () => {
    const set = {
      ...createWorkoutSet('strength'),
      reps: 8,
      weight_kg: 80,
      fromPrevious: true,
    };

    expect(isWorkoutSetAutoSavable('strength', set)).toBe(true);
    expect(workoutSetForAutoSave('strength', set).completed).toBe(true);
  });
});
