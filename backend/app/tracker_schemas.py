from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .models import ExerciseKind, WorkoutCategory


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
    notes: str | None = Field(default=None, max_length=2_000)
    completed: bool = True

    @field_validator("notes", mode="before")
    @classmethod
    def clean_notes(cls, value: str | None) -> str | None:
        return value.strip() or None if isinstance(value, str) else value


class WorkoutMovementCreate(BaseModel):
    exercise_id: str
    notes: str | None = Field(default=None, max_length=2_000)
    sets: list[WorkoutSetCreate] = Field(min_length=1, max_length=100)

    @field_validator("notes", mode="before")
    @classmethod
    def clean_notes(cls, value: str | None) -> str | None:
        return value.strip() or None if isinstance(value, str) else value


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
    notes: str | None
    completed: bool


class WorkoutMovementRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    order_index: int
    notes: str | None
    exercise: ExerciseRead
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


class DashboardRead(BaseModel):
    workouts_this_week: int
    sets_this_week: int
    volume_this_week_kg: float
    current_streak: int
    heatmap: list[HeatmapDay]
    weekly_days: list[WeeklyDayBreakdown]
    recommendation: WorkoutRecommendationRead
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
