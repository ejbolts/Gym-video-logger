import type { ServerStatus, VideoUploadMode } from './types';

export const VIDEO_UPLOAD_OPTIONS: { value: VideoUploadMode; label: string; detail: string }[] = [
  {
    value: 'off',
    label: 'Off',
    detail: 'Nobody can upload or process videos. Keeps the server’s CPU free.',
  },
  { value: 'admin', label: 'Admins', detail: 'Only administrators can upload videos.' },
  { value: 'everyone', label: 'Everyone', detail: 'Every account can upload videos.' },
];

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

export function formatBytes(bytes: number): string {
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 || value >= 10 ? 0 : 1;
  return `${value.toFixed(digits)} ${BYTE_UNITS[unit]}`;
}

export function formatJoined(createdAt: string): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** A coarse "how long ago" label; activity is only recorded every few minutes anyway. */
export function formatLastActive(lastActiveAt: string | null, now: Date = new Date()): string {
  if (!lastActiveAt) return 'Never';
  const date = new Date(lastActiveAt);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  const minutes = Math.floor((now.getTime() - date.getTime()) / 60_000);
  if (minutes < 10) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return days === 1 ? 'Yesterday' : `${days} days ago`;
  return formatJoined(lastActiveAt);
}

const QUEUE_LABELS: Record<string, string> = {
  queued: 'waiting',
  normalizing: 'encoding',
  stitching: 'stitching',
  uploading_to_youtube: 'uploading to YouTube',
  youtube_processing: 'processing on YouTube',
};

export function videoQueueSummary(queue: ServerStatus['video_queue']): string {
  const parts = Object.entries(queue)
    .filter(([, count]) => count > 0)
    .map(([status, count]) => `${count} ${QUEUE_LABELS[status] ?? status.replaceAll('_', ' ')}`);
  return parts.length ? parts.join(' · ') : 'Idle';
}

export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}
