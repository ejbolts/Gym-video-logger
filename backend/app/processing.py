from __future__ import annotations

import asyncio
import logging
import shutil
import subprocess
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from .config import Settings
from .models import Clip, ClipUploadStatus, SessionStatus, Timestamp, WorkoutSession
from .notifications import send_push_notification
from .storage import inspect_media, original_clip_path
from .youtube import YouTubeUploader, YouTubeUploadError, make_uploader

logger = logging.getLogger(__name__)


class ProcessingValidationError(Exception):
    pass


class ProcessingError(Exception):
    pass


MINIMUM_TRIMMED_CLIP_SECONDS = 3.0


@dataclass(frozen=True)
class TimestampSpec:
    clip_id: str
    order_index: int
    label: str
    start_seconds: int


def ordered_clips(session: WorkoutSession) -> list[Clip]:
    return sorted(session.clips, key=lambda clip: clip.order_index)


def validate_batch_ready(session: WorkoutSession) -> list[Clip]:
    clips = ordered_clips(session)
    if session.expected_clip_count <= 0:
        raise ProcessingValidationError("A session must expect at least one clip.")
    if len(clips) != session.expected_clip_count:
        raise ProcessingValidationError("Not every expected clip has been uploaded yet.")
    if session.uploaded_clip_count != session.expected_clip_count:
        raise ProcessingValidationError(
            "Server upload count does not match the expected clip count."
        )
    if any(clip.upload_status != ClipUploadStatus.UPLOADED for clip in clips):
        raise ProcessingValidationError(
            "Every clip must finish uploading before processing starts."
        )
    indexes = [clip.order_index for clip in clips]
    if indexes != list(range(session.expected_clip_count)):
        raise ProcessingValidationError("Clip order must be a complete zero-based sequence.")
    return clips


def make_timestamps(clips: Sequence[Clip]) -> list[TimestampSpec]:
    """Calculate cumulative clip starts and reset set numbers for each normalized label."""
    elapsed_ms = 0
    set_counts: dict[str, int] = {}
    timestamps: list[TimestampSpec] = []
    for clip in sorted(clips, key=lambda item: item.order_index):
        clean_label = " ".join((clip.exercise_label or "").split())
        normalized_label = clean_label.casefold()
        if normalized_label:
            set_counts[normalized_label] = set_counts.get(normalized_label, 0) + 1
            label = f"{clean_label} - Set {set_counts[normalized_label]}"
        else:
            label = "Set N"
        timestamps.append(
            TimestampSpec(
                clip_id=clip.id,
                order_index=clip.order_index,
                label=label,
                start_seconds=elapsed_ms // 1000,
            )
        )
        if clip.duration_ms is None or clip.duration_ms <= 0:
            raise ProcessingValidationError(f"Clip {clip.order_index + 1} has no valid duration.")
        elapsed_ms += clip.duration_ms
    return timestamps


def display_time(total_seconds: int) -> str:
    hours, remainder = divmod(total_seconds, 3600)
    minutes, seconds = divmod(remainder, 60)
    return f"{hours}:{minutes:02d}:{seconds:02d}" if hours else f"{minutes}:{seconds:02d}"


def youtube_chapter_text(timestamps: Sequence[TimestampSpec]) -> str:
    """Only include chapter text where it meets YouTube's common minimum rules."""
    if len(timestamps) < 3 or not timestamps or timestamps[0].start_seconds != 0:
        return ""
    starts = [timestamp.start_seconds for timestamp in timestamps]
    if any(right - left < 10 for left, right in zip(starts, starts[1:], strict=False)):
        return ""
    return "\n".join(f"{display_time(item.start_seconds)} {item.label}" for item in timestamps)


class SessionProcessor:
    """A deliberately small persistent-state, in-process queue for one home PC."""

    def __init__(
        self,
        session_factory: Callable[[], Session],
        settings: Settings,
        uploader: YouTubeUploader | None = None,
    ):
        self.session_factory = session_factory
        self.settings = settings
        self.uploader = uploader or make_uploader(settings)
        self._queue: asyncio.Queue[str] = asyncio.Queue()
        self._enqueued: set[str] = set()
        self._worker: asyncio.Task[None] | None = None
        self._youtube_monitor: asyncio.Task[None] | None = None

    async def start(self) -> None:
        queued = self.recover_interrupted_sessions()
        self._worker = asyncio.create_task(self._work(), name="gym-video-worker")
        self._youtube_monitor = asyncio.create_task(
            self._watch_youtube_processing(), name="gym-youtube-monitor"
        )
        for session_id in queued:
            self.enqueue(session_id)

    async def stop(self) -> None:
        for task_name in ("_worker", "_youtube_monitor"):
            task = getattr(self, task_name)
            if not task:
                continue
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
            setattr(self, task_name, None)

    def enqueue(self, session_id: str) -> bool:
        if session_id in self._enqueued:
            return False
        self._enqueued.add(session_id)
        self._queue.put_nowait(session_id)
        return True

    async def _work(self) -> None:
        while True:
            session_id = await self._queue.get()
            try:
                await asyncio.to_thread(self.process, session_id)
            finally:
                self._enqueued.discard(session_id)
                self._queue.task_done()

    async def _watch_youtube_processing(self) -> None:
        while True:
            try:
                with self.session_factory() as db:
                    session_ids = list(
                        db.scalars(
                            select(WorkoutSession.id).where(
                                WorkoutSession.status == SessionStatus.YOUTUBE_PROCESSING
                            )
                        )
                    )
                for session_id in session_ids:
                    await asyncio.to_thread(self.check_youtube_processing, session_id)
            except Exception:
                logger.exception("Could not poll YouTube processing status")
            await asyncio.sleep(self.settings.youtube_processing_poll_seconds)

    def recover_interrupted_sessions(self) -> list[str]:
        """Requeue durable queued jobs and fail work interrupted mid-subprocess by a restart."""
        queued: list[str] = []
        with self.session_factory() as db:
            sessions = db.scalars(select(WorkoutSession)).all()
            for session in sessions:
                if session.status == SessionStatus.QUEUED:
                    queued.append(session.id)
                elif session.status in {
                    SessionStatus.NORMALIZING,
                    SessionStatus.STITCHING,
                    SessionStatus.UPLOADING_TO_YOUTUBE,
                }:
                    session.status = SessionStatus.FAILED
                    session.processing_error = (
                        "Processing was interrupted by a backend restart. Retry processing."
                    )
            db.commit()
        return queued

    def process(self, session_id: str) -> None:
        """Run synchronously so the async queue can safely offload it to a worker thread."""
        try:
            with self.session_factory() as db:
                session = self._load_session(db, session_id)
                if not session or session.status == SessionStatus.CANCELLED:
                    return
                clips = validate_batch_ready(session)
                session.status = SessionStatus.NORMALIZING
                session.processing_error = None
                db.commit()

                session_dir = self.settings.normalized_dir / session.id
                session_dir.mkdir(parents=True, exist_ok=True)
                for clip in clips:
                    normalized_path = session_dir / f"{clip.id}.mp4"
                    self._normalize(
                        original_clip_path(clip),
                        normalized_path,
                        source_duration_ms=clip.duration_ms,
                    )
                    clip.normalized_path = str(normalized_path)
                    clip.duration_ms = inspect_media(normalized_path, self.settings)
                    db.commit()

                session.status = SessionStatus.STITCHING
                db.commit()
                output_path = self.settings.output_dir / f"{session.id}.mp4"
                self._stitch(
                    [Path(clip.normalized_path or "") for clip in clips], session_dir, output_path
                )

                timestamps = make_timestamps(clips)
                chapters = youtube_chapter_text(timestamps)
                session.status = SessionStatus.UPLOADING_TO_YOUTUBE
                db.commit()
                title = self.settings.youtube_title_template.format(
                    session_name=session.name, workout_date=session.workout_date.isoformat()
                )
                description = self.settings.youtube_description_template.format(
                    notes=session.notes or "", chapters=chapters
                ).strip()
                upload = self.uploader.upload(output_path, title, description)
                session.youtube_video_id = upload.video_id
                session.youtube_url = upload.url
                db.query(Timestamp).filter(Timestamp.session_id == session.id).delete()
                for timestamp in timestamps:
                    db.add(
                        Timestamp(
                            session_id=session.id,
                            clip_id=timestamp.clip_id,
                            order_index=timestamp.order_index,
                            label=timestamp.label,
                            start_seconds=timestamp.start_seconds,
                            youtube_url=f"https://youtu.be/{upload.video_id}?t={timestamp.start_seconds}",
                        )
                    )
                session.status = (
                    SessionStatus.COMPLETE
                    if self.uploader.is_mock
                    else SessionStatus.YOUTUBE_PROCESSING
                )
                session.processing_error = None
                db.commit()
                self._cleanup_after_upload(session_dir)
                if self.uploader.is_mock:
                    self._cleanup_after_youtube_success(session.id, clips)
                logger.info("Session upload complete", extra={"session_id": session.id})
        except Exception as error:
            logger.exception("Session processing failed", extra={"session_id": session_id})
            self._mark_failed(session_id, str(error))

    def _load_session(self, db: Session, session_id: str) -> WorkoutSession | None:
        return db.scalar(
            select(WorkoutSession)
            .where(WorkoutSession.id == session_id)
            .options(selectinload(WorkoutSession.clips), selectinload(WorkoutSession.timestamps))
        )

    def _mark_failed(self, session_id: str, error: str) -> None:
        with self.session_factory() as db:
            session = self._load_session(db, session_id)
            if session and session.status != SessionStatus.CANCELLED:
                session.status = SessionStatus.FAILED
                session.processing_error = error[:4_000]
                db.commit()

    def check_youtube_processing(self, session_id: str) -> None:
        """Promote an uploaded video only after YouTube has finished processing it."""
        notification: tuple[str, str] | None = None
        with self.session_factory() as db:
            session = db.get(WorkoutSession, session_id)
            if not session or session.status != SessionStatus.YOUTUBE_PROCESSING:
                return
            if not session.youtube_video_id:
                session.status = SessionStatus.FAILED
                session.processing_error = "The YouTube upload did not return a video ID."
                db.commit()
                return
            status: str | None = None
            try:
                status = self.uploader.processing_status(session.youtube_video_id)
            except YouTubeUploadError as error:
                message = str(error)
                if "insufficient authentication scopes" in message.lower():
                    session.status = SessionStatus.FAILED
                    session.processing_error = (
                        "YouTube permissions need updating before this upload can be checked. "
                        "Run `python -m app.oauth_setup`, approve the new permission, then choose "
                        "Check YouTube again."
                    )
                    db.commit()
                    notification = (
                        "Gym logger needs YouTube permission",
                        f"Reconnect YouTube to finish checking {session.name}.",
                    )
                else:
                    # A transient YouTube API error should not lose a successfully uploaded video.
                    logger.warning("Could not poll YouTube processing: %s", error)

            if status is None:
                if notification is None:
                    return
            elif status == "processing":
                return
            elif status == "succeeded":
                session.status = SessionStatus.COMPLETE
                session.processing_error = None
                db.commit()
                notification = ("Workout video ready", f"{session.name} is ready on YouTube.")
            else:
                session.status = SessionStatus.FAILED
                session.processing_error = (
                    f"YouTube could not finish processing this video. Reported status: {status}."
                )
                db.commit()
                notification = (
                    "Workout video needs attention",
                    f"YouTube could not finish processing {session.name}.",
                )

        if notification:
            if notification[0] == "Workout video ready":
                with self.session_factory() as db:
                    completed = self._load_session(db, session_id)
                    if completed:
                        self._cleanup_after_youtube_success(completed.id, completed.clips)
            send_push_notification(
                self.session_factory,
                self.settings,
                title=notification[0],
                body=notification[1],
            )

    def _trim_window(self, source_duration_ms: int | None) -> tuple[float, float] | None:
        """Return the requested trim start and retained duration without emptying a short clip."""
        if source_duration_ms is None or source_duration_ms <= 0:
            return None
        requested_start = self.settings.trim_start_seconds
        requested_end = self.settings.trim_end_seconds
        requested_total = requested_start + requested_end
        if requested_total == 0:
            return None

        source_duration = source_duration_ms / 1_000
        removable = max(source_duration - MINIMUM_TRIMMED_CLIP_SECONDS, 0)
        if removable == 0:
            return None
        scale = min(1.0, removable / requested_total)
        start = requested_start * scale
        retained_duration = source_duration - (requested_total * scale)
        return start, retained_duration

    def _normalize(
        self, source: Path, destination: Path, source_duration_ms: int | None = None
    ) -> None:
        trim_window = self._trim_window(source_duration_ms)
        input_arguments = ["-i", str(source)]
        if trim_window:
            start, retained_duration = trim_window
            input_arguments.extend(["-ss", f"{start:.3f}", "-t", f"{retained_duration:.3f}"])
        self._run_ffmpeg(
            [
                self.settings.ffmpeg_path,
                "-y",
                "-fflags",
                "+genpts",
                *input_arguments,
                "-map",
                "0:v:0",
                "-map",
                "0:a?",
                "-vf",
                "fps=30,scale=1920:1080:force_original_aspect_ratio=decrease,"
                "pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,setpts=PTS-STARTPTS",
                "-af",
                "aresample=async=1:first_pts=0,asetpts=N/SR/TB",
                "-r",
                "30",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-ar",
                "48000",
                "-ac",
                "2",
                "-movflags",
                "+faststart",
                str(destination),
            ],
            "normalizing clip",
        )

    def _stitch(self, normalized_paths: Sequence[Path], work_dir: Path, output_path: Path) -> None:
        if not normalized_paths or any(not path.exists() for path in normalized_paths):
            raise ProcessingError("One or more normalized clips are missing.")
        concat_path = work_dir / "concat.txt"
        entries = []
        for path in normalized_paths:
            # Paths are generated by this service.
            # Concat receives a data file, never a shell command.
            escaped = path.resolve().as_posix().replace("'", "'\\\\''")
            entries.append(f"file '{escaped}'")
        concat_path.write_text("\n".join(entries) + "\n", encoding="utf-8")
        self._run_ffmpeg(
            [
                self.settings.ffmpeg_path,
                "-y",
                "-f",
                "concat",
                "-safe",
                "0",
                "-i",
                str(concat_path),
                "-c",
                "copy",
                "-avoid_negative_ts",
                "make_zero",
                "-movflags",
                "+faststart",
                str(output_path),
            ],
            "stitching clips",
        )

    def _run_ffmpeg(self, command: list[str], operation: str) -> None:
        try:
            result = subprocess.run(
                command, capture_output=True, check=False, text=True, timeout=60 * 60
            )
        except (OSError, subprocess.TimeoutExpired) as error:
            raise ProcessingError(f"ffmpeg failed while {operation}: {error}") from error
        if result.returncode != 0:
            detail = result.stderr.strip() or "ffmpeg returned a non-zero exit code"
            raise ProcessingError(f"ffmpeg failed while {operation}: {detail[:2_000]}")

    def _cleanup_after_upload(self, normalized_dir: Path) -> None:
        shutil.rmtree(normalized_dir, ignore_errors=True)

    def _cleanup_after_youtube_success(self, session_id: str, clips: Sequence[Clip]) -> None:
        if self.settings.delete_originals_after_success:
            for clip in clips:
                try:
                    original_clip_path(clip).unlink(missing_ok=True)
                except OSError:
                    logger.warning("Could not delete original clip", extra={"clip_id": clip.id})
        if self.settings.delete_output_after_success:
            try:
                (self.settings.output_dir / f"{session_id}.mp4").unlink(missing_ok=True)
            except OSError:
                logger.warning("Could not delete stitched output", extra={"session_id": session_id})
