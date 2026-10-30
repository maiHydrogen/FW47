"""Entry point: `python -m service {replayer,scorer,aggregator}`.

- replayer (A2-A3): replays one recorded race into the streams, then idles until stopped.
- scorer (A3-A4): consumes `fw47:telemetry` in the `scorers` group, scores every sample (`service.scorer`)
  and writes deviations to `fw47:deviations` before acknowledging. Records `t_scored - t_published` per
  sample; with FW47_LATENCY_OUT set, writes the latency summary there on shutdown.
- aggregator (A5): skeleton; connects to Redis and waits.
"""

import argparse
import array
import asyncio
import json
import logging
import signal
import time
from pathlib import Path

import numpy as np
from prometheus_client import Histogram

import redis.asyncio as aioredis

from service.config import Config
from service.schema import TelemetrySample, to_fields
from service.scorer import Scorer, load_baselines
from service.sources import ReplaySource
from service.streams import Consumer, PublishStats, publish

log = logging.getLogger("fw47")
STATS_EVERY_S = 10
LATENCY_BUCKETS_S = (0.0005, 0.001, 0.002, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0)
LATENCY = Histogram("fw47_scorer_latency_seconds", "t_scored - t_published per telemetry sample",
                    buckets=LATENCY_BUCKETS_S)


async def connect(url, attempts=30):
    """Redis client, retrying while the server starts up."""
    client = aioredis.Redis.from_url(url)
    for i in range(attempts):
        try:
            await client.ping()
            return client
        except aioredis.ConnectionError:
            if i == attempts - 1:
                raise
            await asyncio.sleep(1)


async def every(seconds, stop, report):
    while not stop.is_set():
        try:
            await asyncio.wait_for(stop.wait(), seconds)
        except TimeoutError:
            report()


async def replayer(cfg, client, stop):
    src = ReplaySource(cfg.data_dir, cfg.season, cfg.session_key, speed=cfg.speed)
    await client.hset(f"fw47:session:{cfg.session_key}", mapping=src.session_info())   # read by the scorer
    log.info("replaying %s session %s at %s", cfg.season, cfg.session_key, f"{cfg.speed}x" if cfg.speed else "full speed")
    stats, t0 = PublishStats(), time.monotonic()
    report = asyncio.create_task(every(STATS_EVERY_S, stop, lambda: log.info(
        "published %d telemetry, %d laps (%.0f msg/s)", stats.telemetry, stats.laps,
        stats.telemetry / (time.monotonic() - t0))))
    pub = asyncio.create_task(publish(src, client, cfg, stats=stats))
    await asyncio.wait([pub, asyncio.create_task(stop.wait())], return_when=asyncio.FIRST_COMPLETED)
    if pub.done():
        pub.result()
        log.info("replay finished: %d telemetry, %d laps in %.0f s", stats.telemetry, stats.laps, time.monotonic() - t0)
        await stop.wait()
    pub.cancel()
    report.cancel()


async def scorer(cfg, client, stop):
    curves, params = load_baselines(cfg.baseline_dir)
    sc = Scorer(curves, params)
    latencies = array.array("d")
    deviations = 0

    async def handle(batch):
        nonlocal deviations
        out = []
        for _, msg in batch:
            if not sc.knows(msg.session_key):
                info = await client.hgetall(f"fw47:session:{msg.session_key}")
                ck = int(info[b"circuit_key"]) if info else None
                sc.start_session(msg.session_key, ck)
                log.info("session %s: circuit %s, %s", msg.session_key, ck,
                         "baseline loaded" if ck in curves else "no baseline, impossible-state rules only")
            out += sc.process(msg)
            if isinstance(msg, TelemetrySample):
                lat = time.time() - msg.t_published
                LATENCY.observe(lat)
                latencies.append(lat)
        if out:   # written before the batch is acknowledged (at-least-once)
            pipe = client.pipeline(transaction=False)
            for d in out:
                pipe.xadd(cfg.deviation_stream, to_fields(d), maxlen=cfg.deviations_maxlen, approximate=True)
            await pipe.execute()
            deviations += len(out)
            for d in out:
                log.info("deviation %s car %s %s %s (%.0f, %s) lap %s", d.phase, d.driver_number, d.type,
                         f"{d.duration_s:.1f}s", d.severity, d.priority, d.lap)

    def report():
        if latencies:
            p = np.percentile(np.frombuffer(latencies, dtype=float)[-50_000:], [50, 95, 99]) * 1000
            log.info("%s, %d deviations; latency (last 50k) p50 %.1f ms p95 %.1f ms p99 %.1f ms",
                     c.stats, deviations, *p)

    c = Consumer(client, cfg.telemetry_stream, cfg.scorer_group, cfg.consumer, handle, claim_idle_ms=cfg.claim_idle_ms)
    log.info("consuming %s as %s/%s; baseline %s for %d circuits, k=%s d=%ss", cfg.telemetry_stream,
             cfg.scorer_group, cfg.consumer, params.version, len(curves), params.k, params.d_s)
    rep = asyncio.create_task(every(STATS_EVERY_S, stop, report))
    await c.run(stop)
    rep.cancel()
    report()
    if cfg.latency_out and latencies:
        write_latency(Path(cfg.latency_out), np.frombuffer(latencies, dtype=float), c.stats, deviations, params)


def write_latency(path, lat, stats, deviations, params):
    """Latency summary of one scorer run: percentiles and a histogram (the A4 evidence)."""
    counts, _ = np.histogram(lat, bins=(0.0,) + LATENCY_BUCKETS_S + (np.inf,))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({
        "samples": int(len(lat)), "deviations": deviations, "consumer": str(stats), "baseline": params.version,
        "latency_ms": {k: round(float(v) * 1000, 3) for k, v in
                       zip(["p50", "p95", "p99", "p99_9", "max"], np.percentile(lat, [50, 95, 99, 99.9, 100]))},
        "share_under_500ms": float((lat < 0.5).mean()),
        "histogram": [{"le_ms": (b * 1000 if np.isfinite(b) else None), "count": int(n)}
                      for b, n in zip(LATENCY_BUCKETS_S + (np.inf,), counts)],
    }, indent=1))
    log.info("latency summary written to %s", path)


async def aggregator(cfg, client, stop):
    log.info("skeleton only, the loop is built in A5")
    await stop.wait()


ROLES = {"replayer": replayer, "scorer": scorer, "aggregator": aggregator}


async def main_async(role):
    cfg = Config()
    client = await connect(cfg.redis_url)
    log.info("connected to %s (redis %s)", cfg.redis_url, (await client.info("server"))["redis_version"])
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, stop.set)
    try:
        await ROLES[role](cfg, client, stop)
    finally:
        await client.aclose()
    log.info("stopped")


def main():
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("role", choices=ROLES)
    args = p.parse_args()
    logging.basicConfig(level=logging.INFO, format=f"%(asctime)s {args.role} %(levelname)s %(message)s")
    asyncio.run(main_async(args.role))


if __name__ == "__main__":
    main()
