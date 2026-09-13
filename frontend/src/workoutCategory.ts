import type { Exercise, WorkoutCategory } from './types';

type CategorizedExercise = Pick<Exercise, 'category'>;

const automaticWorkoutNames: Record<WorkoutCategory, string> = {
  upper: 'Upper body workout',
  lower: 'Lower body workout',
  push: 'Push workout',
  pull: 'Pull workout',
  full_body: 'Full body workout',
  cardio: 'Cardio workout',
  other: 'Other workout',
};

export function workoutNameForCategory(category: WorkoutCategory): string {
  return automaticWorkoutNames[category];
}

export function finalizeWorkoutIdentity(
  exercises: CategorizedExercise[],
  currentCategory: WorkoutCategory,
  currentName: string,
  inferFromExercises: boolean,
): { category: WorkoutCategory; name: string } {
  const category = inferFromExercises
    ? (inferWorkoutCategory(exercises) ?? currentCategory)
    : currentCategory;
  const trimmedName = currentName.trim();
  const includesCardio = exercises.some((exercise) => exercise.category === 'cardio');
  const hasAutomaticName =
    trimmedName === '' ||
    trimmedName === workoutNameForCategory(currentCategory) ||
    trimmedName === workoutNameWithCardio(currentCategory);
  return {
    category,
    name:
      hasAutomaticName && includesCardio && category !== 'cardio'
        ? workoutNameWithCardio(category)
        : hasAutomaticName
          ? workoutNameForCategory(category)
          : trimmedName,
  };
}

function workoutNameWithCardio(category: WorkoutCategory): string {
  return workoutNameForCategory(category).replace(' workout', ' + Cardio workout');
}

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
  const strengthTotal = upperBody + lowerBody;
  if (strengthTotal === 0) return counts.cardio > 0 ? 'cardio' : 'other';

  const families = [
    { category: 'upper' as const, count: upperBody },
    { category: 'lower' as const, count: lowerBody },
  ].sort((left, right) => right.count - left.count);
  const dominant = families[0];
  const remaining = strengthTotal - dominant.count;

  if (remaining > 0 && dominant.count < 2 * remaining) return 'full_body';
  return dominant.category === 'upper' ? focusedUpperCategory(counts) : dominant.category;
}
