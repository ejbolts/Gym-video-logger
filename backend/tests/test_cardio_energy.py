from datetime import date

import pytest

from app.cardio_energy import cardio_energy_periods, months_before
from app.models import CardioSession


def period(summaries, name="week"):
    return next(item for item in summaries if item["period"] == name)


def cardio_payload(**values):
    return {
        "session_date": date.today().isoformat(),
        "activity_type": "Cycling",
        "duration_minutes": 30,
        "zone": "Zone 3",
        **values,
    }


def test_record_edit_clear_and_delete_calories(client):
    response = client.post("/api/cardio", json=cardio_payload(calories_kcal=350))
    assert response.status_code == 201
    session = response.json()
    assert session["calories_kcal"] == 350
    client.post("/api/cardio", json=cardio_payload())
    overview = client.get("/api/cardio").json()
    week = period(overview["energy_periods"])
    assert (week["calories_kcal"], week["logged_sessions"], week["total_sessions"]) == (350, 1, 2)
    assert overview["current_week"]["completed_minutes"] == 0
    assert period(client.get("/api/dashboard").json()["cardio_energy_periods"]) == week
    assert (
        client.patch(
            f"/api/cardio/{session['id']}/calories", json={"calories_kcal": 770}
        ).status_code
        == 200
    )
    assert period(client.get("/api/cardio").json()["energy_periods"])["calories_kcal"] == 770
    # Older clients omitting the new field must not wipe recorded calories.
    updated = client.put(f"/api/cardio/{session['id']}", json=cardio_payload()).json()
    assert updated["calories_kcal"] == 770
    client.patch(f"/api/cardio/{session['id']}/calories", json={"calories_kcal": 0})
    assert period(client.get("/api/cardio").json()["energy_periods"])["logged_sessions"] == 1
    client.patch(f"/api/cardio/{session['id']}/calories", json={"calories_kcal": None})
    assert period(client.get("/api/cardio").json()["energy_periods"])["logged_sessions"] == 0
    client.patch(f"/api/cardio/{session['id']}/calories", json={"calories_kcal": 500})
    assert client.delete(f"/api/cardio/{session['id']}").status_code == 204
    assert period(client.get("/api/cardio").json()["energy_periods"])["calories_kcal"] == 0


@pytest.mark.parametrize("calories", [-1, 2.5, 100001, "not a number"])
def test_invalid_calories_are_rejected(client, calories):
    assert (
        client.post("/api/cardio", json=cardio_payload(calories_kcal=calories)).status_code == 422
    )
    session = client.post("/api/cardio", json=cardio_payload()).json()
    assert (
        client.patch(
            f"/api/cardio/{session['id']}/calories", json={"calories_kcal": calories}
        ).status_code
        == 422
    )


def test_calorie_edit_is_narrow_and_missing_session_is_not_found(client):
    assert (
        client.patch("/api/cardio/missing/calories", json={"calories_kcal": 50}).status_code == 404
    )
    session = client.post("/api/cardio", json=cardio_payload()).json()
    assert client.patch(f"/api/cardio/{session['id']}/calories", json={}).status_code == 422
    assert (
        client.patch(
            f"/api/cardio/{session['id']}/calories",
            json={"calories_kcal": 50, "duration_minutes": 10},
        ).status_code
        == 422
    )


def test_linked_calories_survive_workout_edits_and_reordering(client):
    exercises = [item for item in client.get("/api/exercises").json() if item["kind"] == "cardio"][
        :2
    ]
    payload = {
        "name": "Cardio mix",
        "workout_date": date.today().isoformat(),
        "category": "cardio",
        "movements": [
            {"exercise_id": item["id"], "sets": [{"duration_seconds": 1800, "completed": True}]}
            for item in exercises
        ],
    }
    created = client.post("/api/workouts", json=payload)
    assert created.status_code == 201
    workout_id = created.json()["id"]
    sessions = client.get("/api/cardio").json()["sessions"]
    for session in sessions:
        calories = 350 if session["activity_type"] == exercises[0]["name"] else 200
        assert (
            client.patch(
                f"/api/cardio/{session['id']}/calories", json={"calories_kcal": calories}
            ).status_code
            == 200
        )
    payload["movements"].reverse()
    payload["movements"][0]["sets"][0]["duration_seconds"] = 2100
    assert client.put(f"/api/workouts/{workout_id}", json=payload).status_code == 200
    sessions = client.get("/api/cardio").json()["sessions"]
    assert {s["activity_type"]: s["calories_kcal"] for s in sessions} == {
        exercises[0]["name"]: 350,
        exercises[1]["name"]: 200,
    }
    assert (
        period(client.get("/api/dashboard").json()["cardio_energy_periods"])["calories_kcal"] == 550
    )
    assert client.delete(f"/api/workouts/{workout_id}").status_code == 204
    assert period(client.get("/api/cardio").json()["energy_periods"])["calories_kcal"] == 0


def test_cardio_creation_with_exercise_retains_calories_after_sync(client):
    exercise = next(
        item for item in client.get("/api/exercises").json() if item["kind"] == "cardio"
    )
    session = client.post(
        "/api/cardio", json=cardio_payload(exercise_id=exercise["id"], calories_kcal=420)
    ).json()
    assert session["calories_kcal"] == 420
    workout = client.get(f"/api/workouts/{session['source_workout_id']}").json()
    payload = {
        "name": workout["name"],
        "workout_date": workout["workout_date"],
        "category": "cardio",
        "movements": [
            {"exercise_id": exercise["id"], "sets": [{"duration_seconds": 1800, "completed": True}]}
        ],
    }
    assert client.put(f"/api/workouts/{workout['id']}", json=payload).status_code == 200
    assert client.get("/api/cardio").json()["sessions"][0]["calories_kcal"] == 420


def test_periods_use_today_not_latest_session_and_respect_week_start():
    today = date(2026, 9, 6)  # Sunday.
    sessions = [
        CardioSession(session_date=date.fromisoformat(day), calories_kcal=kcal)
        for day, kcal in [
            ("2026-09-06", 100),
            ("2026-09-05", 200),
            ("2026-08-31", 300),
            ("2026-08-30", 400),
            ("2026-06-06", 500),
            ("2026-06-05", 600),
            ("2026-09-07", 9000),
            ("2025-01-01", 700),
            ("2026-09-02", None),
        ]
    ]
    summaries = [item.model_dump() for item in cardio_energy_periods(sessions, today, "monday")]
    assert period(summaries)["calories_kcal"] == 600
    assert period(summaries)["logged_sessions"] == 3
    assert period(summaries)["total_sessions"] == 4
    assert period(summaries, "month")["calories_kcal"] == 300
    assert period(summaries, "3m")["calories_kcal"] == 1500
    assert period(summaries, "6m")["calories_kcal"] == 2100
    assert period(summaries, "year")["calories_kcal"] == 2100
    assert period(summaries, "all")["calories_kcal"] == 2800
    sunday = cardio_energy_periods(sessions, today, "sunday")[0]
    assert sunday.calories_kcal == 100
    saturday = cardio_energy_periods(sessions, today, "saturday")[0]
    assert saturday.calories_kcal == 300
    assert months_before(date(2024, 5, 31), 3) == date(2024, 2, 29)
    assert months_before(date(2025, 5, 31), 3) == date(2025, 2, 28)


def test_empty_and_future_only_periods_are_empty():
    today = date(2026, 9, 6)
    for sessions in [[], [CardioSession(session_date=date(2026, 10, 1), calories_kcal=100)]]:
        summaries = cardio_energy_periods(sessions, today, "monday")
        assert all(
            item.total_sessions == item.logged_sessions == item.calories_kcal == 0
            for item in summaries
        )
        assert all(item.start_date <= item.end_date for item in summaries)
