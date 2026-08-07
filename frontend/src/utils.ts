export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length);
  return `${(bytes / 1024 ** unit).toFixed(unit > 1 ? 1 : 0)} ${units[unit - 1]}`;
}

export function localDate(): string {
  const date = new Date();
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

export function formatSeconds(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remaining = seconds % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`
    : `${minutes}:${String(remaining).padStart(2, '0')}`;
}

export function formatMinutesDuration(minutes: number | null): string {
  if (minutes === null) return '–';
  const normalized = Math.max(0, Math.floor(minutes));
  const hours = Math.floor(normalized / 60);
  const remainingMinutes = normalized % 60;
  if (hours && remainingMinutes) return `${hours}h ${remainingMinutes}min`;
  if (hours) return `${hours}h`;
  return `${remainingMinutes}min`;
}

export function mergeUniqueById<T extends { id: string }>(existing: T[], selected: T[]): T[] {
  const seen = new Set(existing.map((item) => item.id));
  return [...existing, ...selected.filter((item) => !seen.has(item.id))];
}

export function reorder<T>(items: T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length || from === to) return items;
  const copy = [...items];
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item);
  return copy;
}
