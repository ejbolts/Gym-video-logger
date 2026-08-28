import type { TrainingMode } from './types';
import { dateRangeForDates, type TimeRange } from './dateRanges';

export type BodyTrendRange = TimeRange;

export interface DatedMeasurement {
  measurement_date: string;
}

export interface PhaseChange {
  start_date: string;
  mode: TrainingMode;
}

export interface WeightChartPoint {
  date: string;
  x: number;
  y: number;
}

export interface WeightChartSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  mode: TrainingMode;
}

export function filterMeasurementsByRange<T extends DatedMeasurement>(
  measurements: T[],
  range: BodyTrendRange,
): T[] {
  const { start_date: cutoff } = dateRangeForDates(
    measurements.map((item) => item.measurement_date),
    range,
  );
  if (!cutoff) return measurements;
  return measurements.filter((item) => item.measurement_date >= cutoff);
}

export function nearestChartPointIndex(
  chartX: number,
  chartStart: number,
  chartEnd: number,
  pointCount: number,
): number {
  if (pointCount <= 1) return 0;
  const ratio = Math.min(1, Math.max(0, (chartX - chartStart) / (chartEnd - chartStart)));
  return Math.round(ratio * (pointCount - 1));
}

export function trainingPhaseAtDate(
  date: string,
  changes: PhaseChange[],
  fallback: TrainingMode,
): TrainingMode {
  let latest: PhaseChange | null = null;
  for (const change of changes) {
    if (change.start_date <= date && (latest === null || change.start_date >= latest.start_date)) {
      latest = change;
    }
  }
  return latest?.mode ?? fallback;
}

export function splitWeightLineByPhase(
  points: WeightChartPoint[],
  changes: PhaseChange[],
  fallback: TrainingMode,
): WeightChartSegment[] {
  const segments: WeightChartSegment[] = [];
  const changesByDate = new Map<string, PhaseChange>();
  for (const change of changes) changesByDate.set(change.start_date, change);
  const orderedChanges = [...changesByDate.values()].sort((a, b) =>
    a.start_date.localeCompare(b.start_date),
  );

  for (let index = 0; index < points.length - 1; index += 1) {
    const from = points[index];
    const to = points[index + 1];
    const fromTime = Date.parse(`${from.date}T00:00:00Z`);
    const toTime = Date.parse(`${to.date}T00:00:00Z`);
    const boundaries = orderedChanges.filter(
      (change) => change.start_date > from.date && change.start_date < to.date,
    );
    let currentX = from.x;
    let currentY = from.y;
    let currentDate = from.date;

    for (const boundary of boundaries) {
      const boundaryTime = Date.parse(`${boundary.start_date}T00:00:00Z`);
      const ratio = (boundaryTime - fromTime) / Math.max(toTime - fromTime, 1);
      const boundaryX = from.x + (to.x - from.x) * ratio;
      const boundaryY = from.y + (to.y - from.y) * ratio;
      segments.push({
        x1: currentX,
        y1: currentY,
        x2: boundaryX,
        y2: boundaryY,
        mode: trainingPhaseAtDate(currentDate, orderedChanges, fallback),
      });
      currentX = boundaryX;
      currentY = boundaryY;
      currentDate = boundary.start_date;
    }

    segments.push({
      x1: currentX,
      y1: currentY,
      x2: to.x,
      y2: to.y,
      mode: trainingPhaseAtDate(currentDate, orderedChanges, fallback),
    });
  }

  return segments;
}
