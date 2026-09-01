from __future__ import annotations

import asyncio
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
    endpoint: str | None = None,
    url: str = "/",
    tag: str | None = None,
) -> None:
    try:
        from pywebpush import WebPushException, webpush
    except ImportError:
        logger.warning("Push notification skipped because pywebpush is not installed")
        return

    key_path = settings.web_push_vapid_private_key_path
    _vapid_private_key(key_path)
    with session_factory() as db:
        query = select(PushSubscription)
        if endpoint is not None:
            query = query.where(PushSubscription.endpoint == endpoint)
        subscriptions = list(db.scalars(query))

    stale_ids: list[str] = []
    for subscription in subscriptions:
        try:
            webpush(
                subscription_info={
                    "endpoint": subscription.endpoint,
                    "keys": {"p256dh": subscription.p256dh, "auth": subscription.auth},
                },
                data=json.dumps({"title": title, "body": body, "url": url, "tag": tag}),
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


class RestTimerNotificationScheduler:
    def __init__(
        self,
        session_factory: Callable[[], Session],
        settings: Settings,
    ) -> None:
        self.session_factory = session_factory
        self.settings = settings
        self._tasks: dict[str, tuple[str, asyncio.Task[None]]] = {}

    def schedule(self, *, endpoint: str, timer_id: str, delay_seconds: int) -> None:
        self._cancel_endpoint(endpoint)
        task = asyncio.create_task(self._deliver(endpoint=endpoint, delay_seconds=delay_seconds))
        self._tasks[endpoint] = (timer_id, task)
        task.add_done_callback(lambda completed: self._discard(endpoint, completed))

    def cancel(self, *, endpoint: str, timer_id: str) -> None:
        current = self._tasks.get(endpoint)
        if current is not None and current[0] == timer_id:
            self._cancel_endpoint(endpoint)

    def cancel_endpoint(self, endpoint: str) -> None:
        self._cancel_endpoint(endpoint)

    async def stop(self) -> None:
        tasks = [task for _, task in self._tasks.values()]
        self._tasks.clear()
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    def _cancel_endpoint(self, endpoint: str) -> None:
        current = self._tasks.pop(endpoint, None)
        if current is not None:
            current[1].cancel()

    def _discard(self, endpoint: str, completed: asyncio.Task[None]) -> None:
        current = self._tasks.get(endpoint)
        if current is not None and current[1] is completed:
            self._tasks.pop(endpoint, None)

    async def _deliver(self, *, endpoint: str, delay_seconds: int) -> None:
        await asyncio.sleep(delay_seconds)
        await asyncio.to_thread(
            send_push_notification,
            self.session_factory,
            self.settings,
            title="Rest complete",
            body="Time for your next set.",
            endpoint=endpoint,
            url="/#log",
            tag="rest-timer",
        )
