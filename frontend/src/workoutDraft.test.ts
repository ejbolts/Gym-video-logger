import { describe, expect, it } from 'vitest';
import {
  ACTIVE_WORKOUT_DRAFT_KEY,
  clearActiveWorkoutDraft,
  readActiveWorkoutDraft,
  writeActiveWorkoutDraft,
} from './workoutDraft';
import type { ActiveWorkoutDraft, DraftStorage } from './workoutDraft';

class MemoryStorage implements DraftStorage {
  values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

const draft: ActiveWorkoutDraft = {
  version: 1,
  startedAt: Date.UTC(2026, 7, 1, 9),
  updatedAt: Date.UTC(2026, 7, 1, 9, 30),
  name: 'Push workout',
  workoutDate: '2026-08-01',
  category: 'push',
  notes: 'Strong session',
  movements: [
    {
      key: 'movement-1',
      exerciseId: 'bench',
      notes: 'Pause reps',
      machinePhotoIds: ['photo-1'],
      supersetKey: null,
      sets: [
        {
          key: 'set-1',
          reps: 5,
          weight_kg: 100,
          rpe: 8,
          rest_seconds: 180,
          duration_seconds: null,
          distance_km: null,
          incline_percent: null,
          speed_kph: null,
          notes: null,
          completed: true,
        },
      ],
    },
  ],
};

describe('active workout draft persistence', () => {
  it('round-trips and clears a workout draft', () => {
    const storage = new MemoryStorage();

    expect(writeActiveWorkoutDraft(draft, storage)).toBe(true);
    expect(readActiveWorkoutDraft(storage)).toEqual(draft);

    clearActiveWorkoutDraft(storage);
    expect(readActiveWorkoutDraft(storage)).toBeNull();
  });

  it('ignores corrupt or incompatible stored data', () => {
    const storage = new MemoryStorage();
    storage.setItem(ACTIVE_WORKOUT_DRAFT_KEY, '{not-json');
    expect(readActiveWorkoutDraft(storage)).toBeNull();

    storage.setItem(ACTIVE_WORKOUT_DRAFT_KEY, JSON.stringify({ ...draft, version: 2 }));
    expect(readActiveWorkoutDraft(storage)).toBeNull();
  });
});
