import { describe, expect, it } from 'vitest';
import type { Exercise, TrackedSet, TrackedWorkout } from './types';
import { recentExerciseHistory } from './exerciseHistory';

const exercise: Exercise = {
  id: 'bench-press',
  name: 'Bench Press',
  category: 'push',
  kind: 'strength',
  muscle_group: 'Chest',
  equipment: 'Barbell',
  is_custom: false,
  is_favorite: false,
  muscle_contributions: [],
};

function trackedSet(id: string, orderIndex: number, completed = true): TrackedSet {
  return {
    id,
    order_index: orderIndex,
    reps: 8,
    weight_kg: 80,
    rpe: 8,
    rest_seconds: 120,
    duration_seconds: null,
    distance_km: null,
    incline_percent: null,
    speed_kph: null,
    bodyweight_kg: null,
    percentile: null,
    warmup: false,
    set_type: 'normal',
    failed: false,
    target_reps: null,
    notes: orderIndex === 0 ? 'Pause on chest' : null,
    completed,
  };
}

function workout(
  id: string,
  workoutDate: string,
  createdAt: string,
  sets: TrackedSet[],
  movementNotes: string | null = null,
): TrackedWorkout {
  return {
    id,
    name: `${id} workout`,
    workout_date: workoutDate,
    category: 'push',
    notes: null,
    duration_minutes: 45,
    is_sample: false,
    created_at: createdAt,
    updated_at: createdAt,
    movements: [
      {
        id: `${id}-movement`,
        order_index: 0,
        notes: movementNotes,
        exercise,
        sets,
        machine_photos: [],
        superset_group_id: null,
        superset_name: null,
      },
    ],
  };
}

describe('recent exercise history', () => {
  it('returns completed sets and notes newest first', () => {
    const older = workout('older', '2026-07-01', '2026-07-01T09:00:00Z', [
      trackedSet('older-set', 0),
    ]);
    const latest = workout(
      'latest',
      '2026-07-08',
      '2026-07-08T09:00:00Z',
      [trackedSet('incomplete', 0, false), trackedSet('second-set', 1)],
      'Use rack height 4',
    );

    const history = recentExerciseHistory([older, latest], exercise.id);

    expect(history.map((entry) => entry.workoutId)).toEqual(['latest', 'older']);
    expect(history[0].sets.map((item) => item.id)).toEqual(['second-set']);
    expect(history[0].movementNotes).toBe('Use rack height 4');
  });

  it('excludes the workout being edited and respects the requested limit', () => {
    const workouts = [
      workout('current', '2026-07-10', '2026-07-10T09:00:00Z', [trackedSet('current-set', 0)]),
      workout('previous', '2026-07-08', '2026-07-08T09:00:00Z', [
        trackedSet('previous-set', 0),
      ]),
      workout('oldest', '2026-07-01', '2026-07-01T09:00:00Z', [
        trackedSet('oldest-set', 0),
      ]),
    ];

    expect(recentExerciseHistory(workouts, exercise.id, 'current', 1)[0].workoutId).toBe(
      'previous',
    );
  });
});
