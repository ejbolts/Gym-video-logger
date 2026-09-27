import type { BodyTrendStatistic } from './bodyTrend';

export type BodyHistoryPeriod = 'week' | 'month';

export interface BodyHistoryMeasurement {
  measurement_date: string;
  weight_kg: number;
  body_fat_pct: number | null;
}

export interface BodyHistorySummary {
  start_date: string;
  end_date: string;
  weight_kg: number;
  body_fat_pct: number | null;
  count: number;
}

function statistic(values: number[], selected: BodyTrendStatistic): number | null {
  if (values.length === 0) return null;
  if (selected === 'average') {
    return values.reduce((total, value) => total + value, 0) / values.length;
  }
  const sorted = values.slice().sort((first, second) => first - second);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function weekStart(date: string): string {
  const day = new Date(`${date}T00:00:00Z`);
  const daysSinceMonday = (day.getUTCDay() + 6) % 7;
  day.setUTCDate(day.getUTCDate() - daysSinceMonday);
  return day.toISOString().slice(0, 10);
}

export function summarizeBodyHistory(
  measurements: BodyHistoryMeasurement[],
  period: BodyHistoryPeriod,
  selected: BodyTrendStatistic,
): BodyHistorySummary[] {
  const groups = new Map<string, BodyHistoryMeasurement[]>();
  for (const measurement of measurements) {
    const key =
      period === 'week'
        ? weekStart(measurement.measurement_date)
        : `${measurement.measurement_date.slice(0, 7)}-01`;
    groups.set(key, [...(groups.get(key) ?? []), measurement]);
  }

  return [...groups.entries()]
    .sort(([first], [second]) => second.localeCompare(first))
    .map(([start_date, entries]) => {
      const end = new Date(`${start_date}T00:00:00Z`);
      if (period === 'week') end.setUTCDate(end.getUTCDate() + 6);
      else end.setUTCMonth(end.getUTCMonth() + 1, 0);
      return {
        start_date,
        end_date: end.toISOString().slice(0, 10),
        weight_kg: statistic(
          entries.map((entry) => entry.weight_kg),
          selected,
        )!,
        body_fat_pct: statistic(
          entries.flatMap((entry) => (entry.body_fat_pct === null ? [] : [entry.body_fat_pct])),
          selected,
        ),
        count: entries.length,
      };
    });
}
