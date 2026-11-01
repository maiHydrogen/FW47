"""Metrics and health endpoints (plan step A7)."""

import asyncio
import os
import urllib.error
import urllib.request
import uuid
from collections import Counter
from dataclasses import dataclass, field

import pytest
import redis
import redis.asyncio as aioredis
from prometheus_client import CollectorRegistry

from service.observe import Health, StatsCollector, group_lag, serve
from service.streams import ConsumerStats


@dataclass
class Kinds:
    by_kind: Counter = field(default_factory=Counter)


def get(server, path):
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{server.server_port}{path}", timeout=2) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


@pytest.fixture
def endpoint():
    now = [0.0]
    health = Health(stale_s=10, clock=lambda: now[0])
    stats, kinds = ConsumerStats(processed=7, dropped=2), Kinds(Counter({"slowdown:open": 3}))
    registry = CollectorRegistry()
    registry.register(StatsCollector().add("fw47_test_consumer", stats).add("fw47_test_dev", kinds)
                      .add("fw47_test_open", lambda: 4, "gauge", "open things"))
    server = serve(0, health, registry)
    yield server, health, stats, now
    server.shutdown()


def test_metrics_read_the_stats_at_scrape_time(endpoint):
    server, _, stats, _ = endpoint
    status, body = get(server, "/metrics")
    assert status == 200
    assert "fw47_test_consumer_processed_total 7.0" in body and "fw47_test_consumer_dropped_total 2.0" in body
    assert 'fw47_test_dev_by_kind_total{key="slowdown:open"} 3.0' in body and "fw47_test_open 4.0" in body
    stats.processed += 5
    assert "fw47_test_consumer_processed_total 12.0" in get(server, "/metrics")[1]


def test_healthz_fails_when_the_loop_stops_beating_or_redis_is_down(endpoint):
    server, health, _, now = endpoint
    assert get(server, "/healthz")[0] == 200
    now[0] = 11.0                       # no beat for 11 s
    assert get(server, "/healthz")[0] == 503
    health.beat()
    assert get(server, "/healthz")[0] == 200
    health.redis_ok = False
    assert get(server, "/healthz")[0] == 503
    assert get(server, "/nope")[0] == 404


REDIS_URL = os.environ.get("FW47_TEST_REDIS_URL", "redis://localhost:6379/15")


def _redis_up():
    try:
        return redis.Redis.from_url(REDIS_URL, socket_connect_timeout=1, socket_timeout=1).ping()
    except (redis.ConnectionError, redis.TimeoutError, OSError):
        return False


@pytest.mark.skipif(not _redis_up() and os.environ.get("FW47_REQUIRE_REDIS") != "1", reason=f"no Redis at {REDIS_URL}")
def test_group_lag_counts_undelivered_and_pending_entries():
    async def go():
        client = aioredis.Redis.from_url(REDIS_URL)
        stream = f"test:{uuid.uuid4().hex[:8]}:lag"
        assert await group_lag(client, stream, "g") == (None, None)          # no stream yet
        await client.xgroup_create(stream, "g", id="0", mkstream=True)
        for i in range(10):
            await client.xadd(stream, {"i": i})
        assert await group_lag(client, stream, "g") == (10, 0)
        await client.xreadgroup("g", "c1", {stream: ">"}, count=4)          # 4 delivered, not acked
        assert await group_lag(client, stream, "g") == (6, 4)
        await client.delete(stream)
        await client.aclose()
    asyncio.run(go())
