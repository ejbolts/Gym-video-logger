import type {
  Clip,
  CsvImportResult,
  DashboardData,
  Exercise,
  ExerciseProgress,
  Health,
  PushConfig,
  TrackedWorkout,
  WorkoutInput,
  WorkoutSession,
} from './types';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly code = 'request_failed',
    public readonly status = 0,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, credentials: 'omit' });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: { code?: string; message?: string };
    } | null;
    throw new ApiError(
      body?.error?.message ?? `Request failed (${response.status})`,
      body?.error?.code,
      response.status,
    );
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

async function requestBlob(path: string): Promise<Blob> {
  const response = await fetch(path, { credentials: 'omit' });
  if (!response.ok)
    throw new ApiError(`Export failed (${response.status})`, 'export_failed', response.status);
  return response.blob();
}

export const api = {
  health: () => request<Health>('/api/health'),
  pushConfig: () => request<PushConfig>('/api/notifications/push/config'),
  savePushSubscription: (payload: { endpoint: string; p256dh: string; auth: string }) =>
    request<void>('/api/notifications/push/subscriptions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  testPush: () => request<void>('/api/notifications/push/test', { method: 'POST' }),
  listSessions: () => request<WorkoutSession[]>('/api/sessions'),
  listExercises: () => request<Exercise[]>('/api/exercises'),
  createExercise: (payload: {
    name: string;
    category: string;
    kind: string;
    muscle_group: string;
    equipment: string | null;
  }) =>
    request<Exercise>('/api/exercises', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  dashboard: () => request<DashboardData>('/api/dashboard'),
  listWorkouts: () => request<TrackedWorkout[]>('/api/workouts'),
  exportWorkouts: () => requestBlob('/api/workouts/export.csv'),
  importWorkouts: (file: File) => {
    const form = new FormData();
    form.append('file', file, file.name);
    return request<CsvImportResult>('/api/workouts/import', { method: 'POST', body: form });
  },
  createWorkout: (payload: WorkoutInput) =>
    request<TrackedWorkout>('/api/workouts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  updateWorkout: (id: string, payload: WorkoutInput) =>
    request<TrackedWorkout>(`/api/workouts/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  deleteWorkout: (id: string) => request<void>(`/api/workouts/${id}`, { method: 'DELETE' }),
  deleteSampleData: () => request<void>('/api/sample-data', { method: 'DELETE' }),
  exerciseProgress: (id: string) => request<ExerciseProgress>(`/api/progress/${id}`),
  getSession: (id: string) => request<WorkoutSession>(`/api/sessions/${id}`),
  deleteSession: (id: string) =>
    request<void>(`/api/sessions/${id}`, {
      method: 'DELETE',
    }),
  createSession: (payload: {
    name: string;
    workout_date: string;
    notes: string | null;
    expected_clip_count: number;
  }) =>
    request<WorkoutSession>('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  process: (id: string) =>
    request<WorkoutSession>(`/api/sessions/${id}/process`, { method: 'POST' }),
  retryProcessing: (id: string) =>
    request<WorkoutSession>(`/api/sessions/${id}/retry-processing`, { method: 'POST' }),
  retryYoutubeProcessing: (id: string) =>
    request<WorkoutSession>(`/api/sessions/${id}/retry-youtube-processing`, {
      method: 'POST',
    }),
  cancel: (id: string) => request<WorkoutSession>(`/api/sessions/${id}/cancel`, { method: 'POST' }),
  uploadClip: (
    sessionId: string,
    clip: { clientId: string; file: File; exerciseLabel: string; orderIndex: number },
    onProgress: (percent: number) => void,
  ) =>
    new Promise<Clip>((resolve, reject) => {
      const form = new FormData();
      form.append('client_clip_id', clip.clientId);
      form.append('order_index', String(clip.orderIndex));
      form.append('exercise_label', clip.exerciseLabel);
      form.append('file', clip.file, clip.file.name);
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `/api/sessions/${sessionId}/clips`);
      xhr.withCredentials = false;
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
      };
      xhr.onerror = () => reject(new ApiError('Network error while uploading this clip.'));
      xhr.onload = () => {
        const body = xhr.responseText
          ? (JSON.parse(xhr.responseText) as { error?: { code?: string; message?: string } })
          : null;
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(body as unknown as Clip);
          return;
        }
        reject(
          new ApiError(
            body?.error?.message ?? `Upload failed (${xhr.status})`,
            body?.error?.code,
            xhr.status,
          ),
        );
      };
      xhr.send(form);
    }),
};
