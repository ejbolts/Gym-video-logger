from __future__ import annotations

import enum
import uuid
from datetime import UTC, date, datetime, time

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    Date,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    String,
    Table,
    Text,
    Time,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from .database import Base


class SessionStatus(enum.StrEnum):
    DRAFT = "draft"
    UPLOADING = "uploading"
    UPLOAD_FAILED = "upload_failed"
    QUEUED = "queued"
    NORMALIZING = "normalizing"
    STITCHING = "stitching"
    UPLOADING_TO_YOUTUBE = "uploading_to_youtube"
    YOUTUBE_PROCESSING = "youtube_processing"
    COMPLETE = "complete"
    FAILED = "failed"
    CANCELLED = "cancelled"


class ClipUploadStatus(enum.StrEnum):
    WAITING = "waiting"
    UPLOADING = "uploading"
    UPLOADED = "uploaded"
    FAILED = "failed"


class WorkoutCategory(enum.StrEnum):
    UPPER = "upper"
    LOWER = "lower"
    PUSH = "push"
    PULL = "pull"
    FULL_BODY = "full_body"
    CARDIO = "cardio"
    OTHER = "other"


class ExerciseKind(enum.StrEnum):
    STRENGTH = "strength"
    CARDIO = "cardio"


class TrainingMode(enum.StrEnum):
    CUT = "cut"
    MAINTENANCE = "maintenance"
    BULK = "bulk"


class SetType(enum.StrEnum):
    WARMUP = "warmup"
    NORMAL = "normal"
    DROP = "drop"


class MuscleRole(enum.StrEnum):
    PRIMARY = "primary"
    SECONDARY = "secondary"


class PersonalRecordType(enum.StrEnum):
    WEIGHT = "weight"
    REPS_AT_WEIGHT = "reps_at_weight"
    ESTIMATED_1RM = "estimated_1rm"
    DURATION = "duration"
    DISTANCE = "distance"


def new_uuid() -> str:
    return str(uuid.uuid4())


def utc_now() -> datetime:
    return datetime.now(UTC)


movement_machine_photos = Table(
    "movement_machine_photos",
    Base.metadata,
    Column(
        "movement_id",
        String(36),
        ForeignKey("workout_movements.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column(
        "machine_photo_id",
        String(36),
        ForeignKey("machine_photos.id", ondelete="RESTRICT"),
        primary_key=True,
    ),
)


class WorkoutSession(Base):
    __tablename__ = "sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    name: Mapped[str] = mapped_column(String(200))
    workout_date: Mapped[date] = mapped_column(Date)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[SessionStatus] = mapped_column(
        Enum(SessionStatus, native_enum=False), default=SessionStatus.DRAFT
    )
    expected_clip_count: Mapped[int] = mapped_column(Integer)
    uploaded_clip_count: Mapped[int] = mapped_column(Integer, default=0)
    processing_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    youtube_video_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    youtube_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    clips: Mapped[list[Clip]] = relationship(
        back_populates="session", cascade="all, delete-orphan", order_by="Clip.order_index"
    )
    timestamps: Mapped[list[Timestamp]] = relationship(
        back_populates="session", cascade="all, delete-orphan", order_by="Timestamp.order_index"
    )

    __table_args__ = (
        CheckConstraint("expected_clip_count > 0", name="expected_clip_count_positive"),
    )


class Clip(Base):
    __tablename__ = "clips"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    client_clip_id: Mapped[str] = mapped_column(String(36))
    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"))
    original_filename: Mapped[str] = mapped_column(String(500))
    stored_filename: Mapped[str] = mapped_column(String(200))
    order_index: Mapped[int] = mapped_column(Integer)
    exercise_label: Mapped[str | None] = mapped_column(String(200), nullable=True)
    file_size: Mapped[int] = mapped_column(Integer)
    upload_status: Mapped[ClipUploadStatus] = mapped_column(
        Enum(ClipUploadStatus, native_enum=False), default=ClipUploadStatus.WAITING
    )
    uploaded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    original_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    normalized_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    ai_metadata_json: Mapped[str] = mapped_column(Text, default="{}")

    session: Mapped[WorkoutSession] = relationship(back_populates="clips")
    timestamp: Mapped[Timestamp | None] = relationship(back_populates="clip")

    __table_args__ = (
        UniqueConstraint("session_id", "client_clip_id", name="uq_clip_client_id_per_session"),
        UniqueConstraint("session_id", "order_index", name="uq_clip_order_per_session"),
        CheckConstraint("order_index >= 0", name="clip_order_nonnegative"),
    )


class Timestamp(Base):
    __tablename__ = "timestamps"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"))
    clip_id: Mapped[str] = mapped_column(ForeignKey("clips.id", ondelete="CASCADE"), unique=True)
    order_index: Mapped[int] = mapped_column(Integer)
    label: Mapped[str] = mapped_column(String(300))
    start_seconds: Mapped[int] = mapped_column(Integer)
    youtube_url: Mapped[str | None] = mapped_column(String(500), nullable=True)

    session: Mapped[WorkoutSession] = relationship(back_populates="timestamps")
    clip: Mapped[Clip] = relationship(back_populates="timestamp")

    __table_args__ = (
        UniqueConstraint("session_id", "order_index", name="uq_timestamp_order_per_session"),
    )


class PushSubscription(Base):
    __tablename__ = "push_subscriptions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    endpoint: Mapped[str] = mapped_column(Text, unique=True)
    p256dh: Mapped[str] = mapped_column(String(200))
    auth: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class AppSetting(Base):
    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value: Mapped[str] = mapped_column(Text)


class TrainingPhase(Base):
    __tablename__ = "training_phases"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    start_date: Mapped[date] = mapped_column(Date, unique=True)
    mode: Mapped[TrainingMode] = mapped_column(Enum(TrainingMode, native_enum=False))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, server_default=func.now()
    )


class BodyMeasurement(Base):
    __tablename__ = "body_measurements"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    measurement_date: Mapped[date] = mapped_column(Date, unique=True)
    weight_kg: Mapped[float] = mapped_column(Float)
    body_fat_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_sample: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, server_default=func.now()
    )

    __table_args__ = (
        CheckConstraint("weight_kg > 0 AND weight_kg <= 500", name="body_weight_range"),
        CheckConstraint(
            "body_fat_pct IS NULL OR (body_fat_pct >= 1 AND body_fat_pct <= 70)",
            name="body_fat_range",
        ),
    )


class BodyWeightGoal(Base):
    __tablename__ = "body_weight_goals"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    start_date: Mapped[date] = mapped_column(Date)
    target_date: Mapped[date] = mapped_column(Date)
    start_weight_kg: Mapped[float] = mapped_column(Float)
    target_weight_kg: Mapped[float] = mapped_column(Float)
    mode: Mapped[TrainingMode] = mapped_column(Enum(TrainingMode, native_enum=False))
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, server_default=func.now()
    )

    __table_args__ = (
        CheckConstraint(
            "start_weight_kg > 0 AND target_weight_kg > 0", name="body_goal_weights_positive"
        ),
        CheckConstraint("target_date >= start_date", name="body_goal_dates_ordered"),
    )


class Exercise(Base):
    __tablename__ = "exercises"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    name: Mapped[str] = mapped_column(String(160), unique=True)
    category: Mapped[WorkoutCategory] = mapped_column(Enum(WorkoutCategory, native_enum=False))
    kind: Mapped[ExerciseKind] = mapped_column(
        Enum(ExerciseKind, native_enum=False), default=ExerciseKind.STRENGTH
    )
    muscle_group: Mapped[str] = mapped_column(String(100))
    equipment: Mapped[str | None] = mapped_column(String(100), nullable=True)
    is_custom: Mapped[bool] = mapped_column(Boolean, default=False)
    is_favorite: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    movements: Mapped[list[WorkoutMovement]] = relationship(back_populates="exercise")
    machine_photos: Mapped[list[MachinePhoto]] = relationship(
        back_populates="exercise", cascade="all, delete-orphan"
    )
    muscle_contributions: Mapped[list[ExerciseMuscleContribution]] = relationship(
        back_populates="exercise",
        cascade="all, delete-orphan",
        order_by="ExerciseMuscleContribution.muscle_name",
    )


class ExerciseMuscleContribution(Base):
    __tablename__ = "exercise_muscle_contributions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    exercise_id: Mapped[str] = mapped_column(
        ForeignKey("exercises.id", ondelete="CASCADE"), index=True
    )
    muscle_name: Mapped[str] = mapped_column(String(100))
    role: Mapped[MuscleRole] = mapped_column(Enum(MuscleRole, native_enum=False))
    contribution_factor: Mapped[float] = mapped_column(Float)

    exercise: Mapped[Exercise] = relationship(back_populates="muscle_contributions")

    __table_args__ = (
        UniqueConstraint("exercise_id", "muscle_name", name="uq_exercise_muscle"),
        CheckConstraint(
            "contribution_factor > 0 AND contribution_factor <= 1",
            name="exercise_muscle_factor_range",
        ),
    )


class MachinePhoto(Base):
    __tablename__ = "machine_photos"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    exercise_id: Mapped[str] = mapped_column(
        ForeignKey("exercises.id", ondelete="CASCADE"), index=True
    )
    caption: Mapped[str] = mapped_column(String(160))
    original_filename: Mapped[str] = mapped_column(String(500))
    full_filename: Mapped[str] = mapped_column(String(200), unique=True)
    thumbnail_filename: Mapped[str] = mapped_column(String(200), unique=True)
    media_type: Mapped[str] = mapped_column(String(100), default="image/webp")
    file_size: Mapped[int] = mapped_column(Integer)
    width: Mapped[int] = mapped_column(Integer)
    height: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, server_default=func.now()
    )

    exercise: Mapped[Exercise] = relationship(back_populates="machine_photos")
    movements: Mapped[list[WorkoutMovement]] = relationship(
        secondary=movement_machine_photos,
        back_populates="machine_photos",
    )

    @property
    def thumbnail_url(self) -> str:
        return f"/api/machine-photos/{self.id}/image?variant=thumbnail"

    @property
    def full_url(self) -> str:
        return f"/api/machine-photos/{self.id}/image?variant=full"

    __table_args__ = (
        CheckConstraint("file_size > 0", name="machine_photo_file_size_positive"),
        CheckConstraint("width > 0", name="machine_photo_width_positive"),
        CheckConstraint("height > 0", name="machine_photo_height_positive"),
    )


class TrainingWorkout(Base):
    __tablename__ = "training_workouts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    name: Mapped[str] = mapped_column(String(200))
    workout_date: Mapped[date] = mapped_column(Date)
    category: Mapped[WorkoutCategory] = mapped_column(Enum(WorkoutCategory, native_enum=False))
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    duration_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    start_time: Mapped[time | None] = mapped_column(Time, nullable=True)
    end_time: Mapped[time | None] = mapped_column(Time, nullable=True)
    is_sample: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, server_default=func.now(), onupdate=func.now()
    )

    movements: Mapped[list[WorkoutMovement]] = relationship(
        back_populates="workout",
        cascade="all, delete-orphan",
        order_by="WorkoutMovement.order_index",
    )
    superset_groups: Mapped[list[SupersetGroup]] = relationship(
        back_populates="workout", cascade="all, delete-orphan", order_by="SupersetGroup.order_index"
    )
    personal_records: Mapped[list[PersonalRecord]] = relationship(
        back_populates="workout", cascade="all, delete-orphan"
    )

    __table_args__ = (
        CheckConstraint(
            "duration_minutes IS NULL OR duration_minutes >= 0",
            name="training_workout_duration_nonnegative",
        ),
        CheckConstraint(
            "(start_time IS NULL AND end_time IS NULL) OR "
            "(start_time IS NOT NULL AND end_time IS NOT NULL)",
            name="training_workout_times_together",
        ),
    )


class WorkoutMovement(Base):
    __tablename__ = "workout_movements"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    workout_id: Mapped[str] = mapped_column(ForeignKey("training_workouts.id", ondelete="CASCADE"))
    exercise_id: Mapped[str] = mapped_column(ForeignKey("exercises.id"))
    order_index: Mapped[int] = mapped_column(Integer)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    superset_group_id: Mapped[str | None] = mapped_column(
        ForeignKey("superset_groups.id", ondelete="SET NULL"), nullable=True, index=True
    )

    workout: Mapped[TrainingWorkout] = relationship(back_populates="movements")
    exercise: Mapped[Exercise] = relationship(back_populates="movements")
    sets: Mapped[list[WorkoutSet]] = relationship(
        back_populates="movement", cascade="all, delete-orphan", order_by="WorkoutSet.order_index"
    )
    machine_photos: Mapped[list[MachinePhoto]] = relationship(
        secondary=movement_machine_photos,
        back_populates="movements",
        order_by="MachinePhoto.created_at",
    )
    superset_group: Mapped[SupersetGroup | None] = relationship(back_populates="movements")

    @property
    def superset_name(self) -> str | None:
        return self.superset_group.name if self.superset_group else None

    __table_args__ = (
        UniqueConstraint("workout_id", "order_index", name="uq_workout_movement_order"),
        CheckConstraint("order_index >= 0", name="workout_movement_order_nonnegative"),
    )


class WorkoutSet(Base):
    __tablename__ = "workout_sets"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    movement_id: Mapped[str] = mapped_column(ForeignKey("workout_movements.id", ondelete="CASCADE"))
    order_index: Mapped[int] = mapped_column(Integer)
    reps: Mapped[int | None] = mapped_column(Integer, nullable=True)
    weight_kg: Mapped[float | None] = mapped_column(Float, nullable=True)
    rpe: Mapped[float | None] = mapped_column(Float, nullable=True)
    rest_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    duration_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    distance_km: Mapped[float | None] = mapped_column(Float, nullable=True)
    incline_percent: Mapped[float | None] = mapped_column(Float, nullable=True)
    speed_kph: Mapped[float | None] = mapped_column(Float, nullable=True)
    bodyweight_kg: Mapped[float | None] = mapped_column(Float, nullable=True)
    percentile: Mapped[float | None] = mapped_column(Float, nullable=True)
    warmup: Mapped[bool] = mapped_column(Boolean, default=False)
    set_type: Mapped[SetType] = mapped_column(
        Enum(SetType, native_enum=False), default=SetType.NORMAL
    )
    failed: Mapped[bool] = mapped_column(Boolean, default=False)
    target_reps: Mapped[int | None] = mapped_column(Integer, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    completed: Mapped[bool] = mapped_column(Boolean, default=True)

    movement: Mapped[WorkoutMovement] = relationship(back_populates="sets")
    personal_records: Mapped[list[PersonalRecord]] = relationship(
        back_populates="workout_set", cascade="all, delete-orphan"
    )

    __table_args__ = (
        UniqueConstraint("movement_id", "order_index", name="uq_workout_set_order"),
        CheckConstraint("order_index >= 0", name="workout_set_order_nonnegative"),
        CheckConstraint("reps IS NULL OR reps >= 0", name="workout_set_reps_nonnegative"),
        CheckConstraint(
            "target_reps IS NULL OR target_reps >= 0", name="workout_set_target_reps_nonnegative"
        ),
        CheckConstraint(
            "weight_kg IS NULL OR weight_kg >= 0", name="workout_set_weight_nonnegative"
        ),
        CheckConstraint("rpe IS NULL OR (rpe >= 1 AND rpe <= 10)", name="workout_set_rpe_range"),
        CheckConstraint(
            "rest_seconds IS NULL OR rest_seconds >= 0", name="workout_set_rest_nonnegative"
        ),
        CheckConstraint(
            "incline_percent IS NULL OR (incline_percent >= 0 AND incline_percent <= 100)",
            name="workout_set_incline_range",
        ),
        CheckConstraint(
            "speed_kph IS NULL OR (speed_kph >= 0 AND speed_kph <= 100)",
            name="workout_set_speed_range",
        ),
        CheckConstraint(
            "bodyweight_kg IS NULL OR bodyweight_kg >= 0",
            name="workout_set_bodyweight_nonnegative",
        ),
        CheckConstraint(
            "percentile IS NULL OR (percentile >= 0 AND percentile <= 100)",
            name="workout_set_percentile_range",
        ),
    )


class SupersetGroup(Base):
    __tablename__ = "superset_groups"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    workout_id: Mapped[str] = mapped_column(
        ForeignKey("training_workouts.id", ondelete="CASCADE"), index=True
    )
    order_index: Mapped[int] = mapped_column(Integer)
    name: Mapped[str | None] = mapped_column(String(100), nullable=True)

    workout: Mapped[TrainingWorkout] = relationship(back_populates="superset_groups")
    movements: Mapped[list[WorkoutMovement]] = relationship(back_populates="superset_group")

    __table_args__ = (
        UniqueConstraint("workout_id", "order_index", name="uq_workout_superset_order"),
        CheckConstraint("order_index >= 0", name="superset_order_nonnegative"),
    )


class PersonalRecord(Base):
    __tablename__ = "personal_records"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    exercise_id: Mapped[str] = mapped_column(
        ForeignKey("exercises.id", ondelete="CASCADE"), index=True
    )
    workout_id: Mapped[str] = mapped_column(
        ForeignKey("training_workouts.id", ondelete="CASCADE"), index=True
    )
    set_id: Mapped[str] = mapped_column(
        ForeignKey("workout_sets.id", ondelete="CASCADE"), index=True
    )
    achieved_date: Mapped[date] = mapped_column(Date, index=True)
    record_type: Mapped[PersonalRecordType] = mapped_column(
        Enum(PersonalRecordType, native_enum=False)
    )
    value: Mapped[float] = mapped_column(Float)
    unit: Mapped[str] = mapped_column(String(30))
    normalized_weight: Mapped[float | None] = mapped_column(Float, nullable=True)
    formula: Mapped[str | None] = mapped_column(String(100), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, server_default=func.now()
    )

    exercise: Mapped[Exercise] = relationship()
    workout: Mapped[TrainingWorkout] = relationship(back_populates="personal_records")
    workout_set: Mapped[WorkoutSet] = relationship(back_populates="personal_records")

    @property
    def exercise_name(self) -> str:
        return self.exercise.name

    __table_args__ = (
        UniqueConstraint(
            "set_id", "record_type", "normalized_weight", name="uq_pr_set_type_weight"
        ),
        CheckConstraint("value >= 0", name="personal_record_value_nonnegative"),
    )


class CardioSession(Base):
    __tablename__ = "cardio_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    session_date: Mapped[date] = mapped_column(Date, index=True)
    activity_type: Mapped[str] = mapped_column(String(100))
    duration_minutes: Mapped[int] = mapped_column(Integer)
    intensity: Mapped[str | None] = mapped_column(String(100), nullable=True)
    zone: Mapped[str | None] = mapped_column(String(30), nullable=True)
    qualifies_zone2: Mapped[bool] = mapped_column(Boolean, default=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_workout_id: Mapped[str | None] = mapped_column(
        ForeignKey("training_workouts.id", ondelete="CASCADE"), nullable=True, index=True
    )
    source_movement_index: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        CheckConstraint(
            "duration_minutes > 0 AND duration_minutes <= 1440", name="cardio_duration_range"
        ),
        CheckConstraint(
            "(source_workout_id IS NULL AND source_movement_index IS NULL) OR "
            "(source_workout_id IS NOT NULL AND source_movement_index IS NOT NULL)",
            name="cardio_source_fields_together",
        ),
        UniqueConstraint(
            "source_workout_id",
            "source_movement_index",
            name="uq_cardio_source_workout_movement",
        ),
    )
