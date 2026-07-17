from __future__ import annotations

import csv
import io
from collections import defaultdict
from dataclasses import dataclass
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import (
    Exercise,
    ExerciseKind,
    TrainingWorkout,
    WorkoutCategory,
    WorkoutMovement,
    WorkoutSet,
)

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
    if any(word in lowered for word in ("treadmill", "run", "cycling", "bike", "cardio")):
        return WorkoutCategory.CARDIO, ExerciseKind.CARDIO, "Cardio", None
    if any(
        word in lowered for word in ("squat", "leg", "lunge", "hip", "calf", "romanian deadlift")
    ):
        return WorkoutCategory.LOWER, ExerciseKind.STRENGTH, "Lower body", None
    if any(word in lowered for word in ("bench", "chest", "shoulder", "tricep", "fly")):
        return WorkoutCategory.PUSH, ExerciseKind.STRENGTH, "Push", None
    if any(word in lowered for word in ("row", "pulldown", "pull-up", "curl", "bicep")):
        return WorkoutCategory.PULL, ExerciseKind.STRENGTH, "Pull", None
    return WorkoutCategory.OTHER, ExerciseKind.STRENGTH, "Other", None


def import_workouts(db: Session, raw: bytes) -> ImportSummary:
    rows, warnings = parse_rows(raw)
    exercises = {item.name.casefold(): item for item in db.scalars(select(Exercise))}
    exercises_created = 0
    grouped: dict[date, dict[str, list[ParsedRow]]] = defaultdict(lambda: defaultdict(list))
    for row in rows:
        grouped[row.workout_date][row.exercise_name].append(row)

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
        unique_categories = set(movement_categories)
        workout.category = (
            next(iter(unique_categories))
            if len(unique_categories) == 1
            else WorkoutCategory.FULL_BODY
        )
    db.commit()
    return ImportSummary(
        workouts_created=len(grouped),
        exercises_created=exercises_created,
        sets_imported=len(rows),
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
