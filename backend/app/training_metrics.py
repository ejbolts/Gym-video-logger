"""Authoritative training calculations shared by APIs and history rebuilds.

Rules:
* Epley estimated 1RM = weight * (1 + reps / 30), for 1-30 reps.
* Warm-ups never count as working volume or PRs. Drop sets do count.
* A failed set counts toward muscle volume when at least one rep was completed,
  but is PR eligible only when its configured target reps were completed.
* Primary and secondary muscle contributions default to 1.0 and 0.5.
* Stored weights are canonical kilograms; PR comparison buckets are rounded to
  0.1 in the user's preferred display unit.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta

from sqlalchemy import delete, select
from sqlalchemy.orm import Session, selectinload

from .models import (
    AppSetting,
    Exercise,
    ExerciseMuscleContribution,
    MuscleRole,
    PersonalRecord,
    PersonalRecordType,
    SetType,
    TrainingWorkout,
    WorkoutMovement,
    WorkoutSet,
)

KG_TO_LB = 2.2046226218
EPLEY_FORMULA = "Epley: weight × (1 + reps ÷ 30), reps 1–30"

# Conservative, editable defaults. Entries are deliberately exercise-specific.
DEFAULT_MUSCLE_MAPPING: dict[str, tuple[tuple[str, MuscleRole, float], ...]] = {
    "Barbell Bench Press": (
        ("Pectorals", MuscleRole.PRIMARY, 1.0),
        ("Triceps", MuscleRole.SECONDARY, 0.5),
        ("Anterior deltoids", MuscleRole.SECONDARY, 0.5),
    ),
    "Incline Dumbbell Press": (
        ("Upper pectorals", MuscleRole.PRIMARY, 1.0),
        ("Anterior deltoids", MuscleRole.PRIMARY, 1.0),
        ("Triceps", MuscleRole.SECONDARY, 0.5),
    ),
    "Overhead Press": (
        ("Anterior deltoids", MuscleRole.PRIMARY, 1.0),
        ("Triceps", MuscleRole.SECONDARY, 0.5),
        ("Upper pectorals", MuscleRole.SECONDARY, 0.5),
    ),
    "Dumbbell Shoulder Press": (
        ("Anterior deltoids", MuscleRole.PRIMARY, 1.0),
        ("Triceps", MuscleRole.SECONDARY, 0.5),
    ),
    "Lateral Raise": (
        ("Lateral deltoids", MuscleRole.PRIMARY, 1.0),
        ("Upper trapezius", MuscleRole.SECONDARY, 0.5),
    ),
    "Cable Fly": (
        ("Pectorals", MuscleRole.PRIMARY, 1.0),
        ("Anterior deltoids", MuscleRole.SECONDARY, 0.5),
    ),
    "Triceps Pushdown": (("Triceps", MuscleRole.PRIMARY, 1.0),),
    "Dips": (
        ("Pectorals", MuscleRole.PRIMARY, 1.0),
        ("Triceps", MuscleRole.PRIMARY, 1.0),
        ("Anterior deltoids", MuscleRole.SECONDARY, 0.5),
    ),
    "Deadlift": (
        ("Glutes", MuscleRole.PRIMARY, 1.0),
        ("Hamstrings", MuscleRole.PRIMARY, 1.0),
        ("Spinal erectors", MuscleRole.PRIMARY, 1.0),
        ("Upper back", MuscleRole.SECONDARY, 0.5),
        ("Forearms", MuscleRole.SECONDARY, 0.5),
    ),
    "Barbell Row": (
        ("Mid / Upper Back", MuscleRole.PRIMARY, 1.0),
        ("Lats", MuscleRole.PRIMARY, 1.0),
        ("Biceps", MuscleRole.SECONDARY, 0.5),
        ("Rear deltoids", MuscleRole.SECONDARY, 0.5),
    ),
    "Pull-up": (
        ("Lats", MuscleRole.PRIMARY, 1.0),
        ("Biceps", MuscleRole.SECONDARY, 0.5),
        ("Forearms", MuscleRole.SECONDARY, 0.5),
    ),
    "Lat Pulldown": (
        ("Lats", MuscleRole.PRIMARY, 1.0),
        ("Biceps", MuscleRole.SECONDARY, 0.5),
        ("Forearms", MuscleRole.SECONDARY, 0.5),
    ),
    "Seated Cable Row": (
        ("Mid / Upper Back", MuscleRole.PRIMARY, 1.0),
        ("Lats", MuscleRole.SECONDARY, 0.5),
        ("Biceps", MuscleRole.SECONDARY, 0.5),
    ),
    "Face Pull": (
        ("Rear deltoids", MuscleRole.PRIMARY, 1.0),
        ("External rotators", MuscleRole.PRIMARY, 1.0),
        ("Mid / Upper Back", MuscleRole.SECONDARY, 0.5),
    ),
    "Barbell Curl": (("Biceps", MuscleRole.PRIMARY, 1.0), ("Forearms", MuscleRole.SECONDARY, 0.5)),
    "Hammer Curl": (
        ("Brachialis", MuscleRole.PRIMARY, 1.0),
        ("Biceps", MuscleRole.SECONDARY, 0.5),
        ("Forearms", MuscleRole.SECONDARY, 0.5),
    ),
    "Back Squat": (
        ("Quadriceps", MuscleRole.PRIMARY, 1.0),
        ("Glutes", MuscleRole.PRIMARY, 1.0),
        ("Adductors", MuscleRole.SECONDARY, 0.5),
    ),
    "Front Squat": (
        ("Quadriceps", MuscleRole.PRIMARY, 1.0),
        ("Glutes", MuscleRole.SECONDARY, 0.5),
        ("Adductors", MuscleRole.SECONDARY, 0.5),
    ),
    "Romanian Deadlift": (
        ("Hamstrings", MuscleRole.PRIMARY, 1.0),
        ("Glutes", MuscleRole.PRIMARY, 1.0),
        ("Spinal erectors", MuscleRole.SECONDARY, 0.5),
    ),
    "Leg Press": (
        ("Quadriceps", MuscleRole.PRIMARY, 1.0),
        ("Glutes", MuscleRole.PRIMARY, 1.0),
        ("Adductors", MuscleRole.SECONDARY, 0.5),
    ),
    "Bulgarian Split Squat": (
        ("Quadriceps", MuscleRole.PRIMARY, 1.0),
        ("Glutes", MuscleRole.PRIMARY, 1.0),
        ("Adductors", MuscleRole.SECONDARY, 0.5),
    ),
    "Leg Extension": (("Quadriceps", MuscleRole.PRIMARY, 1.0),),
    "Leg Curl": (("Hamstrings", MuscleRole.PRIMARY, 1.0), ("Calves", MuscleRole.SECONDARY, 0.5)),
    "Hip Thrust": (
        ("Glutes", MuscleRole.PRIMARY, 1.0),
        ("Hamstrings", MuscleRole.SECONDARY, 0.5),
        ("Adductors", MuscleRole.SECONDARY, 0.5),
    ),
    "Standing Calf Raise": (("Calves", MuscleRole.PRIMARY, 1.0),),
    "Plank": (("Core", MuscleRole.PRIMARY, 1.0), ("Glutes", MuscleRole.SECONDARY, 0.5)),
    "Hanging Leg Raise": (
        ("Core", MuscleRole.PRIMARY, 1.0),
        ("Hip flexors", MuscleRole.SECONDARY, 0.5),
    ),
}


def get_setting(db: Session, key: str, default: str) -> str:
    setting = db.get(AppSetting, key)
    return setting.value if setting else default


def set_setting(db: Session, key: str, value: str) -> None:
    setting = db.get(AppSetting, key)
    if setting:
        setting.value = value
    else:
        db.add(AppSetting(key=key, value=value))


def preferred_weight_unit(db: Session) -> str:
    return "lb" if get_setting(db, "preferred_weight_unit", "kg") == "lb" else "kg"


def normalized_weight(weight_kg: float, unit: str) -> float:
    return round(weight_kg * KG_TO_LB if unit == "lb" else weight_kg, 1)


def estimated_one_rep_max(weight_kg: float, reps: int) -> float:
    if reps < 1 or reps > 30:
        return 0.0
    return weight_kg * (1 + reps / 30)


def is_warmup(item: WorkoutSet) -> bool:
    return item.set_type == SetType.WARMUP or item.warmup


def is_working_set(item: WorkoutSet) -> bool:
    return bool(
        item.completed and not is_warmup(item) and (not item.failed or (item.reps or 0) > 0)
    )


def is_pr_eligible(item: WorkoutSet) -> bool:
    if not item.completed or is_warmup(item):
        return False
    if item.failed:
        return item.target_reps is not None and (item.reps or 0) >= item.target_reps
    return True


def muscle_credits(exercise: Exercise) -> list[tuple[str, float]]:
    if exercise.muscle_contributions:
        return [
            (item.muscle_name, item.contribution_factor) for item in exercise.muscle_contributions
        ]
    # Custom exercises retain the user's explicit muscle field until they edit detailed credits.
    return [(exercise.muscle_group.strip(), 1.0)] if exercise.muscle_group.strip() else []


def muscle_volume(workouts: list[TrainingWorkout], start: date, end: date) -> dict[str, float]:
    totals: dict[str, float] = defaultdict(float)
    for workout in workouts:
        if not start <= workout.workout_date <= end:
            continue
        for movement in workout.movements:
            credits = muscle_credits(movement.exercise)
            for item in movement.sets:
                if is_working_set(item):
                    for muscle, contribution in credits:
                        totals[muscle] += contribution
    return dict(totals)


def seed_muscle_mappings(db: Session) -> None:
    exercises = {
        item.name: item
        for item in db.scalars(
            select(Exercise).options(selectinload(Exercise.muscle_contributions))
        )
    }
    changed = False
    for exercise_name, mappings in DEFAULT_MUSCLE_MAPPING.items():
        exercise = exercises.get(exercise_name)
        if not exercise or exercise.is_custom or exercise.muscle_contributions:
            continue
        for muscle, role, factor in mappings:
            exercise.muscle_contributions.append(
                ExerciseMuscleContribution(
                    muscle_name=muscle, role=role, contribution_factor=factor
                )
            )
        changed = True
    if changed:
        db.commit()


def workout_query():
    return select(TrainingWorkout).options(
        selectinload(TrainingWorkout.movements)
        .selectinload(WorkoutMovement.exercise)
        .selectinload(Exercise.muscle_contributions),
        selectinload(TrainingWorkout.movements).selectinload(WorkoutMovement.sets),
    )


def rebuild_personal_records(db: Session) -> None:
    """Rebuild derived milestone rows transactionally after any workout mutation."""
    db.execute(delete(PersonalRecord))
    unit = preferred_weight_unit(db)
    workouts = list(
        db.scalars(
            workout_query().order_by(TrainingWorkout.workout_date, TrainingWorkout.created_at)
        )
    )
    state: dict[str, dict[str, object]] = defaultdict(
        lambda: {"weight": -1.0, "e1rm": -1.0, "duration": -1.0, "distance": -1.0, "reps": {}}
    )
    for workout in workouts:
        for movement in sorted(workout.movements, key=lambda item: item.order_index):
            current = state[movement.exercise_id]
            for item in sorted(movement.sets, key=lambda set_item: set_item.order_index):
                if not is_pr_eligible(item):
                    continue
                weight = (
                    normalized_weight(item.weight_kg, unit) if item.weight_kg is not None else None
                )
                if weight is not None and weight > float(current["weight"]):
                    current["weight"] = weight
                    db.add(
                        _pr(
                            workout, movement, item, PersonalRecordType.WEIGHT, weight, unit, weight
                        )
                    )
                if weight is not None and item.reps is not None:
                    rep_bests = current["reps"]
                    assert isinstance(rep_bests, dict)
                    previous_reps = rep_bests.get(weight)
                    if previous_reps is not None and item.reps > int(previous_reps):
                        db.add(
                            _pr(
                                workout,
                                movement,
                                item,
                                PersonalRecordType.REPS_AT_WEIGHT,
                                float(item.reps),
                                "reps",
                                weight,
                            )
                        )
                    rep_bests[weight] = max(int(previous_reps or 0), item.reps)
                    e1rm_kg = estimated_one_rep_max(item.weight_kg or 0, item.reps)
                    e1rm = normalized_weight(e1rm_kg, unit)
                    if e1rm and e1rm > float(current["e1rm"]):
                        current["e1rm"] = e1rm
                        db.add(
                            _pr(
                                workout,
                                movement,
                                item,
                                PersonalRecordType.ESTIMATED_1RM,
                                e1rm,
                                unit,
                                weight,
                                EPLEY_FORMULA,
                            )
                        )
                if item.duration_seconds is not None and item.duration_seconds > float(
                    current["duration"]
                ):
                    current["duration"] = float(item.duration_seconds)
                    db.add(
                        _pr(
                            workout,
                            movement,
                            item,
                            PersonalRecordType.DURATION,
                            float(item.duration_seconds),
                            "seconds",
                            weight,
                        )
                    )
                if item.distance_km is not None and item.distance_km > float(current["distance"]):
                    current["distance"] = float(item.distance_km)
                    db.add(
                        _pr(
                            workout,
                            movement,
                            item,
                            PersonalRecordType.DISTANCE,
                            float(item.distance_km),
                            "km",
                            weight,
                        )
                    )
    db.flush()


def _pr(
    workout: TrainingWorkout,
    movement: WorkoutMovement,
    item: WorkoutSet,
    record_type: PersonalRecordType,
    value: float,
    unit: str,
    weight: float | None,
    formula: str | None = None,
) -> PersonalRecord:
    return PersonalRecord(
        exercise_id=movement.exercise_id,
        workout_id=workout.id,
        set_id=item.id,
        achieved_date=workout.workout_date,
        record_type=record_type,
        value=value,
        unit=unit,
        normalized_weight=weight,
        formula=formula,
    )


def start_of_week(day: date, preference: str = "monday") -> date:
    wanted = {"monday": 0, "sunday": 6, "saturday": 5}.get(preference.casefold(), 0)
    return day - timedelta(days=(day.weekday() - wanted) % 7)
