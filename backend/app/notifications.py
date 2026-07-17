from __future__ import annotations

import base64
import json
import logging
from pathlib import Path
from typing import TYPE_CHECKING

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .config import Settings
from .models import PushSubscription

if TYPE_CHECKING:
    from collections.abc import Callable

logger = logging.getLogger(__name__)


def _vapid_private_key(path: Path) -> ec.EllipticCurvePrivateKey:
    if path.exists():
        return serialization.load_pem_private_key(path.read_bytes(), password=None)
    path.parent.mkdir(parents=True, exist_ok=True)
    key = ec.generate_private_key(ec.SECP256R1())
    path.write_bytes(
        key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        )
    )
    return key


def vapid_public_key(settings: Settings) -> str:
    key = _vapid_private_key(settings.web_push_vapid_private_key_path)
    raw = key.public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
    )
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def push_available(settings: Settings) -> bool:
    try:
        import pywebpush  # noqa: F401
    except ImportError:
        return False
    vapid_public_key(settings)
    return True


def send_push_notification(
    session_factory: Callable[[], Session],
    settings: Settings,
    *,
    title: str,
    body: str,
) -> None:
    try:
        from pywebpush import WebPushException, webpush
    except ImportError:
        logger.warning("Push notification skipped because pywebpush is not installed")
        return

    key_path = settings.web_push_vapid_private_key_path
    _vapid_private_key(key_path)
    with session_factory() as db:
        subscriptions = list(db.scalars(select(PushSubscription)))

    stale_ids: list[str] = []
    for subscription in subscriptions:
        try:
            webpush(
                subscription_info={
                    "endpoint": subscription.endpoint,
                    "keys": {"p256dh": subscription.p256dh, "auth": subscription.auth},
                },
                data=json.dumps({"title": title, "body": body, "url": "/"}),
                vapid_private_key=str(key_path),
                vapid_claims={"sub": settings.web_push_contact_email},
            )
        except WebPushException as error:
            response = getattr(error, "response", None)
            if response is not None and response.status_code in {404, 410}:
                stale_ids.append(subscription.id)
            else:
                logger.warning("Could not deliver push notification: %s", error)

    if stale_ids:
        with session_factory() as db:
            db.execute(delete(PushSubscription).where(PushSubscription.id.in_(stale_ids)))
            db.commit()
