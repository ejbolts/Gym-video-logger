import type { Exercise, WorkoutSetInput } from './types';

export type WorkoutDraftSet = WorkoutSetInput & { key: string };

export type WorkoutDraftMovement = {
  key: string;
  exercise: Exercise;
  notes: string;
  machinePhotoIds: string[];
  machinePhotosInitialized: boolean;
  supersetKey: string | null;
  sets: WorkoutDraftSet[];
};

export function replaceMovementExercise(
  movements: WorkoutDraftMovement[],
  movementKey: string,
  exercise: Exercise,
): WorkoutDraftMovement[] {
  return movements.map((movement) =>
    movement.key === movementKey
      ? {
          ...movement,
          exercise,
          machinePhotoIds: [],
          machinePhotosInitialized: false,
        }
      : movement,
  );
}
