from __future__ import annotations

import logging
import shutil
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated

from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from .config import Settings, get_settings
from .database import Base, SessionLocal, engine, get_db
from .models import Clip, ClipUploadStatus, PushSubscription, SessionStatus, WorkoutSession
from .notifications import push_available, send_push_notification, vapid_public_key
from .processing import ProcessingValidationError, SessionProcessor, validate_batch_ready
from .schemas import (
    ClipPatch,
    ClipRead,
    HealthRead,
    PushConfigRead,
    PushSubscriptionCreate,
    ReorderRequest,
    SessionCreate,
    SessionRead,
)
from .storage import UploadValidationError, clean_abandoned_partials, stream_upload_to_disk
from .tracker import router as tracker_router
from .tracker import seed_default_exercises
from .tracker_seed import seed_sample_body_measurements, seed_sample_workouts

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger(__name__)


def api_error(status_code: int, code: str, message: str) -> HTTPException:
    return HTTPException(
        status_code=status_code, detail={"error": {"code": code, "message": message}}
    )


def load_session(db: Session, session_id: str) -> WorkoutSession:
    session = db.scalar(
        select(WorkoutSession)
        .where(WorkoutSession.id == session_id)
        .options(selectinload(WorkoutSession.clips), selectinload(WorkoutSession.timestamps))
    )
    if not session:
        raise api_error(404, "session_not_found", "Session was not found.")
    return session


def can_accept_uploads(session: WorkoutSession) -> bool:
    return session.status in {
        SessionStatus.DRAFT,
        SessionStatus.UPLOADING,
        SessionStatus.UPLOAD_FAILED,
    }


def remove_session_files(session_id: str, settings: Settings) -> None:
    # session IDs are server-generated UUIDs; every root is owned by this application.
    for directory in (settings.uploads_dir / session_id, settings.normalized_dir / session_id):
        shutil.rmtree(directory, ignore_errors=True)
    (settings.output_dir / f"{session_id}.mp4").unlink(missing_ok=True)


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        settings.ensure_directories()
        Base.metadata.create_all(bind=engine)
        with SessionLocal() as db:
            seed_default_exercises(db)
            if settings.seed_sample_data:
                seeded = seed_sample_workouts(db)
                seed_sample_body_measurements(db)
                if seeded:
                    logger.info("Seeded sample workouts", extra={"count": seeded})
        removed = clean_abandoned_partials(settings)
        if removed:
            logger.info("Removed abandoned partial uploads", extra={"count": removed})
        processor = SessionProcessor(SessionLocal, settings)
        app.state.processor = processor
        await processor.start()
        yield
        await processor.stop()

    app = FastAPI(title="Gym Video Logger", version="0.1.0", lifespan=lifespan)

    @app.exception_handler(HTTPException)
    async def http_exception_handler(_: Request, exc: HTTPException) -> JSONResponse:
        detail = exc.detail
        if not isinstance(detail, dict) or "error" not in detail:
            detail = {"error": {"code": "http_error", "message": str(detail)}}
        return JSONResponse(status_code=exc.status_code, content=detail, headers=exc.headers)

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
        details = exc.errors()
        for detail in details:
            detail.pop("ctx", None)
        return JSONResponse(
            status_code=422,
            content={
                "error": {
                    "code": "validation_error",
                    "message": "Request validation failed.",
                    "details": details,
                }
            },
        )

    @app.get("/api/health", response_model=HealthRead)
    def health() -> HealthRead:
        return HealthRead(
            status="ok",
            upload_concurrency=settings.upload_concurrency,
            youtube_mock_mode=settings.youtube_mock_mode,
        )

    @app.get("/api/notifications/push/config", response_model=PushConfigRead)
    def push_config() -> PushConfigRead:
        enabled = push_available(settings)
        return PushConfigRead(
            enabled=enabled, public_key=vapid_public_key(settings) if enabled else None
        )

    @app.post("/api/notifications/push/subscriptions", status_code=204)
    def save_push_subscription(
        payload: PushSubscriptionCreate, db: Session = Depends(get_db)
    ) -> None:
        subscription = db.scalar(
            select(PushSubscription).where(PushSubscription.endpoint == payload.endpoint)
        )
        if subscription:
            subscription.p256dh = payload.p256dh
            subscription.auth = payload.auth
        else:
            db.add(PushSubscription(**payload.model_dump()))
        db.commit()

    @app.post("/api/notifications/push/test", status_code=204)
    def send_test_push_notification() -> None:
        send_push_notification(
            SessionLocal,
            settings,
            title="Gym logger alerts are ready",
            body="This phone will be notified when YouTube finishes processing a workout.",
        )

    @app.post("/api/sessions", response_model=SessionRead, status_code=201)
    def create_session(payload: SessionCreate, db: Session = Depends(get_db)) -> WorkoutSession:
        session = WorkoutSession(**payload.model_dump())
        db.add(session)
        db.commit()
        db.refresh(session)
        return session

    @app.get("/api/sessions", response_model=list[SessionRead])
    def list_sessions(db: Session = Depends(get_db)) -> list[WorkoutSession]:
        return list(
            db.scalars(
                select(WorkoutSession)
                .options(
                    selectinload(WorkoutSession.clips), selectinload(WorkoutSession.timestamps)
                )
                .order_by(WorkoutSession.workout_date.desc(), WorkoutSession.created_at.desc())
            )
        )

    @app.get("/api/sessions/{session_id}", response_model=SessionRead)
    def get_session(session_id: str, db: Session = Depends(get_db)) -> WorkoutSession:
        return load_session(db, session_id)

    @app.delete("/api/sessions/{session_id}", status_code=204)
    def delete_session(session_id: str, db: Session = Depends(get_db)) -> None:
        session = load_session(db, session_id)
        if session.status in {
            SessionStatus.QUEUED,
            SessionStatus.NORMALIZING,
            SessionStatus.STITCHING,
            SessionStatus.UPLOADING_TO_YOUTUBE,
            SessionStatus.YOUTUBE_PROCESSING,
        }:
            raise api_error(409, "session_processing", "A processing session cannot be deleted.")
        db.delete(session)
        db.commit()
        remove_session_files(session_id, settings)

    @app.post("/api/sessions/{session_id}/clips", response_model=ClipRead)
    async def upload_clip(
        session_id: str,
        client_clip_id: Annotated[str, Form(min_length=1, max_length=100)],
        order_index: Annotated[int, Form(ge=0)],
        file: Annotated[UploadFile, File(...)],
        exercise_label: Annotated[str | None, Form(max_length=200)] = None,
        db: Session = Depends(get_db),
    ) -> Clip:
        session = load_session(db, session_id)
        if not can_accept_uploads(session):
            raise api_error(
                409, "uploads_not_allowed", "This session is no longer accepting uploads."
            )
        if order_index >= session.expected_clip_count:
            raise api_error(
                422, "invalid_order", "Clip order index is outside this session's expected range."
            )
        existing = db.scalar(
            select(Clip).where(Clip.session_id == session_id, Clip.client_clip_id == client_clip_id)
        )
        if existing:
            # A successful first request wins; the same client ID never creates a duplicate clip.
            return existing
        occupied_order = db.scalar(
            select(Clip.id).where(Clip.session_id == session_id, Clip.order_index == order_index)
        )
        if occupied_order:
            raise api_error(
                409, "duplicate_order", "Another clip already uses this order position."
            )
        existing_bytes = db.scalar(
            select(func.coalesce(func.sum(Clip.file_size), 0)).where(
                Clip.session_id == session_id, Clip.upload_status == ClipUploadStatus.UPLOADED
            )
        )
        try:
            stored = await stream_upload_to_disk(
                upload=file,
                session_id=session_id,
                existing_session_bytes=int(existing_bytes or 0),
                settings=settings,
            )
        except UploadValidationError as error:
            session.status = SessionStatus.UPLOAD_FAILED
            db.commit()
            raise api_error(400, error.code, error.message) from error

        if (int(existing_bytes or 0) + stored.file_size) > settings.max_session_size_bytes:
            stored.path.unlink(missing_ok=True)
            session.status = SessionStatus.UPLOAD_FAILED
            db.commit()
            raise api_error(413, "session_too_large", "This upload exceeds the session size limit.")

        clip = Clip(
            client_clip_id=client_clip_id,
            session_id=session_id,
            original_filename=stored.original_filename,
            stored_filename=stored.stored_filename,
            order_index=order_index,
            exercise_label=exercise_label.strip() or None if exercise_label else None,
            file_size=stored.file_size,
            upload_status=ClipUploadStatus.UPLOADED,
            duration_ms=stored.duration_ms,
            original_path=str(stored.path),
        )
        try:
            db.add(clip)
            db.flush()
            session.uploaded_clip_count = (
                db.scalar(
                    select(func.count(Clip.id)).where(
                        Clip.session_id == session_id,
                        Clip.upload_status == ClipUploadStatus.UPLOADED,
                    )
                )
                or 0
            )
            session.status = SessionStatus.UPLOADING
            db.commit()
            db.refresh(clip)
            return clip
        except IntegrityError as error:
            db.rollback()
            stored.path.unlink(missing_ok=True)
            # Concurrent retries can hit either unique constraint.
            # Preserve the existing idempotent clip if present.
            existing = db.scalar(
                select(Clip).where(
                    Clip.session_id == session_id, Clip.client_clip_id == client_clip_id
                )
            )
            if existing:
                return existing
            raise api_error(
                409, "duplicate_order", "Another clip already uses this order position."
            ) from error

    @app.patch("/api/sessions/{session_id}/clips/{clip_id}", response_model=ClipRead)
    def patch_clip(
        session_id: str, clip_id: str, payload: ClipPatch, db: Session = Depends(get_db)
    ) -> Clip:
        session = load_session(db, session_id)
        if not can_accept_uploads(session):
            raise api_error(
                409, "clips_locked", "Clips cannot be changed after processing is queued."
            )
        clip = db.get(Clip, clip_id)
        if not clip or clip.session_id != session.id:
            raise api_error(404, "clip_not_found", "Clip was not found in this session.")
        clip.exercise_label = payload.exercise_label
        db.commit()
        db.refresh(clip)
        return clip

    @app.delete("/api/sessions/{session_id}/clips/{clip_id}", status_code=204)
    def delete_clip(session_id: str, clip_id: str, db: Session = Depends(get_db)) -> None:
        session = load_session(db, session_id)
        if not can_accept_uploads(session):
            raise api_error(
                409, "clips_locked", "Clips cannot be changed after processing is queued."
            )
        clip = db.get(Clip, clip_id)
        if not clip or clip.session_id != session.id:
            raise api_error(404, "clip_not_found", "Clip was not found in this session.")
        path = Path(clip.original_path) if clip.original_path else None
        db.delete(clip)
        db.flush()
        session.uploaded_clip_count = (
            db.scalar(
                select(func.count(Clip.id)).where(
                    Clip.session_id == session_id, Clip.upload_status == ClipUploadStatus.UPLOADED
                )
            )
            or 0
        )
        db.commit()
        if path:
            path.unlink(missing_ok=True)

    @app.post("/api/sessions/{session_id}/clips/reorder", response_model=SessionRead)
    def reorder_clips(
        session_id: str, payload: ReorderRequest, db: Session = Depends(get_db)
    ) -> WorkoutSession:
        session = load_session(db, session_id)
        if not can_accept_uploads(session):
            raise api_error(
                409, "clips_locked", "Clips cannot be changed after processing is queued."
            )
        clips = sorted(session.clips, key=lambda clip: clip.order_index)
        supplied_ids = [item.clip_id for item in payload.clips]
        supplied_indexes = [item.order_index for item in payload.clips]
        if set(supplied_ids) != {clip.id for clip in clips} or len(supplied_ids) != len(
            set(supplied_ids)
        ):
            raise api_error(
                422, "invalid_reorder", "Reorder must include every session clip exactly once."
            )
        if sorted(supplied_indexes) != list(range(len(clips))):
            raise api_error(
                422, "invalid_reorder", "Order indexes must form a complete zero-based sequence."
            )
        for clip in clips:
            clip.order_index = -clip.order_index - 1
        db.flush()
        requested = {item.clip_id: item.order_index for item in payload.clips}
        for clip in clips:
            clip.order_index = requested[clip.id]
        db.commit()
        return load_session(db, session_id)

    @app.post("/api/sessions/{session_id}/process", response_model=SessionRead, status_code=202)
    def process_session(session_id: str, db: Session = Depends(get_db)) -> WorkoutSession:
        session = load_session(db, session_id)
        if session.status in {
            SessionStatus.QUEUED,
            SessionStatus.NORMALIZING,
            SessionStatus.STITCHING,
            SessionStatus.UPLOADING_TO_YOUTUBE,
            SessionStatus.YOUTUBE_PROCESSING,
        }:
            raise api_error(409, "already_processing", "This session is already processing.")
        if session.status == SessionStatus.COMPLETE:
            raise api_error(409, "already_complete", "This session has already completed.")
        if session.status in {SessionStatus.FAILED, SessionStatus.CANCELLED}:
            raise api_error(
                409, "use_retry_or_new_session", "Use retry processing or create a new session."
            )
        try:
            validate_batch_ready(session)
        except ProcessingValidationError as error:
            raise api_error(409, "incomplete_batch", str(error)) from error
        session.status = SessionStatus.QUEUED
        session.processing_error = None
        db.commit()
        app.state.processor.enqueue(session.id)
        return load_session(db, session.id)

    @app.post(
        "/api/sessions/{session_id}/retry-processing", response_model=SessionRead, status_code=202
    )
    def retry_processing(session_id: str, db: Session = Depends(get_db)) -> WorkoutSession:
        session = load_session(db, session_id)
        if session.status != SessionStatus.FAILED:
            raise api_error(409, "not_failed", "Only failed sessions can be retried.")
        try:
            validate_batch_ready(session)
        except ProcessingValidationError as error:
            raise api_error(409, "incomplete_batch", str(error)) from error
        session.status = SessionStatus.QUEUED
        session.processing_error = None
        db.commit()
        app.state.processor.enqueue(session.id)
        return load_session(db, session.id)

    @app.post(
        "/api/sessions/{session_id}/retry-youtube-processing",
        response_model=SessionRead,
        status_code=202,
    )
    def retry_youtube_processing(session_id: str, db: Session = Depends(get_db)) -> WorkoutSession:
        session = load_session(db, session_id)
        if session.status != SessionStatus.FAILED or not session.youtube_video_id:
            raise api_error(
                409,
                "not_youtube_processing_failure",
                "Only a failed session with an uploaded YouTube video can be checked again.",
            )
        session.status = SessionStatus.YOUTUBE_PROCESSING
        session.processing_error = None
        db.commit()
        return load_session(db, session.id)

    @app.post("/api/sessions/{session_id}/cancel", response_model=SessionRead)
    def cancel_session(session_id: str, db: Session = Depends(get_db)) -> WorkoutSession:
        session = load_session(db, session_id)
        if not can_accept_uploads(session):
            raise api_error(
                409, "cannot_cancel", "Only a session still uploading can be cancelled."
            )
        session.status = SessionStatus.CANCELLED
        session.processing_error = None
        db.commit()
        return load_session(db, session.id)

    app.include_router(tracker_router)

    frontend_dist = Path(__file__).resolve().parents[2] / "frontend" / "dist"
    if frontend_dist.is_dir():
        app.mount("/", StaticFiles(directory=frontend_dist, html=True), name="frontend")

    return app


app = create_app()
