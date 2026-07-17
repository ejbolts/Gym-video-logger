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

export type WorkoutCategory =
  'upper' | 'lower' | 'push' | 'pull' | 'full_body' | 'cardio' | 'other';

export type ExerciseKind = 'strength' | 'cardio';

export interface Exercise {
  id: string;
  name: string;
  category: WorkoutCategory;
  kind: ExerciseKind;
  muscle_group: string;
  equipment: string | null;
  is_custom: boolean;
}

export interface TrackedSet {
  id: string;
  order_index: number;
  reps: number | null;
  weight_kg: number | null;
  rpe: number | null;
  rest_seconds: number | null;
  duration_seconds: number | null;
  distance_km: number | null;
  bodyweight_kg: number | null;
  percentile: number | null;
  warmup: boolean;
  notes: string | null;
  completed: boolean;
}

export interface TrackedMovement {
  id: string;
  order_index: number;
  notes: string | null;
  exercise: Exercise;
  sets: TrackedSet[];
}

export interface TrackedWorkout {
  id: string;
  name: string;
  workout_date: string;
  category: WorkoutCategory;
  notes: string | null;
  duration_minutes: number | null;
  is_sample: boolean;
  created_at: string;
  updated_at: string;
  movements: TrackedMovement[];
}

export interface WorkoutSetInput {
  reps: number | null;
  weight_kg: number | null;
  rpe: number | null;
  rest_seconds: number | null;
  duration_seconds: number | null;
  distance_km: number | null;
  bodyweight_kg?: number | null;
  percentile?: number | null;
  warmup?: boolean;
  notes: string | null;
  completed: boolean;
}

export interface WorkoutInput {
  name: string;
  workout_date: string;
  category: WorkoutCategory;
  notes: string | null;
  duration_minutes: number | null;
  movements: Array<{
    exercise_id: string;
    notes: string | null;
    sets: WorkoutSetInput[];
  }>;
}

export interface HeatmapDay {
  workout_date: string;
  categories: WorkoutCategory[];
  workout_count: number;
  set_count: number;
}

export interface WeeklyExerciseBreakdown {
  exercise_id: string;
  exercise_name: string;
  muscle_group: string;
  category: WorkoutCategory;
  set_count: number;
  volume_kg: number;
}

export interface WeeklyDayBreakdown {
  workout_date: string;
  workout_count: number;
  total_sets: number;
  volume_kg: number;
  workout_names: string[];
  categories: WorkoutCategory[];
  exercises: WeeklyExerciseBreakdown[];
}

export interface DashboardData {
  workouts_this_week: number;
  sets_this_week: number;
  volume_this_week_kg: number;
  current_streak: number;
  heatmap: HeatmapDay[];
  weekly_days: WeeklyDayBreakdown[];
  recent_workouts: TrackedWorkout[];
}

export interface ProgressPoint {
  workout_date: string;
  workout_id: string;
  best_weight_kg: number;
  best_reps: number;
  estimated_1rm: number;
  volume_kg: number;
  best_rpe: number | null;
}

export interface ExerciseProgress {
  exercise: Exercise;
  points: ProgressPoint[];
  personal_best_weight_kg: number;
  personal_best_estimated_1rm: number;
}

export interface CsvImportResult {
  workouts_created: number;
  exercises_created: number;
  sets_imported: number;
  warnings: string[];
}
