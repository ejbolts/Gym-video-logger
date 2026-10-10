from __future__ import annotations

import os
import shutil
import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

# Test imports below create the application's database engine. Point them at an
# isolated, ignored location before importing any application module so tests
# can never reset a user's live data/gym-video-logger.db database.
TEST_DATA_DIR = Path(__file__).parent / ".test-data" / f"pytest-{os.getpid()}"
os.environ["GYM_DATA_DIR"] = str(TEST_DATA_DIR)
os.environ["GYM_DATABASE_PATH"] = str(TEST_DATA_DIR / "gym-video-logger-test.db")
os.environ["GYM_SEED_SAMPLE_DATA"] = "false"
# Mirrors a deployed server: browser sign-up (including the first account) needs the invite code.
TEST_INVITE_CODE = "test-invite-code"
os.environ["GYM_REGISTRATION_INVITE_CODE"] = TEST_INVITE_CODE
os.environ["GYM_ALLOW_REGISTRATION"] = "true"

from app.config import get_settings  # noqa: E402
from app.database import Base, SessionLocal, engine  # noqa: E402
from app.main import create_app  # noqa: E402
from app.models import User  # noqa: E402
from app.storage import StoredUpload, original_filename  # noqa: E402


@pytest.fixture(autouse=True)
def reset_database():
    photo_dir = get_settings().machine_photos_dir
    shutil.rmtree(photo_dir, ignore_errors=True)
    photo_dir.mkdir(parents=True, exist_ok=True)
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    yield
    Base.metadata.drop_all(engine)
    shutil.rmtree(photo_dir, ignore_errors=True)


TEST_PASSWORD = "correct horse battery staple"


def register_user(
    test_client: TestClient,
    email: str = "owner@example.com",
    display_name: str = "Owner",
    password: str = TEST_PASSWORD,
) -> dict:
    """Register through the API so the client's cookie jar holds a real session."""
    response = test_client.post(
        "/api/auth/register",
        json={
            "email": email,
            "password": password,
            "display_name": display_name,
            "invite_code": TEST_INVITE_CODE,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


@pytest.fixture
def anonymous_client():
    with TestClient(create_app()) as test_client:
        yield test_client


@pytest.fixture
def client(anonymous_client):
    """A signed-in client for the first (admin) account."""
    anonymous_client.user = register_user(anonymous_client)
    return anonymous_client


@pytest.fixture
def other_client(client):
    """A second, independent browser signed in as a different non-admin account."""
    second = TestClient(client.app)
    second.user = register_user(second, "other@example.com", "Other")
    yield second
    second.close()


def make_user(email: str = "direct@example.com", *, is_admin: bool = False) -> str:
    """Insert an account row directly, for tests that exercise internals without HTTP."""
    with SessionLocal() as db:
        user = User(
            email=email, display_name="Direct", password_hash="not-a-real-hash", is_admin=is_admin
        )
        db.add(user)
        db.commit()
        return user.id


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
