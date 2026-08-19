import type { ExerciseKind, TrackedSet, TrackedWorkout, WorkoutSetInput } from './types';

export const DEFAULT_REST_SECONDS = 180;

export function createWorkoutSet(
  kind: ExerciseKind,
  previous?: WorkoutSetInput,
  isFirstSet = previous === undefined,
): WorkoutSetInput {
  const setType = isFirstSet
    ? 'warmup'
    : (previous?.set_type ?? (previous?.warmup ? 'warmup' : 'normal'));

  return {
    reps: kind === 'strength' ? (previous?.reps ?? null) : null,
    weight_kg: kind === 'strength' ? (previous?.weight_kg ?? null) : null,
    rpe: previous?.rpe ?? null,
    rest_seconds: previous?.rest_seconds ?? DEFAULT_REST_SECONDS,
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

export function createSuggestedWorkoutSet(
  kind: ExerciseKind,
  previous: WorkoutSetInput,
): WorkoutSetInput {
  return {
    ...createWorkoutSet(kind, previous, false),
    rest_seconds: DEFAULT_REST_SECONDS,
  };
}

export function latestExerciseSet(
  workouts: TrackedWorkout[],
  exerciseId: string,
  onOrBeforeDate: string,
  excludedWorkoutId?: string,
): TrackedSet | undefined {
  return latestExerciseSets(workouts, exerciseId, onOrBeforeDate, excludedWorkoutId)[0];
}

export function latestExerciseSets(
  workouts: TrackedWorkout[],
  exerciseId: string,
  onOrBeforeDate: string,
  excludedWorkoutId?: string,
): TrackedSet[] {
  const newestFirst = [...workouts].sort(
    (left, right) =>
      right.workout_date.localeCompare(left.workout_date) ||
      right.created_at.localeCompare(left.created_at),
  );

  for (const workout of newestFirst) {
    if (workout.id === excludedWorkoutId || workout.workout_date > onOrBeforeDate) continue;
    const movement = workout.movements.find((item) => item.exercise.id === exerciseId);
    const completedSets = movement?.sets
      .filter((item) => item.completed)
      .sort((left, right) => left.order_index - right.order_index);
    if (completedSets?.length) return completedSets;
  }

  return [];
}

export function isCompletedWorkingSet(item: WorkoutSetInput): boolean {
  return (
    item.completed &&
    item.set_type !== 'warmup' &&
    !item.warmup &&
    (!item.failed || (item.reps ?? 0) > 0)
  );
}
