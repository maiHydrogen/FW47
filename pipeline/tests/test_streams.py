"""Integration tests against a real Redis (plan step A3).

Uses FW47_TEST_REDIS_URL (default redis://localhost:6379/15). Skipped when no Redis answers, unless
FW47_REQUIRE_REDIS=1 (set in CI, where a Redis service runs), so a missing server can't pass silently there.
"""

import asyncio
import os
import time
import uuid
from dataclasses import replace

import pytest
import redis
import redis.asyncio as aioredis

from service.config import Config
from service.schema import SCHEMA_VERSION, LapCompleted, TelemetrySample
from service.streams import Consumer, publish

URL = os.environ.get("FW47_TEST_REDIS_URL", "redis://localhost:6379/15")


def _redis_up():
    try:
        return redis.Redis.from_url(URL, socket_connect_timeout=1, socket_timeout=1).ping()
    except (redis.ConnectionError, redis.TimeoutError, OSError):
        return False


if not _redis_up():
    if os.environ.get("FW47_REQUIRE_REDIS") == "1":
        raise RuntimeError(f"FW47_REQUIRE_REDIS=1 but no Redis at {URL}")
    pytestmark = pytest.mark.skip(reason=f"no Redis at {URL}")


class Crash(Exception):
    pass


def run(coro):
    return asyncio.run(coro)


async def _client():
    return aioredis.Redis.from_url(URL)


@pytest.fixture
def cfg():
    p = f"test:{uuid.uuid4().hex[:8]}"
    yield Config(redis_url=URL, telemetry_stream=f"{p}:telemetry", laps_stream=f"{p}:laps", scorer_group="scorers")

    async def cleanup():
        c = await _client()
        await c.delete(f"{p}:telemetry", f"{p}:laps")
        await c.aclose()
    run(cleanup())


def samples(n, driver=44, t0=1709391920.0):
    return [TelemetrySample(SCHEMA_VERSION, 9472, driver, t0 + i * 0.02, None, 3, 100.0 + i, 280.0, 11000.0, 7,
                            100.0, 0, 12, i % 13 != 0) for i in range(n)]


async def source(msgs):
    for m in msgs:
        yield replace(m, t_published=time.time())


async def consume_until(c, n, timeout=10):
    """Run consumer `c` until it has processed `n` messages."""
    stop = asyncio.Event()

    async def watch():
        t = time.monotonic()
        while c.stats.processed < n and time.monotonic() - t < timeout:
            await asyncio.sleep(0.01)
        stop.set()
    w = asyncio.create_task(watch())
    await c.run(stop)
    await w


async def pending(client, cfg):
    return (await client.xpending(cfg.telemetry_stream, cfg.scorer_group))["pending"]


def test_publish_n_consume_n_all_acknowledged(cfg):
    async def go():
        client = await _client()
        msgs = samples(1000)
        lap = LapCompleted(SCHEMA_VERSION, 9472, 44, 1709391930.0, None, 3, 92.1, "SOFT", 4, 1)
        stats = await publish(source(msgs + [lap]), client, cfg)
        assert (stats.telemetry, stats.laps) == (1000, 1)
        assert await client.xlen(cfg.telemetry_stream) == 1000 and await client.xlen(cfg.laps_stream) == 1
        got = []

        async def handle(batch):
            got.extend(m for _, m in batch)
        c = Consumer(client, cfg.telemetry_stream, cfg.scorer_group, "s1", handle, block_ms=50)
        await consume_until(c, 1000)
        assert [replace(m, t_published=None) for m in got] == msgs     # same messages, same order
        assert c.stats.processed == 1000 and await pending(client, cfg) == 0
        await client.aclose()
    run(go())


def test_a_gap_in_the_source_doesnt_hold_back_buffered_messages(cfg):
    async def go():
        client = await _client()
        seen = []

        async def gappy():
            for m in samples(3):
                yield replace(m, t_published=time.time())
            await asyncio.sleep(0.5)                       # all cars silent: the 3 must not wait for this
            seen.append(await client.xlen(cfg.telemetry_stream))
            for m in samples(2, t0=1709391930.0):
                yield replace(m, t_published=time.time())
        stats = await publish(gappy(), client, cfg)
        assert seen == [3] and stats.telemetry == 5 and await client.xlen(cfg.telemetry_stream) == 5
        await client.aclose()
    run(go())


async def crash_after_reading(client, cfg, name):
    """A consumer that reads a batch and dies before acknowledging it."""
    async def handle(batch):
        raise Crash
    c = Consumer(client, cfg.telemetry_stream, cfg.scorer_group, name, handle, block_ms=50)
    with pytest.raises(Crash):
        await c.run()


def test_restarted_scorer_resumes_from_its_pending_entries(cfg):
    async def go():
        client = await _client()
        await Consumer(client, cfg.telemetry_stream, cfg.scorer_group, "s1", None).ensure_group()
        await publish(source(samples(300)), client, cfg)
        await crash_after_reading(client, cfg, "s1")
        assert await pending(client, cfg) == 300
        got = []

        async def handle(batch):
            got.extend(eid for eid, _ in batch)
        c = Consumer(client, cfg.telemetry_stream, cfg.scorer_group, "s1", handle, block_ms=50)   # same name
        await consume_until(c, 300)
        assert len(got) == len(set(got)) == 300
        assert c.stats.reclaimed == 0 and await pending(client, cfg) == 0
        await client.aclose()
    run(go())


def test_new_scorer_takes_over_a_dead_consumers_entries(cfg):
    async def go():
        client = await _client()
        await Consumer(client, cfg.telemetry_stream, cfg.scorer_group, "s1", None).ensure_group()
        await publish(source(samples(300)), client, cfg)
        await crash_after_reading(client, cfg, "s1")

        async def handle(batch):
            pass
        c = Consumer(client, cfg.telemetry_stream, cfg.scorer_group, "s2", handle, block_ms=50, claim_idle_ms=0)
        await consume_until(c, 300)
        assert c.stats.reclaimed == 300 and await pending(client, cfg) == 0
        await client.aclose()
    run(go())


def test_entries_older_than_retention_are_trimmed_and_counted_as_dropped(cfg):
    async def go():
        client = await _client()
        short = replace(cfg, retention_s=0.5)
        await Consumer(client, cfg.telemetry_stream, cfg.scorer_group, "s1", None).ensure_group()
        await publish(source(samples(1000)), client, short)
        await crash_after_reading(client, cfg, "s1")          # the scorer goes down holding a batch
        await asyncio.sleep(1.0)                               # ...for longer than the retention
        await publish(source(samples(1000, t0=1709391990.0)), client, short)
        assert await client.xlen(cfg.telemetry_stream) < 2000

        async def handle(batch):
            pass
        c = Consumer(client, cfg.telemetry_stream, cfg.scorer_group, "s1", handle, block_ms=50)
        await consume_until(c, 1000)
        assert c.stats.dropped > 0                             # the crashed batch, trimmed while pending
        assert c.stats.processed >= 1000                       # everything still retained gets through
        assert await pending(client, cfg) == 0
        await client.aclose()
    run(go())
