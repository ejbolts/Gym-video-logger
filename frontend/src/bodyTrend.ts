import type { TrainingMode } from './types';
import { dateRangeForDates, type TimeRange } from './dateRanges';

export type BodyTrendRange = TimeRange;

export const BODY_TREND_DURATION_OPTIONS = [
  { value: '7d', label: '7 days', days: 7 },
  { value: '14d', label: '14 days', days: 14 },
  { value: '30d', label: '30 days', days: 30 },
  { value: '60d', label: '60 days', days: 60 },
  { value: '90d', label: '90 days', days: 90 },
  { value: '6m', label: '6 months', months: 6 },
  { value: '1y', label: '1 year', months: 12 },
] as const;

export type BodyTrendDuration = (typeof BODY_TREND_DURATION_OPTIONS)[number]['value'];
export type BodyTrendStatistic = 'average' | 'median';

export interface WeightedMeasurement extends DatedMeasurement {
  weight_kg: number;
}

export interface BodyWeightTrendSummary {
  average: number | null;
  median: number | null;
  count: number;
}

export function bodyweightEntryPlaceholder(measurements: WeightedMeasurement[]): string {
  return measurements[0] ? measurements[0].weight_kg.toFixed(1) : '88.0';
}

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

function dateOnlyUtc(date: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

export function bodyTrendCutoffDate(latestDate: string, duration: BodyTrendDuration): string {
  const option = BODY_TREND_DURATION_OPTIONS.find((item) => item.value === duration)!;
  const cutoff = dateOnlyUtc(latestDate);
  if ('days' in option) {
    cutoff.setUTCDate(cutoff.getUTCDate() - (option.days - 1));
  } else {
    const originalDay = cutoff.getUTCDate();
    cutoff.setUTCDate(1);
    cutoff.setUTCMonth(cutoff.getUTCMonth() - option.months);
    const lastDay = new Date(
      Date.UTC(cutoff.getUTCFullYear(), cutoff.getUTCMonth() + 1, 0),
    ).getUTCDate();
    cutoff.setUTCDate(Math.min(originalDay, lastDay));
  }
  return cutoff.toISOString().slice(0, 10);
}

export function summarizeBodyWeightTrend<T extends WeightedMeasurement>(
  measurements: T[],
  duration: BodyTrendDuration,
): BodyWeightTrendSummary {
  if (measurements.length === 0) return { average: null, median: null, count: 0 };
  const latestDate = measurements.reduce(
    (latest, item) => (item.measurement_date > latest ? item.measurement_date : latest),
    measurements[0].measurement_date,
  );
  const cutoff = bodyTrendCutoffDate(latestDate, duration);
  const weights = measurements
    .filter((item) => item.measurement_date >= cutoff && item.measurement_date <= latestDate)
    .map((item) => item.weight_kg)
    .sort((first, second) => first - second);
  if (weights.length === 0) return { average: null, median: null, count: 0 };
  const middle = Math.floor(weights.length / 2);
  const median =
    weights.length % 2 === 0 ? (weights[middle - 1] + weights[middle]) / 2 : weights[middle];
  return {
    average: weights.reduce((total, value) => total + value, 0) / weights.length,
    median,
    count: weights.length,
  };
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
