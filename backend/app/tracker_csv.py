from __future__ import annotations

import csv
import io
import re
from collections import defaultdict
from dataclasses import dataclass
from datetime import date
from statistics import median

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import (
    BodyMeasurement,
    Exercise,
    ExerciseKind,
    TrainingWorkout,
    WorkoutCategory,
    WorkoutMovement,
    WorkoutSet,
)
from .workout_category import infer_workout_category

CSV_HEADERS = (
    "Date Lifted",
    "Exercise",
    "Weight (kg)",
    "Weight (lb)",
    "Reps",
    "Bodyweight (kg)",
    "Bodyweight (lb)",
    "Percentile (%)",
    "Warmup",
)
KG_TO_LB = 2.2046226218
IMPORTED_BODYWEIGHT_NOTE = "Imported from workout CSV."


class CsvImportError(ValueError):
    pass


@dataclass(frozen=True)
class ParsedRow:
    workout_date: date
    exercise_name: str
    weight_kg: float | None
    reps: int | None
    bodyweight_kg: float | None
    percentile: float | None
    warmup: bool


@dataclass(frozen=True)
class ImportSummary:
    workouts_created: int
    exercises_created: int
    sets_imported: int
    body_measurements_created: int
    body_measurements_updated: int
    warnings: list[str]


def optional_float(value: str | None, field: str, row_number: int) -> float | None:
    clean = (value or "").strip()
    if not clean:
        return None
    try:
        return float(clean)
    except ValueError as error:
        raise CsvImportError(f"Row {row_number}: {field} must be a number.") from error


def optional_int(value: str | None, field: str, row_number: int) -> int | None:
    parsed = optional_float(value, field, row_number)
    if parsed is None:
        return None
    if not parsed.is_integer():
        raise CsvImportError(f"Row {row_number}: {field} must be a whole number.")
    return int(parsed)


def parse_rows(raw: bytes) -> tuple[list[ParsedRow], list[str]]:
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError as error:
        raise CsvImportError("The file must be UTF-8 encoded.") from error
    if not text.strip():
        raise CsvImportError("The CSV file is empty.")
    first_line = text.splitlines()[0]
    delimiter = "\t" if first_line.count("\t") > first_line.count(",") else ","
    reader = csv.DictReader(io.StringIO(text), delimiter=delimiter)
    supplied = tuple((header or "").strip() for header in (reader.fieldnames or []))
    missing = [header for header in CSV_HEADERS if header not in supplied]
    if missing:
        raise CsvImportError(f"Missing required columns: {', '.join(missing)}.")

    rows: list[ParsedRow] = []
    warnings: list[str] = []
    for row_number, row in enumerate(reader, start=2):
        if not any((value or "").strip() for value in row.values()):
            continue
        exercise_name = (row.get("Exercise") or "").strip()
        if not exercise_name:
            raise CsvImportError(f"Row {row_number}: Exercise is required.")
        try:
            workout_date = date.fromisoformat((row.get("Date Lifted") or "").strip())
        except ValueError as error:
            raise CsvImportError(
                f"Row {row_number}: Date Lifted must use YYYY-MM-DD format."
            ) from error
        weight_kg = optional_float(row.get("Weight (kg)"), "Weight (kg)", row_number)
        weight_lb = optional_float(row.get("Weight (lb)"), "Weight (lb)", row_number)
        if weight_kg is None and weight_lb is not None:
            weight_kg = round(weight_lb / KG_TO_LB, 3)
            warnings.append(f"Row {row_number}: converted Weight (lb) to kilograms.")
        bodyweight_kg = optional_float(row.get("Bodyweight (kg)"), "Bodyweight (kg)", row_number)
        bodyweight_lb = optional_float(row.get("Bodyweight (lb)"), "Bodyweight (lb)", row_number)
        if bodyweight_kg is None and bodyweight_lb is not None:
            bodyweight_kg = round(bodyweight_lb / KG_TO_LB, 3)
            warnings.append(f"Row {row_number}: converted Bodyweight (lb) to kilograms.")
        if bodyweight_kg is not None and not 0 < bodyweight_kg <= 500:
            raise CsvImportError(f"Row {row_number}: Bodyweight must be between 0 and 500 kg.")
        percentile = optional_float(row.get("Percentile (%)"), "Percentile (%)", row_number)
        if percentile is not None and not 0 <= percentile <= 100:
            raise CsvImportError(f"Row {row_number}: Percentile (%) must be between 0 and 100.")
        warmup_value = (row.get("Warmup") or "").strip().casefold()
        if warmup_value not in {"", "0", "1", "false", "true", "no", "yes"}:
            raise CsvImportError(f"Row {row_number}: Warmup must be 1/0, true/false, or yes/no.")
        rows.append(
            ParsedRow(
                workout_date=workout_date,
                exercise_name=exercise_name,
                weight_kg=weight_kg,
                reps=optional_int(row.get("Reps"), "Reps", row_number),
                bodyweight_kg=bodyweight_kg,
                percentile=percentile,
                warmup=warmup_value in {"1", "true", "yes"},
            )
        )
    if not rows:
        raise CsvImportError("The CSV contains no workout rows.")
    return rows, warnings


def infer_exercise(name: str) -> tuple[WorkoutCategory, ExerciseKind, str, str | None]:
    lowered = name.casefold()
    if any(
        phrase in lowered
        for phrase in ("crunch", "sit up", "sit-up", "knee raise", "leg raise", "plank")
    ):
        return WorkoutCategory.FULL_BODY, ExerciseKind.STRENGTH, "Core", None
    if (
        re.search(
            r"\b(treadmill|run|running|jog|jogging|walk|walking|cycling|bike|bicycle|cardio|rowing)\b",
            lowered,
        )
        or "stair climber" in lowered
    ):
        return WorkoutCategory.CARDIO, ExerciseKind.CARDIO, "Cardio", None
    if any(word in lowered for word in ("reverse fly", "face pull", "rear delt")):
        return WorkoutCategory.PULL, ExerciseKind.STRENGTH, "Rear Delts", None
    if any(
        word in lowered
        for word in (
            "pulldown",
            "pull down",
            "pull-up",
            "pullup",
            "pull up",
            "chin-up",
            "chin up",
            "pullover",
            "pull over",
        )
    ):
        return WorkoutCategory.PULL, ExerciseKind.STRENGTH, "Lats", None
    if "row" in lowered:
        return WorkoutCategory.PULL, ExerciseKind.STRENGTH, "Mid / Upper Back", None
    if any(word in lowered for word in ("curl", "bicep", "grip squeezer")):
        return WorkoutCategory.PULL, ExerciseKind.STRENGTH, "Biceps", None
    if "tricep" in lowered:
        return WorkoutCategory.PUSH, ExerciseKind.STRENGTH, "Triceps", None
    if any(word in lowered for word in ("romanian deadlift", "leg curl", "hamstring")):
        return WorkoutCategory.LOWER, ExerciseKind.STRENGTH, "Hamstrings", None
    if any(word in lowered for word in ("hip thrust", "hip adduction", "hip abduction", "glute")):
        return WorkoutCategory.LOWER, ExerciseKind.STRENGTH, "Glutes", None
    if "back extension" in lowered:
        return WorkoutCategory.LOWER, ExerciseKind.STRENGTH, "Lower Back", None
    if "calf" in lowered:
        return WorkoutCategory.LOWER, ExerciseKind.STRENGTH, "Calves", None
    if any(word in lowered for word in ("squat", "leg press", "leg extension", "lunge")):
        return WorkoutCategory.LOWER, ExerciseKind.STRENGTH, "Quads", None
    if any(
        word in lowered
        for word in ("shoulder", "overhead press", "military press", "lateral raise")
    ):
        return WorkoutCategory.PUSH, ExerciseKind.STRENGTH, "Shoulders", None
    if any(
        word in lowered
        for word in (
            "bench",
            "chest",
            "pec ",
            "dumbbell fly",
            "machine fly",
            "push up",
            "push-up",
            "dips",
            "press",
        )
    ):
        return WorkoutCategory.PUSH, ExerciseKind.STRENGTH, "Chest", None
    if "deadlift" in lowered:
        return WorkoutCategory.PULL, ExerciseKind.STRENGTH, "Posterior chain", None
    if "external rotation" in lowered:
        return WorkoutCategory.UPPER, ExerciseKind.STRENGTH, "Shoulders", None
    return WorkoutCategory.OTHER, ExerciseKind.STRENGTH, "Other", None


def sync_imported_bodyweights(db: Session, bodyweights: dict[date, list[float]]) -> tuple[int, int]:
    """Create graph check-ins from workout bodyweights without replacing manual entries."""
    if not bodyweights:
        return 0, 0
    existing = {
        item.measurement_date: item
        for item in db.scalars(
            select(BodyMeasurement).where(BodyMeasurement.measurement_date.in_(bodyweights))
        )
    }
    created = 0
    updated = 0
    for measurement_date, values in sorted(bodyweights.items()):
        weight_kg = round(float(median(values)), 3)
        measurement = existing.get(measurement_date)
        if measurement is None:
            db.add(
                BodyMeasurement(
                    measurement_date=measurement_date,
                    weight_kg=weight_kg,
                    body_fat_pct=None,
                    notes=IMPORTED_BODYWEIGHT_NOTE,
                    is_sample=False,
                )
            )
            created += 1
        elif measurement.is_sample or measurement.notes == IMPORTED_BODYWEIGHT_NOTE:
            measurement.weight_kg = weight_kg
            if measurement.is_sample:
                measurement.body_fat_pct = None
            measurement.notes = IMPORTED_BODYWEIGHT_NOTE
            measurement.is_sample = False
            updated += 1
    return created, updated


def import_workouts(db: Session, raw: bytes) -> ImportSummary:
    rows, warnings = parse_rows(raw)
    exercises = {item.name.casefold(): item for item in db.scalars(select(Exercise))}
    exercises_created = 0
    grouped: dict[date, dict[str, list[ParsedRow]]] = defaultdict(lambda: defaultdict(list))
    bodyweights: dict[date, list[float]] = defaultdict(list)
    for row in rows:
        grouped[row.workout_date][row.exercise_name].append(row)
        if row.bodyweight_kg is not None:
            bodyweights[row.workout_date].append(row.bodyweight_kg)

    for workout_date, movement_groups in sorted(grouped.items()):
        movement_categories: list[WorkoutCategory] = []
        workout = TrainingWorkout(
            name=f"Imported workout · {workout_date.isoformat()}",
            workout_date=workout_date,
            category=WorkoutCategory.OTHER,
            notes="Imported from CSV.",
            is_sample=False,
        )
        db.add(workout)
        for movement_index, (exercise_name, set_rows) in enumerate(movement_groups.items()):
            exercise = exercises.get(exercise_name.casefold())
            if not exercise:
                category, kind, muscle_group, equipment = infer_exercise(exercise_name)
                exercise = Exercise(
                    name=exercise_name,
                    category=category,
                    kind=kind,
                    muscle_group=muscle_group,
                    equipment=equipment,
                    is_custom=True,
                )
                db.add(exercise)
                exercises[exercise_name.casefold()] = exercise
                exercises_created += 1
            movement_categories.append(exercise.category)
            movement = WorkoutMovement(exercise=exercise, order_index=movement_index)
            for set_index, row in enumerate(set_rows):
                movement.sets.append(
                    WorkoutSet(
                        order_index=set_index,
                        reps=row.reps,
                        weight_kg=row.weight_kg,
                        bodyweight_kg=row.bodyweight_kg,
                        percentile=row.percentile,
                        warmup=row.warmup,
                        completed=True,
                    )
                )
            workout.movements.append(movement)
        workout.category = infer_workout_category(movement_categories) or WorkoutCategory.OTHER
    body_measurements_created, body_measurements_updated = sync_imported_bodyweights(
        db, bodyweights
    )
    db.flush()
    return ImportSummary(
        workouts_created=len(grouped),
        exercises_created=exercises_created,
        sets_imported=len(rows),
        body_measurements_created=body_measurements_created,
        body_measurements_updated=body_measurements_updated,
        warnings=warnings[:50],
    )


def format_number(value: float | int | None) -> str:
    if value is None:
        return ""
    return f"{value:.3f}".rstrip("0").rstrip(".") if isinstance(value, float) else str(value)


def export_workouts(workouts: list[TrainingWorkout]) -> str:
    output = io.StringIO(newline="")
    writer = csv.writer(output, lineterminator="\r\n")
    writer.writerow(CSV_HEADERS)
    for workout in workouts:
        for movement in sorted(workout.movements, key=lambda item: item.order_index):
            for item in sorted(movement.sets, key=lambda entry: entry.order_index):
                writer.writerow(
                    (
                        workout.workout_date.isoformat(),
                        movement.exercise.name,
                        format_number(item.weight_kg),
                        format_number(
                            round(item.weight_kg * KG_TO_LB, 1)
                            if item.weight_kg is not None
                            else None
                        ),
                        format_number(item.reps),
                        format_number(item.bodyweight_kg),
                        format_number(
                            round(item.bodyweight_kg * KG_TO_LB, 1)
                            if item.bodyweight_kg is not None
                            else None
                        ),
                        format_number(item.percentile),
                        "1" if item.warmup else "0",
                    )
                )
    return output.getvalue()
