import { describe, expect, it } from 'vitest';
import { calculateDraftPrs } from './workoutPr';
import { createWorkoutSet } from './workoutSets';
import type { WorkoutDraftMovement } from './workoutMovements';
import type { Exercise, PersonalRecord } from './types';

const bench: Exercise = {
  id: 'bench',
  name: 'Barbell Bench Press',
  category: 'push',
  kind: 'strength',
  muscle_group: 'Pectorals',
  equipment: 'Barbell',
  is_custom: false,
  is_favorite: false,
  muscle_contributions: [],
};

function previousRecord(record_type: PersonalRecord['record_type'], value: number): PersonalRecord {
  return {
    id: record_type,
    exercise_id: bench.id,
    workout_id: 'earlier',
    set_id: 'earlier-set',
    achieved_date: '2026-01-01',
    record_type,
    value,
    unit: 'kg',
    normalized_weight: 100,
    formula: record_type === 'estimated_1rm' ? 'Epley' : null,
    exercise_name: bench.name,
  };
}

function draft(weight_kg: number, reps: number): WorkoutDraftMovement[] {
  return [
    {
      key: 'movement',
      exercise: bench,
      notes: '',
      machinePhotoIds: [],
      machinePhotosInitialized: true,
      supersetKey: null,
      isComplete: false,
      sets: [
        {
          ...createWorkoutSet('strength', undefined, false),
          key: 'set',
          weight_kg,
          reps,
          completed: true,
        },
      ],
    },
  ];
}

describe('live estimated 1RM PR badge', () => {
  const previous = [previousRecord('weight', 100), previousRecord('estimated_1rm', 126.7)];

  it('awards a PR when lighter weight and more reps beat the prior Epley estimate', () => {
    const badges = calculateDraftPrs(draft(90, 13), previous, [], null).get('movement');
    expect(badges?.get('set')).toEqual(['Estimated 1RM PR']);
  });

  it('does not award a 1RM PR for a lower estimate', () => {
    const badges = calculateDraftPrs(draft(90, 12), previous, [], null).get('movement');
    expect(badges?.has('set')).toBe(false);
  });

  it('matches the saved estimate when display weight rounds in pounds', () => {
    const pounds = [previousRecord('weight', 100), previousRecord('estimated_1rm', 126.6)].map(
      (record) => ({ ...record, unit: 'lb' }),
    );
    const badges = calculateDraftPrs(draft(45.34, 8), pounds, [], null).get('movement');
    expect(badges?.has('set')).toBe(false);
  });
});
