"""Incidents (plan step A5), with no Redis in it: scorer output in, incident events out.

An incident is one problem on one car: the deviations of one (session, car, type), grouped. It produces:

- `opened` on the first deviation of its key while none is open;
- `escalated` when its priority rises (priority only ever rises while it's open);
- `closed` once none of its runs is open and nothing has happened for `cooldown_s`. A run that starts again
  within the cooldown belongs to the same incident;
- `session_closed` when the session ends, after `closed` for each incident still open.

Time is source time and comes from the stream itself (deviations, and the scorer's `Watermark` every second),
so a replay at 5x groups exactly like one at 1x, and the same deviations always give the same incidents.

The incident ID is a hash of (session, car, type, opened_at), opened_at being the start of its first run;
event IDs are built from it. Replaying the same deviations, or receiving one twice (the streams are
at-least-once), gives the same IDs, which is what makes delivery idempotent downstream.

Only `types` become incidents. Until B6 decides how pit stops are handled, slowdowns are counted and ignored
(see A4 in the plan).
"""

import hashlib
import json
import math
from dataclasses import asdict, dataclass, field

from fw47_core.baseline import PRIORITY_BANDS
from service.schema import SCHEMA_VERSION, Deviation, IncidentEvent, SessionEnded, Watermark

DEFAULT_TYPES = ("engine-stall", "gearbox-failure", "drs-failure")
COOLDOWN_S = 60.0
RANK = {p: i for i, (_, p) in enumerate(reversed(PRIORITY_BANDS))}   # Low 0 ... Critical 3


def incident_id(session_key, driver_number, type_, opened_at):
    return hashlib.sha256(f"{session_key}:{driver_number}:{type_}:{opened_at:.3f}".encode()).hexdigest()[:16]


@dataclass
class Incident:
    id: str
    session_key: int
    driver_number: int
    type: str
    opened_at: float          # start of its first run
    alert_at: float           # its first deviation (time-to-signal is measured to here)
    last_activity: float      # its latest deviation
    severity: float           # highest so far
    priority: str
    lap: int | None           # where the worst deviation was
    lap_distance_m: float | None
    observed: float | None
    expected: float | None
    z: float | None
    runs: list = field(default_factory=list)   # t_start of the runs still open
    deviations: int = 0
    escalations: int = 0
    status: str = "open"
    closed_at: float | None = None

    def to_json(self):
        return json.dumps(asdict(self))

    @classmethod
    def from_json(cls, text):
        return cls(**json.loads(text))


class Aggregator:
    """Open incidents for every session it sees. Feed it the deviation stream in order with `process`.

    The caller persists what changed (`take_dirty`) and can `restore` open incidents after a restart.
    """

    def __init__(self, cooldown_s=COOLDOWN_S, types=DEFAULT_TYPES):
        self.cooldown_s, self.types = cooldown_s, frozenset(types)
        self.open = {}       # (session, car, type) -> Incident
        self.clocks = {}     # session -> latest source time seen
        self.ignored = 0     # deviations of types that don't become incidents
        self._dirty = {}

    def restore(self, incidents):
        for inc in incidents:
            if inc.status == "open":
                self.open[inc.session_key, inc.driver_number, inc.type] = inc

    def take_dirty(self):
        """Incidents changed since the last call."""
        out, self._dirty = list(self._dirty.values()), {}
        return out

    def ranked(self, session_key):
        """The session's open incidents, worst first."""
        return sorted((i for i in self.open.values() if i.session_key == session_key),
                      key=lambda i: (-i.severity, i.alert_at))

    def process(self, msg):
        """Update state with one message; returns the IncidentEvents it produced (often none)."""
        if isinstance(msg, Watermark):
            return self._advance(msg.session_key, msg.t_source)
        if isinstance(msg, SessionEnded):
            return self._end(msg)
        if not isinstance(msg, Deviation):
            return []
        out = self._advance(msg.session_key, msg.t_source)
        if msg.type not in self.types:
            self.ignored += 1
            return out
        return out + self._deviation(msg)

    def _advance(self, session_key, t):
        """Move the session's clock to `t` and close incidents that have been quiet for the cooldown."""
        now = self.clocks[session_key] = max(t, self.clocks.get(session_key, -math.inf))
        quiet = [k for k, i in self.open.items()
                 if k[0] == session_key and not i.runs and now - i.last_activity >= self.cooldown_s]
        return [self._close(k, now) for k in sorted(quiet, key=lambda k: self.open[k].alert_at)]

    def _deviation(self, d):
        key = (d.session_key, d.driver_number, d.type)
        inc = self.open.get(key)
        if inc is None:
            if d.phase == "close":   # its incident is already closed (a redelivered entry): nothing new
                return []
            inc = self.open[key] = Incident(
                incident_id(*key, d.t_start), *key, d.t_start, d.t_source, d.t_source, d.severity, d.priority,
                d.lap, d.lap_distance_m, d.observed, d.expected, d.z, [d.t_start], 1)
            self._dirty[inc.id] = inc
            return [self._event("opened", inc, d.t_source)]
        inc.last_activity = max(inc.last_activity, d.t_source)
        inc.deviations += 1
        if d.phase == "close":
            if d.t_start in inc.runs:
                inc.runs.remove(d.t_start)
        elif d.t_start not in inc.runs:
            inc.runs.append(d.t_start)
        if d.severity > inc.severity:
            inc.severity, inc.lap, inc.lap_distance_m = d.severity, d.lap, d.lap_distance_m
            inc.observed, inc.expected, inc.z = d.observed, d.expected, d.z
        self._dirty[inc.id] = inc
        if RANK[d.priority] > RANK[inc.priority]:
            inc.priority = d.priority
            inc.escalations += 1
            return [self._event("escalated", inc, d.t_source)]
        return []

    def _close(self, key, t):
        inc = self.open.pop(key)
        inc.status, inc.closed_at, inc.runs = "closed", t, []
        self._dirty[inc.id] = inc
        return self._event("closed", inc, t)

    def _end(self, msg):
        now = max(msg.t_source, self.clocks.pop(msg.session_key, -math.inf))
        keys = sorted((k for k in self.open if k[0] == msg.session_key), key=lambda k: self.open[k].alert_at)
        out = [self._close(k, now) for k in keys]
        body = {"schema_version": SCHEMA_VERSION, "event": "session_closed", "event_id": f"session:{msg.session_key}:closed",
                "session_key": msg.session_key, "t_source": now}
        return out + [IncidentEvent(SCHEMA_VERSION, body["event_id"], "session_closed", msg.session_key, now,
                                    json.dumps(body))]

    def _event(self, kind, inc, t):
        event_id = f"{inc.id}:{kind}" + (f":{inc.escalations}" if kind == "escalated" else "")
        body = {"schema_version": SCHEMA_VERSION, "event": kind, "event_id": event_id, "incident_id": inc.id,
                "t_source": t, **{k: v for k, v in asdict(inc).items() if k not in ("id", "runs", "status")}}
        return IncidentEvent(SCHEMA_VERSION, event_id, kind, inc.session_key, t, json.dumps(body))
