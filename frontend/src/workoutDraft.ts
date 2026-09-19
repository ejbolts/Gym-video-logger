import type { TrackedWorkout, WorkoutCategory, WorkoutSetInput } from './types';

export const ACTIVE_WORKOUT_DRAFT_KEY = 'gym-video-logger.active-workout.v1';

export interface DraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface StoredDraftSet extends WorkoutSetInput {
  key: string;
  fromPrevious?: boolean;
}

export interface StoredDraftMovement {
  key: string;
  exerciseId: string;
  notes: string;
  machinePhotoIds: string[];
  supersetKey: string | null;
  isComplete?: boolean;
  sets: StoredDraftSet[];
}

export interface ActiveWorkoutDraft {
  version: 1;
  startedAt: number;
  updatedAt: number;
  lastActiveAt?: number;
  durationOverrideMinutes?: number | null;
  name: string;
  workoutDate: string;
  category: WorkoutCategory;
  notes: string;
  movements: StoredDraftMovement[];
}

const workoutCategories = new Set<WorkoutCategory>([
  'upper',
  'lower',
  'push',
  'pull',
  'full_body',
  'cardio',
  'other',
]);

function browserStorage(): DraftStorage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isStoredSet(value: unknown): value is StoredDraftSet {
  return (
    isRecord(value) &&
    typeof value.key === 'string' &&
    typeof value.completed === 'boolean' &&
    (value.fromPrevious === undefined || typeof value.fromPrevious === 'boolean') &&
    (value.notes === null || typeof value.notes === 'string')
  );
}

function isStoredMovement(value: unknown): value is StoredDraftMovement {
  return (
    isRecord(value) &&
    typeof value.key === 'string' &&
    typeof value.exerciseId === 'string' &&
    typeof value.notes === 'string' &&
    Array.isArray(value.machinePhotoIds) &&
    value.machinePhotoIds.every((id) => typeof id === 'string') &&
    (value.supersetKey === null || typeof value.supersetKey === 'string') &&
    (value.isComplete === undefined || typeof value.isComplete === 'boolean') &&
    Array.isArray(value.sets) &&
    value.sets.every(isStoredSet)
  );
}

function isActiveWorkoutDraft(value: unknown): value is ActiveWorkoutDraft {
  return (
    isRecord(value) &&
    value.version === 1 &&
    typeof value.startedAt === 'number' &&
    Number.isFinite(value.startedAt) &&
    value.startedAt > 0 &&
    (value.lastActiveAt === undefined ||
      (typeof value.lastActiveAt === 'number' &&
        Number.isFinite(value.lastActiveAt) &&
        value.lastActiveAt >= value.startedAt)) &&
    (value.durationOverrideMinutes == null ||
      (typeof value.durationOverrideMinutes === 'number' &&
        Number.isInteger(value.durationOverrideMinutes) &&
        value.durationOverrideMinutes >= 1 &&
        value.durationOverrideMinutes <= 1440)) &&
    typeof value.updatedAt === 'number' &&
    typeof value.name === 'string' &&
    typeof value.workoutDate === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value.workoutDate) &&
    typeof value.category === 'string' &&
    workoutCategories.has(value.category as WorkoutCategory) &&
    typeof value.notes === 'string' &&
    Array.isArray(value.movements) &&
    value.movements.every(isStoredMovement)
  );
}

export function readActiveWorkoutDraft(storage?: DraftStorage | null): ActiveWorkoutDraft | null {
  const target = storage === undefined ? browserStorage() : storage;
  if (!target) return null;
  try {
    const serialized = target.getItem(ACTIVE_WORKOUT_DRAFT_KEY);
    if (!serialized) return null;
    const parsed: unknown = JSON.parse(serialized);
    return isActiveWorkoutDraft(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeActiveWorkoutDraft(
  draft: ActiveWorkoutDraft,
  storage?: DraftStorage | null,
): boolean {
  const target = storage === undefined ? browserStorage() : storage;
  if (!target) return false;
  try {
    target.setItem(ACTIVE_WORKOUT_DRAFT_KEY, JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

export function clearActiveWorkoutDraft(storage?: DraftStorage | null): void {
  const target = storage === undefined ? browserStorage() : storage;
  if (!target) return;
  try {
    target.removeItem(ACTIVE_WORKOUT_DRAFT_KEY);
  } catch {
    // Storage can be unavailable in private modes; the in-memory workout remains usable.
  }
}

function completedSetSignature(
  exerciseId: string,
  item: Pick<WorkoutSetInput, 'completed' | 'reps' | 'weight_kg' | 'warmup' | 'set_type'>,
): string | null {
  if (!item.completed) return null;
  return JSON.stringify([
    exerciseId,
    item.reps,
    item.weight_kg,
    item.set_type === 'warmup' || item.warmup === true,
  ]);
}

export function savedWorkoutMatchesOldDraft(
  draft: ActiveWorkoutDraft,
  workout: TrackedWorkout,
  now = Date.now(),
): boolean {
  if (now - draft.startedAt < 24 * 60 * 60 * 1000) return false;
  if (
    workout.workout_date !== draft.workoutDate ||
    workout.name !== draft.name.trim() ||
    workout.category !== draft.category
  ) {
    return false;
  }
  const draftSets = draft.movements.flatMap((movement) =>
    movement.sets
      .map((item) => completedSetSignature(movement.exerciseId, item))
      .filter((item): item is string => item !== null),
  );
  const savedSets = workout.movements.flatMap((movement) =>
    movement.sets
      .map((item) => completedSetSignature(movement.exercise.id, item))
      .filter((item): item is string => item !== null),
  );
  return draftSets.length > 0 && JSON.stringify(draftSets) === JSON.stringify(savedSets);
}
