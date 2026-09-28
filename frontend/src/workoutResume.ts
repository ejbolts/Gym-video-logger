export function completedWorkoutDurationMinutes(
  previousDurationMinutes: number,
  startedAt: number,
  endedAt: number,
  overrideMinutes: number | null,
): number {
  if (overrideMinutes !== null) return overrideMinutes;
  const elapsedSeconds = Math.max(0, Math.floor((endedAt - startedAt) / 1000));
  return Math.max(1, previousDurationMinutes + Math.round(elapsedSeconds / 60));
}
