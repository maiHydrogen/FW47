"""Entry point: `python -m service {replayer,scorer,aggregator}`.

- replayer (A2-A3): replays one recorded race into the streams, then idles until stopped.
- scorer (A3-A4): consumes `fw47:telemetry` in the `scorers` group, scores every sample (`service.scorer`)
  and writes deviations to `fw47:deviations` before acknowledging. Records `t_scored - t_published` per
  sample, and the part of it before Redis received the sample (from the entry ID, which is the server's
  clock in ms), so a slow sample can be pinned on the publisher or the consumer side. With FW47_LATENCY_OUT
  set, writes the latency summary there on shutdown.
- aggregator (A5): consumes `fw47:deviations` in the `aggregators` group, groups deviations into incidents
  (`service.incidents`) and writes incident events to `fw47:outbox`, together with the incident state, before
  acknowledging. With FW47_WEBHOOK_URL set it also delivers the outbox to the Forge webtrigger
  (`service.delivery`); failed events go to `fw47:dlq`.

Incident state in Redis: `fw47:incidents:open` (hash, ID -> JSON; reloaded on start-up),
`fw47:incidents:ranked:<session>` (sorted set of open incident IDs by severity) and `fw47:incident:<id>`
(JSON, kept for 7 days after closing).
"""

import argparse
import array
import asyncio
import json
import logging
import signal
import time
from pathlib import Path

import httpx
import numpy as np
from prometheus_client import Histogram

import redis.asyncio as aioredis

from service.config import Config
from service.delivery import DeliveryStats, Sender, delivery_handler
from service.incidents import Aggregator, Incident
from service.schema import Deviation, TelemetrySample, to_fields
from service.scorer import Scorer, load_baselines
from service.sources import ReplaySource
from service.streams import Consumer, PublishStats, publish

log = logging.getLogger("fw47")
STATS_EVERY_S = 10
SLOW_S = 0.25          # samples slower than this are kept individually, to find when and where stalls happened
WATERMARK_S = 1.0
OPEN_INCIDENTS = "fw47:incidents:open"
CLOSED_TTL_S = 7 * 24 * 3600
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
    sc = Scorer(curves, params, watermark_s=WATERMARK_S)
    latencies, publish_part = array.array("d"), array.array("d")
    slow = []   # (t_scored, latency, publish part) of samples over SLOW_S
    deviations = 0

    async def handle(batch):
        nonlocal deviations
        out = []
        for eid, msg in batch:
            if not sc.knows(msg.session_key):
                info = await client.hgetall(f"fw47:session:{msg.session_key}")
                ck = int(info[b"circuit_key"]) if info else None
                sc.start_session(msg.session_key, ck)
                log.info("session %s: circuit %s, %s", msg.session_key, ck,
                         "baseline loaded" if ck in curves else "no baseline, impossible-state rules only")
            out += sc.process(msg)
            if isinstance(msg, TelemetrySample):
                now = time.time()
                lat, pub = now - msg.t_published, int(eid.split(b"-")[0]) / 1000 - msg.t_published
                LATENCY.observe(lat)
                latencies.append(lat)
                publish_part.append(pub)
                if lat > SLOW_S:
                    slow.append((now, lat, pub))
        if out:   # written before the batch is acknowledged (at-least-once)
            pipe = client.pipeline(transaction=False)
            for d in out:
                pipe.xadd(cfg.deviation_stream, to_fields(d), maxlen=cfg.deviations_maxlen, approximate=True)
            await pipe.execute()
            out = [d for d in out if isinstance(d, Deviation)]
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
        write_latency(Path(cfg.latency_out), np.frombuffer(latencies, dtype=float),
                      np.frombuffer(publish_part, dtype=float), slow, c.stats, deviations, params)


def stall_episodes(slow, gap_s=5.0):
    """Group slow samples into episodes (no slow sample for `gap_s` between them)."""
    out = []
    for t, lat, pub in slow:
        if out and t - out[-1]["last"] <= gap_s:
            e = out[-1]
            e["last"], e["samples"] = t, e["samples"] + 1
            if lat > e["max_ms"] / 1000:
                e["max_ms"], e["publish_part_ms"] = round(lat * 1000, 1), round(pub * 1000, 1)
        else:
            out.append({"first": t, "last": t, "samples": 1, "max_ms": round(lat * 1000, 1),
                        "publish_part_ms": round(pub * 1000, 1)})
    for e in out:
        e["first"] = time.strftime("%H:%M:%S", time.gmtime(e["first"]))
        e["last"] = time.strftime("%H:%M:%S", time.gmtime(e["last"]))
    return out


def write_latency(path, lat, pub, slow, stats, deviations, params):
    """Latency summary of one scorer run: percentiles and a histogram (the A4 evidence).

    publish_part: of each latency, the time before Redis received the sample (replayer and network);
    the rest is reading and scoring. stalls: episodes of samples slower than SLOW_S, with UTC times.
    """
    pct = lambda x: {k: round(float(v) * 1000, 3) for k, v in
                     zip(["p50", "p95", "p99", "p99_9", "max"], np.percentile(x, [50, 95, 99, 99.9, 100]))}
    counts, _ = np.histogram(lat, bins=(0.0,) + LATENCY_BUCKETS_S + (np.inf,))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({
        "samples": int(len(lat)), "deviations": deviations, "consumer": str(stats), "baseline": params.version,
        "latency_ms": pct(lat), "publish_part_ms": pct(pub), "consume_part_ms": pct(lat - pub),
        "share_under_500ms": float((lat < 0.5).mean()),
        "stalls": stall_episodes(slow),
        "histogram": [{"le_ms": (b * 1000 if np.isfinite(b) else None), "count": int(n)}
                      for b, n in zip(LATENCY_BUCKETS_S + (np.inf,), counts)],
    }, indent=1))
    log.info("latency summary written to %s", path)


async def aggregator(cfg, client, stop):
    agg = Aggregator(cfg.incident_cooldown_s, cfg.incident_types)
    agg.restore(Incident.from_json(v) for v in (await client.hgetall(OPEN_INCIDENTS)).values())
    counts = {"opened": 0, "escalated": 0, "closed": 0, "session_closed": 0}

    async def handle(batch):
        out = [e for _, m in batch for e in agg.process(m)]
        dirty = agg.take_dirty()
        if not (out or dirty):
            return
        pipe = client.pipeline(transaction=True)    # state and events together, before the ack
        for inc in dirty:
            ranked = f"fw47:incidents:ranked:{inc.session_key}"
            if inc.status == "open":
                pipe.hset(OPEN_INCIDENTS, inc.id, inc.to_json())
                pipe.zadd(ranked, {inc.id: inc.severity})
                pipe.set(f"fw47:incident:{inc.id}", inc.to_json())
            else:
                pipe.hdel(OPEN_INCIDENTS, inc.id)
                pipe.zrem(ranked, inc.id)
                pipe.set(f"fw47:incident:{inc.id}", inc.to_json(), ex=CLOSED_TTL_S)
        for e in out:
            pipe.xadd(cfg.outbox_stream, to_fields(e), maxlen=cfg.outbox_maxlen, approximate=True)
        await pipe.execute()
        for e in out:
            counts[e.event] += 1
            log.info("incident %s %s", e.event, e.event_id)

    c = Consumer(client, cfg.deviation_stream, cfg.aggregator_group, cfg.consumer, handle,
                 claim_idle_ms=cfg.claim_idle_ms)
    log.info("consuming %s as %s/%s; %d open incidents restored; types %s, cooldown %s s", cfg.deviation_stream,
             cfg.aggregator_group, cfg.consumer, len(agg.open), ",".join(cfg.incident_types), cfg.incident_cooldown_s)
    tasks, http, dstats, d = [asyncio.create_task(c.run(stop))], None, DeliveryStats(), None
    if cfg.webhook_url:
        http = httpx.AsyncClient(timeout=10)
        sender = Sender(http, cfg.webhook_url, cfg.webhook_secret, max_attempts=cfg.delivery_max_attempts)
        d = Consumer(client, cfg.outbox_stream, cfg.delivery_group, cfg.consumer,
                     delivery_handler(sender, client, cfg.dlq_stream, dstats), count=10, claim_idle_ms=cfg.claim_idle_ms)
        tasks.append(asyncio.create_task(d.run(stop)))
        log.info("delivering %s to the webtrigger", cfg.outbox_stream)
    else:
        log.warning("FW47_WEBHOOK_URL not set: incident events stay in %s", cfg.outbox_stream)

    def report():
        log.info("%s; %d open, %d deviations ignored (type), events %s%s", c.stats, len(agg.open), agg.ignored,
                 counts, f"; {dstats}" if d else "")

    rep = asyncio.create_task(every(STATS_EVERY_S, stop, report))
    try:
        await asyncio.gather(*tasks)
    finally:
        rep.cancel()
        report()
        if http:
            await http.aclose()


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
