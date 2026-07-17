from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import Response
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from .database import get_db
from .models import (
    Exercise,
    ExerciseKind,
    TrainingWorkout,
    WorkoutCategory,
    WorkoutMovement,
    WorkoutSet,
)
from .tracker_csv import CsvImportError, export_workouts, import_workouts
from .tracker_schemas import (
    CsvImportRead,
    DashboardRead,
    ExerciseCreate,
    ExerciseProgressRead,
    ExerciseRead,
    HeatmapDay,
    ProgressPoint,
    TrainingWorkoutCreate,
    TrainingWorkoutRead,
)

router = APIRouter(prefix="/api", tags=["workout tracking"])
DbSession = Annotated[Session, Depends(get_db)]


DEFAULT_EXERCISES = (
    ("Barbell Bench Press", WorkoutCategory.PUSH, "Chest", "Barbell"),
    ("Incline Dumbbell Press", WorkoutCategory.PUSH, "Chest", "Dumbbell"),
    ("Overhead Press", WorkoutCategory.PUSH, "Shoulders", "Barbell"),
    ("Dumbbell Shoulder Press", WorkoutCategory.PUSH, "Shoulders", "Dumbbell"),
    ("Lateral Raise", WorkoutCategory.PUSH, "Shoulders", "Dumbbell"),
    ("Cable Fly", WorkoutCategory.PUSH, "Chest", "Cable"),
    ("Triceps Pushdown", WorkoutCategory.PUSH, "Triceps", "Cable"),
    ("Dips", WorkoutCategory.PUSH, "Chest / Triceps", "Bodyweight"),
    ("Deadlift", WorkoutCategory.PULL, "Posterior chain", "Barbell"),
    ("Barbell Row", WorkoutCategory.PULL, "Back", "Barbell"),
    ("Pull-up", WorkoutCategory.PULL, "Back", "Bodyweight"),
    ("Lat Pulldown", WorkoutCategory.PULL, "Back", "Cable"),
    ("Seated Cable Row", WorkoutCategory.PULL, "Back", "Cable"),
    ("Face Pull", WorkoutCategory.PULL, "Rear delts", "Cable"),
    ("Barbell Curl", WorkoutCategory.PULL, "Biceps", "Barbell"),
    ("Hammer Curl", WorkoutCategory.PULL, "Biceps", "Dumbbell"),
    ("Back Squat", WorkoutCategory.LOWER, "Quads / Glutes", "Barbell"),
    ("Front Squat", WorkoutCategory.LOWER, "Quads", "Barbell"),
    ("Romanian Deadlift", WorkoutCategory.LOWER, "Hamstrings", "Barbell"),
    ("Leg Press", WorkoutCategory.LOWER, "Quads / Glutes", "Machine"),
    ("Bulgarian Split Squat", WorkoutCategory.LOWER, "Quads / Glutes", "Dumbbell"),
    ("Leg Extension", WorkoutCategory.LOWER, "Quads", "Machine"),
    ("Leg Curl", WorkoutCategory.LOWER, "Hamstrings", "Machine"),
    ("Hip Thrust", WorkoutCategory.LOWER, "Glutes", "Barbell"),
    ("Standing Calf Raise", WorkoutCategory.LOWER, "Calves", "Machine"),
    ("Plank", WorkoutCategory.FULL_BODY, "Core", "Bodyweight"),
    ("Hanging Leg Raise", WorkoutCategory.FULL_BODY, "Core", "Bodyweight"),
)

DEFAULT_CARDIO = (
    ("Running", "Cardio", "Outdoor / Treadmill"),
    ("Cycling", "Cardio", "Bike"),
    ("Rowing", "Cardio", "Rowing machine"),
    ("Stair Climber", "Cardio", "Machine"),
    ("Walking", "Cardio", "Outdoor / Treadmill"),
)


def seed_default_exercises(db: Session) -> None:
    if db.scalar(select(func.count(Exercise.id))):
        return
    for name, category, muscle_group, equipment in DEFAULT_EXERCISES:
        db.add(
            Exercise(
                name=name,
                category=category,
                kind=ExerciseKind.STRENGTH,
                muscle_group=muscle_group,
                equipment=equipment,
            )
        )
    for name, muscle_group, equipment in DEFAULT_CARDIO:
        db.add(
            Exercise(
                name=name,
                category=WorkoutCategory.CARDIO,
                kind=ExerciseKind.CARDIO,
                muscle_group=muscle_group,
                equipment=equipment,
            )
        )
    db.commit()


def workout_options():
    return (
        selectinload(TrainingWorkout.movements).selectinload(WorkoutMovement.exercise),
        selectinload(TrainingWorkout.movements).selectinload(WorkoutMovement.sets),
    )


def load_workout(db: Session, workout_id: str) -> TrainingWorkout:
    workout = db.scalar(
        select(TrainingWorkout).where(TrainingWorkout.id == workout_id).options(*workout_options())
    )
    if not workout:
        raise HTTPException(status_code=404, detail="Workout was not found.")
    return workout


def replace_workout_contents(
    db: Session, workout: TrainingWorkout, payload: TrainingWorkoutCreate
) -> None:
    workout.name = payload.name
    workout.workout_date = payload.workout_date
    workout.category = payload.category
    workout.notes = payload.notes
    workout.duration_minutes = payload.duration_minutes
    workout.movements.clear()
    db.flush()
    for movement_index, movement_payload in enumerate(payload.movements):
        exercise = db.get(Exercise, movement_payload.exercise_id)
        if not exercise:
            raise HTTPException(
                status_code=422,
                detail=f"Exercise {movement_payload.exercise_id} was not found.",
            )
        movement = WorkoutMovement(
            exercise_id=exercise.id,
            order_index=movement_index,
            notes=movement_payload.notes,
        )
        for set_index, set_payload in enumerate(movement_payload.sets):
            movement.sets.append(WorkoutSet(order_index=set_index, **set_payload.model_dump()))
        workout.movements.append(movement)


@router.get("/exercises", response_model=list[ExerciseRead])
def list_exercises(
    db: DbSession,
    search: str | None = Query(default=None, max_length=100),
) -> list[Exercise]:
    query = select(Exercise).order_by(Exercise.name)
    if search:
        query = query.where(Exercise.name.ilike(f"%{search.strip()}%"))
    return list(db.scalars(query))


@router.post("/exercises", response_model=ExerciseRead, status_code=201)
def create_exercise(payload: ExerciseCreate, db: DbSession) -> Exercise:
    exercise = Exercise(**payload.model_dump(), is_custom=True)
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


@router.get("/workouts", response_model=list[TrainingWorkoutRead])
def list_workouts(
    db: DbSession, limit: int = Query(default=100, ge=1, le=500)
) -> list[TrainingWorkout]:
    return list(
        db.scalars(
            select(TrainingWorkout)
            .options(*workout_options())
            .order_by(TrainingWorkout.workout_date.desc(), TrainingWorkout.created_at.desc())
            .limit(limit)
        )
    )


@router.post("/workouts", response_model=TrainingWorkoutRead, status_code=201)
def create_workout(payload: TrainingWorkoutCreate, db: DbSession) -> TrainingWorkout:
    workout = TrainingWorkout(
        name=payload.name,
        workout_date=payload.workout_date,
        category=payload.category,
        notes=payload.notes,
        duration_minutes=payload.duration_minutes,
    )
    db.add(workout)
    replace_workout_contents(db, workout, payload)
    db.commit()
    return load_workout(db, workout.id)


@router.get("/workouts/export.csv")
def export_workout_csv(db: DbSession) -> Response:
    workouts = list(
        db.scalars(
            select(TrainingWorkout)
            .options(*workout_options())
            .order_by(TrainingWorkout.workout_date, TrainingWorkout.created_at)
        )
    )
    content = export_workouts(workouts)
    filename = f"gym-workouts-{date.today().isoformat()}.csv"
    return Response(
        content=content.encode("utf-8-sig"),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/workouts/import", response_model=CsvImportRead, status_code=201)
async def import_workout_csv(
    db: DbSession, file: Annotated[UploadFile, File(...)]
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
    try:
        summary = import_workouts(db, raw)
    except CsvImportError as error:
        db.rollback()
        raise HTTPException(status_code=422, detail=str(error)) from error
    return CsvImportRead(**summary.__dict__)


@router.get("/workouts/{workout_id}", response_model=TrainingWorkoutRead)
def get_workout(workout_id: str, db: DbSession) -> TrainingWorkout:
    return load_workout(db, workout_id)


@router.put("/workouts/{workout_id}", response_model=TrainingWorkoutRead)
def update_workout(
    workout_id: str, payload: TrainingWorkoutCreate, db: DbSession
) -> TrainingWorkout:
    workout = load_workout(db, workout_id)
    replace_workout_contents(db, workout, payload)
    db.commit()
    return load_workout(db, workout.id)


@router.delete("/workouts/{workout_id}", status_code=204)
def delete_workout(workout_id: str, db: DbSession) -> None:
    workout = load_workout(db, workout_id)
    db.delete(workout)
    db.commit()


@router.delete("/sample-data", status_code=204)
def delete_sample_data(db: DbSession) -> None:
    samples = list(db.scalars(select(TrainingWorkout).where(TrainingWorkout.is_sample.is_(True))))
    for workout in samples:
        db.delete(workout)
    db.commit()


@router.get("/dashboard", response_model=DashboardRead)
def dashboard(db: DbSession) -> DashboardRead:
    today = date.today()
    start = today - timedelta(days=364)
    workouts = list(
        db.scalars(
            select(TrainingWorkout)
            .where(TrainingWorkout.workout_date >= start)
            .options(*workout_options())
            .order_by(TrainingWorkout.workout_date.desc(), TrainingWorkout.created_at.desc())
        )
    )
    week_start = today - timedelta(days=today.weekday())
    this_week = [workout for workout in workouts if workout.workout_date >= week_start]

    def completed_sets(workout: TrainingWorkout) -> list[WorkoutSet]:
        return [item for movement in workout.movements for item in movement.sets if item.completed]

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
            categories=list(dict.fromkeys(item.category for item in items)),
            workout_count=len(items),
            set_count=sum(len(completed_sets(item)) for item in items),
        )
        for workout_date, items in sorted(day_groups.items())
    ]

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

    return DashboardRead(
        workouts_this_week=len(this_week),
        sets_this_week=sum(len(completed_sets(workout)) for workout in this_week),
        volume_this_week_kg=round(volume_this_week, 1),
        current_streak=streak,
        heatmap=heatmap,
        recent_workouts=workouts[:5],
    )


@router.get("/progress/{exercise_id}", response_model=ExerciseProgressRead)
def exercise_progress(exercise_id: str, db: DbSession) -> ExerciseProgressRead:
    exercise = db.get(Exercise, exercise_id)
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
            item for item in movement.sets if item.completed
        )
    points: list[ProgressPoint] = []
    for (workout_date, workout_id), sets in sorted(grouped.items()):
        if not sets:
            continue
        best_set = max(sets, key=lambda item: ((item.weight_kg or 0), (item.reps or 0)))
        best_e1rm = max((item.weight_kg or 0) * (1 + (item.reps or 0) / 30) for item in sets)
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
