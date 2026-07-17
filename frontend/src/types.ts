export type SessionStatus =
  | 'draft'
  | 'uploading'
  | 'upload_failed'
  | 'queued'
  | 'normalizing'
  | 'stitching'
  | 'uploading_to_youtube'
  | 'youtube_processing'
  | 'complete'
  | 'failed'
  | 'cancelled';

export type ClipUploadStatus = 'waiting' | 'uploading' | 'uploaded' | 'failed';

export interface Clip {
  id: string;
  client_clip_id: string;
  original_filename: string;
  order_index: number;
  exercise_label: string | null;
  file_size: number;
  upload_status: ClipUploadStatus;
  uploaded_at: string | null;
  duration_ms: number | null;
}

export interface Timestamp {
  clip_id: string;
  order_index: number;
  label: string;
  start_seconds: number;
  youtube_url: string | null;
}

export interface WorkoutSession {
  id: string;
  name: string;
  workout_date: string;
  notes: string | null;
  status: SessionStatus;
  expected_clip_count: number;
  uploaded_clip_count: number;
  processing_error: string | null;
  youtube_video_id: string | null;
  youtube_url: string | null;
  created_at: string;
  updated_at: string;
  clips: Clip[];
  timestamps: Timestamp[];
}

export interface Health {
  status: string;
  upload_concurrency: number;
  youtube_mock_mode: boolean;
}

export interface PushConfig {
  enabled: boolean;
  public_key: string | null;
}

export interface LocalClip {
  clientId: string;
  file: File;
  previewUrl: string;
  exerciseLabel: string;
  status: ClipUploadStatus;
  progress: number;
  error?: string;
}
