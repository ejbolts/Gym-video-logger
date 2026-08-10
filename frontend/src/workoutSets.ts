import type { ExerciseKind, TrackedSet, TrackedWorkout, WorkoutSetInput } from './types';

export function createWorkoutSet(
  kind: ExerciseKind,
  previous?: WorkoutSetInput,
  isFirstSet = previous === undefined,
): WorkoutSetInput {
  const setType = isFirstSet ? 'warmup' : (previous?.set_type ?? 'normal');

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
    set_type: setType,
    failed: false,
    target_reps: previous?.target_reps ?? null,
    warmup: setType === 'warmup',
    completed: false,
  };
}

export function latestExerciseSet(
  workouts: TrackedWorkout[],
  exerciseId: string,
  onOrBeforeDate: string,
  excludedWorkoutId?: string,
): TrackedSet | undefined {
  const newestFirst = [...workouts].sort(
    (left, right) =>
      right.workout_date.localeCompare(left.workout_date) ||
      right.created_at.localeCompare(left.created_at),
  );

  for (const workout of newestFirst) {
    if (workout.id === excludedWorkoutId || workout.workout_date > onOrBeforeDate) continue;
    const movement = workout.movements.find((item) => item.exercise.id === exerciseId);
    const completedSet = movement?.sets
      .filter((item) => item.completed)
      .sort((left, right) => left.order_index - right.order_index)[0];
    if (completedSet) return completedSet;
  }

  return undefined;
}

export function isCompletedWorkingSet(item: WorkoutSetInput): boolean {
  return (
    item.completed &&
    item.set_type !== 'warmup' &&
    !item.warmup &&
    (!item.failed || (item.reps ?? 0) > 0)
  );
}
