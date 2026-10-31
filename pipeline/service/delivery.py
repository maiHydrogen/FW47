"""Delivery of incident events to the Forge webtrigger (plan step A5).

Each event is POSTed as its JSON body with these headers:

    X-FW47-Timestamp: <unix seconds>
    X-FW47-Signature: sha256=<hex HMAC-SHA256(secret, "<timestamp>." + body)>
    X-FW47-Event-Id:  <event ID, the idempotency key>

The receiver (A6) recomputes the signature and rejects timestamps more than 5 minutes old, so a captured
request can't be replayed later. Every attempt is signed afresh.

Retries: 429, 5xx, timeouts and connection errors are retried up to `max_attempts` in all, waiting a random
time in [0, min(cap_s, base_s * 2^n)] ("full jitter", so many senders don't retry in step), and at least
`Retry-After` when the response gives one. Any other status fails at once. A failed event goes to
`fw47:dlq` with the reason, and delivery moves on.

Events are sent one at a time, in stream order, so an incident's `opened` always arrives before its
`escalated` and `closed`. A batch is acknowledged after it has been sent; a crash in between sends some
events again, which the event IDs make harmless.
"""

import asyncio
import hashlib
import hmac
import logging
import random
import time
from dataclasses import dataclass
from email.utils import parsedate_to_datetime

import httpx

from service.schema import to_fields

log = logging.getLogger("fw47.delivery")


def sign(secret, timestamp, body):
    return "sha256=" + hmac.new(secret.encode(), f"{timestamp}.".encode() + body, hashlib.sha256).hexdigest()


def retry_after(value, now):
    """Seconds to wait from a Retry-After header (seconds or an HTTP date); None if absent or unreadable."""
    if not value:
        return None
    try:
        return max(0.0, float(value))
    except ValueError:
        pass
    try:
        return max(0.0, parsedate_to_datetime(value).timestamp() - now)
    except (TypeError, ValueError):
        return None


@dataclass
class Result:
    ok: bool
    attempts: int
    status: int | None = None    # last HTTP status
    error: str | None = None     # why it failed


@dataclass
class DeliveryStats:
    delivered: int = 0
    retries: int = 0
    dead_lettered: int = 0


class Sender:
    """Sends one event at a time to `url`, retrying as described above.

    http: an httpx.AsyncClient. sleep, clock and rand are injectable for tests.
    """

    def __init__(self, http, url, secret, max_attempts=6, base_s=0.5, cap_s=30.0, max_wait_s=300.0,
                 sleep=asyncio.sleep, clock=time.time, rand=random.random):
        if not secret:
            raise ValueError("a webhook secret is required")
        self.http, self.url, self.secret = http, url, secret
        self.max_attempts, self.base_s, self.cap_s, self.max_wait_s = max_attempts, base_s, cap_s, max_wait_s
        self.sleep, self.clock, self.rand = sleep, clock, rand

    async def send(self, event):
        body = event.body.encode()
        status = error = None
        for attempt in range(1, self.max_attempts + 1):
            ts = str(int(self.clock()))
            headers = {"Content-Type": "application/json", "X-FW47-Timestamp": ts,
                       "X-FW47-Signature": sign(self.secret, ts, body), "X-FW47-Event-Id": event.event_id}
            wait_at_least = None
            try:
                r = await self.http.post(self.url, content=body, headers=headers)
                status = r.status_code
                if r.is_success:
                    return Result(True, attempt, status)
                error = f"HTTP {status}"
                if status != 429 and status < 500:
                    return Result(False, attempt, status, error)   # won't succeed on retry
                wait_at_least = retry_after(r.headers.get("Retry-After"), self.clock())
            except httpx.TransportError as e:
                status, error = None, f"{type(e).__name__}: {e}"
            if attempt == self.max_attempts:
                break
            wait = self.rand() * min(self.cap_s, self.base_s * 2 ** (attempt - 1))
            if wait_at_least is not None:
                wait = max(wait, min(wait_at_least, self.max_wait_s))
            log.warning("%s: %s, retry %d in %.1f s", event.event_id, error, attempt, wait)
            await self.sleep(wait)
        return Result(False, self.max_attempts, status, error)


def delivery_handler(sender, client, dlq_stream, stats):
    """A `Consumer` handler for the outbox: send each event, dead-letter the ones that fail."""
    async def handle(batch):
        for _, event in batch:
            r = await sender.send(event)
            stats.retries += r.attempts - 1
            if r.ok:
                stats.delivered += 1
                continue
            stats.dead_lettered += 1
            log.error("%s dead-lettered after %d attempts: %s", event.event_id, r.attempts, r.error)
            await client.xadd(dlq_stream, {**to_fields(event), "error": r.error or "", "attempts": str(r.attempts)})
    return handle
