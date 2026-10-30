"""Redis Streams plumbing (plan step A3): publish a source, consume with a group.

Publishing: telemetry and race-control messages go to `fw47:telemetry`, lap events to `fw47:laps`. Telemetry is trimmed by age, not
count: each XADD drops entries older than `retention_s` of wall clock (MINID on the auto-generated IDs, which
are server milliseconds). A fixed MAXLEN would keep 60 s at 1x but only 12 s at 5x. Trimming is approximate
(`~`), so Redis drops whole internal nodes and keeps a little more than `retention_s`.

If the scorer is down for longer than that, the oldest samples are gone by design: time-to-signal over
completeness. Entries trimmed while still pending are acknowledged and counted as `dropped`.

Consuming: `Consumer` reads with XREADGROUP and XACKs a batch only after its handler returns, i.e. after the
handler has written its output (at-least-once: a crash between the write and the ack replays the batch).
On start-up it first finishes its own unacknowledged entries, then takes over entries other consumers have
held for `claim_idle_ms` (XAUTOCLAIM), and only then reads new ones.
"""

import asyncio
import logging
import time
from dataclasses import dataclass

import redis

from service.schema import LapCompleted, RaceControl, from_fields, to_fields

log = logging.getLogger("fw47.streams")
BATCH = 200          # messages per pipeline round trip
FLUSH_S = 0.005      # ...or this much publish time, whichever comes first


@dataclass
class PublishStats:
    telemetry: int = 0
    laps: int = 0
    race_control: int = 0
    flushes: int = 0


async def publish(source, client, cfg, batch=BATCH, flush_s=FLUSH_S, stats=None):
    """XADD every message of `source`, batched into pipelines. Returns PublishStats.

    A batch is sent when it holds `batch` messages or its first message was published `flush_s` ago, so
    batching adds at most ~5 ms of latency, and that delay is inside `t_scored - t_published`.
    """
    stats = stats or PublishStats()
    buf = []

    async def flush():
        pipe = client.pipeline(transaction=False)
        minid = int(time.time() * 1000 - cfg.retention_s * 1000)
        for m in buf:
            if isinstance(m, LapCompleted):
                pipe.xadd(cfg.laps_stream, to_fields(m), maxlen=cfg.laps_maxlen, approximate=True)
                stats.laps += 1
            else:   # race control shares the telemetry stream, so the scorer sees it in order with the samples
                pipe.xadd(cfg.telemetry_stream, to_fields(m), minid=minid, approximate=True)
                if isinstance(m, RaceControl):
                    stats.race_control += 1
                else:
                    stats.telemetry += 1
        await pipe.execute()
        stats.flushes += 1
        buf.clear()

    async for msg in source:
        buf.append(msg)
        if len(buf) >= batch or (msg.t_published or 0) - (buf[0].t_published or 0) >= flush_s:
            await flush()
    if buf:
        await flush()
    return stats


@dataclass
class ConsumerStats:
    processed: int = 0
    reclaimed: int = 0     # taken over from another consumer at start-up
    dropped: int = 0       # trimmed from the stream before they were processed
    rejected: int = 0      # couldn't be decoded (e.g. an unknown schema_version)


class Consumer:
    """One member of a consumer group.

    handler: `async def handler(batch)`, where batch is a list of (entry_id, message). It must write its
        output before returning; the batch is acknowledged right after. If it raises, nothing is
        acknowledged and the error propagates (the container restarts and recovers the batch).
    """

    def __init__(self, client, stream, group, name, handler, count=500, block_ms=1000, claim_idle_ms=10_000):
        self.client, self.stream, self.group, self.name = client, stream, group, name
        self.handler, self.count, self.block_ms, self.claim_idle_ms = handler, count, block_ms, claim_idle_ms
        self.stats = ConsumerStats()

    async def ensure_group(self):
        """Create the group (and the stream) if needed, starting from the oldest retained entry."""
        try:
            await self.client.xgroup_create(self.stream, self.group, id="0", mkstream=True)
        except redis.ResponseError as e:
            if "BUSYGROUP" not in str(e):
                raise

    async def _handle(self, entries):
        batch, ack = [], []
        for eid, raw in entries:
            ack.append(eid)
            if not raw:                  # pending entry whose data was trimmed away
                self.stats.dropped += 1
                continue
            try:
                batch.append((eid, from_fields(raw)))
            except (ValueError, KeyError) as e:
                self.stats.rejected += 1
                log.error("rejected %s: %s", eid, e)
        if batch:
            await self.handler(batch)
        if ack:
            await self.client.xack(self.stream, self.group, *ack)
        self.stats.processed += len(batch)

    async def recover(self):
        """Finish this consumer's own pending entries, then claim idle ones from other consumers."""
        start = "0"
        while True:                      # own pending: XREADGROUP from 0 returns the history, not new entries
            resp = await self.client.xreadgroup(self.group, self.name, {self.stream: start}, count=self.count)
            entries = resp[0][1] if resp else []
            if not entries:
                break
            await self._handle(entries)
            start = entries[-1][0]
        start = "0-0"
        while True:
            nxt, entries, deleted = await self.client.xautoclaim(self.stream, self.group, self.name,
                                                                 self.claim_idle_ms, start_id=start, count=self.count)
            self.stats.reclaimed += len(entries)
            if deleted:                  # claimed IDs that no longer exist: drop them from the pending list
                self.stats.dropped += len(deleted)
                await self.client.xack(self.stream, self.group, *deleted)
            if entries:
                await self._handle(entries)
            nxt = nxt.decode() if isinstance(nxt, bytes) else nxt
            if nxt == "0-0":
                break
            start = nxt

    async def run(self, stop=None):
        """Recover, then read new entries until `stop` (an asyncio.Event) is set."""
        stop = stop or asyncio.Event()
        await self.ensure_group()
        await self.recover()
        while not stop.is_set():
            resp = await self.client.xreadgroup(self.group, self.name, {self.stream: ">"},
                                                count=self.count, block=self.block_ms)
            if resp:
                await self._handle(resp[0][1])
        return self.stats
