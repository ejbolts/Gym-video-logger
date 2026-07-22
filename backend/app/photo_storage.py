from __future__ import annotations

import re
import uuid
from dataclasses import dataclass
from pathlib import Path

from fastapi import UploadFile
from PIL import Image, ImageOps, UnidentifiedImageError
from pillow_heif import register_heif_opener

from .config import Settings

CHUNK_SIZE = 1024 * 1024
ALLOWED_IMAGE_FORMATS = {"JPEG", "PNG", "WEBP", "HEIF", "HEIC"}
FULL_MAX_SIZE = (1800, 1800)
THUMBNAIL_MAX_SIZE = (360, 360)
MAX_SOURCE_PIXELS = 50_000_000

register_heif_opener()


class PhotoValidationError(Exception):
    def __init__(self, code: str, message: str, status_code: int = 422):
        self.code = code
        self.message = message
        self.status_code = status_code
        super().__init__(message)


@dataclass(frozen=True)
class StoredMachinePhoto:
    original_filename: str
    full_filename: str
    thumbnail_filename: str
    file_size: int
    width: int
    height: int


def photo_display_filename(filename: str | None) -> str:
    raw = filename or "machine-photo"
    raw = raw.replace("\\", "/").split("/")[-1]
    cleaned = re.sub(r"[\x00-\x1f]", "_", raw).strip()[:500]
    return cleaned or "machine-photo"


def machine_photo_paths(
    settings: Settings, full_filename: str, thumbnail_filename: str
) -> tuple[Path, Path]:
    return (
        settings.machine_photos_dir / full_filename,
        settings.machine_photos_dir / thumbnail_filename,
    )


async def store_machine_photo(*, upload: UploadFile, settings: Settings) -> StoredMachinePhoto:
    """Decode an uploaded image, correct orientation, and atomically store WebP variants."""
    token = uuid.uuid4().hex
    upload_partial = settings.machine_photos_dir / f"{token}.upload.partial"
    full_filename = f"{token}-full.webp"
    thumbnail_filename = f"{token}-thumbnail.webp"
    full_path, thumbnail_path = machine_photo_paths(settings, full_filename, thumbnail_filename)
    full_partial = settings.machine_photos_dir / f"{full_filename}.partial"
    thumbnail_partial = settings.machine_photos_dir / f"{thumbnail_filename}.partial"
    total = 0
    stored = False
    try:
        with upload_partial.open("xb") as target:
            while chunk := await upload.read(CHUNK_SIZE):
                total += len(chunk)
                if total > settings.max_photo_size_bytes:
                    raise PhotoValidationError(
                        "photo_too_large",
                        "Machine photos are limited to 15 MB.",
                        status_code=413,
                    )
                target.write(chunk)
        if total == 0:
            raise PhotoValidationError("invalid_photo", "The selected photo is empty.")

        try:
            with Image.open(upload_partial) as source:
                source_format = source.format
                if source_format not in ALLOWED_IMAGE_FORMATS:
                    raise PhotoValidationError(
                        "unsupported_photo_type",
                        "Choose a JPEG, PNG, WebP, HEIF, or HEIC image.",
                        status_code=415,
                    )
                if source.width * source.height > MAX_SOURCE_PIXELS:
                    raise PhotoValidationError(
                        "photo_dimensions_too_large",
                        "The selected photo has more than 50 megapixels.",
                        status_code=413,
                    )
                source.load()
                oriented = ImageOps.exif_transpose(source)
                if oriented.mode not in {"RGB", "RGBA"}:
                    oriented = oriented.convert(
                        "RGBA" if "transparency" in oriented.info else "RGB"
                    )

                full = oriented.copy()
                full.thumbnail(FULL_MAX_SIZE, Image.Resampling.LANCZOS)
                width, height = full.size
                full.save(full_partial, format="WEBP", quality=90, method=6)

                thumbnail = full.copy()
                thumbnail.thumbnail(THUMBNAIL_MAX_SIZE, Image.Resampling.LANCZOS)
                thumbnail.save(thumbnail_partial, format="WEBP", quality=82, method=6)
        except PhotoValidationError:
            raise
        except (Image.DecompressionBombError, UnidentifiedImageError, OSError, ValueError) as error:
            raise PhotoValidationError(
                "invalid_photo",
                "The selected file is not a readable JPEG, PNG, WebP, HEIF, or HEIC image.",
            ) from error

        full_partial.replace(full_path)
        thumbnail_partial.replace(thumbnail_path)
        stored = True
        return StoredMachinePhoto(
            original_filename=photo_display_filename(upload.filename),
            full_filename=full_filename,
            thumbnail_filename=thumbnail_filename,
            file_size=total,
            width=width,
            height=height,
        )
    except PhotoValidationError:
        raise
    except OSError as error:
        raise PhotoValidationError(
            "photo_write_failed", f"Could not save the machine photo: {error}", status_code=500
        ) from error
    finally:
        await upload.close()
        for path in (upload_partial, full_partial, thumbnail_partial):
            path.unlink(missing_ok=True)
        if not stored:
            full_path.unlink(missing_ok=True)
            thumbnail_path.unlink(missing_ok=True)


def delete_machine_photo_files(
    settings: Settings, full_filename: str, thumbnail_filename: str
) -> None:
    for path in machine_photo_paths(settings, full_filename, thumbnail_filename):
        path.unlink(missing_ok=True)
