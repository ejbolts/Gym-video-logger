import type { TrainingMode } from './types';

export type BodyTrendRange = '1m' | '3m' | '9m' | '1y' | 'all';

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

function subtractCalendarMonths(dateValue: string, months: number): string {
  const [year, month, day] = dateValue.split('-').map(Number);
  const targetMonthIndex = year * 12 + month - 1 - months;
  const targetYear = Math.floor(targetMonthIndex / 12);
  const targetMonth = targetMonthIndex - targetYear * 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return new Date(Date.UTC(targetYear, targetMonth, Math.min(day, lastDay)))
    .toISOString()
    .slice(0, 10);
}

export function filterMeasurementsByRange<T extends DatedMeasurement>(
  measurements: T[],
  range: BodyTrendRange,
): T[] {
  if (range === 'all' || measurements.length === 0) return measurements;
  const latestDate = measurements.reduce(
    (latest, item) => (item.measurement_date > latest ? item.measurement_date : latest),
    measurements[0].measurement_date,
  );
  const months = range === '1m' ? 1 : range === '3m' ? 3 : range === '9m' ? 9 : 12;
  const cutoff = subtractCalendarMonths(latestDate, months);
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
