import type { ExerciseKind, WorkoutSetInput } from './types';

type DraftSetForAutoSave = WorkoutSetInput & { fromPrevious?: boolean };

export function isWorkoutSetAutoSavable(
  kind: ExerciseKind,
  set: DraftSetForAutoSave,
): boolean {
  if (set.completed) return true;

  if (kind === 'cardio') {
    return (
      set.duration_seconds !== null ||
      set.distance_km !== null ||
      set.calories_kcal != null ||
      set.average_heart_rate_bpm != null ||
      set.incline_percent != null ||
      set.speed_kph != null
    );
  }

  return (
    set.reps !== null ||
    set.weight_kg !== null ||
    set.bodyweight_kg != null ||
    set.percentile != null
  );
}

export function workoutSetForAutoSave(
  kind: ExerciseKind,
  set: DraftSetForAutoSave,
): DraftSetForAutoSave {
  return isWorkoutSetAutoSavable(kind, set) ? { ...set, completed: true } : set;
}
