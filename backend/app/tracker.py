from __future__ import annotations

import uuid
from collections import defaultdict
from datetime import date, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, Response
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from .account_limits import (
    CARDIO_NOT_SAVED,
    EXERCISE_NOT_CREATED,
    IMPORT_NOT_SAVED,
    PHOTO_NOT_UPLOADED,
    WORKOUT_NOT_SAVED,
    AccountLimits,
    check_account_total,
    check_workout_size,
    limit_save_rate,
    load_account_limits,
    refuse,
)
from .auth import CurrentUser, get_current_user
from .body_measurement_csv import export_body_measurements, import_body_measurements
from .cardio_energy import cardio_energy_periods
from .cardio_ocr import CardioScreenshotError, scan_cardio_screenshot
from .config import Settings, get_settings
from .database import get_db
from .errors import api_error
from .exercise_aliases import canonical_exercise_name
from .models import (
    BodyMeasurement,
    BodyWeightGoal,
    CardioSession,
    Exercise,
    ExerciseKind,
    MachinePhoto,
    PersonalRecord,
    SupersetGroup,
    TrainingWorkout,
    User,
    WorkoutCategory,
    WorkoutMovement,
    WorkoutSet,
    movement_machine_photos,
)
from .photo_storage import (
    PhotoValidationError,
    delete_machine_photo_files,
    store_machine_photo,
)
from .processing import backfill_completed_video_links
from .tracker_csv import CsvImportError, export_workouts, import_workouts
from .tracker_schemas import (
    BodyMeasurementCreate,
    BodyMeasurementCsvImportRead,
    BodyMeasurementRead,
    BodyWeightGoalCreate,
    BodyWeightGoalRead,
    CalendarExerciseRead,
    CalendarWorkoutRead,
    CardioCaloriesUpdate,
    CardioMetricsUpdate,
    CardioOverviewRead,
    CardioScreenshotRead,
    CardioSessionCreate,
    CardioSessionRead,
    CsvImportRead,
    DashboardRead,
    ExerciseCreate,
    ExerciseFavoriteUpdate,
    ExerciseProgressRead,
    ExerciseRead,
    HeatmapDay,
    MachinePhotoCaptionUpdate,
    MachinePhotoRead,
    MuscleFrequencyRead,
    MuscleVolumeRead,
    PersonalRecordRead,
    ProgressPoint,
    TrainingPreferencesRead,
    TrainingPreferencesUpdate,
    TrainingWorkoutCreate,
    TrainingWorkoutRead,
    WeeklyDayBreakdown,
    WeeklyExerciseBreakdown,
    WeeklyMuscleSetsRead,
    WeeklySetsRead,
    WorkoutCacheRevisionRead,
    WorkoutRecommendationRead,
    WorkoutSnapshotRead,
    WorkoutTypeColors,
    Zone2WeekRead,
)
from .training_metrics import (
    estimated_one_rep_max,
    get_setting,
    is_pr_eligible,
    is_working_set,
    muscle_credits,
    muscle_volume,
    preferred_weight_unit,
    rebuild_personal_records,
    seed_muscle_mappings,
    set_setting,
    start_of_week,
)

router = APIRouter(
    prefix="/api",
    tags=["workout tracking"],
    dependencies=[Depends(get_current_user), Depends(limit_save_rate)],
)
DbSession = Annotated[Session, Depends(get_db)]
SettingsDependency = Annotated[Settings, Depends(get_settings)]
WORKOUT_CACHE_REVISION_KEY = "workout_cache_revision"
WORKOUT_TYPE_COLORS_KEY = "workout_type_colors"
DEFAULT_WORKOUT_TYPE_COLORS = WorkoutTypeColors(
    upper="#8b5cf6",
    lower="#f59e0b",
    push="#ef476f",
    pull="#3b82f6",
    full_body="#14b8a6",
    cardio="#22c55e",
    other="#94a3b8",
)


def workout_cache_revision(db: Session, user_id: str) -> str:
    return get_setting(db, user_id, WORKOUT_CACHE_REVISION_KEY, "0")


def bump_workout_cache_revision(db: Session, user_id: str) -> None:
    set_setting(db, user_id, WORKOUT_CACHE_REVISION_KEY, str(uuid.uuid4()))


def get_owned(db: Session, model, item_id: str, user_id: str):
    """Load a user-owned row by id; another user's row is indistinguishable from a missing one."""
    item = db.get(model, item_id)
    return item if item is not None and item.user_id == user_id else None


DEFAULT_EXERCISES = (
    ("Barbell Bench Press", WorkoutCategory.PUSH, "Chest", "Barbell"),
    ("Incline Dumbbell Press", WorkoutCategory.PUSH, "Chest", "Dumbbell"),
    ("Overhead Press", WorkoutCategory.PUSH, "Shoulders", "Barbell"),
    ("Dumbbell Shoulder Press", WorkoutCategory.PUSH, "Shoulders", "Dumbbell"),
    ("Lateral Raise", WorkoutCategory.PUSH, "Shoulders", "Dumbbell"),
    ("Cable Fly", WorkoutCategory.PUSH, "Chest", "Cable"),
    ("Pec Deck", WorkoutCategory.PUSH, "Chest", "Machine"),
    ("Triceps Pushdown", WorkoutCategory.PUSH, "Triceps", "Cable"),
    (
        "Single-Arm Cable Triceps Pushdown",
        WorkoutCategory.PUSH,
        "Triceps",
        "Cable",
    ),
    ("Triceps Machine Extension", WorkoutCategory.PUSH, "Triceps", "Machine"),
    ("Dips", WorkoutCategory.PUSH, "Chest / Triceps", "Bodyweight"),
    ("Deadlift", WorkoutCategory.PULL, "Posterior chain", "Barbell"),
    ("Barbell Row", WorkoutCategory.PULL, "Mid / Upper Back", "Barbell"),
    ("Pull-up", WorkoutCategory.PULL, "Lats", "Bodyweight"),
    ("Lat Pulldown", WorkoutCategory.PULL, "Lats", "Cable"),
    ("Single-Arm Lat Pulldown (Machine)", WorkoutCategory.PULL, "Lats", "Machine"),
    ("Seated Cable Row", WorkoutCategory.PULL, "Mid / Upper Back", "Cable"),
    ("Seated Machine Row", WorkoutCategory.PULL, "Mid / Upper Back", "Machine"),
    ("Face Pull", WorkoutCategory.PULL, "Rear Delts", "Cable"),
    ("Cable Shoulder Extensions", WorkoutCategory.PULL, "Rear Delts", "Cable"),
    ("Barbell Curl", WorkoutCategory.PULL, "Biceps", "Barbell"),
    ("Machine Bicep Preacher Curl", WorkoutCategory.PULL, "Biceps", "Machine"),
    ("Single-Arm Preacher Curl", WorkoutCategory.PULL, "Biceps", "Dumbbell"),
    ("Hammer Curl", WorkoutCategory.PULL, "Biceps", "Dumbbell"),
    ("Back Squat", WorkoutCategory.LOWER, "Quads", "Barbell"),
    ("Front Squat", WorkoutCategory.LOWER, "Quads", "Barbell"),
    ("Romanian Deadlift", WorkoutCategory.LOWER, "Hamstrings", "Barbell"),
    ("Leg Press", WorkoutCategory.LOWER, "Quads", "Machine"),
    ("Single Leg Press", WorkoutCategory.LOWER, "Quads", "Machine"),
    ("Bulgarian Split Squat", WorkoutCategory.LOWER, "Quads", "Dumbbell"),
    ("Leg Extension", WorkoutCategory.LOWER, "Quads", "Machine"),
    ("Seated Leg Curl", WorkoutCategory.LOWER, "Hamstrings", "Machine"),
    ("Lying Leg Curl", WorkoutCategory.LOWER, "Hamstrings", "Machine"),
    ("Hip Thrust", WorkoutCategory.LOWER, "Glutes", "Barbell"),
    ("Standing Calf Raise", WorkoutCategory.LOWER, "Calves", "Machine"),
    ("Back Extension Machine", WorkoutCategory.LOWER, "Lower Back", "Machine"),
    ("Seated Ab Crunch Machine", WorkoutCategory.FULL_BODY, "Core", "Machine"),
    ("Plank", WorkoutCategory.FULL_BODY, "Core", "Bodyweight"),
    ("Hanging Leg Raise", WorkoutCategory.FULL_BODY, "Core", "Bodyweight"),
)

DEFAULT_CARDIO = (
    ("Running", "Cardio", "Outdoor / Treadmill"),
    ("Incline Treadmill Walking", "Cardio", "Treadmill"),
    ("Cycling", "Cardio", "Bike"),
    ("Cycling (Indoor)", "Cardio", "Stationary Bike"),
    ("Rowing", "Cardio", "Rowing machine"),
    ("Stair Climber", "Cardio", "Machine"),
    ("Walking", "Cardio", "Outdoor / Treadmill"),
)

TRAINING_ROTATION = (
    WorkoutCategory.PUSH,
    WorkoutCategory.PULL,
    WorkoutCategory.LOWER,
    WorkoutCategory.CARDIO,
)
SESSION_MUSCLE_GROUPS = {
    WorkoutCategory.PUSH: ("Pectorals", "Front delts", "Side delts", "Triceps"),
    WorkoutCategory.PULL: ("Lats", "Mid / Upper Back", "Rear deltoids", "Biceps", "Forearms"),
    WorkoutCategory.LOWER: ("Quadriceps", "Hamstrings", "Glutes", "Calves"),
    WorkoutCategory.CARDIO: ("Cardio",),
}
SESSION_NAMES = {
    WorkoutCategory.PUSH: "Push",
    WorkoutCategory.PULL: "Pull",
    WorkoutCategory.LOWER: "Legs",
    WorkoutCategory.CARDIO: "Cardio",
}


def exercise_muscle_credits(exercise: Exercise) -> list[tuple[str, float]]:
    if exercise.category == WorkoutCategory.CARDIO or exercise.kind == ExerciseKind.CARDIO:
        return []
    return muscle_credits(exercise)


def exercise_coverage_groups(exercise: Exercise) -> set[str]:
    if exercise.category == WorkoutCategory.CARDIO or exercise.kind == ExerciseKind.CARDIO:
        return {"Cardio"}
    return {group for group, _ in exercise_muscle_credits(exercise)}


def weekly_sets(
    workouts: list[TrainingWorkout], today: date, week_start_day: str = "monday"
) -> WeeklySetsRead:
    week_start = start_of_week(today, week_start_day)
    week_end = week_start + timedelta(days=6)
    active_start = today - timedelta(days=27)
    active_groups: set[str] = set()
    raw_by_group: dict[str, float] = defaultdict(float)
    effective_by_group: dict[str, float] = defaultdict(float)
    rpes_by_group: dict[str, list[float]] = defaultdict(list)
    raw_sets = 0
    rated_sets = 0
    unrated_sets = 0
    low_rpe_sets = 0

    for workout in workouts:
        if not active_start <= workout.workout_date <= today:
            continue
        in_current_week = week_start <= workout.workout_date <= today
        for movement in workout.movements:
            credits = exercise_muscle_credits(movement.exercise)
            if not credits:
                continue
            work_sets = [item for item in movement.sets if is_working_set(item)]
            if work_sets:
                active_groups.update(group for group, _ in credits)
            if not in_current_week:
                continue
            for item in work_sets:
                raw_sets += 1
                is_effective = item.rpe is None or item.rpe >= 7
                if item.rpe is None:
                    unrated_sets += 1
                else:
                    rated_sets += 1
                    if item.rpe < 7:
                        low_rpe_sets += 1
                for group, contribution in credits:
                    raw_by_group[group] += contribution
                    if is_effective:
                        effective_by_group[group] += contribution
                    if item.rpe is not None:
                        rpes_by_group[group].append(item.rpe)

    muscle_groups: list[WeeklyMuscleSetsRead] = []
    for group in sorted(active_groups):
        effective = round(effective_by_group[group], 1)
        group_rpes = rpes_by_group[group]
        muscle_groups.append(
            WeeklyMuscleSetsRead(
                muscle_group=group,
                raw_sets=round(raw_by_group[group], 1),
                effective_sets=effective,
                average_rpe=(round(sum(group_rpes) / len(group_rpes), 1) if group_rpes else None),
            )
        )

    return WeeklySetsRead(
        week_start=week_start,
        week_end=week_end,
        raw_sets=raw_sets,
        effective_sets=round(sum(item.effective_sets for item in muscle_groups), 1),
        unrated_sets=unrated_sets,
        low_rpe_sets=low_rpe_sets,
        rpe_logging_percent=round(rated_sets / raw_sets * 100, 1) if raw_sets else 0.0,
        muscle_groups=muscle_groups,
    )


def workout_recommendation(
    workouts: list[TrainingWorkout], today: date
) -> WorkoutRecommendationRead:
    recent_start = today - timedelta(days=6)
    group_dates: dict[str, set[date]] = defaultdict(set)
    for workout in workouts:
        if not recent_start <= workout.workout_date <= today:
            continue
        for movement in workout.movements:
            if not any(is_working_set(item) for item in movement.sets):
                continue
            for group in exercise_coverage_groups(movement.exercise):
                group_dates[group].add(workout.workout_date)

    last_rotation = next(
        (workout.category for workout in workouts if workout.category in TRAINING_ROTATION),
        None,
    )
    rotation_next = (
        WorkoutCategory.PUSH
        if last_rotation is None
        else TRAINING_ROTATION[
            (TRAINING_ROTATION.index(last_rotation) + 1) % len(TRAINING_ROTATION)
        ]
    )

    def candidate_score(category: WorkoutCategory) -> float:
        groups = SESSION_MUSCLE_GROUPS[category]
        target = 1 if category == WorkoutCategory.CARDIO else 2
        deficits = [max(0, target - len(group_dates[group])) for group in groups]
        days_since = [
            min((today - max(group_dates[group])).days, 7) if group_dates[group] else 7
            for group in groups
        ]
        coverage_need = sum(deficits) / len(groups)
        recovery_readiness = sum(days_since) / len(days_since) / 7
        rotation_bonus = 0.8 if category == rotation_next else 0
        return coverage_need * 2 + recovery_readiness + rotation_bonus

    recommended = max(TRAINING_ROTATION, key=candidate_score)
    target = 1 if recommended == WorkoutCategory.CARDIO else 2
    frequencies = [
        MuscleFrequencyRead(
            muscle_group=group,
            sessions_last_7_days=len(group_dates[group]),
            target_sessions=target,
        )
        for group in SESSION_MUSCLE_GROUPS[recommended]
    ]
    overdue = [item.muscle_group for item in frequencies if item.sessions_last_7_days < target]
    overdue_text = ", ".join(overdue[:3])
    if recommended == rotation_next:
        reason = "Next in your Push → Pull → Legs → Cardio rotation."
        if overdue_text:
            reason += f" {overdue_text} are also below their 7-day frequency target."
    else:
        reason = (
            f"{SESSION_NAMES[recommended]} moves ahead of {SESSION_NAMES[rotation_next]} because "
            f"{overdue_text or 'its muscle groups'} have the largest 7-day frequency gap."
        )
    return WorkoutRecommendationRead(
        category=recommended,
        session_name=f"{SESSION_NAMES[recommended]} workout",
        rotation_next=rotation_next,
        reason=reason,
        muscle_frequency=frequencies,
    )


def seed_default_exercises(db: Session, user_id: str) -> None:
    existing = {
        item.name.casefold(): item
        for item in db.scalars(select(Exercise).where(Exercise.user_id == user_id))
    }
    renamed_default = False
    legacy_leg_curl = existing.get("leg curl")
    seated_leg_curl = existing.get("seated leg curl")
    if legacy_leg_curl and not legacy_leg_curl.is_custom and not seated_leg_curl:
        legacy_leg_curl.name = "Seated Leg Curl"
        existing.pop("leg curl")
        existing["seated leg curl"] = legacy_leg_curl
        renamed_default = True
    legacy_single_arm_lat_pulldown = existing.get("single-arm lat pulldown")
    machine_single_arm_lat_pulldown = existing.get("single-arm lat pulldown (machine)")
    if (
        legacy_single_arm_lat_pulldown
        and not legacy_single_arm_lat_pulldown.is_custom
        and not machine_single_arm_lat_pulldown
    ):
        legacy_single_arm_lat_pulldown.name = "Single-Arm Lat Pulldown (Machine)"
        existing.pop("single-arm lat pulldown")
        existing["single-arm lat pulldown (machine)"] = legacy_single_arm_lat_pulldown
        renamed_default = True
    defaults = (
        *(
            (name, category, ExerciseKind.STRENGTH, muscle_group, equipment)
            for name, category, muscle_group, equipment in DEFAULT_EXERCISES
        ),
        *(
            (name, WorkoutCategory.CARDIO, ExerciseKind.CARDIO, muscle_group, equipment)
            for name, muscle_group, equipment in DEFAULT_CARDIO
        ),
    )
    for name, category, kind, muscle_group, equipment in defaults:
        exercise = existing.get(name.casefold())
        if exercise and not exercise.is_custom:
            exercise.category = category
            exercise.kind = kind
            exercise.muscle_group = muscle_group
            exercise.equipment = equipment
        elif not exercise:
            db.add(
                Exercise(
                    user_id=user_id,
                    name=name,
                    category=category,
                    kind=kind,
                    muscle_group=muscle_group,
                    equipment=equipment,
                )
            )
    if renamed_default:
        bump_workout_cache_revision(db, user_id)
    db.commit()
    seed_muscle_mappings(db, user_id)


def workout_options():
    return (
        selectinload(TrainingWorkout.movements)
        .selectinload(WorkoutMovement.exercise)
        .selectinload(Exercise.muscle_contributions),
        selectinload(TrainingWorkout.movements).selectinload(WorkoutMovement.sets),
        selectinload(TrainingWorkout.movements).selectinload(WorkoutMovement.machine_photos),
        selectinload(TrainingWorkout.movements).selectinload(WorkoutMovement.superset_group),
    )


def load_workout(db: Session, user_id: str, workout_id: str) -> TrainingWorkout:
    workout = db.scalar(
        select(TrainingWorkout)
        .where(TrainingWorkout.id == workout_id, TrainingWorkout.user_id == user_id)
        .options(*workout_options())
    )
    if not workout:
        raise HTTPException(status_code=404, detail="Workout was not found.")
    return workout


def replace_workout_contents(
    db: Session, user_id: str, workout: TrainingWorkout, payload: TrainingWorkoutCreate
) -> None:
    workout.name = payload.name
    workout.workout_date = payload.workout_date
    workout.category = payload.category
    workout.notes = payload.notes
    workout.duration_minutes = payload.duration_minutes
    workout.start_time = payload.start_time
    workout.end_time = payload.end_time
    workout.movements.clear()
    workout.superset_groups.clear()
    db.flush()
    group_counts: dict[str, int] = defaultdict(int)
    for movement_payload in payload.movements:
        if movement_payload.superset_key:
            group_counts[movement_payload.superset_key] += 1
    if any(count < 2 for count in group_counts.values()):
        raise HTTPException(
            status_code=422, detail="A superset must contain at least two exercises."
        )
    groups = {
        key: SupersetGroup(order_index=index, name=f"Superset {index + 1}")
        for index, key in enumerate(group_counts)
    }
    workout.superset_groups.extend(groups.values())
    db.flush()
    for movement_index, movement_payload in enumerate(payload.movements):
        exercise = get_owned(db, Exercise, movement_payload.exercise_id, user_id)
        if not exercise:
            raise HTTPException(
                status_code=422,
                detail=f"Exercise {movement_payload.exercise_id} was not found.",
            )
        movement = WorkoutMovement(
            exercise=exercise,
            order_index=movement_index,
            notes=movement_payload.notes,
            superset_group=groups.get(movement_payload.superset_key or ""),
        )
        if movement_payload.machine_photo_ids:
            photos = list(
                db.scalars(
                    select(MachinePhoto).where(
                        MachinePhoto.id.in_(movement_payload.machine_photo_ids),
                        MachinePhoto.user_id == user_id,
                    )
                )
            )
            photos_by_id = {photo.id: photo for photo in photos}
            missing = [
                photo_id
                for photo_id in movement_payload.machine_photo_ids
                if photo_id not in photos_by_id
            ]
            if missing:
                raise HTTPException(status_code=422, detail="A pinned machine photo was not found.")
            if any(photo.exercise_id != exercise.id for photo in photos):
                raise HTTPException(
                    status_code=422,
                    detail="Machine photos must belong to the movement's exercise.",
                )
            movement.machine_photos = [
                photos_by_id[photo_id] for photo_id in movement_payload.machine_photo_ids
            ]
        for set_index, set_payload in enumerate(movement_payload.sets):
            movement.sets.append(WorkoutSet(order_index=set_index, **set_payload.model_dump()))
        workout.movements.append(movement)


def sync_workout_cardio_sessions(db: Session, workout: TrainingWorkout) -> None:
    """Mirror completed cardio movements into the cardio-session ledger."""
    existing = {
        session.source_movement_index: session
        for session in db.scalars(
            select(CardioSession).where(CardioSession.source_workout_id == workout.id)
        )
    }
    imported_indexes: set[int] = set()
    manual_metrics_by_exercise = {
        session.source_exercise_id: {
            "calories_kcal": session.calories_kcal,
            "average_heart_rate_bpm": session.average_heart_rate_bpm,
            "average_power_watts": session.average_power_watts,
            "average_mets": session.average_mets,
        }
        for session in existing.values()
    }
    for movement in workout.movements:
        if movement.exercise.kind != ExerciseKind.CARDIO:
            continue
        duration_seconds = sum(
            item.duration_seconds or 0
            for item in movement.sets
            if item.completed and (item.duration_seconds or 0) > 0
        )
        duration_minutes = duration_seconds // 60
        if duration_minutes < 1:
            continue
        imported_indexes.add(movement.order_index)
        session = existing.get(movement.order_index)
        created = session is None
        if session is None:
            session = CardioSession(
                user_id=workout.user_id,
                source_workout_id=workout.id,
                source_movement_index=movement.order_index,
            )
            db.add(session)
        session.session_date = workout.workout_date
        session.activity_type = movement.exercise.name
        session.duration_minutes = duration_minutes
        session.source_exercise_id = movement.exercise_id
        completed_sets = [item for item in movement.sets if item.completed]
        manual_metrics = manual_metrics_by_exercise.get(movement.exercise_id, {})
        calorie_sets = [item for item in completed_sets if item.calories_kcal is not None]
        heart_rate_sets = [
            item for item in completed_sets if item.average_heart_rate_bpm is not None
        ]
        heart_rate_duration = sum(item.duration_seconds or 0 for item in heart_rate_sets)
        session.calories_kcal = (
            sum(item.calories_kcal for item in calorie_sets)
            if calorie_sets
            else manual_metrics.get("calories_kcal")
        )
        session.average_heart_rate_bpm = (
            round(
                sum(
                    item.average_heart_rate_bpm * (item.duration_seconds or 0)
                    for item in heart_rate_sets
                )
                / heart_rate_duration
            )
            if heart_rate_duration > 0
            else (
                round(
                    sum(item.average_heart_rate_bpm for item in heart_rate_sets)
                    / len(heart_rate_sets)
                )
                if heart_rate_sets
                else manual_metrics.get("average_heart_rate_bpm")
            )
        )
        session.average_power_watts = manual_metrics.get("average_power_watts")
        session.average_mets = manual_metrics.get("average_mets")
        distances = [item.distance_km for item in completed_sets if item.distance_km is not None]
        speed_sets = [item for item in completed_sets if item.speed_kph is not None]
        incline_sets = [item for item in completed_sets if item.incline_percent is not None]
        session.distance_km = round(sum(distances), 2) if distances else None
        session.average_speed_kph = (
            round(
                sum(item.speed_kph * (item.duration_seconds or 0) for item in speed_sets)
                / sum(item.duration_seconds or 0 for item in speed_sets),
                1,
            )
            if sum(item.duration_seconds or 0 for item in speed_sets) > 0
            else (
                round(sum(item.speed_kph for item in speed_sets) / len(speed_sets), 1)
                if speed_sets
                else None
            )
        )
        session.incline_percent = (
            round(
                sum(item.incline_percent * (item.duration_seconds or 0) for item in incline_sets)
                / sum(item.duration_seconds or 0 for item in incline_sets),
                1,
            )
            if sum(item.duration_seconds or 0 for item in incline_sets) > 0
            else (
                round(sum(item.incline_percent for item in incline_sets) / len(incline_sets), 1)
                if incline_sets
                else None
            )
        )
        session.intensity = "Imported from workout"
        if created:
            session.zone = "Zone 2"
            session.qualifies_zone2 = True
        session.notes = movement.notes
    for movement_index, session in existing.items():
        if movement_index not in imported_indexes:
            db.delete(session)


def sync_all_workout_cardio_sessions(db: Session, user_id: str | None = None) -> None:
    query = select(TrainingWorkout).options(*workout_options())
    if user_id is not None:
        query = query.where(TrainingWorkout.user_id == user_id)
    workouts = list(db.scalars(query))
    for workout in workouts:
        sync_workout_cardio_sessions(db, workout)


@router.get("/exercises", response_model=list[ExerciseRead])
def list_exercises(
    db: DbSession,
    user: CurrentUser,
    search: str | None = Query(default=None, max_length=100),
) -> list[Exercise]:
    query = select(Exercise).where(Exercise.user_id == user.id).order_by(Exercise.name)
    if search:
        query = query.where(Exercise.name.ilike(f"%{search.strip()}%"))
    return list(db.scalars(query))


@router.get("/body-measurements", response_model=list[BodyMeasurementRead])
def list_body_measurements(db: DbSession, user: CurrentUser) -> list[BodyMeasurement]:
    return list(
        db.scalars(
            select(BodyMeasurement)
            .where(BodyMeasurement.user_id == user.id)
            .order_by(BodyMeasurement.measurement_date.desc())
        )
    )


@router.post("/body-measurements", response_model=BodyMeasurementRead)
def save_body_measurement(
    payload: BodyMeasurementCreate, db: DbSession, user: CurrentUser
) -> BodyMeasurement:
    measurement = db.scalar(
        select(BodyMeasurement).where(
            BodyMeasurement.user_id == user.id,
            BodyMeasurement.measurement_date == payload.measurement_date,
        )
    )
    if measurement:
        measurement.weight_kg = payload.weight_kg
        measurement.body_fat_pct = payload.body_fat_pct
        measurement.notes = payload.notes
        measurement.is_sample = False
    else:
        measurement = BodyMeasurement(user_id=user.id, **payload.model_dump())
        db.add(measurement)
    db.commit()
    db.refresh(measurement)
    return measurement


@router.get("/body-measurements/export.csv")
def export_body_measurement_csv(
    db: DbSession,
    user: CurrentUser,
    start_date: date | None = None,
    end_date: date | None = None,
) -> Response:
    if start_date and end_date and start_date > end_date:
        raise HTTPException(status_code=422, detail="Start date must not be after end date.")
    statement = (
        select(BodyMeasurement)
        .where(BodyMeasurement.user_id == user.id)
        .order_by(BodyMeasurement.measurement_date)
    )
    if start_date:
        statement = statement.where(BodyMeasurement.measurement_date >= start_date)
    if end_date:
        statement = statement.where(BodyMeasurement.measurement_date <= end_date)
    measurements = list(db.scalars(statement))
    content = export_body_measurements(measurements)
    filename = f"body-weight-{date.today().isoformat()}.csv"
    return Response(
        content=content.encode("utf-8-sig"),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post(
    "/body-measurements/import",
    response_model=BodyMeasurementCsvImportRead,
    status_code=201,
)
async def import_body_measurement_csv(
    db: DbSession, user: CurrentUser, file: Annotated[UploadFile, File(...)]
) -> BodyMeasurementCsvImportRead:
    if file.content_type not in {
        None,
        "text/csv",
        "text/tab-separated-values",
        "text/plain",
        "application/vnd.ms-excel",
        "application/octet-stream",
    }:
        raise HTTPException(status_code=415, detail="Choose a CSV or tab-separated text file.")
    raw = await file.read(5 * 1024 * 1024 + 1)
    await file.close()
    if len(raw) > 5 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Body-weight CSV imports are limited to 5 MB.")
    try:
        summary = import_body_measurements(db, user.id, raw)
    except CsvImportError as error:
        db.rollback()
        raise HTTPException(status_code=422, detail=str(error)) from error
    db.commit()
    return BodyMeasurementCsvImportRead(**summary.__dict__)


@router.delete("/body-measurements/{measurement_id}", status_code=204)
def delete_body_measurement(measurement_id: str, db: DbSession, user: CurrentUser) -> None:
    measurement = get_owned(db, BodyMeasurement, measurement_id, user.id)
    if not measurement:
        raise HTTPException(status_code=404, detail="Body measurement was not found.")
    db.delete(measurement)
    db.commit()


@router.post("/exercises", response_model=ExerciseRead, status_code=201)
def create_exercise(
    payload: ExerciseCreate, db: DbSession, user: CurrentUser, settings: SettingsDependency
) -> Exercise:
    check_account_total(
        db,
        user,
        Exercise,
        load_account_limits(db, settings).custom_exercises_per_account,
        "custom_exercises_per_account",
        EXERCISE_NOT_CREATED,
        Exercise.is_custom.is_(True),
    )
    exercise_data = payload.model_dump()
    exercise_data["name"] = canonical_exercise_name(payload.name)
    exercise = Exercise(user_id=user.id, **exercise_data, is_custom=True)
    try:
        db.add(exercise)
        db.commit()
        db.refresh(exercise)
        return exercise
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(
            status_code=409, detail="An exercise with that name already exists."
        ) from error


@router.patch("/exercises/{exercise_id}/favorite", response_model=ExerciseRead)
def update_exercise_favorite(
    exercise_id: str, payload: ExerciseFavoriteUpdate, db: DbSession, user: CurrentUser
) -> Exercise:
    exercise = get_owned(db, Exercise, exercise_id, user.id)
    if not exercise:
        raise HTTPException(status_code=404, detail="Exercise was not found.")
    exercise.is_favorite = payload.is_favorite
    bump_workout_cache_revision(db, user.id)
    db.commit()
    db.refresh(exercise)
    return exercise


@router.get("/exercises/{exercise_id}/machine-photos", response_model=list[MachinePhotoRead])
def list_machine_photos(exercise_id: str, db: DbSession, user: CurrentUser) -> list[MachinePhoto]:
    if not get_owned(db, Exercise, exercise_id, user.id):
        raise HTTPException(status_code=404, detail="Exercise was not found.")
    return list(
        db.scalars(
            select(MachinePhoto)
            .where(MachinePhoto.exercise_id == exercise_id, MachinePhoto.user_id == user.id)
            .order_by(MachinePhoto.created_at.desc())
        )
    )


@router.get(
    "/exercises/{exercise_id}/machine-photos/last-used",
    response_model=list[MachinePhotoRead],
)
def last_used_machine_photos(
    exercise_id: str, db: DbSession, user: CurrentUser
) -> list[MachinePhoto]:
    if not get_owned(db, Exercise, exercise_id, user.id):
        raise HTTPException(status_code=404, detail="Exercise was not found.")
    movement_id = db.scalar(
        select(WorkoutMovement.id)
        .join(TrainingWorkout, WorkoutMovement.workout_id == TrainingWorkout.id)
        .join(
            movement_machine_photos,
            movement_machine_photos.c.movement_id == WorkoutMovement.id,
        )
        .where(WorkoutMovement.exercise_id == exercise_id, TrainingWorkout.user_id == user.id)
        .order_by(TrainingWorkout.workout_date.desc(), TrainingWorkout.created_at.desc())
        .limit(1)
    )
    if not movement_id:
        return []
    return list(
        db.scalars(
            select(MachinePhoto)
            .join(
                movement_machine_photos,
                movement_machine_photos.c.machine_photo_id == MachinePhoto.id,
            )
            .where(
                movement_machine_photos.c.movement_id == movement_id,
                MachinePhoto.user_id == user.id,
            )
            .order_by(MachinePhoto.created_at)
        )
    )


@router.post(
    "/exercises/{exercise_id}/machine-photos",
    response_model=MachinePhotoRead,
    status_code=201,
)
async def upload_machine_photo(
    exercise_id: str,
    db: DbSession,
    user: CurrentUser,
    settings: SettingsDependency,
    file: Annotated[UploadFile, File(...)],
    caption: Annotated[str, Form(min_length=1, max_length=160)],
) -> MachinePhoto:
    if not get_owned(db, Exercise, exercise_id, user.id):
        raise HTTPException(status_code=404, detail="Exercise was not found.")
    cleaned_caption = caption.strip()
    if not cleaned_caption:
        raise HTTPException(status_code=422, detail="Enter a machine name.")
    limits = load_account_limits(db, settings)
    check_account_total(
        db, user, MachinePhoto, limits.photos_per_account, "photos_per_account", PHOTO_NOT_UPLOADED
    )
    try:
        stored = await store_machine_photo(
            upload=file,
            settings=settings,
            max_bytes=limits.photo_upload_megabytes * 1024 * 1024,
        )
    except PhotoValidationError as error:
        raise api_error(error.status_code, error.code, error.message) from error

    photo = MachinePhoto(
        user_id=user.id,
        exercise_id=exercise_id,
        caption=cleaned_caption,
        original_filename=stored.original_filename,
        full_filename=stored.full_filename,
        thumbnail_filename=stored.thumbnail_filename,
        media_type="image/webp",
        file_size=stored.file_size,
        width=stored.width,
        height=stored.height,
    )
    try:
        db.add(photo)
        db.commit()
        db.refresh(photo)
        return photo
    except Exception:
        db.rollback()
        delete_machine_photo_files(settings, stored.full_filename, stored.thumbnail_filename)
        raise


@router.patch("/machine-photos/{photo_id}", response_model=MachinePhotoRead)
def update_machine_photo_caption(
    photo_id: str, payload: MachinePhotoCaptionUpdate, db: DbSession, user: CurrentUser
) -> MachinePhoto:
    photo = get_owned(db, MachinePhoto, photo_id, user.id)
    if not photo:
        raise HTTPException(status_code=404, detail="Machine photo was not found.")
    photo.caption = payload.caption
    bump_workout_cache_revision(db, user.id)
    db.commit()
    db.refresh(photo)
    return photo


@router.get("/machine-photos/{photo_id}/image")
def get_machine_photo_image(
    photo_id: str,
    db: DbSession,
    user: CurrentUser,
    settings: SettingsDependency,
    variant: str = Query(default="full", pattern="^(thumbnail|full)$"),
) -> FileResponse:
    photo = get_owned(db, MachinePhoto, photo_id, user.id)
    if not photo:
        raise HTTPException(status_code=404, detail="Machine photo was not found.")
    filename = photo.thumbnail_filename if variant == "thumbnail" else photo.full_filename
    root = settings.machine_photos_dir.resolve()
    path = (root / filename).resolve()
    if root not in path.parents or not path.is_file():
        raise HTTPException(status_code=404, detail="Machine photo file was not found.")
    return FileResponse(
        path,
        media_type=photo.media_type,
        headers={"Cache-Control": "private, max-age=31536000, immutable"},
    )


@router.delete("/machine-photos/{photo_id}", status_code=204)
def delete_machine_photo(
    photo_id: str, db: DbSession, user: CurrentUser, settings: SettingsDependency
) -> None:
    photo = get_owned(db, MachinePhoto, photo_id, user.id)
    if not photo:
        raise HTTPException(status_code=404, detail="Machine photo was not found.")
    reference = db.scalar(
        select(movement_machine_photos.c.movement_id)
        .where(movement_machine_photos.c.machine_photo_id == photo_id)
        .limit(1)
    )
    if reference:
        raise HTTPException(
            status_code=409,
            detail="Remove this photo from its workouts before deleting it.",
        )
    full_filename = photo.full_filename
    thumbnail_filename = photo.thumbnail_filename
    db.delete(photo)
    db.commit()
    delete_machine_photo_files(settings, full_filename, thumbnail_filename)


def training_preferences(db: Session, user_id: str) -> TrainingPreferencesRead:
    unit = preferred_weight_unit(db, user_id)
    week_start_value = get_setting(db, user_id, "week_start", "monday")
    if week_start_value not in {"monday", "sunday", "saturday"}:
        week_start_value = "monday"
    try:
        zone2_goal = max(1, int(get_setting(db, user_id, "zone2_goal_minutes", "150")))
    except ValueError:
        zone2_goal = 150
    return TrainingPreferencesRead(
        preferred_weight_unit=unit,
        week_start=week_start_value,
        zone2_goal_minutes=zone2_goal,
    )


def zone2_week(
    sessions: list[CardioSession],
    week: date,
    goal: int,
) -> Zone2WeekRead:
    end = week + timedelta(days=6)
    session_minutes = sum(
        item.duration_minutes
        for item in sessions
        if item.qualifies_zone2 and week <= item.session_date <= min(end, date.today())
    )
    completed = session_minutes
    return Zone2WeekRead(
        week_start=week,
        week_end=end,
        goal_minutes=goal,
        completed_minutes=completed,
        remaining_minutes=max(0, goal - completed),
        percentage=round(min(completed / goal * 100, 100), 1),
        complete=completed >= goal,
    )


@router.get("/training-preferences", response_model=TrainingPreferencesRead)
def get_training_preferences(db: DbSession, user: CurrentUser) -> TrainingPreferencesRead:
    return training_preferences(db, user.id)


@router.get("/workout-type-colors", response_model=WorkoutTypeColors)
def get_workout_type_colors(db: DbSession, user: CurrentUser) -> WorkoutTypeColors:
    stored = get_setting(db, user.id, WORKOUT_TYPE_COLORS_KEY, "")
    if stored:
        try:
            return WorkoutTypeColors.model_validate_json(stored)
        except ValueError:
            pass
    return DEFAULT_WORKOUT_TYPE_COLORS


@router.put("/workout-type-colors", response_model=WorkoutTypeColors)
def update_workout_type_colors(
    payload: WorkoutTypeColors, db: DbSession, user: CurrentUser
) -> WorkoutTypeColors:
    set_setting(db, user.id, WORKOUT_TYPE_COLORS_KEY, payload.model_dump_json())
    db.commit()
    return payload


@router.put("/training-preferences", response_model=TrainingPreferencesRead)
def update_training_preferences(
    payload: TrainingPreferencesUpdate, db: DbSession, user: CurrentUser
) -> TrainingPreferencesRead:
    set_setting(db, user.id, "preferred_weight_unit", payload.preferred_weight_unit)
    set_setting(db, user.id, "week_start", payload.week_start)
    set_setting(db, user.id, "zone2_goal_minutes", str(payload.zone2_goal_minutes))
    db.flush()
    rebuild_personal_records(db, user.id)
    db.commit()
    return training_preferences(db, user.id)


@router.get("/cardio", response_model=CardioOverviewRead)
def cardio_overview(db: DbSession, user: CurrentUser) -> CardioOverviewRead:
    preferences = training_preferences(db, user.id)
    sessions = list(
        db.scalars(
            select(CardioSession)
            .where(CardioSession.user_id == user.id)
            .options(
                selectinload(CardioSession.source_workout)
                .selectinload(TrainingWorkout.movements)
                .selectinload(WorkoutMovement.exercise)
            )
            .order_by(CardioSession.session_date.desc())
        )
    )
    current_start = start_of_week(date.today(), preferences.week_start)
    return CardioOverviewRead(
        preferences=preferences,
        current_week=zone2_week(sessions, current_start, preferences.zone2_goal_minutes),
        previous_weeks=[
            zone2_week(
                sessions,
                current_start - timedelta(days=7 * offset),
                preferences.zone2_goal_minutes,
            )
            for offset in range(1, 9)
        ],
        sessions=sessions,
        energy_periods=cardio_energy_periods(sessions, date.today(), preferences.week_start),
    )


@router.post("/cardio/scan", response_model=CardioScreenshotRead)
async def scan_cardio_workout_screenshot(
    file: Annotated[UploadFile, File(...)],
) -> CardioScreenshotRead:
    try:
        parsed = await scan_cardio_screenshot(file)
    except CardioScreenshotError as error:
        raise HTTPException(status_code=error.status_code, detail=error.message) from error
    return CardioScreenshotRead(**parsed)


@router.post("/cardio", response_model=CardioSessionRead, status_code=201)
def create_cardio_session(
    payload: CardioSessionCreate, db: DbSession, user: CurrentUser, settings: SettingsDependency
) -> CardioSession:
    limits = load_account_limits(db, settings)
    check_account_total(
        db,
        user,
        CardioSession,
        limits.cardio_sessions_per_account,
        "cardio_sessions_per_account",
        CARDIO_NOT_SAVED,
    )
    if payload.exercise_id:
        check_account_total(
            db,
            user,
            TrainingWorkout,
            limits.workouts_per_account,
            "workouts_per_account",
            CARDIO_NOT_SAVED,
        )
        exercise = get_owned(db, Exercise, payload.exercise_id, user.id)
        if not exercise or exercise.kind != ExerciseKind.CARDIO:
            raise HTTPException(status_code=422, detail="Choose a cardio exercise.")

        workout = TrainingWorkout(
            user_id=user.id,
            name=f"{exercise.name} cardio",
            workout_date=payload.session_date,
            category=WorkoutCategory.CARDIO,
            notes=None,
            duration_minutes=payload.duration_minutes,
            start_time=None,
            end_time=None,
        )
        movement = WorkoutMovement(exercise=exercise, order_index=0, notes=payload.notes)
        movement.sets.append(
            WorkoutSet(
                order_index=0,
                duration_seconds=payload.duration_minutes * 60,
                distance_km=payload.distance_km,
                calories_kcal=payload.calories_kcal,
                average_heart_rate_bpm=payload.average_heart_rate_bpm,
                speed_kph=payload.average_speed_kph,
                incline_percent=payload.incline_percent,
                completed=True,
            )
        )
        workout.movements.append(movement)
        db.add(workout)
        db.flush()
        session = CardioSession(
            user_id=user.id,
            session_date=payload.session_date,
            activity_type=exercise.name,
            duration_minutes=payload.duration_minutes,
            calories_kcal=payload.calories_kcal,
            average_heart_rate_bpm=payload.average_heart_rate_bpm,
            distance_km=payload.distance_km,
            average_speed_kph=payload.average_speed_kph,
            incline_percent=payload.incline_percent,
            average_power_watts=payload.average_power_watts,
            average_mets=payload.average_mets,
            source_exercise_id=exercise.id,
            intensity=None,
            zone=payload.zone,
            qualifies_zone2=payload.zone == "Zone 2",
            notes=payload.notes,
            source_workout_id=workout.id,
            source_movement_index=0,
        )
        db.add(session)
        rebuild_personal_records(db, user.id)
        bump_workout_cache_revision(db, user.id)
        db.commit()
        db.refresh(session)
        return session

    session = CardioSession(user_id=user.id, **payload.model_dump(exclude={"exercise_id"}))
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


@router.put("/cardio/{session_id}", response_model=CardioSessionRead)
def update_cardio_session(
    session_id: str, payload: CardioSessionCreate, db: DbSession, user: CurrentUser
) -> CardioSession:
    session = get_owned(db, CardioSession, session_id, user.id)
    if not session:
        raise HTTPException(status_code=404, detail="Cardio session was not found.")
    if session.source_workout_id:
        raise HTTPException(status_code=409, detail="Edit imported cardio in its workout.")
    optional_metrics = {
        "calories_kcal",
        "average_heart_rate_bpm",
        "distance_km",
        "average_speed_kph",
        "incline_percent",
        "average_power_watts",
        "average_mets",
    }
    for key, value in payload.model_dump(exclude={"exercise_id"}).items():
        if key in optional_metrics and key not in payload.model_fields_set:
            continue
        setattr(session, key, value)
    db.commit()
    db.refresh(session)
    return session


@router.patch("/cardio/{session_id}/calories", response_model=CardioSessionRead)
def update_cardio_calories(
    session_id: str, payload: CardioCaloriesUpdate, db: DbSession, user: CurrentUser
) -> CardioSession:
    session = get_owned(db, CardioSession, session_id, user.id)
    if not session:
        raise HTTPException(status_code=404, detail="Cardio session was not found.")
    session.calories_kcal = payload.calories_kcal
    if sync_cardio_session_metrics_to_workout_sets(db, session, {"calories_kcal"}):
        rebuild_personal_records(db, user.id)
        bump_workout_cache_revision(db, user.id)
    db.commit()
    db.refresh(session)
    return session


def sync_cardio_session_metrics_to_workout_sets(
    db: Session, session: CardioSession, fields: set[str]
) -> bool:
    workout_set_fields = {
        "calories_kcal",
        "average_heart_rate_bpm",
        "distance_km",
        "average_speed_kph",
        "incline_percent",
    }
    if not workout_set_fields.intersection(fields):
        return False
    if not session.source_workout_id:
        return False
    workout = load_workout(db, session.user_id, session.source_workout_id)
    movement = next(
        (item for item in workout.movements if item.order_index == session.source_movement_index),
        None,
    )
    if not movement:
        return False
    completed_sets = [item for item in movement.sets if item.completed]
    if not completed_sets:
        return False
    if "calories_kcal" in fields:
        total_duration = sum(item.duration_seconds or 0 for item in completed_sets)
        distributed_calories = 0
        for index, workout_set in enumerate(completed_sets):
            if session.calories_kcal is None:
                workout_set.calories_kcal = None
            elif index == len(completed_sets) - 1:
                workout_set.calories_kcal = session.calories_kcal - distributed_calories
            else:
                share = (
                    (workout_set.duration_seconds or 0) / total_duration
                    if total_duration
                    else 1 / len(completed_sets)
                )
                workout_set.calories_kcal = round(session.calories_kcal * share)
                distributed_calories += workout_set.calories_kcal
    if "average_heart_rate_bpm" in fields:
        for workout_set in completed_sets:
            workout_set.average_heart_rate_bpm = session.average_heart_rate_bpm
    if "distance_km" in fields:
        total_duration = sum(item.duration_seconds or 0 for item in completed_sets)
        distributed_distance = 0.0
        for index, workout_set in enumerate(completed_sets):
            if session.distance_km is None:
                workout_set.distance_km = None
            elif index == len(completed_sets) - 1:
                workout_set.distance_km = round(session.distance_km - distributed_distance, 3)
            else:
                share = (
                    (workout_set.duration_seconds or 0) / total_duration
                    if total_duration
                    else 1 / len(completed_sets)
                )
                workout_set.distance_km = round(session.distance_km * share, 3)
                distributed_distance += workout_set.distance_km
    if "average_speed_kph" in fields:
        for workout_set in completed_sets:
            workout_set.speed_kph = session.average_speed_kph
    if "incline_percent" in fields:
        for workout_set in completed_sets:
            workout_set.incline_percent = session.incline_percent
    return True


@router.patch("/cardio/{session_id}/metrics", response_model=CardioSessionRead)
def update_cardio_metrics(
    session_id: str, payload: CardioMetricsUpdate, db: DbSession, user: CurrentUser
) -> CardioSession:
    session = get_owned(db, CardioSession, session_id, user.id)
    if not session:
        raise HTTPException(status_code=404, detail="Cardio session was not found.")
    for key in payload.model_fields_set:
        setattr(session, key, getattr(payload, key))
    if sync_cardio_session_metrics_to_workout_sets(db, session, payload.model_fields_set):
        rebuild_personal_records(db, user.id)
        bump_workout_cache_revision(db, user.id)
    db.commit()
    db.refresh(session)
    return session


@router.delete("/cardio/{session_id}", status_code=204)
def delete_cardio_session(session_id: str, db: DbSession, user: CurrentUser) -> None:
    session = get_owned(db, CardioSession, session_id, user.id)
    if not session:
        raise HTTPException(status_code=404, detail="Cardio session was not found.")
    if session.source_workout_id:
        raise HTTPException(status_code=409, detail="Delete imported cardio from its workout.")
    db.delete(session)
    db.commit()


@router.get("/body-weight-goals", response_model=list[BodyWeightGoalRead])
def list_body_weight_goals(db: DbSession, user: CurrentUser) -> list[BodyWeightGoal]:
    return list(
        db.scalars(
            select(BodyWeightGoal)
            .where(BodyWeightGoal.user_id == user.id)
            .order_by(BodyWeightGoal.created_at.desc())
        )
    )


@router.post("/body-weight-goals", response_model=BodyWeightGoalRead, status_code=201)
def create_body_weight_goal(
    payload: BodyWeightGoalCreate, db: DbSession, user: CurrentUser
) -> BodyWeightGoal:
    if payload.active:
        for existing_goal in db.scalars(
            select(BodyWeightGoal).where(
                BodyWeightGoal.user_id == user.id, BodyWeightGoal.active.is_(True)
            )
        ):
            existing_goal.active = False
    goal = BodyWeightGoal(user_id=user.id, **payload.model_dump())
    db.add(goal)
    db.commit()
    db.refresh(goal)
    return goal


@router.put("/body-weight-goals/{goal_id}", response_model=BodyWeightGoalRead)
def update_body_weight_goal(
    goal_id: str, payload: BodyWeightGoalCreate, db: DbSession, user: CurrentUser
) -> BodyWeightGoal:
    goal = get_owned(db, BodyWeightGoal, goal_id, user.id)
    if not goal:
        raise HTTPException(status_code=404, detail="Body-weight goal was not found.")
    if payload.active:
        for other in db.scalars(
            select(BodyWeightGoal).where(
                BodyWeightGoal.user_id == user.id, BodyWeightGoal.active.is_(True)
            )
        ):
            if other.id != goal_id:
                other.active = False
    values = payload.model_dump()
    for key, value in values.items():
        setattr(goal, key, value)
    db.commit()
    db.refresh(goal)
    return goal


@router.delete("/body-weight-goals/{goal_id}", status_code=204)
def delete_body_weight_goal(goal_id: str, db: DbSession, user: CurrentUser) -> None:
    goal = get_owned(db, BodyWeightGoal, goal_id, user.id)
    if not goal:
        raise HTTPException(status_code=404, detail="Body-weight goal was not found.")
    db.delete(goal)
    db.commit()


@router.get("/personal-records", response_model=list[PersonalRecordRead])
def list_personal_records(
    db: DbSession,
    user: CurrentUser,
    exercise_id: str | None = None,
    workout_id: str | None = None,
) -> list[PersonalRecord]:
    query = (
        select(PersonalRecord)
        .where(PersonalRecord.user_id == user.id)
        .options(selectinload(PersonalRecord.exercise))
    )
    if exercise_id:
        query = query.where(PersonalRecord.exercise_id == exercise_id)
    if workout_id:
        query = query.where(PersonalRecord.workout_id == workout_id)
    return list(
        db.scalars(
            query.order_by(PersonalRecord.achieved_date.desc(), PersonalRecord.created_at.desc())
        )
    )


@router.get("/muscle-volume", response_model=list[MuscleVolumeRead])
def weekly_muscle_volume(
    db: DbSession,
    user: CurrentUser,
    start: date | None = None,
    end: date | None = None,
) -> list[MuscleVolumeRead]:
    end_date = end or date.today()
    start_date = start or start_of_week(end_date, training_preferences(db, user.id).week_start)
    if start_date > end_date:
        raise HTTPException(status_code=422, detail="Start date must not be after end date.")
    workouts = list(
        db.scalars(
            select(TrainingWorkout)
            .where(TrainingWorkout.user_id == user.id)
            .options(*workout_options())
        )
    )
    totals = muscle_volume(workouts, start_date, end_date)
    return [
        MuscleVolumeRead(muscle_name=name, set_total=value)
        for name, value in sorted(totals.items())
    ]


@router.get("/workouts", response_model=list[TrainingWorkoutRead])
def list_workouts(db: DbSession, user: CurrentUser) -> list[TrainingWorkout]:
    return list(
        db.scalars(
            select(TrainingWorkout)
            .where(TrainingWorkout.user_id == user.id)
            .options(*workout_options())
            .order_by(TrainingWorkout.workout_date.desc(), TrainingWorkout.created_at.desc())
        )
    )


@router.get("/workouts/revision", response_model=WorkoutCacheRevisionRead)
def get_workout_cache_revision(db: DbSession, user: CurrentUser) -> WorkoutCacheRevisionRead:
    return WorkoutCacheRevisionRead(revision=workout_cache_revision(db, user.id))


@router.get("/workouts/snapshot", response_model=WorkoutSnapshotRead)
def get_workout_snapshot(db: DbSession, user: CurrentUser) -> WorkoutSnapshotRead:
    return WorkoutSnapshotRead(
        revision=workout_cache_revision(db, user.id),
        workouts=list_workouts(db, user),
    )


@router.post("/workouts", response_model=TrainingWorkoutRead, status_code=201)
def create_workout(
    payload: TrainingWorkoutCreate, db: DbSession, user: CurrentUser, settings: SettingsDependency
) -> TrainingWorkout:
    limits = load_account_limits(db, settings)
    check_workout_size(payload, limits, user)
    check_account_total(
        db,
        user,
        TrainingWorkout,
        limits.workouts_per_account,
        "workouts_per_account",
        WORKOUT_NOT_SAVED,
    )
    workout = TrainingWorkout(
        user_id=user.id,
        name=payload.name,
        workout_date=payload.workout_date,
        category=payload.category,
        notes=payload.notes,
        duration_minutes=payload.duration_minutes,
        start_time=payload.start_time,
        end_time=payload.end_time,
    )
    db.add(workout)
    replace_workout_contents(db, user.id, workout, payload)
    db.flush()
    sync_workout_cardio_sessions(db, workout)
    rebuild_personal_records(db, user.id)
    bump_workout_cache_revision(db, user.id)
    db.commit()
    backfill_completed_video_links(db, workout.workout_date, user_id=user.id)
    return load_workout(db, user.id, workout.id)


@router.get("/workouts/export.csv")
def export_workout_csv(
    db: DbSession,
    user: CurrentUser,
    start_date: date | None = None,
    end_date: date | None = None,
) -> Response:
    if start_date and end_date and start_date > end_date:
        raise HTTPException(status_code=422, detail="Start date must not be after end date.")
    statement = (
        select(TrainingWorkout)
        .where(TrainingWorkout.user_id == user.id)
        .options(*workout_options())
        .order_by(TrainingWorkout.workout_date, TrainingWorkout.created_at)
    )
    if start_date:
        statement = statement.where(TrainingWorkout.workout_date >= start_date)
    if end_date:
        statement = statement.where(TrainingWorkout.workout_date <= end_date)
    workouts = list(db.scalars(statement))
    content = export_workouts(workouts)
    filename = f"gym-workouts-{date.today().isoformat()}.csv"
    return Response(
        content=content.encode("utf-8-sig"),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def check_imported_workouts(
    db: Session, user: User, limits: AccountLimits, existing_ids: set[str]
) -> None:
    """Hold an import to the same limits as saving workouts one by one."""
    if not user.is_admin:
        workouts = db.scalar(
            select(func.count(TrainingWorkout.id)).where(TrainingWorkout.user_id == user.id)
        )
        if workouts > limits.workouts_per_account:
            raise refuse(user, "workouts_per_account", IMPORT_NOT_SAVED)
        custom = db.scalar(
            select(func.count(Exercise.id)).where(
                Exercise.user_id == user.id, Exercise.is_custom.is_(True)
            )
        )
        if custom > limits.custom_exercises_per_account:
            raise refuse(user, "custom_exercises_per_account", IMPORT_NOT_SAVED)
    sizes = db.execute(
        select(
            TrainingWorkout.id,
            func.count(func.distinct(WorkoutMovement.id)),
            func.count(WorkoutSet.id),
        )
        .join(WorkoutMovement, WorkoutMovement.workout_id == TrainingWorkout.id)
        .join(WorkoutSet, WorkoutSet.movement_id == WorkoutMovement.id)
        .where(TrainingWorkout.user_id == user.id)
        .group_by(TrainingWorkout.id)
    )
    for workout_id, exercises, sets in sizes:
        if workout_id in existing_ids:
            continue
        if exercises > limits.exercises_per_workout:
            raise refuse(user, "exercises_per_workout", IMPORT_NOT_SAVED)
        if sets > limits.sets_per_workout:
            raise refuse(user, "sets_per_workout", IMPORT_NOT_SAVED)


@router.post("/workouts/import", response_model=CsvImportRead, status_code=201)
async def import_workout_csv(
    db: DbSession,
    user: CurrentUser,
    settings: SettingsDependency,
    file: Annotated[UploadFile, File(...)],
) -> CsvImportRead:
    if file.content_type not in {
        None,
        "text/csv",
        "text/tab-separated-values",
        "text/plain",
        "application/vnd.ms-excel",
        "application/octet-stream",
    }:
        raise HTTPException(status_code=415, detail="Choose a CSV or tab-separated text file.")
    raw = await file.read(20 * 1024 * 1024 + 1)
    await file.close()
    if len(raw) > 20 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="CSV imports are limited to 20 MB.")
    existing_ids = set(
        db.scalars(select(TrainingWorkout.id).where(TrainingWorkout.user_id == user.id))
    )
    try:
        summary = import_workouts(db, user.id, raw)
    except CsvImportError as error:
        db.rollback()
        raise HTTPException(status_code=422, detail=str(error)) from error
    try:
        check_imported_workouts(db, user, load_account_limits(db, settings), existing_ids)
    except HTTPException:
        db.rollback()
        raise
    rebuild_personal_records(db, user.id)
    bump_workout_cache_revision(db, user.id)
    db.commit()
    return CsvImportRead(**summary.__dict__)


@router.get("/workouts/{workout_id}", response_model=TrainingWorkoutRead)
def get_workout(workout_id: str, db: DbSession, user: CurrentUser) -> TrainingWorkout:
    return load_workout(db, user.id, workout_id)


@router.put("/workouts/{workout_id}", response_model=TrainingWorkoutRead)
def update_workout(
    workout_id: str,
    payload: TrainingWorkoutCreate,
    db: DbSession,
    user: CurrentUser,
    settings: SettingsDependency,
) -> TrainingWorkout:
    workout = load_workout(db, user.id, workout_id)
    check_workout_size(payload, load_account_limits(db, settings), user, existing=workout)
    replace_workout_contents(db, user.id, workout, payload)
    db.flush()
    sync_workout_cardio_sessions(db, workout)
    rebuild_personal_records(db, user.id)
    bump_workout_cache_revision(db, user.id)
    db.commit()
    backfill_completed_video_links(db, workout.workout_date, user_id=user.id)
    return load_workout(db, user.id, workout.id)


@router.delete("/workouts/{workout_id}", status_code=204)
def delete_workout(workout_id: str, db: DbSession, user: CurrentUser) -> None:
    workout = load_workout(db, user.id, workout_id)
    db.execute(delete(CardioSession).where(CardioSession.source_workout_id == workout.id))
    db.delete(workout)
    db.flush()
    rebuild_personal_records(db, user.id)
    bump_workout_cache_revision(db, user.id)
    db.commit()


@router.delete("/sample-data", status_code=204)
def delete_sample_data(db: DbSession, user: CurrentUser) -> None:
    samples = list(
        db.scalars(
            select(TrainingWorkout).where(
                TrainingWorkout.user_id == user.id, TrainingWorkout.is_sample.is_(True)
            )
        )
    )
    for workout in samples:
        db.delete(workout)
    for measurement in db.scalars(
        select(BodyMeasurement).where(
            BodyMeasurement.user_id == user.id, BodyMeasurement.is_sample.is_(True)
        )
    ):
        db.delete(measurement)
    db.flush()
    rebuild_personal_records(db, user.id)
    bump_workout_cache_revision(db, user.id)
    db.commit()


@router.get("/dashboard", response_model=DashboardRead)
def dashboard(db: DbSession, user: CurrentUser) -> DashboardRead:
    today = date.today()
    workouts = list(
        db.scalars(
            select(TrainingWorkout)
            .where(TrainingWorkout.user_id == user.id)
            .options(*workout_options())
            .order_by(TrainingWorkout.workout_date.desc(), TrainingWorkout.created_at.desc())
        )
    )
    preferences = training_preferences(db, user.id)
    week_start = start_of_week(today, preferences.week_start)
    this_week = [workout for workout in workouts if week_start <= workout.workout_date <= today]
    measurements = list(
        db.scalars(
            select(BodyMeasurement)
            .where(BodyMeasurement.user_id == user.id)
            .order_by(BodyMeasurement.measurement_date)
        )
    )

    def bodyweight_on(workout_date: date) -> float | None:
        applicable = [
            item.weight_kg for item in measurements if item.measurement_date <= workout_date
        ]
        return applicable[-1] if applicable else None

    def completed_sets(workout: TrainingWorkout) -> list[WorkoutSet]:
        return [
            item for movement in workout.movements for item in movement.sets if is_working_set(item)
        ]

    def display_categories(items: list[TrainingWorkout]) -> list[WorkoutCategory]:
        """Collapse a day to one strength colour plus cardio when both occurred."""
        has_cardio = False
        strength_categories: list[WorkoutCategory] = []
        for workout in items:
            movement_categories = {movement.exercise.category for movement in workout.movements}
            has_cardio = has_cardio or WorkoutCategory.CARDIO in movement_categories
            non_cardio = movement_categories - {WorkoutCategory.CARDIO}
            if non_cardio:
                category = workout.category
                if category == WorkoutCategory.CARDIO:
                    category = (
                        next(iter(non_cardio))
                        if len(non_cardio) == 1
                        else WorkoutCategory.FULL_BODY
                    )
                strength_categories.append(category)
            elif workout.category == WorkoutCategory.CARDIO:
                has_cardio = True
            else:
                strength_categories.append(workout.category)
        unique_strength = list(dict.fromkeys(strength_categories))
        if len(unique_strength) > 1:
            unique_strength = [WorkoutCategory.FULL_BODY]
        return [*unique_strength, *([WorkoutCategory.CARDIO] if has_cardio else [])]

    volume_this_week = sum(
        (item.weight_kg or 0) * (item.reps or 0)
        for workout in this_week
        for item in completed_sets(workout)
    )
    day_groups: dict[date, list[TrainingWorkout]] = defaultdict(list)
    for workout in workouts:
        day_groups[workout.workout_date].append(workout)
    heatmap = [
        HeatmapDay(
            workout_date=workout_date,
            categories=display_categories(items),
            workout_count=len(items),
            set_count=sum(len(completed_sets(item)) for item in items),
            workouts=[
                CalendarWorkoutRead(
                    id=item.id,
                    name=item.name,
                    category=item.category,
                    duration_minutes=item.duration_minutes,
                    exercises=[
                        CalendarExerciseRead(
                            exercise_name=movement.exercise.name,
                            set_count=len(
                                [set_item for set_item in movement.sets if is_working_set(set_item)]
                            ),
                            bodyweight_kg=bodyweight_on(item.workout_date)
                            or next(
                                (
                                    set_item.bodyweight_kg
                                    for set_item in movement.sets
                                    if is_working_set(set_item)
                                    and set_item.bodyweight_kg is not None
                                ),
                                None,
                            ),
                        )
                        for movement in item.movements
                        if any(is_working_set(set_item) for set_item in movement.sets)
                    ],
                )
                for item in items
            ],
        )
        for workout_date, items in sorted(day_groups.items())
    ]

    weekly_groups: dict[date, list[TrainingWorkout]] = defaultdict(list)
    for workout in this_week:
        weekly_groups[workout.workout_date].append(workout)
    weekly_days: list[WeeklyDayBreakdown] = []
    for workout_date, items in sorted(weekly_groups.items(), reverse=True):
        exercise_groups: dict[str, dict[str, object]] = {}
        for workout in items:
            for movement in workout.movements:
                sets = [item for item in movement.sets if is_working_set(item)]
                if not sets:
                    continue
                aggregate = exercise_groups.setdefault(
                    movement.exercise_id,
                    {
                        "exercise": movement.exercise,
                        "set_count": 0,
                        "volume_kg": 0.0,
                    },
                )
                aggregate["set_count"] = int(aggregate["set_count"]) + len(sets)
                aggregate["volume_kg"] = float(aggregate["volume_kg"]) + sum(
                    (item.weight_kg or 0) * (item.reps or 0) for item in sets
                )
        exercises = []
        for aggregate in exercise_groups.values():
            exercise = aggregate["exercise"]
            exercises.append(
                WeeklyExerciseBreakdown(
                    exercise_id=exercise.id,
                    exercise_name=exercise.name,
                    muscle_group=exercise.muscle_group,
                    category=exercise.category,
                    set_count=int(aggregate["set_count"]),
                    volume_kg=round(float(aggregate["volume_kg"]), 1),
                )
            )
        exercises.sort(
            key=lambda item: (item.muscle_group.casefold(), item.exercise_name.casefold())
        )
        day_sets = sum(len(completed_sets(item)) for item in items)
        weekly_days.append(
            WeeklyDayBreakdown(
                workout_date=workout_date,
                workout_count=len(items),
                total_sets=day_sets,
                volume_kg=round(
                    sum(
                        (item.weight_kg or 0) * (item.reps or 0)
                        for workout in items
                        for item in completed_sets(workout)
                    ),
                    1,
                ),
                workout_names=[item.name for item in items],
                categories=display_categories(items),
                exercises=exercises,
            )
        )

    workout_dates = sorted(day_groups, reverse=True)
    streak = 0
    if workout_dates and workout_dates[0] >= today - timedelta(days=1):
        cursor = workout_dates[0]
        for workout_date in workout_dates:
            if workout_date == cursor:
                streak += 1
                cursor -= timedelta(days=1)
            elif workout_date < cursor:
                break

    preferences = training_preferences(db, user.id)
    cardio_sessions = list(
        db.scalars(select(CardioSession).where(CardioSession.user_id == user.id))
    )
    cardio_week_start = start_of_week(today, preferences.week_start)
    cardio_minutes_this_week = sum(
        session.duration_minutes
        for session in cardio_sessions
        if cardio_week_start <= session.session_date <= today
    )
    muscle_totals = muscle_volume(workouts, week_start, today)
    return DashboardRead(
        workouts_this_week=len(this_week),
        sets_this_week=sum(len(completed_sets(workout)) for workout in this_week),
        volume_this_week_kg=round(volume_this_week, 1),
        current_streak=streak,
        total_cardio_sessions=len(cardio_sessions),
        cardio_minutes_this_week=cardio_minutes_this_week,
        cardio_energy_periods=cardio_energy_periods(cardio_sessions, today, preferences.week_start),
        heatmap=heatmap,
        weekly_days=weekly_days,
        recommendation=workout_recommendation(workouts, today),
        weekly_sets=weekly_sets(workouts, today, preferences.week_start),
        muscle_volume=[
            MuscleVolumeRead(muscle_name=name, set_total=value)
            for name, value in sorted(muscle_totals.items())
        ],
        zone2=zone2_week(
            cardio_sessions,
            cardio_week_start,
            preferences.zone2_goal_minutes,
        ),
        recent_workouts=workouts[:5],
    )


@router.get("/progress/{exercise_id}", response_model=ExerciseProgressRead)
def exercise_progress(exercise_id: str, db: DbSession, user: CurrentUser) -> ExerciseProgressRead:
    exercise = get_owned(db, Exercise, exercise_id, user.id)
    if not exercise:
        raise HTTPException(status_code=404, detail="Exercise was not found.")
    movements = list(
        db.scalars(
            select(WorkoutMovement)
            .where(WorkoutMovement.exercise_id == exercise_id)
            .options(selectinload(WorkoutMovement.workout), selectinload(WorkoutMovement.sets))
            .order_by(WorkoutMovement.workout_id)
        )
    )
    grouped: dict[tuple[date, str], list[WorkoutSet]] = defaultdict(list)
    for movement in movements:
        grouped[(movement.workout.workout_date, movement.workout_id)].extend(
            item for item in movement.sets if is_working_set(item)
        )
    points: list[ProgressPoint] = []
    for (workout_date, workout_id), sets in sorted(grouped.items()):
        if not sets:
            continue
        best_set = max(sets, key=lambda item: ((item.weight_kg or 0), (item.reps or 0)))
        best_e1rm = max(
            (
                estimated_one_rep_max(item.weight_kg or 0, item.reps or 0)
                for item in sets
                if is_pr_eligible(item)
            ),
            default=0.0,
        )
        points.append(
            ProgressPoint(
                workout_date=workout_date,
                workout_id=workout_id,
                best_weight_kg=max(item.weight_kg or 0 for item in sets),
                best_reps=max(item.reps or 0 for item in sets),
                estimated_1rm=round(best_e1rm, 1),
                volume_kg=round(sum((item.weight_kg or 0) * (item.reps or 0) for item in sets), 1),
                best_rpe=best_set.rpe,
            )
        )
    return ExerciseProgressRead(
        exercise=exercise,
        points=points,
        personal_best_weight_kg=max((point.best_weight_kg for point in points), default=0),
        personal_best_estimated_1rm=max((point.estimated_1rm for point in points), default=0),
    )
