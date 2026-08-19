import { describe, expect, it } from 'vitest';
import { monthCountFromOldestWorkout } from './calendarRange';

describe('calendar workout range', () => {
  it('includes every month from the oldest workout through the present month', () => {
    const entries = [
      { workout_date: '2026-08-11' },
      { workout_date: '2020-08-17' },
      { workout_date: '2024-01-05' },
    ];

    expect(monthCountFromOldestWorkout(entries, new Date(2026, 7, 12))).toBe(73);
  });

  it('shows the current month when the history is empty', () => {
    expect(monthCountFromOldestWorkout([], new Date(2026, 7, 12))).toBe(1);
  });
});
