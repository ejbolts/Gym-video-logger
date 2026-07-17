from __future__ import annotations

import os
import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

# Test imports below create the application's database engine. Point them at an
# isolated, ignored location before importing any application module so tests
# can never reset a user's live data/gym-video-logger.db database.
TEST_DATA_DIR = Path(__file__).parent / ".test-data"
os.environ["GYM_DATA_DIR"] = str(TEST_DATA_DIR)
os.environ["GYM_DATABASE_PATH"] = str(TEST_DATA_DIR / "gym-video-logger-test.db")

from app.database import Base, engine  # noqa: E402
from app.main import create_app  # noqa: E402
from app.storage import StoredUpload, original_filename  # noqa: E402


@pytest.fixture(autouse=True)
def reset_database():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    yield
    Base.metadata.drop_all(engine)


@pytest.fixture
def client():
    with TestClient(create_app()) as test_client:
        yield test_client


@pytest.fixture
def fake_upload(monkeypatch):
    async def store(*, upload, session_id, existing_session_bytes, settings):
        filename = original_filename(upload.filename)
        extension = Path(filename).suffix.lower()
        path = settings.uploads_dir / session_id / f"server-{uuid.uuid4().hex}{extension}"
        path.parent.mkdir(parents=True, exist_ok=True)
        contents = await upload.read()
        path.write_bytes(contents)
        await upload.close()
        return StoredUpload(filename, path.name, path, len(contents), 1_000)

    monkeypatch.setattr("app.main.stream_upload_to_disk", store)
    return store


def create_session(client: TestClient, expected: int = 1) -> dict:
    response = client.post(
        "/api/sessions",
        json={
            "name": "Lower body",
            "workout_date": "2026-07-12",
            "notes": "Test notes",
            "expected_clip_count": expected,
        },
    )
    assert response.status_code == 201
    return response.json()


def upload(client: TestClient, session_id: str, client_id: str, order: int, name: str = "set.mov"):
    return client.post(
        f"/api/sessions/{session_id}/clips",
        data={
            "client_clip_id": client_id,
            "order_index": str(order),
            "exercise_label": "Back squat",
        },
        files={"file": (name, b"small but test-only video", "video/quicktime")},
    )
