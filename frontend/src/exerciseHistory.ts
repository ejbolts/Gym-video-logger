import type { TrackedSet, TrackedWorkout } from './types';

export type ExerciseHistoryEntry = {
  workoutId: string;
  workoutDate: string;
  workoutName: string;
  movementNotes: string | null;
  sets: TrackedSet[];
};

export function recentExerciseHistory(
  workouts: TrackedWorkout[],
  exerciseId: string,
  excludedWorkoutId?: string,
  limit = 5,
): ExerciseHistoryEntry[] {
  const newestFirst = [...workouts].sort(
    (left, right) =>
      right.workout_date.localeCompare(left.workout_date) ||
      right.created_at.localeCompare(left.created_at),
  );
  const entries: ExerciseHistoryEntry[] = [];

  for (const workout of newestFirst) {
    if (workout.id === excludedWorkoutId) continue;
    for (const movement of workout.movements) {
      if (movement.exercise.id !== exerciseId) continue;
      const completedSets = movement.sets
        .filter((item) => item.completed)
        .sort((left, right) => left.order_index - right.order_index);
      if (!completedSets.length && !movement.notes) continue;
      entries.push({
        workoutId: workout.id,
        workoutDate: workout.workout_date,
        workoutName: workout.name,
        movementNotes: movement.notes,
        sets: completedSets,
      });
      if (entries.length === limit) return entries;
    }
  }

  return entries;
}
