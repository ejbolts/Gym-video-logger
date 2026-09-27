import type { PersonalRecord, TrackedWorkout } from './types';
import type { WorkoutDraftMovement as DraftMovement } from './workoutMovements';

export function calculateDraftPrs(
  movements: DraftMovement[],
  records: PersonalRecord[],
  historicalWorkouts: TrackedWorkout[],
  excludedWorkoutId: string | null,
): Map<string, Map<string, string[]>> {
  type State = {
    weight: number;
    e1rm: number;
    duration: number;
    distance: number;
    reps: Map<number, number>;
    unit: 'kg' | 'lb';
  };
  const states = new Map<string, State>();
  for (const record of records.filter((item) => item.workout_id !== excludedWorkoutId)) {
    const state = states.get(record.exercise_id) ?? {
      weight: -1,
      e1rm: -1,
      duration: -1,
      distance: -1,
      reps: new Map(),
      unit: record.unit === 'lb' ? 'lb' : 'kg',
    };
    if (record.record_type === 'weight') state.weight = Math.max(state.weight, record.value);
    if (record.record_type === 'estimated_1rm') state.e1rm = Math.max(state.e1rm, record.value);
    if (record.record_type === 'duration') state.duration = Math.max(state.duration, record.value);
    if (record.record_type === 'distance') state.distance = Math.max(state.distance, record.value);
    if (record.record_type === 'reps_at_weight' && record.normalized_weight !== null)
      state.reps.set(
        record.normalized_weight,
        Math.max(state.reps.get(record.normalized_weight) ?? -1, record.value),
      );
    states.set(record.exercise_id, state);
  }
  for (const workout of historicalWorkouts.filter((item) => item.id !== excludedWorkoutId)) {
    for (const movement of workout.movements) {
      const state = states.get(movement.exercise.id) ?? {
        weight: -1,
        e1rm: -1,
        duration: -1,
        distance: -1,
        reps: new Map(),
        unit: 'kg' as const,
      };
      for (const item of movement.sets) {
        if (!item.completed || item.set_type === 'warmup' || item.warmup) continue;
        if (item.failed && (item.target_reps === null || (item.reps ?? 0) < item.target_reps))
          continue;
        if (item.weight_kg !== null && item.reps !== null) {
          const weight =
            Math.round(item.weight_kg * (state.unit === 'lb' ? 2.2046226218 : 1) * 10) / 10;
          state.reps.set(weight, Math.max(state.reps.get(weight) ?? 0, item.reps));
        }
      }
      states.set(movement.exercise.id, state);
    }
  }
  const result = new Map<string, Map<string, string[]>>();
  for (const movement of movements) {
    const state = states.get(movement.exercise.id) ?? {
      weight: -1,
      e1rm: -1,
      duration: -1,
      distance: -1,
      reps: new Map(),
      unit: 'kg' as const,
    };
    const badges = new Map<string, string[]>();
    for (const item of movement.sets) {
      const labels: string[] = [];
      const eligible =
        item.completed &&
        item.set_type !== 'warmup' &&
        !item.warmup &&
        (!item.failed || (item.target_reps != null && (item.reps ?? 0) >= item.target_reps));
      if (!eligible) continue;
      const weight =
        item.weight_kg === null
          ? null
          : Math.round(item.weight_kg * (state.unit === 'lb' ? 2.2046226218 : 1) * 10) / 10;
      if (weight !== null && weight > state.weight) {
        state.weight = weight;
        labels.push('Weight PR');
      }
      if (weight !== null && item.reps !== null) {
        const previousReps = state.reps.get(weight);
        if (previousReps !== undefined && item.reps > previousReps) {
          labels.push(`Rep PR @ ${weight} ${state.unit}`);
        }
        state.reps.set(weight, Math.max(previousReps ?? 0, item.reps));
        if (item.reps >= 1 && item.reps <= 30) {
          const e1rm =
            Math.round(
              (item.weight_kg ?? 0) *
                (1 + item.reps / 30) *
                (state.unit === 'lb' ? 2.2046226218 : 1) *
                10,
            ) / 10;
          if (e1rm > state.e1rm) {
            state.e1rm = e1rm;
            labels.push('Estimated 1RM PR');
          }
        }
      }
      if ((item.duration_seconds ?? -1) > state.duration) {
        state.duration = item.duration_seconds ?? -1;
        labels.push('Duration PR');
      }
      if ((item.distance_km ?? -1) > state.distance) {
        state.distance = item.distance_km ?? -1;
        labels.push('Distance PR');
      }
      if (labels.length) badges.set(item.key, labels);
    }
    states.set(movement.exercise.id, state);
    result.set(movement.key, badges);
  }
  return result;
}
