import { describe, expect, it } from 'vitest';
import {
  filterMeasurementsByRange,
  nearestChartPointIndex,
  splitWeightLineByPhase,
  trainingPhaseAtDate,
} from './bodyTrend';

const phases = [
  { start_date: '2026-01-10', mode: 'cut' as const },
  { start_date: '2026-02-10', mode: 'maintenance' as const },
  { start_date: '2026-03-10', mode: 'bulk' as const },
];

describe('body-weight phase history', () => {
  it('uses the latest phase that began on or before a date', () => {
    expect(trainingPhaseAtDate('2026-01-01', phases, 'maintenance')).toBe('maintenance');
    expect(trainingPhaseAtDate('2026-01-10', phases, 'maintenance')).toBe('cut');
    expect(trainingPhaseAtDate('2026-02-25', phases, 'maintenance')).toBe('maintenance');
    expect(trainingPhaseAtDate('2026-04-01', phases, 'maintenance')).toBe('bulk');
  });

  it('splits a line at phase boundaries and interpolates the join', () => {
    const segments = splitWeightLineByPhase(
      [
        { date: '2026-01-01', x: 0, y: 100 },
        { date: '2026-01-21', x: 200, y: 80 },
      ],
      [{ start_date: '2026-01-11', mode: 'cut' }],
      'maintenance',
    );

    expect(segments).toEqual([
      { x1: 0, y1: 100, x2: 100, y2: 90, mode: 'maintenance' },
      { x1: 100, y1: 90, x2: 200, y2: 80, mode: 'cut' },
    ]);
  });
});

describe('body-composition chart ranges and scrubbing', () => {
  const measurements = [
    { measurement_date: '2025-07-31', weight_kg: 90 },
    { measurement_date: '2025-10-30', weight_kg: 89 },
    { measurement_date: '2025-10-31', weight_kg: 88 },
    { measurement_date: '2026-04-29', weight_kg: 87 },
    { measurement_date: '2026-04-30', weight_kg: 86 },
    { measurement_date: '2026-07-31', weight_kg: 85 },
  ];

  it('filters calendar ranges relative to the latest measurement', () => {
    expect(
      filterMeasurementsByRange(measurements, '3m').map((item) => item.measurement_date),
    ).toEqual(['2026-04-30', '2026-07-31']);
    expect(
      filterMeasurementsByRange(measurements, '9m').map((item) => item.measurement_date),
    ).toEqual(['2025-10-31', '2026-04-29', '2026-04-30', '2026-07-31']);
    expect(filterMeasurementsByRange(measurements, '1y')).toEqual(measurements);
    expect(filterMeasurementsByRange(measurements, 'all')).toEqual(measurements);
  });

  it('selects and clamps the nearest point while scrubbing', () => {
    expect(nearestChartPointIndex(42, 42, 302, 4)).toBe(0);
    expect(nearestChartPointIndex(175, 42, 302, 4)).toBe(2);
    expect(nearestChartPointIndex(999, 42, 302, 4)).toBe(3);
  });
});
