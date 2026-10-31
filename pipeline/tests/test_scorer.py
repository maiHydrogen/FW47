"""The streaming scorer (plan step A4): same answers as the batch detector, at any sample rate."""

import numpy as np
import pandas as pd
import pytest

from fw47_core.baseline import detect
from service.schema import (SCHEMA_VERSION, Deviation, RaceControl, SessionEnded, TelemetrySample, Watermark,
                            from_fields, to_fields)
from service.scorer import Params, Scorer, load_baselines
from service.sources import upsample

PARAMS = Params(k=6.0, d_s=2.0, sample_gap_s=1.0, blue_flag_window_s=30.0, version="test")
CURVE = {1: (np.array([0.0, 5000.0]), np.array([200.0, 200.0]), np.array([5.0, 5.0]))}   # 200 km/h, spread 5


def sample(t, speed=200.0, drv=44, lap=5, dist=1000.0, rpm=11000.0, gear=7, brake=0, drs=0, interp=False):
    return TelemetrySample(SCHEMA_VERSION, 1, drv, t, t, lap, dist, speed, rpm, gear, 100.0, brake, drs, interp)


def rc(t, message="", flag=None, scope=None, drv=None):
    return RaceControl(SCHEMA_VERSION, 1, t, t, "Flag", flag, scope, None, drv, message)


def run(msgs, suppress=True, curves=CURVE, circuit=1):
    sc = Scorer(curves, PARAMS, suppress=suppress, clock=lambda: 0.0)
    sc.start_session(1, circuit)
    return [e for m in msgs for e in sc.process(m)]


def opens(events, kind="slowdown"):
    return [e for e in events if e.phase == "open" and e.type == kind]


def slow_trace(n=400, seed=0):
    """A car at ~4 Hz with random dips below the baseline, some long enough to alert, and a data gap."""
    rng = np.random.default_rng(seed)
    t = np.cumsum(rng.uniform(0.2, 0.3, n))
    t[200:] += 3.0                                        # a 3 s outage
    speed = np.full(n, 200.0)
    for start in rng.choice(n - 20, 12, replace=False):
        speed[start:start + rng.integers(2, 15)] = rng.uniform(140, 175)   # z between -12 and -5
    return t, speed


def test_matches_the_batch_detector():
    t, speed = slow_trace()
    events = run([sample(ti, sp) for ti, sp in zip(t, speed)], suppress=False)
    df = pd.DataFrame({"driver_number": 44, "date": pd.to_datetime((t * 1e9).astype("int64"), utc=True),
                       "z": (speed - 200.0) / 5.0})
    ep = detect(df, PARAMS.k, PARAMS.d_s)
    assert len(ep) >= 3
    assert [(round(e.t_start, 6), round(e.t_source, 6)) for e in opens(events)] == \
        [(round(a.value / 1e9, 6), round(b.value / 1e9, 6)) for a, b in zip(ep["start"], ep["alert_at"])]
    closes = [e for e in events if e.phase == "close"]
    assert [round(e.duration_s, 6) for e in closes] == [round(d, 6) for d in ep["duration_s"]]
    assert [round(e.z, 6) for e in closes] == [round(z, 6) for z in ep["z_min"]]


def test_same_alerts_at_4_hz_and_50_hz():
    t, speed = slow_trace(seed=1)
    n = len(t)
    car = dict(t=t.tolist(), speed=speed.tolist(), rpm=[11000] * n, throttle=[100] * n, gear=[7] * n,
               brake=[0] * n, drs=[0] * n, lap=[5] * n, dist=np.linspace(0, 4000, n).tolist())
    key = lambda evs: [(e.type, e.phase, e.t_start, e.t_source, e.duration_s) for e in evs]
    real = run(list(upsample(1, 44, **car, max_gap_s=0)), suppress=False)
    fifty = list(upsample(1, 44, **car, hz=50))
    assert sum(s.interpolated for s in fifty) > 10 * n
    assert key(run(fifty, suppress=False)) == key(real) and opens(real)


def test_engine_stall_fires_on_one_sample_and_is_critical():
    ev = run([sample(0.0), sample(0.25, speed=150, rpm=0), sample(0.5)])
    (o,) = opens(ev, "engine-stall")
    assert (o.priority, o.severity, o.t_source) == ("Critical", 100.0, 0.25)
    assert [e.phase for e in ev if e.type == "engine-stall"] == ["open", "close"]


def test_drs_failure_needs_half_a_second():
    open_drs = lambda t: sample(t, brake=100, drs=12)
    assert not opens(run([open_drs(0.0), open_drs(0.25), sample(0.5)]), "drs-failure")          # 0.25 s
    assert opens(run([open_drs(0.0), open_drs(0.25), open_drs(0.5), sample(0.75)]), "drs-failure")


def test_interpolated_samples_cannot_start_a_run():
    ev = run([sample(0.0), sample(0.02, speed=100, rpm=0, interp=True), sample(0.25)])
    assert not ev


def test_a_data_gap_ends_the_run():
    slow = [sample(t, speed=150) for t in (0.0, 0.5, 1.0)] + [sample(t, speed=150) for t in (2.5, 3.0, 3.5)]
    assert not opens(run(slow))                        # two 1 s runs, not one 3.5 s run


def test_priority_only_rises_and_runs_close():
    speed = lambda t: 200 if t < 1 else 160 if t < 3 else 120 if t < 7 else 20    # z: -8, -16, -36
    ev = run([sample(t, speed=speed(t)) for t in np.arange(0, 12.5, 0.5)] + [sample(12.5)])
    assert [(e.phase, e.priority) for e in ev] == [("open", "High"), ("update", "Critical"), ("close", "Critical")]
    assert ev[0].t_source == 3.0                        # 2 s after the run started at 1.0
    assert ev[-1].duration_s == 11.0 and ev[-1].z == pytest.approx(-36.0) and ev[-1].observed == 20


def test_safety_car_delays_slowdowns_but_not_impossible_states():
    msgs = [rc(0.0, "SAFETY CAR DEPLOYED")] + [sample(t, speed=120) for t in np.arange(0.25, 10, 0.25)]
    msgs.insert(20, sample(5.0, speed=120, rpm=0))     # engine off at 120 km/h during the SC
    assert not opens(run(msgs)) and opens(run(msgs), "engine-stall")
    cleared = msgs + [rc(10.0, flag="CLEAR", scope="Track"), sample(10.25, speed=120)]
    (o,) = opens(run(cleared))
    assert o.t_source == 10.25 and o.t_start == 0.25   # still slow after the SC: reported then, run since 0.25 s


def test_vsc_suppresses_until_15_s_after_it_ends():
    msgs = [rc(0.0, "VIRTUAL SAFETY CAR DEPLOYED"), rc(5.0, "VIRTUAL SAFETY CAR ENDING")]
    msgs += [sample(t, speed=150) for t in np.arange(6, 22, 0.5)]
    (o,) = opens(run(msgs))
    assert o.t_source == 20.0                           # 5 + 15 s (periods are half-open, as in clean.py)


def test_blue_flag_suppresses_that_car_for_30_s():
    slow = lambda drv, t0: [sample(t, speed=150, drv=drv) for t in np.arange(t0, t0 + 3, 0.25)]
    msgs = [rc(0.0, "WAVED BLUE FLAG FOR CAR 2 (SAR)", flag="BLUE", drv=2)] + slow(2, 1.0) + slow(44, 1.0)
    assert {e.driver_number for e in opens(run(msgs))} == {44}
    assert {e.driver_number for e in opens(run([rc(0.0, flag="BLUE", drv=2)] + slow(2, 31.0)))} == {2}


def test_lap_one_is_suppressed():
    assert not opens(run([sample(t, speed=100, lap=1) for t in np.arange(0, 5, 0.25)]))


def test_circuit_without_baseline_still_runs_impossible_state_rules():
    ev = run([sample(0.0, speed=50), sample(1.0, speed=50), sample(3.0, speed=150, rpm=0)], circuit=999)
    assert {e.type for e in ev} == {"engine-stall"}


def test_session_end_closes_open_runs_and_is_passed_on():
    end = SessionEnded(SCHEMA_VERSION, 1, 5.0, 5.0)
    ev = run([sample(t, speed=120) for t in np.arange(1, 5, 0.25)] + [sample(4.0, drv=1, rpm=0), end])
    closes = [e for e in ev if isinstance(e, Deviation) and e.phase == "close"]
    assert [(e.driver_number, e.type, e.t_source) for e in closes] == [(1, "engine-stall", 4.0), (44, "slowdown", 4.75)]
    assert ev[-1] == end


def test_watermarks_follow_source_time():
    sc = Scorer(CURVE, PARAMS, clock=lambda: 0.0, watermark_s=1.0)
    sc.start_session(1, 1)
    out = [e for t in np.arange(0, 3.01, 0.25) for e in sc.process(sample(t))]
    assert [e.t_source for e in out if isinstance(e, Watermark)] == [0.0, 1.0, 2.0, 3.0]


def test_loads_the_exported_b4_baselines():
    curves, params = load_baselines()
    assert len(curves) == 24 and (params.k, params.d_s, params.blue_flag_window_s) == (6.0, 2.0, 30.0)
    centre, expected, scale = curves[63]                # Sakhir
    assert np.all(np.diff(centre) > 0) and np.all(scale >= 3.0)


def test_new_messages_round_trip():
    d = Deviation(SCHEMA_VERSION, 9472, 44, "slowdown", "open", 12, 2050.5, 1.0, 3.25, 2.25, 61.3, "High", 140.0,
                  262.0, -9.1, 3.2, 3.21)
    m = RaceControl(SCHEMA_VERSION, 9472, 1.0, 1.1, "Flag", "BLUE", "Driver", None, 2, "WAVED BLUE FLAG")
    assert from_fields(to_fields(d)) == d and from_fields(to_fields(m)) == m
