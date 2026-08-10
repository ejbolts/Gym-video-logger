import type { Exercise, WorkoutCategory } from './types';

type CategorizedExercise = Pick<Exercise, 'category'>;

function focusedUpperCategory(counts: Record<WorkoutCategory, number>): WorkoutCategory {
  const push = counts.push;
  const pull = counts.pull;
  const neutralUpper = counts.upper;

  if (push >= 2 * (pull + neutralUpper)) return 'push';
  if (pull >= 2 * (push + neutralUpper)) return 'pull';
  return 'upper';
}

export function inferWorkoutCategory(exercises: CategorizedExercise[]): WorkoutCategory | null {
  if (!exercises.length) return null;

  const counts: Record<WorkoutCategory, number> = {
    upper: 0,
    lower: 0,
    push: 0,
    pull: 0,
    full_body: 0,
    cardio: 0,
    other: 0,
  };
  exercises.forEach((exercise) => {
    counts[exercise.category] += 1;
  });

  if (counts.full_body > 0) return 'full_body';

  const upperBody = counts.push + counts.pull + counts.upper;
  const lowerBody = counts.lower;
  const cardio = counts.cardio;
  const categorizedTotal = upperBody + lowerBody + cardio;
  if (categorizedTotal === 0) return 'other';

  const families = [
    { category: 'upper' as const, count: upperBody },
    { category: 'lower' as const, count: lowerBody },
    { category: 'cardio' as const, count: cardio },
  ].sort((left, right) => right.count - left.count);
  const dominant = families[0];
  const remaining = categorizedTotal - dominant.count;

  if (remaining > 0 && dominant.count < 2 * remaining) return 'full_body';
  return dominant.category === 'upper' ? focusedUpperCategory(counts) : dominant.category;
}
