from app.database import SessionLocal
from app.home_layout import SECTION_IDS
from app.training_metrics import set_setting


def test_layout_defaults_and_round_trip_are_account_scoped(client, other_client):
    default = {"order": SECTION_IDS, "hidden": [], "widths": {}}
    assert client.get("/api/home-layout").json() == default
    layout = {
        "order": list(reversed(SECTION_IDS)),
        "hidden": ["consistency", "workouts"],
        "widths": {"daily-check-in": "compact", "workouts": "full", "friends": "third"},
    }
    response = client.put("/api/home-layout", json=layout)
    assert response.status_code == 200
    assert response.json() == layout
    assert client.get("/api/home-layout").json() == layout
    assert other_client.get("/api/home-layout").json() == default
    assert (
        other_client.put(
            "/api/home-layout", json={"order": SECTION_IDS, "hidden": SECTION_IDS}
        ).status_code
        == 200
    )
    assert client.get("/api/home-layout").json() == layout


def test_layout_requires_sign_in(anonymous_client):
    assert anonymous_client.get("/api/home-layout").status_code == 401
    assert anonymous_client.put("/api/home-layout", json={}).status_code == 401


def test_invalid_layout_does_not_overwrite_saved_layout(client):
    saved = client.put("/api/home-layout", json={"hidden": ["records"]}).json()
    for invalid in (
        {"order": ["consistency", "consistency"]},
        {"hidden": ["records", "records"]},
        {"order": ["unknown-section"]},
        {"hidden": ["unknown-section"]},
        {"order": "records"},
        {"widths": {"unknown-section": "full"}},
        {"widths": {"records": "wide"}},
        {"widths": {"records": 3}},
        {"widths": []},
    ):
        assert client.put("/api/home-layout", json=invalid).status_code == 422
        assert client.get("/api/home-layout").json() == saved


def test_older_layout_appends_new_sections_without_unhiding_old_sections(client):
    old = {"order": ["consistency", "workouts"], "hidden": ["workouts"]}
    with SessionLocal() as db:
        set_setting(
            db,
            client.user["id"],
            "home_layout",
            '{"order":["consistency","workouts"],"hidden":["workouts"]}',
        )
        db.commit()
    result = client.get("/api/home-layout").json()
    assert result["order"][0] == "profile"
    assert result["order"][1:3] == old["order"]
    assert set(result["order"]) == set(SECTION_IDS)
    assert result["hidden"] == old["hidden"]
    assert result["widths"] == {}


def test_corrupt_saved_layout_recovers_to_default(client):
    with SessionLocal() as db:
        set_setting(db, client.user["id"], "home_layout", "invalid json")
        db.commit()
    assert client.get("/api/home-layout").json() == {
        "order": SECTION_IDS,
        "hidden": [],
        "widths": {},
    }
