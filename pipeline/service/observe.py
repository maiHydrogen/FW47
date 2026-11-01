"""Metrics and health (plan step A7).

Each service serves, on `FW47_METRICS_PORT` (default 9100):

- `/metrics`: Prometheus text format. Counters come straight from the services' own stats objects at scrape
  time (`StatsCollector`), so nothing is counted twice. Consumer lag and pending counts come from Redis
  (`XINFO GROUPS`), sampled every few seconds by `watch_lag`.
- `/healthz`: 200 while the service's event loop is alive and its last Redis call worked, else 503. The
  loop proves it's alive by calling `Health.beat()` every second (`heartbeat`); a loop stuck for more than
  `stale_s` fails the check, and Docker restarts the container.

The server runs in a thread (stdlib `http.server`), so a scrape never waits on the event loop.
"""

import asyncio
import logging
import threading
import time
from dataclasses import fields
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import redis
from prometheus_client import REGISTRY, Gauge, generate_latest
from prometheus_client.core import CounterMetricFamily, GaugeMetricFamily

log = logging.getLogger("fw47.observe")

LAG = Gauge("fw47_stream_lag", "Entries in the stream not yet delivered to the group (XINFO GROUPS lag)",
            ["stream", "group"])
PENDING = Gauge("fw47_stream_pending", "Entries delivered to the group but not acknowledged", ["stream", "group"])


class Health:
    def __init__(self, stale_s=10.0, clock=time.monotonic):
        self.stale_s, self.clock = stale_s, clock
        self.last_beat = clock()
        self.redis_ok = True

    def beat(self):
        self.last_beat = self.clock()

    def ok(self):
        return self.redis_ok and self.clock() - self.last_beat < self.stale_s


async def heartbeat(health, stop, every_s=1.0):
    while not stop.is_set():
        health.beat()
        try:
            await asyncio.wait_for(stop.wait(), every_s)
        except TimeoutError:
            pass


class StatsCollector:
    """Exposes dataclass stats objects as metrics: `add("fw47_scorer_consumer", stats, kind)`.

    kind is "counter" (int fields, exported as `<prefix>_<field>_total`) or "gauge". A callable source
    is called at scrape time, for values that aren't a dataclass (e.g. the number of open incidents).
    """

    def __init__(self):
        self.sources = []

    def add(self, prefix, source, kind="counter", help_text=""):
        self.sources.append((prefix, source, kind, help_text))
        return self

    def collect(self):
        for prefix, source, kind, help_text in self.sources:
            if callable(source):
                g = GaugeMetricFamily(prefix, help_text or prefix)
                g.add_metric([], float(source()))
                yield g
                continue
            for f in fields(source):
                value = getattr(source, f.name)
                if isinstance(value, dict):
                    family = CounterMetricFamily(f"{prefix}_{f.name}", help_text or f.name, labels=["key"])
                    for k, v in value.items():
                        family.add_metric([str(k)], float(v))
                    yield family
                elif kind == "counter":
                    yield CounterMetricFamily(f"{prefix}_{f.name}", help_text or f.name, value=float(value))
                else:
                    yield GaugeMetricFamily(f"{prefix}_{f.name}", help_text or f.name, value=float(value))


def serve(port, health, registry=REGISTRY):
    """Start /metrics and /healthz in a daemon thread. Returns the server (its `.server_port` is the port)."""
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path.startswith("/metrics"):
                body, status, ctype = generate_latest(registry), 200, "text/plain; version=0.0.4"
            elif self.path.startswith("/healthz"):
                good = health.ok()
                body, status, ctype = (b"ok\n" if good else b"unhealthy\n"), (200 if good else 503), "text/plain"
            else:
                body, status, ctype = b"not found\n", 404, "text/plain"
            self.send_response(status)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    log.info("metrics and health on :%d", server.server_port)
    return server


async def group_lag(client, stream, group):
    """(lag, pending) of a consumer group, from XINFO GROUPS; (None, None) if the group doesn't exist yet."""
    try:
        groups = await client.xinfo_groups(stream)
    except redis.ResponseError:     # the stream doesn't exist yet
        return None, None
    for g in groups:
        name = g["name"].decode() if isinstance(g["name"], bytes) else g["name"]
        if name == group:
            return g.get("lag"), g.get("pending")
    return None, None


async def watch_lag(client, health, stop, streams, every_s=5.0):
    """Sample lag and pending for each (stream, group) into the gauges; mark Redis down when it fails."""
    while not stop.is_set():
        try:
            for stream, group in streams:
                lag, pending = await group_lag(client, stream, group)
                if lag is not None:
                    LAG.labels(stream, group).set(lag)
                if pending is not None:
                    PENDING.labels(stream, group).set(pending)
            await client.ping()
            health.redis_ok = True
        except Exception as e:
            if health.redis_ok:
                log.warning("redis check failed: %s", e)
            health.redis_ok = False
        try:
            await asyncio.wait_for(stop.wait(), every_s)
        except TimeoutError:
            pass
