import type { WorkoutSetInput } from './types';

export const RPE_OPTIONS = [5, 6, 7, 7.5, 8, 8.5, 9, 9.5, 10] as const;

export type SetKind = 'normal' | 'warmup' | 'drop';

/** Adds `delta` to a numeric text value, clamped at `min`, without float noise. */
export function steppedValue(value: string, delta: number, min = 0): string {
  const current = Number(value.replace(',', '.'));
  const base = value.trim() !== '' && Number.isFinite(current) ? current : 0;
  const next = Math.max(min, base + delta);
  return String(Number(next.toFixed(2)));
}

export function setKindOf(item: Pick<WorkoutSetInput, 'set_type' | 'warmup'>): SetKind {
  if (item.set_type === 'warmup' || item.warmup) return 'warmup';
  if (item.set_type === 'drop') return 'drop';
  return 'normal';
}

/** Working sets are numbered 1…n; warm-ups show W and drop sets D. */
export function setNumberLabels(
  sets: Array<Pick<WorkoutSetInput, 'set_type' | 'warmup'>>,
): string[] {
  let working = 0;
  return sets.map((item) => {
    const kind = setKindOf(item);
    if (kind === 'warmup') return 'W';
    if (kind === 'drop') return 'D';
    working += 1;
    return String(working);
  });
}
