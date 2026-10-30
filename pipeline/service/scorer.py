"""The scorer's logic (plan step A4), with no Redis in it: messages in, deviations out.

Two kinds of condition, both from `fw47_core`:

- **slowdown** (B4): robust z of speed against the track's v1 baseline at this lap distance; a run of
  z < -k lasting d seconds. The same rule as `fw47_core.baseline.detect`.
- **impossible states** (B3): `engine-stall`, `gearbox-failure` and `drs-failure` from
  `fw47_core.rules.TELEMETRY_RULES`, unchanged. Each must hold for `IMPOSSIBLE_HOLD_S` (drs-failure: 0.5 s,
  B3's 3-sample persistence at ~4 Hz written as a duration).

Every sample is scored, but only real samples (`interpolated=False`) start, extend or end a run: interpolated
samples carry no new information, and this keeps the result identical at 4 Hz and 50 Hz. A run ends at the
first real sample where its condition fails, or at a data gap longer than `sample_gap_s`.

Slowdowns, not impossible states, are suppressed from race-control context: during a safety car, VSC
(+15 s) or red flag, within `blue_flag_window_s` after a blue flag to that car, and on lap 1 (standing
start). Suppression delays an alert rather than cancelling it: a run that is still going once the context
clears is reported then.

Not handled yet: pit stops. The stream doesn't say when a car is in the pit lane, so a pit stop can raise a
slowdown; B6 decides how to handle it (and between v1 and v2) at M2.
"""

import json
import math
import time
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pandas as pd

from fw47_core.baseline import PRIORITY_BANDS, severity
from fw47_core.rules import TELEMETRY_RULES
from service.schema import SCHEMA_VERSION, Deviation, LapCompleted, RaceControl, TelemetrySample

IMPOSSIBLE_HOLD_S = {"engine-stall": 0.0, "gearbox-failure": 0.0, "drs-failure": 0.5}
RULES = [r for r in TELEMETRY_RULES if r.incident_type in IMPOSSIBLE_HOLD_S]
VSC_EXTRA_S = 15.0     # as in fw47_core.clean.neutralised_periods: cars need ~15 s to get back up to speed
_RANK = {p: i for i, (_, p) in enumerate(reversed(PRIORITY_BANDS))}   # Low 0 ... Critical 3
DEFAULT_BASELINE_DIR = Path(__file__).resolve().parents[1] / "baselines"


@dataclass(frozen=True)
class Params:
    k: float
    d_s: float
    sample_gap_s: float
    blue_flag_window_s: float
    version: str


def load_baselines(directory=DEFAULT_BASELINE_DIR, name="speed_v1"):
    """Per-circuit (centre_m, expected_kmh, scale_kmh) arrays and the detector settings, from B4's export."""
    directory = Path(directory)
    meta = json.loads((directory / f"{name}.json").read_text())
    d = meta["detector"]
    params = Params(d["k"], d["d_s"], d["sample_gap_s"], d["blue_flag_window_s"], meta["version"])
    table = pd.read_csv(directory / f"{name}.csv").sort_values(["circuit_key", "centre_m"])
    curves = {int(ck): (g["centre_m"].to_numpy(float), g["expected_kmh"].to_numpy(float), g["scale_kmh"].to_numpy(float))
              for ck, g in table.groupby("circuit_key")}
    return curves, params


@dataclass
class Run:
    start: float
    last: float
    z_min: float = math.inf
    observed: float | None = None
    expected: float | None = None
    fired: bool = False
    rank: int = -1                # priority rank last reported
    lap: int | None = None
    dist: float | None = None


@dataclass
class Car:
    last_real: float | None = None
    runs: dict = field(default_factory=dict)   # condition -> Run
    last_blue: float = -math.inf


@dataclass
class Session:
    curve: tuple | None           # None: no baseline for this circuit, so no slowdown detection
    cars: dict = field(default_factory=dict)
    sc: bool = False
    vsc: bool = False
    vsc_until: float = -math.inf  # VSC ending + 15 s
    red: bool = False


class Scorer:
    """Per-car state for every session it sees. Feed it messages in stream order with `process`.

    curves: {circuit_key: (centre_m, expected_kmh, scale_kmh)}; params: detector settings.
    suppress: apply the race-control and lap-1 suppression (off only to compare with the batch detector).
    clock: returns the time used for `t_scored` (injectable for tests).
    """

    def __init__(self, curves, params, suppress=True, clock=time.time):
        self.curves, self.params, self.suppress, self.clock = curves, params, suppress, clock
        self.sessions = {}

    def start_session(self, session_key, circuit_key):
        self.sessions[session_key] = Session(self.curves.get(circuit_key))

    def knows(self, session_key):
        return session_key in self.sessions

    def process(self, msg):
        """Update state with one message; returns the Deviation events it produced (often none)."""
        if isinstance(msg, LapCompleted):
            return []
        ses = self.sessions[msg.session_key]
        if isinstance(msg, RaceControl):
            self._race_control(ses, msg)
            return []
        return self._sample(ses, msg)

    # ------------------------------------------------------------ context

    def _race_control(self, ses, m):
        text = m.message or ""
        if text == "SAFETY CAR DEPLOYED":
            ses.sc = True
        elif m.flag == "CLEAR" and m.scope == "Track":
            ses.sc = False
        if "VIRTUAL SAFETY CAR" in text and "DEPLOYED" in text:
            ses.vsc = True
        elif "VIRTUAL SAFETY CAR" in text and "ENDING" in text and ses.vsc:
            ses.vsc, ses.vsc_until = False, m.t_source + VSC_EXTRA_S
        if m.flag == "RED":
            ses.red = True
        elif text == "SESSION STARTED":
            ses.red = False
        if m.flag == "BLUE" and m.driver_number is not None:
            ses.cars.setdefault(m.driver_number, Car()).last_blue = m.t_source

    def _slowdown_suppressed(self, ses, car, s):
        if not self.suppress:
            return False
        return (ses.sc or ses.vsc or ses.red or s.t_source < ses.vsc_until or s.lap is None or s.lap <= 1
                or s.t_source - car.last_blue <= self.params.blue_flag_window_s)

    # ------------------------------------------------------------ samples

    def _sample(self, ses, s):
        car = ses.cars.setdefault(s.driver_number, Car())
        # score: expected speed and z (every sample), and the impossible-state rules
        z = exp = None
        if ses.curve is not None and s.lap_distance_m is not None:
            centre, e, sc = ses.curve
            exp = float(np.interp(s.lap_distance_m, centre, e))
            z = (s.speed - exp) / float(np.interp(s.lap_distance_m, centre, sc))
        values = {"speed": s.speed, "rpm": s.rpm, "throttle": s.throttle, "brake": s.brake,
                  "n_gear": math.nan if s.gear is None else s.gear, "drs": s.drs}
        held = {r.incident_type: bool(r.test(values)) for r in RULES}
        held["slowdown"] = z is not None and z < -self.params.k
        if s.interpolated:
            return []

        out = []
        gap = car.last_real is not None and s.t_source - car.last_real > self.params.sample_gap_s
        car.last_real = s.t_source
        for cond, on in held.items():
            run = car.runs.get(cond)
            if run is not None and (gap or not on):
                if run.fired:
                    out.append(self._event(s, cond, run, "close", t=run.last))
                del car.runs[cond]
                run = None
            if not on:
                continue
            if run is None:
                run = car.runs[cond] = Run(s.t_source, s.t_source)
            run.last = s.t_source
            if cond == "slowdown" and z < run.z_min:
                run.z_min, run.observed, run.expected = z, s.speed, exp
            elif cond != "slowdown" and run.observed is None:
                run.observed = s.speed
            need = self.params.d_s if cond == "slowdown" else IMPOSSIBLE_HOLD_S[cond]
            if run.last - run.start < need:
                continue
            if cond == "slowdown" and self._slowdown_suppressed(ses, car, s):
                continue
            score, prio = self._severity(cond, run)
            if not run.fired:
                run.fired, run.rank, run.lap, run.dist = True, _RANK[prio], s.lap, s.lap_distance_m
                out.append(self._event(s, cond, run, "open"))
            elif _RANK[prio] > run.rank:
                run.rank = _RANK[prio]
                out.append(self._event(s, cond, run, "update"))
        return out

    def _severity(self, cond, run):
        if cond == "slowdown":
            score, prio = severity(run.z_min, run.last - run.start)
        else:
            score, prio = severity(0.0, 0.0, cond)
        return float(score), str(prio)

    def _event(self, s, cond, run, phase, t=None):
        score, prio = self._severity(cond, run)
        slow = cond == "slowdown"
        return Deviation(SCHEMA_VERSION, s.session_key, s.driver_number, cond, phase,
                         run.lap if phase == "close" else s.lap, run.dist if phase == "close" else s.lap_distance_m,
                         run.start, s.t_source if t is None else t, run.last - run.start, score, prio,
                         run.observed, run.expected if slow else None, run.z_min if slow else None,
                         s.t_published, self.clock())
