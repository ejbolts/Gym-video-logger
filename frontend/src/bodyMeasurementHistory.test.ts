import { describe, expect, it } from 'vitest';
import { summarizeBodyHistory } from './bodyMeasurementHistory';

const measurements = [
  { measurement_date: '2026-10-01', weight_kg: 90, body_fat_pct: null },
  { measurement_date: '2026-09-30', weight_kg: 80, body_fat_pct: 12 },
  { measurement_date: '2026-09-28', weight_kg: 70, body_fat_pct: 14 },
  { measurement_date: '2026-09-27', weight_kg: 60, body_fat_pct: 16 },
];

describe('bodyweight history summaries', () => {
  it('groups weeks from Monday through Sunday and keeps the newest week first', () => {
    expect(summarizeBodyHistory(measurements, 'week', 'average')).toEqual([
      {
        start_date: '2026-09-28',
        end_date: '2026-10-04',
        weight_kg: 80,
        body_fat_pct: 13,
        count: 3,
      },
      {
        start_date: '2026-09-21',
        end_date: '2026-09-27',
        weight_kg: 60,
        body_fat_pct: 16,
        count: 1,
      },
    ]);
  });

  it('uses calendar months, median values, and only known body fat readings', () => {
    expect(summarizeBodyHistory(measurements, 'month', 'median')).toEqual([
      {
        start_date: '2026-10-01',
        end_date: '2026-10-31',
        weight_kg: 90,
        body_fat_pct: null,
        count: 1,
      },
      {
        start_date: '2026-09-01',
        end_date: '2026-09-30',
        weight_kg: 70,
        body_fat_pct: 14,
        count: 3,
      },
    ]);
  });
});
