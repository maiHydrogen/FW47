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


@dataclass(frozen=True, slots=True)
class RaceControl:
    """A race-control message (flags, safety car, ...). The scorer needs them as context: everyone slows
    under a safety car, and a lapped car lifts after a blue flag."""
    KIND = "race_control"

    schema_version: int
    session_key: int
    t_source: float
    t_published: float | None
    category: str | None
    flag: str | None
    scope: str | None
    sector: int | None
    driver_number: int | None   # set for car-specific messages, e.g. blue flags
    message: str


@dataclass(frozen=True, slots=True)
class Deviation:
    """A condition that has held long enough to report (scorer output, `fw47:deviations`).

    One run of a condition gives an `open` event when it first qualifies, an `update` whenever its priority
    rises, and a `close` event when it ends.
    """
    KIND = "deviation"

    schema_version: int
    session_key: int
    driver_number: int
    type: str             # "slowdown" or an impossible-state rule, e.g. "engine-stall"
    phase: str            # open / update / close
    lap: int | None
    lap_distance_m: float | None
    t_start: float        # first sample of the run
    t_source: float       # the sample that produced this event (for close: the last sample of the run)
    duration_s: float
    severity: float       # 0-100 (fw47_core.baseline.severity)
    priority: str
    observed: float | None   # slowdown: speed at its lowest z; rules: speed
    expected: float | None   # slowdown: expected speed there
    z: float | None          # slowdown: lowest z of the run
    t_published: float | None   # of the sample that produced this event
    t_scored: float


@dataclass(frozen=True, slots=True)
class SessionEnded:
    """The source has nothing more for this session. The scorer closes its open runs and passes it on, and
    the aggregator closes the session's incidents."""
    KIND = "session_ended"

    schema_version: int
    session_key: int
    t_source: float       # the last message of the session
    t_published: float | None


@dataclass(frozen=True, slots=True)
class Watermark:
    """Scorer to aggregator: every sample of the session up to `t_source` has been scored. Lets the aggregator
    see time pass (and close quiet incidents) between deviations, in source time."""
    KIND = "watermark"

    schema_version: int
    session_key: int
    t_source: float
    t_published: float | None


@dataclass(frozen=True, slots=True)
class IncidentEvent:
    """An event for the Forge webtrigger (aggregator output, `fw47:outbox`). `body` is the JSON payload sent
    as-is; the other fields are for routing and logs."""
    KIND = "incident_event"

    schema_version: int
    event_id: str         # idempotency key: the same incident change always gets the same ID
    event: str            # opened / escalated / closed / session_closed
    session_key: int
    t_source: float
    body: str


Message = TelemetrySample | LapCompleted | RaceControl | SessionEnded
_TYPES = {cls.KIND: cls for cls in (TelemetrySample, LapCompleted, RaceControl, Deviation, SessionEnded, Watermark,
                                    IncidentEvent)}


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
