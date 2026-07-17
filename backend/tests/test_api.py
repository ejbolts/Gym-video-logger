from __future__ import annotations

from conftest import create_session, upload


def test_health_requires_no_authentication(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_phone_push_subscription_can_be_saved(client):
    response = client.post(
        "/api/notifications/push/subscriptions",
        json={
            "endpoint": "https://push.example.test/subscription",
            "p256dh": "public-key",
            "auth": "auth-key",
        },
    )

    assert response.status_code == 204


def test_session_creation_persists_expected_clip_count(client):
    session = create_session(client, expected=3)
    assert session["expected_clip_count"] == 3
    assert session["status"] == "draft"


def test_upload_sanitizes_client_filename_and_is_idempotent(client, fake_upload):
    session = create_session(client)
    first = upload(client, session["id"], "phone-clip-1", 0, "../../not-a-path.mov")
    second = upload(client, session["id"], "phone-clip-1", 0, "changed-name.mov")
    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["id"] == second.json()["id"]
    assert first.json()["original_filename"] == "not-a-path.mov"
    saved = client.get(f"/api/sessions/{session['id']}").json()
    assert len(saved["clips"]) == 1


def test_duplicate_order_is_rejected(client, fake_upload):
    session = create_session(client, expected=2)
    assert upload(client, session["id"], "first", 0).status_code == 200
    response = upload(client, session["id"], "second", 0)
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "duplicate_order"


def test_incomplete_batch_cannot_process(client, fake_upload):
    session = create_session(client, expected=2)
    assert upload(client, session["id"], "first", 0).status_code == 200
    response = client.post(f"/api/sessions/{session['id']}/process")
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "incomplete_batch"


def test_clip_list_uses_explicit_order_not_upload_completion_order(client, fake_upload):
    session = create_session(client, expected=2)
    assert upload(client, session["id"], "second", 1, "second.mov").status_code == 200
    assert upload(client, session["id"], "first", 0, "first.mov").status_code == 200
    clips = client.get(f"/api/sessions/{session['id']}").json()["clips"]
    assert [clip["original_filename"] for clip in clips] == ["first.mov", "second.mov"]


def test_session_can_be_cancelled_while_uploading(client, fake_upload):
    session = create_session(client)
    assert upload(client, session["id"], "first", 0).status_code == 200
    response = client.post(f"/api/sessions/{session['id']}/cancel")
    assert response.status_code == 200
    assert response.json()["status"] == "cancelled"


def test_inactive_session_can_be_deleted_with_its_clips(client, fake_upload):
    session = create_session(client)
    assert upload(client, session["id"], "first", 0).status_code == 200
    assert client.post(f"/api/sessions/{session['id']}/cancel").status_code == 200

    response = client.delete(f"/api/sessions/{session['id']}")

    assert response.status_code == 204
    assert client.get(f"/api/sessions/{session['id']}").status_code == 404


def test_failed_processing_can_be_requeued_without_reuploading(client, fake_upload, monkeypatch):
    session = create_session(client)
    assert upload(client, session["id"], "first", 0).status_code == 200
    client.app.state.processor.enqueue = lambda _: True
    from app.database import SessionLocal
    from app.models import SessionStatus, WorkoutSession

    with SessionLocal() as db:
        row = db.get(WorkoutSession, session["id"])
        assert row
        row.status = SessionStatus.FAILED
        row.processing_error = "ffmpeg failed"
        db.commit()
    response = client.post(f"/api/sessions/{session['id']}/retry-processing")
    assert response.status_code == 202
    assert response.json()["status"] == "queued"
