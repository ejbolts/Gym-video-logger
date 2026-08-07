from __future__ import annotations

import csv
from datetime import date, timedelta
from io import BytesIO, StringIO

from PIL import Image
from pillow_heif import from_pillow


def workout_payload(exercise_id: str) -> dict:
    return {
        "name": "Friday push",
        "workout_date": date.today().isoformat(),
        "category": "push",
        "notes": "Strong session",
        "duration_minutes": 62,
        "movements": [
            {
                "exercise_id": exercise_id,
                "notes": "Pause on chest",
                "sets": [
                    {
                        "reps": 5,
                        "weight_kg": 100,
                        "rpe": 8.5,
                        "rest_seconds": 180,
                        "notes": "Moved cleanly",
                        "completed": True,
                    },
                    {
                        "reps": 5,
                        "weight_kg": 102.5,
                        "rpe": 9,
                        "rest_seconds": 180,
                        "notes": None,
                        "completed": True,
                    },
                ],
            }
        ],
    }


def test_default_exercise_library_is_seeded(client):
    response = client.get("/api/exercises")

    assert response.status_code == 200
    exercises = response.json()
    names = {item["name"] for item in exercises}
    assert {
        "Barbell Bench Press",
        "Back Squat",
        "Back Extension Machine",
        "Cable Shoulder Extensions",
        "Cycling (Indoor)",
        "Incline Treadmill Walking",
        "Machine Bicep Preacher Curl",
        "Pec Deck",
        "Running",
        "Seated Ab Crunch Machine",
        "Seated Leg Curl",
        "Seated Machine Row",
        "Single-Arm Cable Triceps Pushdown",
        "Single-Arm Lat Pulldown",
        "Single-Arm Preacher Curl",
        "Single Leg Press",
        "Triceps Machine Extension",
        "Lying Leg Curl",
    } <= names
    assert "Leg Curl" not in names
    pec_deck = next(item for item in exercises if item["name"] == "Pec Deck")
    assert pec_deck["category"] == "push"
    assert pec_deck["muscle_group"] == "Chest"
    assert pec_deck["equipment"] == "Machine"
    indoor_cycling = next(item for item in exercises if item["name"] == "Cycling (Indoor)")
    assert indoor_cycling["category"] == "cardio"
    assert indoor_cycling["kind"] == "cardio"
    assert indoor_cycling["muscle_group"] == "Cardio"
    assert indoor_cycling["equipment"] == "Stationary Bike"
    shoulder_extensions = next(
        item for item in exercises if item["name"] == "Cable Shoulder Extensions"
    )
    assert shoulder_extensions["category"] == "pull"
    assert shoulder_extensions["muscle_group"] == "Rear Delts"
    assert shoulder_extensions["equipment"] == "Cable"
    assert shoulder_extensions["muscle_contributions"] == [
        {"muscle_name": "Rear deltoids", "role": "primary", "contribution_factor": 1.0}
    ]
    triceps_extension = next(
        item for item in exercises if item["name"] == "Triceps Machine Extension"
    )
    assert triceps_extension["category"] == "push"
    assert triceps_extension["muscle_group"] == "Triceps"
    assert triceps_extension["equipment"] == "Machine"
    assert triceps_extension["muscle_contributions"] == [
        {"muscle_name": "Triceps", "role": "primary", "contribution_factor": 1.0}
    ]
    single_arm_pushdown = next(
        item for item in exercises if item["name"] == "Single-Arm Cable Triceps Pushdown"
    )
    assert single_arm_pushdown["category"] == "push"
    assert single_arm_pushdown["muscle_group"] == "Triceps"
    assert single_arm_pushdown["equipment"] == "Cable"
    assert single_arm_pushdown["muscle_contributions"] == [
        {"muscle_name": "Triceps", "role": "primary", "contribution_factor": 1.0}
    ]
    single_arm_preacher = next(
        item for item in exercises if item["name"] == "Single-Arm Preacher Curl"
    )
    assert single_arm_preacher["category"] == "pull"
    assert single_arm_preacher["muscle_group"] == "Biceps"
    assert single_arm_preacher["equipment"] == "Dumbbell"
    assert single_arm_preacher["muscle_contributions"] == [
        {"muscle_name": "Biceps", "role": "primary", "contribution_factor": 1.0}
    ]
    incline_press = next(item for item in exercises if item["name"] == "Incline Dumbbell Press")
    assert {item["muscle_name"] for item in incline_press["muscle_contributions"]} == {
        "Pectorals",
        "Front delts",
        "Triceps",
    }
    lateral_raise = next(item for item in exercises if item["name"] == "Lateral Raise")
    assert {item["muscle_name"] for item in lateral_raise["muscle_contributions"]} == {
        "Side delts",
        "Upper traps",
    }
    face_pull = next(item for item in exercises if item["name"] == "Face Pull")
    assert {item["muscle_name"] for item in face_pull["muscle_contributions"]} == {
        "Rear deltoids",
        "Mid / Upper Back",
    }
    hammer_curl = next(item for item in exercises if item["name"] == "Hammer Curl")
    assert {item["muscle_name"] for item in hammer_curl["muscle_contributions"]} == {
        "Biceps",
        "Forearms",
    }
    single_arm_lat_pulldown = next(
        item for item in exercises if item["name"] == "Single-Arm Lat Pulldown"
    )
    assert single_arm_lat_pulldown["category"] == "pull"
    assert single_arm_lat_pulldown["muscle_group"] == "Lats"
    assert single_arm_lat_pulldown["equipment"] == "Cable"
    assert single_arm_lat_pulldown["muscle_contributions"] == [
        {"muscle_name": "Lats", "role": "primary", "contribution_factor": 1.0}
    ]
    seated_machine_row = next(
        item for item in exercises if item["name"] == "Seated Machine Row"
    )
    assert seated_machine_row["category"] == "pull"
    assert seated_machine_row["muscle_group"] == "Mid / Upper Back"
    assert seated_machine_row["equipment"] == "Machine"
    seated_machine_row_contributions = {
        contribution["muscle_name"]: contribution
        for contribution in seated_machine_row["muscle_contributions"]
    }
    assert seated_machine_row_contributions == {
        "Mid / Upper Back": {
            "muscle_name": "Mid / Upper Back",
            "role": "primary",
            "contribution_factor": 1.0,
        },
        "Lats": {"muscle_name": "Lats", "role": "secondary", "contribution_factor": 0.5},
        "Biceps": {
            "muscle_name": "Biceps",
            "role": "secondary",
            "contribution_factor": 0.5,
        },
    }
    seated_ab_crunch = next(
        item for item in exercises if item["name"] == "Seated Ab Crunch Machine"
    )
    assert seated_ab_crunch["category"] == "full_body"
    assert seated_ab_crunch["muscle_group"] == "Core"
    assert seated_ab_crunch["equipment"] == "Machine"
    assert seated_ab_crunch["muscle_contributions"] == [
        {"muscle_name": "Core", "role": "primary", "contribution_factor": 1.0}
    ]
    machine_preacher_curl = next(
        item for item in exercises if item["name"] == "Machine Bicep Preacher Curl"
    )
    assert machine_preacher_curl["category"] == "pull"
    assert machine_preacher_curl["muscle_group"] == "Biceps"
    assert machine_preacher_curl["equipment"] == "Machine"
    assert machine_preacher_curl["muscle_contributions"] == [
        {"muscle_name": "Biceps", "role": "primary", "contribution_factor": 1.0}
    ]
    single_leg_press = next(item for item in exercises if item["name"] == "Single Leg Press")
    assert single_leg_press["category"] == "lower"
    assert single_leg_press["muscle_group"] == "Quads"
    assert single_leg_press["equipment"] == "Machine"
    assert {
        contribution["muscle_name"]: contribution
        for contribution in single_leg_press["muscle_contributions"]
    } == {
        "Quadriceps": {
            "muscle_name": "Quadriceps",
            "role": "primary",
            "contribution_factor": 1.0,
        },
        "Glutes": {"muscle_name": "Glutes", "role": "primary", "contribution_factor": 1.0},
        "Adductors": {
            "muscle_name": "Adductors",
            "role": "secondary",
            "contribution_factor": 0.5,
        },
    }
    for leg_curl_name in ("Seated Leg Curl", "Lying Leg Curl"):
        leg_curl = next(item for item in exercises if item["name"] == leg_curl_name)
        assert leg_curl["category"] == "lower"
        assert leg_curl["muscle_group"] == "Hamstrings"
        assert leg_curl["equipment"] == "Machine"
        assert leg_curl["muscle_contributions"] == [
            {
                "muscle_name": "Hamstrings",
                "role": "primary",
                "contribution_factor": 1.0,
            }
        ]
    back_extension = next(
        item for item in exercises if item["name"] == "Back Extension Machine"
    )
    assert back_extension["category"] == "lower"
    assert back_extension["muscle_group"] == "Lower Back"
    assert back_extension["equipment"] == "Machine"
    assert {
        contribution["muscle_name"]: contribution
        for contribution in back_extension["muscle_contributions"]
    } == {
        "Spinal erectors": {
            "muscle_name": "Spinal erectors",
            "role": "primary",
            "contribution_factor": 1.0,
        },
        "Glutes": {"muscle_name": "Glutes", "role": "secondary", "contribution_factor": 0.5},
        "Hamstrings": {
            "muscle_name": "Hamstrings",
            "role": "primary",
            "contribution_factor": 1.0,
        },
    }
    assert next(item for item in exercises if item["name"] == "Barbell Row")["muscle_group"] == (
        "Mid / Upper Back"
    )
    assert (
        next(item for item in exercises if item["name"] == "Lat Pulldown")["muscle_group"] == "Lats"
    )
    recommendation = client.get("/api/dashboard").json()["recommendation"]
    assert recommendation["category"] == "push"
    assert recommendation["rotation_next"] == "push"


def test_default_muscle_mappings_are_resynchronized(client):
    from sqlalchemy import select
    from sqlalchemy.orm import selectinload

    from app.database import SessionLocal
    from app.models import Exercise, MuscleRole
    from app.training_metrics import seed_muscle_mappings

    with SessionLocal() as db:
        exercise = db.scalar(
            select(Exercise)
            .where(Exercise.name == "Back Extension Machine")
            .options(selectinload(Exercise.muscle_contributions))
        )
        assert exercise is not None
        hamstrings = next(
            item for item in exercise.muscle_contributions if item.muscle_name == "Hamstrings"
        )
        hamstrings.role = MuscleRole.SECONDARY
        hamstrings.contribution_factor = 0.5
        db.commit()
        seed_muscle_mappings(db)

    updated = next(
        item
        for item in client.get("/api/exercises").json()
        if item["name"] == "Back Extension Machine"
    )
    hamstrings = next(
        item for item in updated["muscle_contributions"] if item["muscle_name"] == "Hamstrings"
    )
    assert hamstrings == {
        "muscle_name": "Hamstrings",
        "role": "primary",
        "contribution_factor": 1.0,
    }


def test_legacy_leg_curl_is_renamed_without_changing_its_id(client):
    from sqlalchemy import select

    from app.database import SessionLocal
    from app.models import Exercise
    from app.tracker import seed_default_exercises

    with SessionLocal() as db:
        exercise = db.scalar(select(Exercise).where(Exercise.name == "Seated Leg Curl"))
        assert exercise is not None
        original_id = exercise.id
        exercise.name = "Leg Curl"
        db.commit()

        seed_default_exercises(db)

        renamed = db.scalar(select(Exercise).where(Exercise.name == "Seated Leg Curl"))
        assert renamed is not None
        assert renamed.id == original_id
        assert db.scalar(select(Exercise).where(Exercise.name == "Leg Curl")) is None


def test_exercise_favorites_are_persisted(client):
    exercise = client.get("/api/exercises").json()[0]
    assert exercise["is_favorite"] is False

    updated = client.patch(f"/api/exercises/{exercise['id']}/favorite", json={"is_favorite": True})

    assert updated.status_code == 200
    assert updated.json()["is_favorite"] is True
    persisted = next(
        item for item in client.get("/api/exercises").json() if item["id"] == exercise["id"]
    )
    assert persisted["is_favorite"] is True


def test_workout_sets_notes_rest_and_rpe_are_saved(client):
    exercise = next(
        item
        for item in client.get("/api/exercises").json()
        if item["name"] == "Barbell Bench Press"
    )

    response = client.post("/api/workouts", json=workout_payload(exercise["id"]))

    assert response.status_code == 201
    workout = response.json()
    assert workout["category"] == "push"
    assert workout["movements"][0]["sets"][0] == {
        "id": workout["movements"][0]["sets"][0]["id"],
        "order_index": 0,
        "reps": 5,
        "weight_kg": 100.0,
        "rpe": 8.5,
        "rest_seconds": 180,
        "duration_seconds": None,
        "distance_km": None,
        "incline_percent": None,
        "speed_kph": None,
        "bodyweight_kg": None,
        "percentile": None,
        "warmup": False,
        "set_type": "normal",
        "failed": False,
        "target_reps": None,
        "notes": "Moved cleanly",
        "completed": True,
    }


def test_treadmill_incline_and_speed_are_saved(client):
    exercise = next(
        item
        for item in client.get("/api/exercises").json()
        if item["name"] == "Incline Treadmill Walking"
    )
    payload = workout_payload(exercise["id"])
    payload["category"] = "cardio"
    payload["movements"][0]["sets"][0].update(
        {
            "reps": None,
            "weight_kg": None,
            "duration_seconds": 1_800,
            "distance_km": 2.7,
            "incline_percent": 12.5,
            "speed_kph": 5.4,
        }
    )

    response = client.post("/api/workouts", json=payload)

    assert response.status_code == 201
    saved_set = response.json()["movements"][0]["sets"][0]
    assert saved_set["incline_percent"] == 12.5
    assert saved_set["speed_kph"] == 5.4


def test_body_measurements_are_upserted_and_used_in_calendar_workouts(client):
    created = client.post(
        "/api/body-measurements",
        json={
            "measurement_date": "2026-07-17",
            "weight_kg": 88,
            "body_fat_pct": 18.5,
            "notes": "Morning check-in",
        },
    )
    exercise = next(
        item
        for item in client.get("/api/exercises").json()
        if item["name"] == "Barbell Bench Press"
    )
    assert client.post("/api/workouts", json=workout_payload(exercise["id"])).status_code == 201

    day = client.get("/api/dashboard").json()["heatmap"][0]
    assert created.status_code == 200
    assert day["workouts"][0]["exercises"][0]["bodyweight_kg"] == 88

    updated = client.post(
        "/api/body-measurements",
        json={
            "measurement_date": "2026-07-17",
            "weight_kg": 87.6,
            "body_fat_pct": 18.1,
            "notes": None,
        },
    )
    measurements = client.get("/api/body-measurements").json()
    assert updated.json()["id"] == created.json()["id"]
    assert len(measurements) == 1
    assert measurements[0]["weight_kg"] == 87.6
    assert client.delete(f"/api/body-measurements/{measurements[0]['id']}").status_code == 204


def test_body_measurement_csv_import_updates_dates_and_exports_history(client):
    existing = client.post(
        "/api/body-measurements",
        json={
            "measurement_date": "2026-07-17",
            "weight_kg": 88,
            "body_fat_pct": 18.5,
            "notes": "Original",
        },
    ).json()
    content = (
        "Date,Weight (kg),Body Fat (%),Notes\n"
        '2026-07-17,87.4,18,"Updated, morning"\n'
        "2026-07-18,87.1,,Evening check-in\n"
    )

    imported = client.post(
        "/api/body-measurements/import",
        files={"file": ("body-weight.csv", content.encode(), "text/csv")},
    )

    assert imported.status_code == 201
    assert imported.json() == {
        "measurements_created": 1,
        "measurements_updated": 1,
        "rows_imported": 2,
    }
    measurements = client.get("/api/body-measurements").json()
    assert [item["measurement_date"] for item in measurements] == ["2026-07-18", "2026-07-17"]
    updated = measurements[1]
    assert updated["id"] == existing["id"]
    assert updated["weight_kg"] == 87.4
    assert updated["body_fat_pct"] == 18
    assert updated["notes"] == "Updated, morning"
    assert updated["is_sample"] is False

    exported = client.get("/api/body-measurements/export.csv")
    rows = list(csv.DictReader(StringIO(exported.content.decode("utf-8-sig"))))
    assert exported.status_code == 200
    assert "body-weight-" in exported.headers["content-disposition"]
    assert rows == [
        {
            "Date": "2026-07-17",
            "Weight (kg)": "87.4",
            "Body Fat (%)": "18",
            "Notes": "Updated, morning",
        },
        {
            "Date": "2026-07-18",
            "Weight (kg)": "87.1",
            "Body Fat (%)": "",
            "Notes": "Evening check-in",
        },
    ]


def test_body_measurement_csv_rejects_duplicate_dates_without_partial_import(client):
    content = (
        "Date,Weight (kg),Body Fat (%),Notes\n2026-07-17,87.4,,Morning\n2026-07-17,87.2,,Evening\n"
    )

    imported = client.post(
        "/api/body-measurements/import",
        files={"file": ("body-weight.csv", content.encode(), "text/csv")},
    )

    assert imported.status_code == 422
    assert "appears more than once" in imported.json()["error"]["message"]
    assert client.get("/api/body-measurements").json() == []


def test_dashboard_and_progress_reflect_completed_workout(client):
    exercise = next(
        item
        for item in client.get("/api/exercises").json()
        if item["name"] == "Barbell Bench Press"
    )
    created = client.post("/api/workouts", json=workout_payload(exercise["id"]))
    assert created.status_code == 201

    dashboard = client.get("/api/dashboard")
    progress = client.get(f"/api/progress/{exercise['id']}")

    assert dashboard.status_code == 200
    assert dashboard.json()["sets_this_week"] == 2
    assert dashboard.json()["volume_this_week_kg"] == 1012.5
    assert dashboard.json()["heatmap"][0]["categories"] == ["push"]
    assert dashboard.json()["weekly_days"][0]["total_sets"] == 2
    assert dashboard.json()["weekly_days"][0]["exercises"][0] == {
        "exercise_id": exercise["id"],
        "exercise_name": "Barbell Bench Press",
        "muscle_group": "Chest",
        "category": "push",
        "set_count": 2,
        "volume_kg": 1012.5,
    }
    assert dashboard.json()["recommendation"]["category"] == "pull"
    assert dashboard.json()["recommendation"]["rotation_next"] == "pull"
    assert progress.status_code == 200
    assert progress.json()["personal_best_weight_kg"] == 102.5
    assert progress.json()["points"][0]["estimated_1rm"] == 119.6


def test_workout_requires_a_completed_set(client):
    exercise = client.get("/api/exercises").json()[0]
    payload = workout_payload(exercise["id"])
    for item in payload["movements"][0]["sets"]:
        item["completed"] = False

    response = client.post("/api/workouts", json=payload)

    assert response.status_code == 422


def test_csv_import_and_export_use_supplied_column_format(client):
    content = (
        "Date Lifted\tExercise\tWeight (kg)\tWeight (lb)\tReps\tBodyweight (kg)\t"
        "Bodyweight (lb)\tPercentile (%)\tWarmup\n"
        "2026-07-17\tMachine Reverse Fly\t45\t99.2\t10\t83.6\t184.3\t38\t1\n"
        "2026-07-17\tMachine Reverse Fly\t51\t112.4\t10\t83.6\t184.3\t48.7\t0\n"
    )

    imported = client.post(
        "/api/workouts/import",
        files={"file": ("workouts.tsv", content.encode(), "text/tab-separated-values")},
    )
    exported = client.get("/api/workouts/export.csv")

    assert imported.status_code == 201
    assert imported.json() == {
        "workouts_created": 1,
        "exercises_created": 1,
        "sets_imported": 2,
        "warnings": [],
    }
    imported_exercise = next(
        item
        for item in client.get("/api/exercises").json()
        if item["name"] == "Machine Reverse Fly"
    )
    assert imported_exercise["muscle_group"] == "Rear Delts"
    assert exported.status_code == 200
    decoded = exported.content.decode("utf-8-sig")
    assert decoded.splitlines()[0] == (
        "Date Lifted,Exercise,Weight (kg),Weight (lb),Reps,Bodyweight (kg),"
        "Bodyweight (lb),Percentile (%),Warmup"
    )
    assert "2026-07-17,Machine Reverse Fly,45,99.2,10,83.6,184.3,38,1" in decoded


def test_sample_seed_creates_one_week_once(client):
    from app.database import SessionLocal
    from app.tracker_seed import seed_sample_body_measurements, seed_sample_workouts

    with SessionLocal() as db:
        assert seed_sample_workouts(db) == 5
        assert seed_sample_workouts(db) == 0
        assert seed_sample_body_measurements(db) == 3
        assert seed_sample_body_measurements(db) == 0

    workouts = client.get("/api/workouts").json()
    assert len(workouts) == 5
    assert all(item["is_sample"] for item in workouts)
    assert len({item["workout_date"] for item in workouts}) == 4

    today = max(item["workout_date"] for item in workouts)
    today_heatmap = next(
        item
        for item in client.get("/api/dashboard").json()["heatmap"]
        if item["workout_date"] == today
    )
    assert today_heatmap["categories"] == ["upper", "cardio"]
    assert today < date.today().isoformat()
    recommendation = client.get("/api/dashboard").json()["recommendation"]
    assert recommendation["rotation_next"] == "push"
    assert recommendation["category"] in {"push", "lower"}

    assert client.delete("/api/sample-data").status_code == 204
    with SessionLocal() as db:
        assert seed_sample_workouts(db) == 0
    assert client.get("/api/workouts").json() == []


def test_machine_photos_are_processed_pinned_and_protected_while_referenced(client):
    exercise = next(
        item
        for item in client.get("/api/exercises").json()
        if item["name"] == "Seated Leg Curl"
    )
    image_buffer = BytesIO()
    source = Image.new("RGB", (1200, 2400), "#e86f35")
    exif = source.getexif()
    exif[274] = 6  # Rotate a portrait sensor image into landscape display orientation.
    source.save(image_buffer, format="JPEG", exif=exif)

    uploaded = client.post(
        f"/api/exercises/{exercise['id']}/machine-photos",
        data={"caption": "Hammer Strength lying leg curl"},
        files={"file": ("../../machine.jpg", image_buffer.getvalue(), "image/jpeg")},
    )

    assert uploaded.status_code == 201
    photo = uploaded.json()
    assert photo["caption"] == "Hammer Strength lying leg curl"
    assert (photo["width"], photo["height"]) == (1800, 900)
    assert photo["thumbnail_url"].endswith("variant=thumbnail")
    assert client.get(f"/api/exercises/{exercise['id']}/machine-photos").json() == [photo]
    assert client.get(f"/api/exercises/{exercise['id']}/machine-photos/last-used").json() == []

    full = client.get(photo["full_url"])
    thumbnail = client.get(photo["thumbnail_url"])
    assert full.status_code == thumbnail.status_code == 200
    assert full.headers["content-type"] == "image/webp"
    with Image.open(BytesIO(full.content)) as decoded_full:
        assert decoded_full.size == (1800, 900)
        assert decoded_full.format == "WEBP"
    with Image.open(BytesIO(thumbnail.content)) as decoded_thumbnail:
        assert max(decoded_thumbnail.size) == 360

    renamed = client.patch(
        f"/api/machine-photos/{photo['id']}",
        json={"caption": "Life Fitness lying leg curl"},
    )
    assert renamed.status_code == 200
    assert renamed.json()["caption"] == "Life Fitness lying leg curl"

    payload = workout_payload(exercise["id"])
    payload["movements"][0]["machine_photo_ids"] = [photo["id"]]
    workout = client.post("/api/workouts", json=payload)
    assert workout.status_code == 201
    assert workout.json()["movements"][0]["machine_photos"][0]["id"] == photo["id"]
    assert client.get(
        f"/api/exercises/{exercise['id']}/machine-photos/last-used"
    ).json() == [renamed.json()]

    updated = client.put(f"/api/workouts/{workout.json()['id']}", json=payload)
    assert updated.status_code == 200
    assert updated.json()["movements"][0]["machine_photos"][0]["id"] == photo["id"]
    assert client.delete(f"/api/machine-photos/{photo['id']}").status_code == 409

    second_buffer = BytesIO()
    Image.new("RGB", (800, 600), "#293d6b").save(second_buffer, format="JPEG")
    second_photo = client.post(
        f"/api/exercises/{exercise['id']}/machine-photos",
        data={"caption": "Technogym seated leg curl"},
        files={"file": ("technogym.jpg", second_buffer.getvalue(), "image/jpeg")},
    ).json()
    next_payload = workout_payload(exercise["id"])
    next_payload["workout_date"] = (date.today() + timedelta(days=1)).isoformat()
    next_payload["movements"][0]["machine_photo_ids"] = [second_photo["id"]]
    next_workout = client.post("/api/workouts", json=next_payload)
    assert next_workout.status_code == 201
    assert client.get(
        f"/api/exercises/{exercise['id']}/machine-photos/last-used"
    ).json() == [second_photo]

    assert client.delete(f"/api/workouts/{next_workout.json()['id']}").status_code == 204
    assert client.get(
        f"/api/exercises/{exercise['id']}/machine-photos/last-used"
    ).json() == [renamed.json()]
    assert client.delete(f"/api/workouts/{workout.json()['id']}").status_code == 204
    assert client.get(f"/api/exercises/{exercise['id']}/machine-photos/last-used").json() == []
    assert client.delete(f"/api/machine-photos/{second_photo['id']}").status_code == 204
    assert client.delete(f"/api/machine-photos/{photo['id']}").status_code == 204
    assert client.get(photo["full_url"]).status_code == 404


def test_machine_photo_rejects_invalid_images_and_cross_exercise_pins(client):
    exercises = client.get("/api/exercises").json()
    bench = next(item for item in exercises if item["name"] == "Barbell Bench Press")
    squat = next(item for item in exercises if item["name"] == "Back Squat")
    invalid = client.post(
        f"/api/exercises/{bench['id']}/machine-photos",
        data={"caption": "Not really a machine"},
        files={"file": ("fake.jpg", b"not an image", "image/jpeg")},
    )
    assert invalid.status_code == 422

    image_buffer = BytesIO()
    Image.new("RGB", (50, 50), "black").save(image_buffer, format="PNG")
    photo = client.post(
        f"/api/exercises/{bench['id']}/machine-photos",
        data={"caption": "Bench station"},
        files={"file": ("bench.png", image_buffer.getvalue(), "image/png")},
    ).json()
    payload = workout_payload(squat["id"])
    payload["movements"][0]["machine_photo_ids"] = [photo["id"]]
    response = client.post("/api/workouts", json=payload)
    assert response.status_code == 422
    assert "must belong" in response.json()["error"]["message"]


def test_iphone_heic_machine_photo_is_accepted_and_converted_to_webp(client):
    exercise = next(
        item for item in client.get("/api/exercises").json() if item["name"] == "Leg Press"
    )
    heic_buffer = BytesIO()
    from_pillow(Image.new("RGB", (800, 1200), "#263242")).save(heic_buffer)

    uploaded = client.post(
        f"/api/exercises/{exercise['id']}/machine-photos",
        data={"caption": "Life Fitness leg press"},
        files={"file": ("IMG_1234.HEIC", heic_buffer.getvalue(), "image/heic")},
    )

    assert uploaded.status_code == 201
    image = client.get(uploaded.json()["full_url"])
    assert image.status_code == 200
    assert image.headers["content-type"] == "image/webp"
    with Image.open(BytesIO(image.content)) as decoded:
        assert decoded.format == "WEBP"
        assert decoded.size == (800, 1200)


def test_training_mode_changes_rpe_aware_weekly_goal(client):
    exercise = next(
        item
        for item in client.get("/api/exercises").json()
        if item["name"] == "Barbell Bench Press"
    )
    payload = workout_payload(exercise["id"])
    payload["movements"][0]["sets"] = [
        {"reps": 8, "weight_kg": 80, "rpe": 8, "completed": True},
        {"reps": 8, "weight_kg": 80, "rpe": 6, "completed": True},
        {"reps": 8, "weight_kg": 80, "rpe": None, "completed": True},
        {"reps": 5, "weight_kg": 20, "rpe": 8, "warmup": True, "completed": True},
    ]
    assert client.post("/api/workouts", json=payload).status_code == 201

    dashboard = client.get("/api/dashboard").json()
    goal = dashboard["weekly_goal"]
    assert dashboard["training_mode"] == "maintenance"
    assert goal["target_sets_per_muscle"] == 12
    assert goal["raw_sets"] == 3
    assert goal["effective_sets"] == 4
    assert goal["unrated_sets"] == 1
    assert goal["low_rpe_sets"] == 1
    assert goal["rpe_logging_percent"] == 66.7
    assert goal["overall_percent"] == 16.7
    assert {item["muscle_group"]: item["effective_sets"] for item in goal["muscle_groups"]} == {
        "Front delts": 1.0,
        "Pectorals": 2.0,
        "Triceps": 1.0,
    }
    assert {item["muscle_group"]: item["target_sets"] for item in goal["muscle_groups"]} == {
        "Front delts": 6,
        "Pectorals": 12,
        "Triceps": 6,
    }

    changed = client.put("/api/training-mode", json={"mode": "cut", "effective_date": "2026-07-01"})
    assert changed.status_code == 200
    assert changed.json() == {"mode": "cut"}
    phases = client.get("/api/training-phases").json()
    assert len(phases) == 1
    assert phases[0]["start_date"] == "2026-07-01"
    assert phases[0]["mode"] == "cut"
    cut_dashboard = client.get("/api/dashboard").json()
    assert cut_dashboard["weekly_goal"]["target_sets_per_muscle"] == 10
    assert cut_dashboard["weekly_goal"]["overall_percent"] == 20.0
    assert {
        item["muscle_group"]: item["target_sets"]
        for item in cut_dashboard["weekly_goal"]["muscle_groups"]
    } == {"Front delts": 5, "Pectorals": 10, "Triceps": 5}
    assert "Cut goal" in cut_dashboard["recommendation"]["reason"]

    assert (
        client.put(
            "/api/training-mode", json={"mode": "bulk", "effective_date": "2026-07-01"}
        ).status_code
        == 200
    )
    bulk_goal = client.get("/api/dashboard").json()["weekly_goal"]
    assert bulk_goal["target_sets_per_muscle"] == 14
    assert bulk_goal["overall_percent"] == 14.3
    assert {item["muscle_group"]: item["target_sets"] for item in bulk_goal["muscle_groups"]} == {
        "Front delts": 7,
        "Pectorals": 14,
        "Triceps": 7,
    }


def test_active_body_weight_goal_infers_and_persists_training_mode(client):
    cases = (
        (98.9, "cut"),
        (99.0, "maintenance"),
        (101.0, "maintenance"),
        (101.1, "bulk"),
    )

    for target_weight, expected_mode in cases:
        created = client.post(
            "/api/body-weight-goals",
            json={
                "start_date": "2026-07-30",
                "target_date": "2026-12-30",
                "start_weight_kg": 100,
                "target_weight_kg": target_weight,
                "mode": "cut" if expected_mode != "cut" else "bulk",
                "active": True,
            },
        )

        assert created.status_code == 201
        assert created.json()["mode"] == expected_mode
        assert client.get("/api/dashboard").json()["training_mode"] == expected_mode
        phases = client.get("/api/training-phases").json()
        assert len(phases) == 1
        assert phases[0]["start_date"] == "2026-07-30"
        assert phases[0]["mode"] == expected_mode


def test_pr_types_warmups_failed_sets_and_unit_conversion(client):
    bench = next(
        item
        for item in client.get("/api/exercises").json()
        if item["name"] == "Barbell Bench Press"
    )
    payload = workout_payload(bench["id"])
    payload["movements"][0]["sets"] = [
        {"reps": 5, "weight_kg": 120, "set_type": "warmup", "completed": True},
        {"reps": 5, "target_reps": 6, "weight_kg": 105, "failed": True, "completed": True},
        {"reps": 5, "weight_kg": 100, "completed": True},
    ]
    first = client.post("/api/workouts", json=payload)
    assert first.status_code == 201
    records = client.get("/api/personal-records").json()
    assert {item["record_type"] for item in records} == {"weight", "estimated_1rm"}
    assert {item["normalized_weight"] for item in records} == {100.0}

    payload["workout_date"] = (date.today() + timedelta(days=1)).isoformat()
    payload["movements"][0]["sets"] = [{"reps": 6, "weight_kg": 100, "completed": True}]
    second = client.post("/api/workouts", json=payload)
    second_records = client.get(
        "/api/personal-records", params={"workout_id": second.json()["id"]}
    ).json()
    assert {item["record_type"] for item in second_records} == {"reps_at_weight", "estimated_1rm"}

    preferences = {"preferred_weight_unit": "lb", "week_start": "monday", "zone2_goal_minutes": 150}
    assert client.put("/api/training-preferences", json=preferences).status_code == 200
    converted = client.get(
        "/api/personal-records", params={"workout_id": first.json()["id"]}
    ).json()
    weight_record = next(item for item in converted if item["record_type"] == "weight")
    assert weight_record["unit"] == "lb"
    assert weight_record["value"] == 220.5


def test_fractional_muscle_volume_and_pr_rebuild_after_edit_delete(client):
    bench = next(
        item
        for item in client.get("/api/exercises").json()
        if item["name"] == "Barbell Bench Press"
    )
    payload = workout_payload(bench["id"])
    payload["movements"][0]["sets"] = [
        {"reps": 10, "weight_kg": 20, "set_type": "warmup", "completed": True},
        {"reps": 5, "weight_kg": 100, "completed": True},
    ]
    created = client.post("/api/workouts", json=payload).json()
    totals = {
        item["muscle_name"]: item["set_total"] for item in client.get("/api/muscle-volume").json()
    }
    assert totals == {"Front delts": 0.5, "Pectorals": 1.0, "Triceps": 0.5}
    original_count = len(client.get("/api/personal-records").json())
    assert client.put(f"/api/workouts/{created['id']}", json=payload).status_code == 200
    assert len(client.get("/api/personal-records").json()) == original_count

    payload["movements"][0]["sets"] = [{"reps": 5, "weight_kg": 80, "completed": True}]
    assert client.put(f"/api/workouts/{created['id']}", json=payload).status_code == 200
    assert (
        max(
            item["value"]
            for item in client.get("/api/personal-records").json()
            if item["record_type"] == "weight"
        )
        == 80
    )
    assert client.delete(f"/api/workouts/{created['id']}").status_code == 204
    assert client.get("/api/personal-records").json() == []


def test_multiple_exercises_reordering_sets_and_supersets(client):
    exercises = client.get("/api/exercises").json()
    bench = next(item for item in exercises if item["name"] == "Barbell Bench Press")
    press = next(item for item in exercises if item["name"] == "Overhead Press")
    payload = workout_payload(bench["id"])
    payload["movements"] = [
        {
            "exercise_id": bench["id"],
            "superset_key": "pair-a",
            "sets": [
                {"reps": 5, "weight_kg": 100, "completed": True},
                {"reps": 8, "weight_kg": 80, "completed": True},
            ],
        },
        {
            "exercise_id": press["id"],
            "superset_key": "pair-a",
            "sets": [{"reps": 6, "weight_kg": 60, "completed": True}],
        },
    ]
    created = client.post("/api/workouts", json=payload)
    assert created.status_code == 201
    workout = created.json()
    assert (
        workout["movements"][0]["superset_group_id"] == workout["movements"][1]["superset_group_id"]
    )

    payload["movements"].reverse()
    payload["movements"][1]["sets"].reverse()
    for movement in payload["movements"]:
        movement["superset_key"] = None
    updated = client.put(f"/api/workouts/{workout['id']}", json=payload).json()
    assert [item["exercise"]["name"] for item in updated["movements"]] == [
        "Overhead Press",
        "Barbell Bench Press",
    ]
    assert [item["weight_kg"] for item in updated["movements"][1]["sets"]] == [80, 100]
    assert all(item["superset_group_id"] is None for item in updated["movements"])

    duplicate = payload.copy()
    duplicate["movements"] = [payload["movements"][0], payload["movements"][0]]
    assert client.post("/api/workouts", json=duplicate).status_code == 422


def test_zone2_week_boundaries_edit_and_delete(client):
    from datetime import timedelta

    today = date.today()
    monday = today - timedelta(days=today.weekday())
    current = {
        "session_date": monday.isoformat(),
        "activity_type": "Cycling",
        "duration_minutes": 60,
        "intensity": "Easy",
        "zone": "Zone 2",
        "qualifies_zone2": True,
        "notes": None,
    }
    previous = {
        **current,
        "session_date": (monday - timedelta(days=1)).isoformat(),
        "duration_minutes": 90,
    }
    other = {**current, "duration_minutes": 40, "qualifies_zone2": False, "zone": "Zone 3"}
    current_id = client.post("/api/cardio", json=current).json()["id"]
    assert client.post("/api/cardio", json=previous).status_code == 201
    other_id = client.post("/api/cardio", json=other).json()["id"]
    overview = client.get("/api/cardio").json()
    assert overview["current_week"]["completed_minutes"] == 60
    assert overview["previous_weeks"][0]["completed_minutes"] == 90

    current["duration_minutes"] = 120
    assert client.put(f"/api/cardio/{current_id}", json=current).status_code == 200
    assert client.get("/api/cardio").json()["current_week"]["completed_minutes"] == 120
    assert client.delete(f"/api/cardio/{current_id}").status_code == 204
    assert client.delete(f"/api/cardio/{other_id}").status_code == 204


def test_completed_treadmill_walking_workout_counts_toward_zone2(client):
    exercise = next(
        item
        for item in client.get("/api/exercises").json()
        if item["name"] == "Incline Treadmill Walking"
    )
    payload = {
        "name": "Incline walking",
        "workout_date": date.today().isoformat(),
        "category": "cardio",
        "notes": None,
        "duration_minutes": 30,
        "movements": [
            {
                "exercise_id": exercise["id"],
                "notes": None,
                "sets": [
                    {
                        "duration_seconds": 1_800,
                        "distance_km": 2.7,
                        "incline_percent": 12.5,
                        "speed_kph": 5.4,
                        "completed": True,
                    }
                ],
            }
        ],
    }

    created = client.post("/api/workouts", json=payload)

    assert created.status_code == 201
    assert client.get("/api/dashboard").json()["zone2"]["completed_minutes"] == 30
    assert client.get("/api/cardio").json()["current_week"]["completed_minutes"] == 30
    assert client.delete(f"/api/workouts/{created.json()['id']}").status_code == 204
    assert client.get("/api/dashboard").json()["zone2"]["completed_minutes"] == 0
    assert client.get("/api/cardio").json()["current_week"]["completed_minutes"] == 0


def test_completed_indoor_cycling_is_imported_as_read_only_cardio_session(client):
    exercise = next(
        item for item in client.get("/api/exercises").json() if item["name"] == "Cycling (Indoor)"
    )
    payload = {
        "name": "Pull and cardio",
        "workout_date": date.today().isoformat(),
        "category": "pull",
        "notes": None,
        "duration_minutes": 60,
        "movements": [
            {
                "exercise_id": exercise["id"],
                "notes": "Easy spin",
                "sets": [
                    {
                        "duration_seconds": 2_400,
                        "distance_km": 17.68,
                        "completed": True,
                    }
                ],
            }
        ],
    }

    created = client.post("/api/workouts", json=payload)

    assert created.status_code == 201
    workout_id = created.json()["id"]
    overview = client.get("/api/cardio").json()
    assert overview["current_week"]["completed_minutes"] == 40
    imported = next(
        session for session in overview["sessions"] if session["source_workout_id"] == workout_id
    )
    assert imported["activity_type"] == "Cycling (Indoor)"
    assert imported["duration_minutes"] == 40
    assert imported["zone"] == "Zone 2"
    assert imported["qualifies_zone2"] is True
    assert imported["notes"] == "Easy spin"
    assert (
        client.put(
            f"/api/cardio/{imported['id']}",
            json={
                "session_date": date.today().isoformat(),
                "activity_type": "Cycling",
                "duration_minutes": 10,
                "intensity": None,
                "zone": "Zone 2",
                "qualifies_zone2": True,
                "notes": None,
            },
        ).status_code
        == 409
    )
    assert client.delete(f"/api/cardio/{imported['id']}").status_code == 409

    payload["movements"][0]["sets"][0]["duration_seconds"] = 3_000
    assert client.put(f"/api/workouts/{workout_id}", json=payload).status_code == 200
    updated_overview = client.get("/api/cardio").json()
    updated = next(
        session
        for session in updated_overview["sessions"]
        if session["source_workout_id"] == workout_id
    )
    assert updated["id"] == imported["id"]
    assert updated["duration_minutes"] == 50
    assert updated_overview["current_week"]["completed_minutes"] == 50

    assert client.delete(f"/api/workouts/{workout_id}").status_code == 204
    final_overview = client.get("/api/cardio").json()
    assert final_overview["current_week"]["completed_minutes"] == 0
    assert all(session["source_workout_id"] != workout_id for session in final_overview["sessions"])
