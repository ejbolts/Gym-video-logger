import { describe, expect, it } from 'vitest';
import { cachedWorkoutsForRevision, type CachedWorkoutSnapshot } from './workoutCache';

describe('workout cache revision matching', () => {
  const cached = { revision: 'revision-one', workouts: [] } satisfies CachedWorkoutSnapshot;

  it('reuses workouts only while the server revision matches', () => {
    expect(cachedWorkoutsForRevision(cached, 'revision-one')).toEqual([]);
    expect(cachedWorkoutsForRevision(cached, 'revision-two')).toBeNull();
    expect(cachedWorkoutsForRevision(null, 'revision-one')).toBeNull();
  });
});
