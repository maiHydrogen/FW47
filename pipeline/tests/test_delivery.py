"""Delivery to the webtrigger (plan step A5): signing, retries with backoff, and the dead-letter stream."""

import asyncio
import json
import os
import uuid
from email.utils import formatdate

import httpx
import pytest
import redis
import redis.asyncio as aioredis

from service.delivery import DeliveryStats, Sender, delivery_handler, retry_after, sign
from service.schema import SCHEMA_VERSION, IncidentEvent, from_fields, to_fields
from service.streams import Consumer

URL = "https://example.invalid/webtrigger"
SECRET = "s3cret"
NOW = 1_800_000_000.0
EVENT = IncidentEvent(SCHEMA_VERSION, "abc:opened", "opened", 9472, 1.0, json.dumps({"event": "opened"}))


def sender(responses, sleeps, **kw):
    """A Sender whose server replies with `responses` in turn (an int status, a Response, or an exception)."""
    seen = []

    def reply(request):
        seen.append(request)
        r = responses[min(len(seen), len(responses)) - 1]
        if isinstance(r, Exception):
            raise r
        return r if isinstance(r, httpx.Response) else httpx.Response(r)

    async def sleep(s):
        sleeps.append(s)
    http = httpx.AsyncClient(transport=httpx.MockTransport(reply))
    return Sender(http, URL, SECRET, sleep=sleep, clock=lambda: NOW, rand=lambda: 1.0, **kw), seen


def send(responses, **kw):
    sleeps = []
    s, seen = sender(responses, sleeps, **kw)
    return asyncio.run(s.send(EVENT)), seen, sleeps


def test_request_is_signed_over_timestamp_and_body():
    r, (req,), _ = send([200])
    assert r.ok and r.attempts == 1
    assert req.content == EVENT.body.encode() and req.headers["X-FW47-Event-Id"] == "abc:opened"
    ts = req.headers["X-FW47-Timestamp"]
    assert ts == str(int(NOW)) and req.headers["X-FW47-Signature"] == sign(SECRET, ts, req.content)
    assert req.headers["X-FW47-Signature"] != sign("wrong", ts, req.content)


def test_5xx_is_retried_with_exponential_backoff():
    r, seen, sleeps = send([503, 502, 200])
    assert (r.ok, r.attempts, len(seen)) == (True, 3, 3)
    assert sleeps == [0.5, 1.0]                  # rand=1: the top of each jitter window


def test_backoff_is_capped():
    _, _, sleeps = send([500], max_attempts=8, cap_s=4.0)
    assert sleeps == [0.5, 1.0, 2.0, 4.0, 4.0, 4.0, 4.0]


def test_429_waits_at_least_retry_after():
    r, _, sleeps = send([httpx.Response(429, headers={"Retry-After": "7"}), 200])
    assert r.ok and sleeps == [7.0]
    assert retry_after(formatdate(NOW + 12, usegmt=True), NOW) == 12.0 and retry_after("soon", NOW) is None


def test_timeouts_and_connection_errors_are_retried():
    r, _, _ = send([httpx.ConnectError("refused"), httpx.ReadTimeout("slow"), 200])
    assert r.ok and r.attempts == 3


def test_gives_up_after_max_attempts():
    r, seen, sleeps = send([500], max_attempts=4)
    assert (r.ok, r.attempts, r.error, len(seen), len(sleeps)) == (False, 4, "HTTP 500", 4, 3)


def test_other_4xx_fail_at_once():
    r, seen, _ = send([401])
    assert (r.ok, r.attempts, r.status, len(seen)) == (False, 1, 401, 1)


def test_a_secret_is_required():
    with pytest.raises(ValueError):
        Sender(None, URL, "")


# ---------------------------------------------------------------- the dead-letter path, against Redis

REDIS_URL = os.environ.get("FW47_TEST_REDIS_URL", "redis://localhost:6379/15")


def _redis_up():
    try:
        return redis.Redis.from_url(REDIS_URL, socket_connect_timeout=1, socket_timeout=1).ping()
    except (redis.ConnectionError, redis.TimeoutError, OSError):
        return False


needs_redis = pytest.mark.skipif(not _redis_up() and os.environ.get("FW47_REQUIRE_REDIS") != "1",
                                 reason=f"no Redis at {REDIS_URL}")


@needs_redis
def test_failed_events_go_to_the_dlq_and_delivery_moves_on():
    async def go():
        client = aioredis.Redis.from_url(REDIS_URL)
        p = f"test:{uuid.uuid4().hex[:8]}"
        outbox, dlq = f"{p}:outbox", f"{p}:dlq"
        events = [IncidentEvent(SCHEMA_VERSION, f"e{i}", "opened", 1, float(i), "{}") for i in range(3)]
        for e in events:
            await client.xadd(outbox, to_fields(e))
        # e1 always fails with 500; the others succeed
        s, seen = sender([200, 500, 500, 500, 200], [], max_attempts=3)
        stats = DeliveryStats()
        c = Consumer(client, outbox, "delivery", "d1", delivery_handler(s, client, dlq, stats), block_ms=50)
        stop = asyncio.Event()
        task = asyncio.create_task(c.run(stop))
        while c.stats.processed < 3:
            await asyncio.sleep(0.01)
        stop.set()
        await task
        assert [r.headers["X-FW47-Event-Id"] for r in seen] == ["e0", "e1", "e1", "e1", "e2"]
        assert (stats.delivered, stats.dead_lettered, stats.retries) == (2, 1, 2)
        (_, fields), = await client.xrange(dlq)
        assert from_fields(fields) == events[1] and fields[b"error"] == b"HTTP 500" and fields[b"attempts"] == b"3"
        assert (await client.xpending(outbox, "delivery"))["pending"] == 0
        await client.delete(outbox, dlq)
        await client.aclose()
    asyncio.run(go())
