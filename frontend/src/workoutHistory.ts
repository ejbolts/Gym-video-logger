export function workoutPageForId(
  workouts: ReadonlyArray<{ id: string }>,
  workoutId: string | null,
  pageSize: number,
): number | null {
  if (workoutId === null) return null;
  const index = workouts.findIndex((workout) => workout.id === workoutId);
  return index < 0 ? null : Math.floor(index / pageSize) + 1;
}

export function upsertWorkoutByRecency<
  T extends { id: string; workout_date: string; created_at: string },
>(workouts: ReadonlyArray<T>, saved: T): T[] {
  return [saved, ...workouts.filter((workout) => workout.id !== saved.id)].sort(
    (left, right) =>
      right.workout_date.localeCompare(left.workout_date) ||
      right.created_at.localeCompare(left.created_at),
  );
}
