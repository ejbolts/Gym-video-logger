from __future__ import annotations


def workout_payload(exercise_id: str) -> dict:
    return {
        "name": "Friday push",
        "workout_date": "2026-07-17",
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
    from app.tracker_seed import seed_sample_workouts

    with SessionLocal() as db:
        assert seed_sample_workouts(db) == 5
        assert seed_sample_workouts(db) == 0

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

    assert client.delete("/api/sample-data").status_code == 204
    with SessionLocal() as db:
        assert seed_sample_workouts(db) == 0
    assert client.get("/api/workouts").json() == []
