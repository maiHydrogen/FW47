"""Messages on the pipeline's streams (plan step A2).

Every message carries `schema_version`, so a consumer can refuse (or adapt to) a version it doesn't know.
Times are UTC seconds since the epoch, as floats:

- `t_source`: when the car produced the sample (or finished the lap), from the source data.
- `t_published`: when the source handed the message on. In a replay this is the wall clock (or, in
  deterministic mode, `t_source`), so `t_scored - t_published` is the pipeline's own latency.

Messages travel through Redis Streams as flat string fields (`to_fields` / `from_fields`).
"""

import json
from dataclasses import asdict, dataclass, fields, replace

SCHEMA_VERSION = 1


@dataclass(frozen=True, slots=True)
class TelemetrySample:
    """One car's channels at one instant. Real samples arrive at ~4 Hz; `interpolated` marks the ones
    added to reach 50 Hz."""
    KIND = "telemetry"

    schema_version: int
    session_key: int
    driver_number: int
    t_source: float
    t_published: float | None
    lap: int | None
    lap_distance_m: float | None
    speed: float          # km/h
    rpm: float
    gear: int | None      # 0 = neutral
    throttle: float       # %
    brake: int            # OpenF1 code: 0 or 100 (104 with throttle 100-104 = car switched off)
    drs: int              # OpenF1 code: 10, 12, 14 = open
    interpolated: bool


@dataclass(frozen=True, slots=True)
class LapCompleted:
    """A car crossed the line. Only the pit-timing model (B8) uses these."""
    KIND = "lap_completed"

    schema_version: int
    session_key: int
    driver_number: int
    t_source: float       # end of the lap
    t_published: float | None
    lap: int
    lap_time_s: float | None
    compound: str | None
    tyre_life: int | None  # laps on this set, counting this one
    position: int | None


Message = TelemetrySample | LapCompleted
_TYPES = {cls.KIND: cls for cls in (TelemetrySample, LapCompleted)}


def published(msg, t):
    """The same message, stamped with its publish time."""
    return replace(msg, t_published=t)


def to_fields(msg):
    """Flat string fields for XADD. None becomes ""; floats keep full precision (repr; float() so numpy
    floats don't print as "np.float64(...)")."""
    out = {"kind": msg.KIND}
    for k, v in asdict(msg).items():
        out[k] = "" if v is None else ("1" if v is True else "0" if v is False else repr(float(v)) if isinstance(v, float) else str(v))
    return out


def from_fields(raw):
    """Inverse of `to_fields`. Accepts the bytes keys and values redis-py returns."""
    d = {(k.decode() if isinstance(k, bytes) else k): (v.decode() if isinstance(v, bytes) else v) for k, v in raw.items()}
    cls = _TYPES[d.pop("kind")]
    if int(d["schema_version"]) != SCHEMA_VERSION:
        raise ValueError(f"unknown schema_version {d['schema_version']}")
    kw = {}
    for f in fields(cls):
        v, t = d[f.name], _base(f.type)
        kw[f.name] = None if v == "" else (v == "1") if t is bool else t(v)
    return cls(**kw)


def _base(t):
    """`int | None` -> int."""
    return next(a for a in getattr(t, "__args__", (t,)) if a is not type(None))


def canonical(msg):
    """A stable text form of a message, for hashing (the determinism test)."""
    return json.dumps(to_fields(msg), sort_keys=True)
