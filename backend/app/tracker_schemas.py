from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .models import (
    ExerciseKind,
    MuscleRole,
    PersonalRecordType,
    SetType,
    TrainingMode,
    WorkoutCategory,
)


class MuscleContributionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    muscle_name: str
    role: MuscleRole
    contribution_factor: float


class ExerciseCreate(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    category: WorkoutCategory
    kind: ExerciseKind = ExerciseKind.STRENGTH
    muscle_group: str = Field(min_length=1, max_length=100)
    equipment: str | None = Field(default=None, max_length=100)

    @field_validator("name", "muscle_group", "equipment", mode="before")
    @classmethod
    def clean_strings(cls, value: str | None) -> str | None:
        return value.strip() or None if isinstance(value, str) else value


class ExerciseRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    category: WorkoutCategory
    kind: ExerciseKind
    muscle_group: str
    equipment: str | None
    is_custom: bool
    is_favorite: bool
    muscle_contributions: list[MuscleContributionRead] = []


class ExerciseFavoriteUpdate(BaseModel):
    is_favorite: bool


class MachinePhotoCaptionUpdate(BaseModel):
    caption: str = Field(min_length=1, max_length=160)

    @field_validator("caption", mode="before")
    @classmethod
    def clean_caption(cls, value: str) -> str:
        return value.strip() if isinstance(value, str) else value


class MachinePhotoRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    exercise_id: str
    caption: str
    thumbnail_url: str
    full_url: str
    width: int
    height: int
    created_at: datetime


class WorkoutSetCreate(BaseModel):
    reps: int | None = Field(default=None, ge=0, le=10_000)
    weight_kg: float | None = Field(default=None, ge=0, le=10_000)
    rpe: float | None = Field(default=None, ge=1, le=10)
    rest_seconds: int | None = Field(default=None, ge=0, le=7_200)
    duration_seconds: int | None = Field(default=None, ge=0, le=172_800)
    distance_km: float | None = Field(default=None, ge=0, le=10_000)
    bodyweight_kg: float | None = Field(default=None, ge=0, le=1_000)
    percentile: float | None = Field(default=None, ge=0, le=100)
    warmup: bool = False
    set_type: SetType = SetType.NORMAL
    failed: bool = False
    target_reps: int | None = Field(default=None, ge=0, le=10_000)
    notes: str | None = Field(default=None, max_length=2_000)
    completed: bool = True

    @field_validator("notes", mode="before")
    @classmethod
    def clean_notes(cls, value: str | None) -> str | None:
        return value.strip() or None if isinstance(value, str) else value

    @model_validator(mode="after")
    def synchronize_warmup(self) -> WorkoutSetCreate:
        if self.warmup:
            self.set_type = SetType.WARMUP
        self.warmup = self.set_type == SetType.WARMUP
        return self


class WorkoutMovementCreate(BaseModel):
    exercise_id: str
    notes: str | None = Field(default=None, max_length=2_000)
    machine_photo_ids: list[str] = Field(default_factory=list, max_length=20)
    superset_key: str | None = Field(default=None, max_length=50)
    sets: list[WorkoutSetCreate] = Field(min_length=1, max_length=100)

    @field_validator("notes", mode="before")
    @classmethod
    def clean_notes(cls, value: str | None) -> str | None:
        return value.strip() or None if isinstance(value, str) else value

    @field_validator("machine_photo_ids")
    @classmethod
    def unique_machine_photos(cls, value: list[str]) -> list[str]:
        if len(value) != len(set(value)):
            raise ValueError("Machine photos cannot be pinned more than once.")
        return value


class TrainingWorkoutCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    workout_date: date
    category: WorkoutCategory
    notes: str | None = Field(default=None, max_length=10_000)
    duration_minutes: int | None = Field(default=None, ge=0, le=1_440)
    movements: list[WorkoutMovementCreate] = Field(min_length=1, max_length=100)

    @field_validator("name", "notes", mode="before")
    @classmethod
    def clean_strings(cls, value: str | None) -> str | None:
        return value.strip() or None if isinstance(value, str) else value

    @model_validator(mode="after")
    def require_completed_set(self) -> TrainingWorkoutCreate:
        if not any(item.completed for movement in self.movements for item in movement.sets):
            raise ValueError("A workout must contain at least one completed set.")
        exercise_ids = [movement.exercise_id for movement in self.movements]
        if len(exercise_ids) != len(set(exercise_ids)):
            raise ValueError("An exercise can only be added once per workout.")
        return self


class WorkoutSetRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    order_index: int
    reps: int | None
    weight_kg: float | None
    rpe: float | None
    rest_seconds: int | None
    duration_seconds: int | None
    distance_km: float | None
    bodyweight_kg: float | None
    percentile: float | None
    warmup: bool
    set_type: SetType
    failed: bool
    target_reps: int | None
    notes: str | None
    completed: bool


class WorkoutMovementRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    order_index: int
    notes: str | None
    exercise: ExerciseRead
    machine_photos: list[MachinePhotoRead] = []
    superset_group_id: str | None
    superset_name: str | None = None
    sets: list[WorkoutSetRead] = []


class TrainingWorkoutRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    workout_date: date
    category: WorkoutCategory
    notes: str | None
    duration_minutes: int | None
    is_sample: bool
    created_at: datetime
    updated_at: datetime
    movements: list[WorkoutMovementRead] = []


class CalendarExerciseRead(BaseModel):
    exercise_name: str
    set_count: int
    bodyweight_kg: float | None


class CalendarWorkoutRead(BaseModel):
    id: str
    name: str
    category: WorkoutCategory
    duration_minutes: int | None
    exercises: list[CalendarExerciseRead]


class HeatmapDay(BaseModel):
    workout_date: date
    categories: list[WorkoutCategory]
    workout_count: int
    set_count: int
    workouts: list[CalendarWorkoutRead]


class WeeklyExerciseBreakdown(BaseModel):
    exercise_id: str
    exercise_name: str
    muscle_group: str
    category: WorkoutCategory
    set_count: int
    volume_kg: float


class WeeklyDayBreakdown(BaseModel):
    workout_date: date
    workout_count: int
    total_sets: int
    volume_kg: float
    workout_names: list[str]
    categories: list[WorkoutCategory]
    exercises: list[WeeklyExerciseBreakdown]


class MuscleFrequencyRead(BaseModel):
    muscle_group: str
    sessions_last_7_days: int
    target_sessions: int


class WorkoutRecommendationRead(BaseModel):
    category: WorkoutCategory
    session_name: str
    rotation_next: WorkoutCategory
    reason: str
    muscle_frequency: list[MuscleFrequencyRead]


class TrainingModeUpdate(BaseModel):
    mode: TrainingMode
    effective_date: date = Field(default_factory=date.today)


class TrainingModeRead(BaseModel):
    mode: TrainingMode


class TrainingPhaseRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    start_date: date
    mode: TrainingMode
    created_at: datetime


class WeeklyMuscleGoalRead(BaseModel):
    muscle_group: str
    raw_sets: float
    effective_sets: float
    target_sets: int
    average_rpe: float | None
    status: Literal["below", "on_target", "above"]


class WeeklyGoalRead(BaseModel):
    mode: TrainingMode
    week_start: date
    week_end: date
    target_sets_per_muscle: int
    raw_sets: int
    effective_sets: float
    unrated_sets: int
    low_rpe_sets: int
    rpe_logging_percent: float
    overall_percent: float
    days_remaining: int
    muscle_groups: list[WeeklyMuscleGoalRead]


class BodyMeasurementCreate(BaseModel):
    measurement_date: date
    weight_kg: float = Field(gt=0, le=500)
    body_fat_pct: float | None = Field(default=None, ge=1, le=70)
    notes: str | None = Field(default=None, max_length=2_000)

    @field_validator("notes", mode="before")
    @classmethod
    def clean_notes(cls, value: str | None) -> str | None:
        return value.strip() or None if isinstance(value, str) else value


class BodyMeasurementRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    measurement_date: date
    weight_kg: float
    body_fat_pct: float | None
    notes: str | None
    is_sample: bool
    created_at: datetime


class BodyMeasurementCsvImportRead(BaseModel):
    measurements_created: int
    measurements_updated: int
    rows_imported: int


class BodyWeightGoalCreate(BaseModel):
    start_date: date
    target_date: date
    start_weight_kg: float = Field(gt=0, le=500)
    target_weight_kg: float = Field(gt=0, le=500)
    mode: TrainingMode
    active: bool = True

    @model_validator(mode="after")
    def dates_are_ordered(self) -> BodyWeightGoalCreate:
        if self.target_date < self.start_date:
            raise ValueError("Target date must be on or after the start date.")
        return self


class BodyWeightGoalRead(BodyWeightGoalCreate):
    model_config = ConfigDict(from_attributes=True)

    id: str
    created_at: datetime


class PersonalRecordRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    exercise_id: str
    workout_id: str
    set_id: str
    achieved_date: date
    record_type: PersonalRecordType
    value: float
    unit: str
    normalized_weight: float | None
    formula: str | None
    exercise_name: str | None = None


class MuscleVolumeRead(BaseModel):
    muscle_name: str
    set_total: float


class CardioSessionCreate(BaseModel):
    session_date: date
    activity_type: str = Field(min_length=1, max_length=100)
    duration_minutes: int = Field(gt=0, le=1_440)
    intensity: str | None = Field(default=None, max_length=100)
    zone: str | None = Field(default=None, max_length=30)
    qualifies_zone2: bool = False
    notes: str | None = Field(default=None, max_length=2_000)

    @field_validator("activity_type", "intensity", "zone", "notes", mode="before")
    @classmethod
    def clean_cardio_strings(cls, value: str | None) -> str | None:
        return value.strip() or None if isinstance(value, str) else value


class CardioSessionRead(CardioSessionCreate):
    model_config = ConfigDict(from_attributes=True)

    id: str
    created_at: datetime
    updated_at: datetime


class TrainingPreferencesUpdate(BaseModel):
    preferred_weight_unit: Literal["kg", "lb"]
    week_start: Literal["monday", "sunday", "saturday"]
    zone2_goal_minutes: int = Field(ge=1, le=10_080)


class TrainingPreferencesRead(TrainingPreferencesUpdate):
    pass


class Zone2WeekRead(BaseModel):
    week_start: date
    week_end: date
    goal_minutes: int
    completed_minutes: int
    remaining_minutes: int
    percentage: float
    complete: bool


class CardioOverviewRead(BaseModel):
    preferences: TrainingPreferencesRead
    current_week: Zone2WeekRead
    previous_weeks: list[Zone2WeekRead]
    sessions: list[CardioSessionRead]


class DashboardRead(BaseModel):
    workouts_this_week: int
    sets_this_week: int
    volume_this_week_kg: float
    current_streak: int
    heatmap: list[HeatmapDay]
    weekly_days: list[WeeklyDayBreakdown]
    recommendation: WorkoutRecommendationRead
    training_mode: TrainingMode
    weekly_goal: WeeklyGoalRead
    muscle_volume: list[MuscleVolumeRead]
    zone2: Zone2WeekRead
    recent_workouts: list[TrainingWorkoutRead]


class ProgressPoint(BaseModel):
    workout_date: date
    workout_id: str
    best_weight_kg: float
    best_reps: int
    estimated_1rm: float
    volume_kg: float
    best_rpe: float | None


class ExerciseProgressRead(BaseModel):
    exercise: ExerciseRead
    points: list[ProgressPoint]
    personal_best_weight_kg: float
    personal_best_estimated_1rm: float


class CsvImportRead(BaseModel):
    workouts_created: int
    exercises_created: int
    sets_imported: int
    warnings: list[str]
