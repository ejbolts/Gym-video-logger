from __future__ import annotations

import enum
import uuid
from datetime import UTC, date, datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
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


def new_uuid() -> str:
    return str(uuid.uuid4())


def utc_now() -> datetime:
    return datetime.now(UTC)


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
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    movements: Mapped[list[WorkoutMovement]] = relationship(back_populates="exercise")


class TrainingWorkout(Base):
    __tablename__ = "training_workouts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    name: Mapped[str] = mapped_column(String(200))
    workout_date: Mapped[date] = mapped_column(Date)
    category: Mapped[WorkoutCategory] = mapped_column(Enum(WorkoutCategory, native_enum=False))
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    duration_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
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

    __table_args__ = (
        CheckConstraint(
            "duration_minutes IS NULL OR duration_minutes >= 0",
            name="training_workout_duration_nonnegative",
        ),
    )


class WorkoutMovement(Base):
    __tablename__ = "workout_movements"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    workout_id: Mapped[str] = mapped_column(ForeignKey("training_workouts.id", ondelete="CASCADE"))
    exercise_id: Mapped[str] = mapped_column(ForeignKey("exercises.id"))
    order_index: Mapped[int] = mapped_column(Integer)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    workout: Mapped[TrainingWorkout] = relationship(back_populates="movements")
    exercise: Mapped[Exercise] = relationship(back_populates="movements")
    sets: Mapped[list[WorkoutSet]] = relationship(
        back_populates="movement", cascade="all, delete-orphan", order_by="WorkoutSet.order_index"
    )

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
    bodyweight_kg: Mapped[float | None] = mapped_column(Float, nullable=True)
    percentile: Mapped[float | None] = mapped_column(Float, nullable=True)
    warmup: Mapped[bool] = mapped_column(Boolean, default=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    completed: Mapped[bool] = mapped_column(Boolean, default=True)

    movement: Mapped[WorkoutMovement] = relationship(back_populates="sets")

    __table_args__ = (
        UniqueConstraint("movement_id", "order_index", name="uq_workout_set_order"),
        CheckConstraint("order_index >= 0", name="workout_set_order_nonnegative"),
        CheckConstraint("reps IS NULL OR reps >= 0", name="workout_set_reps_nonnegative"),
        CheckConstraint(
            "weight_kg IS NULL OR weight_kg >= 0", name="workout_set_weight_nonnegative"
        ),
        CheckConstraint("rpe IS NULL OR (rpe >= 1 AND rpe <= 10)", name="workout_set_rpe_range"),
        CheckConstraint(
            "rest_seconds IS NULL OR rest_seconds >= 0", name="workout_set_rest_nonnegative"
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
