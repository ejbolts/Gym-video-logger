export interface DatedWorkoutEntry {
  workout_date: string;
}

export function monthCountFromOldestWorkout(
  entries: DatedWorkoutEntry[],
  today = new Date(),
): number {
  if (!entries.length) return 1;
  const oldest = entries.reduce(
    (date, entry) => (entry.workout_date < date ? entry.workout_date : date),
    entries[0].workout_date,
  );
  const [year, month] = oldest.split('-').map(Number);
  const count = (today.getFullYear() - year) * 12 + today.getMonth() - (month - 1) + 1;
  return Math.max(count, 1);
}
