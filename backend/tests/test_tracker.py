from __future__ import annotations

from datetime import date
from io import BytesIO

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
    assert {"Barbell Bench Press", "Back Squat", "Running"} <= names
    assert next(item for item in exercises if item["name"] == "Barbell Row")["muscle_group"] == (
        "Mid / Upper Back"
    )
    assert (
        next(item for item in exercises if item["name"] == "Lat Pulldown")["muscle_group"] == "Lats"
    )
    recommendation = client.get("/api/dashboard").json()["recommendation"]
    assert recommendation["category"] == "push"
    assert recommendation["rotation_next"] == "push"


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
        "bodyweight_kg": None,
        "percentile": None,
        "warmup": False,
        "notes": "Moved cleanly",
        "completed": True,
    }


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
    assert recommendation["category"] == "lower"
    assert "moves ahead of Push" in recommendation["reason"]

    assert client.delete("/api/sample-data").status_code == 204
    with SessionLocal() as db:
        assert seed_sample_workouts(db) == 0
    assert client.get("/api/workouts").json() == []


def test_machine_photos_are_processed_pinned_and_protected_while_referenced(client):
    exercise = next(
        item for item in client.get("/api/exercises").json() if item["name"] == "Leg Curl"
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

    updated = client.put(f"/api/workouts/{workout.json()['id']}", json=payload)
    assert updated.status_code == 200
    assert updated.json()["movements"][0]["machine_photos"][0]["id"] == photo["id"]
    assert client.delete(f"/api/machine-photos/{photo['id']}").status_code == 409

    assert client.delete(f"/api/workouts/{workout.json()['id']}").status_code == 204
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
    assert goal["effective_sets"] == 2
    assert goal["unrated_sets"] == 1
    assert goal["low_rpe_sets"] == 1
    assert goal["rpe_logging_percent"] == 66.7
    assert goal["overall_percent"] == 16.7
    assert goal["muscle_groups"] == [
        {
            "muscle_group": "Chest",
            "raw_sets": 3.0,
            "effective_sets": 2.0,
            "target_sets": 12,
            "average_rpe": 7.0,
            "status": "below",
        }
    ]

    changed = client.put("/api/training-mode", json={"mode": "cut"})
    assert changed.status_code == 200
    assert changed.json() == {"mode": "cut"}
    cut_dashboard = client.get("/api/dashboard").json()
    assert cut_dashboard["weekly_goal"]["target_sets_per_muscle"] == 10
    assert cut_dashboard["weekly_goal"]["overall_percent"] == 20.0
    assert "Cut goal" in cut_dashboard["recommendation"]["reason"]
