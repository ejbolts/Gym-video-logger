import type { ExerciseKind, WorkoutSetInput } from './types';

export function createWorkoutSet(kind: ExerciseKind, previous?: WorkoutSetInput): WorkoutSetInput {
  return {
    reps: kind === 'strength' ? (previous?.reps ?? null) : null,
    weight_kg: kind === 'strength' ? (previous?.weight_kg ?? null) : null,
    rpe: previous?.rpe ?? null,
    rest_seconds: previous?.rest_seconds ?? 120,
    duration_seconds: kind === 'cardio' ? (previous?.duration_seconds ?? null) : null,
    distance_km: kind === 'cardio' ? (previous?.distance_km ?? null) : null,
    incline_percent: kind === 'cardio' ? (previous?.incline_percent ?? null) : null,
    speed_kph: kind === 'cardio' ? (previous?.speed_kph ?? null) : null,
    notes: null,
    set_type: previous?.set_type ?? 'normal',
    failed: false,
    target_reps: previous?.target_reps ?? null,
    warmup: false,
    completed: false,
  };
}

export function isCompletedWorkingSet(item: WorkoutSetInput): boolean {
  return (
    item.completed &&
    item.set_type !== 'warmup' &&
    !item.warmup &&
    (!item.failed || (item.reps ?? 0) > 0)
  );
}
