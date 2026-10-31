"""Where telemetry comes from (plan step A2).

The pipeline only sees a `Source`: something to `async for` over, yielding `TelemetrySample`, `LapCompleted`
and `RaceControl` messages in time order, then one `SessionEnded`. `ReplaySource` plays back a recorded race; a live source (A10)
would implement the same interface.

`ReplaySource` reads the B2 clean sample table, which is B1's car_data with lap numbers and distance into
the lap added. Nothing is filtered on quality: a live feed wouldn't be cleaned either, so the scorer sees
the same quirks it would see live.
"""

import asyncio
import heapq
import math
import time
from pathlib import Path
from typing import AsyncIterator, Protocol

import numpy as np
import pandas as pd

from service.schema import SCHEMA_VERSION, LapCompleted, Message, RaceControl, SessionEnded, TelemetrySample, published

TARGET_HZ = 50
MAX_GAP_S = 1.0        # don't invent samples across a longer outage (B2's sample gap flag uses 1 s too)
RACE_MARGIN_S = 60     # replay from 60 s before lap 1 starts to 60 s after the last lap ends
SAMPLE_COLS = ["date", "driver_number", "lap_number", "lap_distance_m", "speed", "rpm", "n_gear", "throttle",
               "brake", "drs"]


class Source(Protocol):
    def __aiter__(self) -> AsyncIterator[Message]: ...


def upsample(session_key, driver_number, t, speed, rpm, throttle, gear, brake, drs, lap, dist,
             hz=TARGET_HZ, max_gap_s=MAX_GAP_S):
    """One car's samples, with interpolated ones added so no two are more than 1/hz apart.

    Inputs are equal-length lists sorted by `t` (seconds); `gear` and `lap` may hold None, `dist` NaN.
    Real samples pass through with their values unchanged. Between two real samples less than
    `max_gap_s` apart, evenly spaced samples are added with `interpolated=True`:
    - speed, rpm, throttle: linear between the two real samples;
    - lap distance: linear when both are on the same lap, else None (it resets at the line);
    - gear, brake, drs, lap: carried forward from the earlier sample.
    """
    step = 1 / hz
    n = len(t)

    def sample(i, ti, sp, r, th, d, interp):
        return TelemetrySample(SCHEMA_VERSION, session_key, driver_number, ti, None, lap[i],
                               None if d is None or math.isnan(d) else d, sp, r, gear[i], th, brake[i], drs[i],
                               interp)

    for i in range(n):
        yield sample(i, t[i], float(speed[i]), float(rpm[i]), float(throttle[i]), dist[i], False)
        if i + 1 == n:
            break
        gap = t[i + 1] - t[i]
        if gap > max_gap_s:
            continue
        m = math.ceil(round(gap / step, 9)) - 1   # points to add; round() stops 0.2/0.02 = 10.000000000000002
        same_lap = lap[i] is not None and lap[i] == lap[i + 1]
        for k in range(1, m + 1):
            f = k / (m + 1)
            yield sample(i, t[i] + f * gap,
                         speed[i] + f * (speed[i + 1] - speed[i]),
                         rpm[i] + f * (rpm[i + 1] - rpm[i]),
                         throttle[i] + f * (throttle[i + 1] - throttle[i]),
                         dist[i] + f * (dist[i + 1] - dist[i]) if same_lap else None,
                         True)


def _order(m):
    """Stream order: time, then telemetry before other messages, then car number, so ties never depend on chance."""
    return m.t_source, m.KIND != TelemetrySample.KIND, m.KIND, getattr(m, "driver_number", None) or 0


def _seconds(dates):
    return dates.to_numpy(dtype="datetime64[ns]").astype(np.int64) / 1e9


def _nullable(series):
    return [None if pd.isna(v) else int(v) for v in series]


class ReplaySource:
    """A recorded race as a message stream.

    speed: playback speed (1 = real time, 5 = five times faster); None plays as fast as possible.
    deterministic: no wall clock at all, `t_published = t_source`, for tests; the same session always gives
        the same messages.
    hz: rate to upsample each car to; None passes the real ~4 Hz samples only.
    race_only: replay the race itself, not the hour of cars driving to the grid before it.
    """

    def __init__(self, data_dir, season, session_key, speed=1.0, deterministic=False, hz=TARGET_HZ,
                 race_only=True):
        self.data_dir = Path(data_dir)
        self.season, self.session_key = season, session_key
        self.speed, self.deterministic, self.hz, self.race_only = speed, deterministic, hz, race_only

    def _read(self, *parts):
        return pd.read_parquet(self.data_dir.joinpath(*parts, f"season={self.season}", f"{self.session_key}.parquet"))

    def laps(self):
        """LapCompleted messages, from the B2 lap table, stints (compound, tyre age) and positions."""
        laps = self._read("clean", "laps").dropna(subset=["date_end"]).sort_values("lap_number")
        stints = self._read("parquet", "stints").sort_values("lap_start")
        laps = pd.merge_asof(laps, stints[["driver_number", "lap_start", "compound", "tyre_age_at_start"]],
                             left_on="lap_number", right_on="lap_start", by="driver_number").sort_values("date_end")
        pos = self._read("parquet", "position").sort_values("date")
        laps = pd.merge_asof(laps, pos[["date", "driver_number", "position"]], left_on="date_end",
                             right_on="date", by="driver_number")
        life = laps["tyre_age_at_start"] + laps["lap_number"] - laps["lap_start"] + 1
        out = [LapCompleted(SCHEMA_VERSION, self.session_key, int(r.driver_number), t, None, int(r.lap_number),
                             None if pd.isna(r.lap_duration) else float(r.lap_duration),
                             None if pd.isna(r.compound) else r.compound, lf, p)
                for r, t, lf, p in zip(laps.itertuples(), _seconds(laps["date_end"]).tolist(), _nullable(life),
                                       _nullable(laps["position"]))]
        return sorted(out, key=_order)

    def race_control(self):
        """RaceControl messages (none if the session has no race-control table)."""
        path = self.data_dir / "parquet" / "race_control" / f"season={self.season}" / f"{self.session_key}.parquet"
        if not path.exists():
            return []
        rc = pd.read_parquet(path).sort_values("date")
        text = lambda v: None if pd.isna(v) else str(v)
        out = [RaceControl(SCHEMA_VERSION, self.session_key, t, None, text(r.category), text(r.flag), text(r.scope),
                           sec, drv, text(r.message) or "")
               for r, t, sec, drv in zip(rc.itertuples(), _seconds(rc["date"]).tolist(), _nullable(rc["sector"]),
                                         _nullable(rc["driver_number"]))]
        return sorted(out, key=_order)

    def session_info(self):
        """Season and circuit of the session, which the scorer needs to pick its baseline."""
        ses = pd.read_parquet(self.data_dir / "parquet" / "sessions" / f"season={self.season}" / "sessions.parquet")
        r = ses.loc[ses["session_key"] == self.session_key].iloc[0]
        return {"season": self.season, "circuit_key": int(r["circuit_key"]),
                "circuit_short_name": str(r["circuit_short_name"])}

    def messages(self):
        """Every message in time order, then `SessionEnded`; unstamped (`t_published` None). Lazy: memory stays per car."""
        s = self._read("clean", "samples")[SAMPLE_COLS].sort_values(["driver_number", "date"])
        laps, rc = self.laps(), self.race_control()
        if self.race_only:
            lap_table = self._read("clean", "laps")
            start = lap_table["date_start"].min() - np.timedelta64(RACE_MARGIN_S, "s")
            end = lap_table["date_end"].max() + np.timedelta64(RACE_MARGIN_S, "s")
            s = s[s["date"].between(start, end)]
            t0, t1 = _seconds(pd.Series([start, end])).tolist()
            rc = [m for m in rc if t0 <= m.t_source <= t1]
        s = s.assign(t=_seconds(s["date"]))
        cars = []
        for drv, c in s.groupby("driver_number", sort=True):
            cols = dict(t=c["t"].tolist(), speed=c["speed"].tolist(), rpm=c["rpm"].tolist(),
                        throttle=c["throttle"].tolist(), gear=_nullable(c["n_gear"]), brake=c["brake"].tolist(),
                        drs=c["drs"].tolist(), lap=_nullable(c["lap_number"]), dist=c["lap_distance_m"].tolist())
            if self.hz is None:
                cars.append(upsample(self.session_key, int(drv), **cols, max_gap_s=0))
            else:
                cars.append(upsample(self.session_key, int(drv), **cols, hz=self.hz))
        return self._ended(heapq.merge(*cars, laps, rc, key=_order))

    def _ended(self, msgs):
        t = None
        for m in msgs:
            t = m.t_source
            yield m
        if t is not None:
            yield SessionEnded(SCHEMA_VERSION, self.session_key, t, None)

    async def __aiter__(self):
        t0 = w0 = None
        for msg in self.messages():
            if self.deterministic:
                yield published(msg, msg.t_source)
                continue
            if self.speed:
                if t0 is None:
                    t0, w0 = msg.t_source, time.monotonic()
                delay = w0 + (msg.t_source - t0) / self.speed - time.monotonic()
                if delay > 0:
                    await asyncio.sleep(delay)
            yield published(msg, time.time())
