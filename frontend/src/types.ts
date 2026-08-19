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

export type TrainingMode = 'cut' | 'maintenance' | 'bulk';
export type SetType = 'warmup' | 'normal' | 'drop';
export type PersonalRecordType =
  'weight' | 'reps_at_weight' | 'estimated_1rm' | 'duration' | 'distance';

export interface MuscleContribution {
  muscle_name: string;
  role: 'primary' | 'secondary';
  contribution_factor: number;
}

export interface Exercise {
  id: string;
  name: string;
  category: WorkoutCategory;
  kind: ExerciseKind;
  muscle_group: string;
  equipment: string | null;
  is_custom: boolean;
  is_favorite: boolean;
  muscle_contributions: MuscleContribution[];
}

export interface MachinePhoto {
  id: string;
  exercise_id: string;
  caption: string;
  thumbnail_url: string;
  full_url: string;
  width: number;
  height: number;
  created_at: string;
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
  incline_percent: number | null;
  speed_kph: number | null;
  bodyweight_kg: number | null;
  percentile: number | null;
  warmup: boolean;
  set_type: SetType;
  failed: boolean;
  target_reps: number | null;
  notes: string | null;
  completed: boolean;
}

export interface TrackedMovement {
  id: string;
  order_index: number;
  notes: string | null;
  exercise: Exercise;
  sets: TrackedSet[];
  machine_photos: MachinePhoto[];
  superset_group_id: string | null;
  superset_name: string | null;
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

export interface WorkoutCacheRevision {
  revision: string;
}

export interface WorkoutSnapshot extends WorkoutCacheRevision {
  workouts: TrackedWorkout[];
}

export interface WorkoutSetInput {
  reps: number | null;
  weight_kg: number | null;
  rpe: number | null;
  rest_seconds: number | null;
  duration_seconds: number | null;
  distance_km: number | null;
  incline_percent?: number | null;
  speed_kph?: number | null;
  bodyweight_kg?: number | null;
  percentile?: number | null;
  warmup?: boolean;
  set_type?: SetType;
  failed?: boolean;
  target_reps?: number | null;
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
    machine_photo_ids: string[];
    superset_key?: string | null;
    sets: WorkoutSetInput[];
  }>;
}

export interface HeatmapDay {
  workout_date: string;
  categories: WorkoutCategory[];
  workout_count: number;
  set_count: number;
  workouts: Array<{
    id: string;
    name: string;
    category: WorkoutCategory;
    duration_minutes: number | null;
    exercises: Array<{
      exercise_name: string;
      set_count: number;
      bodyweight_kg: number | null;
    }>;
  }>;
}

export interface BodyMeasurement {
  id: string;
  measurement_date: string;
  weight_kg: number;
  body_fat_pct: number | null;
  notes: string | null;
  is_sample: boolean;
  created_at: string;
}

export interface BodyMeasurementCsvImportResult {
  measurements_created: number;
  measurements_updated: number;
  rows_imported: number;
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

export interface MuscleFrequency {
  muscle_group: string;
  sessions_last_7_days: number;
  target_sessions: number;
}

export interface WorkoutRecommendation {
  category: WorkoutCategory;
  session_name: string;
  rotation_next: WorkoutCategory;
  reason: string;
  muscle_frequency: MuscleFrequency[];
}

export interface MuscleGoalProgress {
  muscle_group: string;
  raw_sets: number;
  effective_sets: number;
  target_sets: number;
  average_rpe: number | null;
  status: 'below' | 'on_target' | 'above';
}

export interface WeeklyGoal {
  mode: TrainingMode;
  week_start: string;
  week_end: string;
  target_sets_per_muscle: number;
  raw_sets: number;
  effective_sets: number;
  unrated_sets: number;
  low_rpe_sets: number;
  rpe_logging_percent: number;
  overall_percent: number;
  days_remaining: number;
  muscle_groups: MuscleGoalProgress[];
}

export interface DashboardData {
  workouts_this_week: number;
  sets_this_week: number;
  volume_this_week_kg: number;
  current_streak: number;
  total_cardio_sessions: number;
  heatmap: HeatmapDay[];
  weekly_days: WeeklyDayBreakdown[];
  recommendation: WorkoutRecommendation;
  training_mode: TrainingMode;
  weekly_goal: WeeklyGoal;
  muscle_volume: MuscleVolume[];
  zone2: Zone2Week;
  recent_workouts: TrackedWorkout[];
}

export interface MuscleVolume {
  muscle_name: string;
  set_total: number;
}

export interface PersonalRecord {
  id: string;
  exercise_id: string;
  workout_id: string;
  set_id: string;
  achieved_date: string;
  record_type: PersonalRecordType;
  value: number;
  unit: string;
  normalized_weight: number | null;
  formula: string | null;
  exercise_name: string | null;
}

export interface TrainingPreferences {
  preferred_weight_unit: 'kg' | 'lb';
  week_start: 'monday' | 'sunday' | 'saturday';
  zone2_goal_minutes: number;
}

export interface Zone2Week {
  week_start: string;
  week_end: string;
  goal_minutes: number;
  completed_minutes: number;
  remaining_minutes: number;
  percentage: number;
  complete: boolean;
}

export interface CardioSessionInput {
  session_date: string;
  activity_type: string;
  duration_minutes: number;
  intensity: string | null;
  zone: string | null;
  qualifies_zone2: boolean;
  notes: string | null;
}

export interface CardioSession extends CardioSessionInput {
  id: string;
  source_workout_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CardioOverview {
  preferences: TrainingPreferences;
  current_week: Zone2Week;
  previous_weeks: Zone2Week[];
  sessions: CardioSession[];
}

export interface BodyWeightGoalInput {
  start_date: string;
  target_date: string;
  start_weight_kg: number;
  target_weight_kg: number;
  mode: TrainingMode;
  active: boolean;
}

export interface BodyWeightGoal extends BodyWeightGoalInput {
  id: string;
  created_at: string;
}

export interface TrainingPhase {
  id: string;
  start_date: string;
  mode: TrainingMode;
  created_at: string;
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
  body_measurements_created: number;
  body_measurements_updated: number;
  warnings: string[];
}
