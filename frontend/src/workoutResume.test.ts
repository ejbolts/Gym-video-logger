import { describe, expect, it } from 'vitest';
import { completedWorkoutDurationMinutes } from './workoutResume';

describe('resuming a finished workout', () => {
  it('adds only the time since resuming to the saved duration', () => {
    const resumedAt = Date.UTC(2026, 8, 28, 18, 0);
    expect(completedWorkoutDurationMinutes(45, resumedAt, resumedAt + 10 * 60_000, null)).toBe(55);
  });

  it('treats a corrected duration as the total, not another segment', () => {
    const resumedAt = Date.UTC(2026, 8, 28, 18, 0);
    expect(completedWorkoutDurationMinutes(45, resumedAt, resumedAt + 10 * 60_000, 50)).toBe(50);
  });
});
