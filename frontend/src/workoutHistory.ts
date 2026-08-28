export function workoutPageForId(
  workouts: ReadonlyArray<{ id: string }>,
  workoutId: string | null,
  pageSize: number,
): number | null {
  if (workoutId === null) return null;
  const index = workouts.findIndex((workout) => workout.id === workoutId);
  return index < 0 ? null : Math.floor(index / pageSize) + 1;
}
