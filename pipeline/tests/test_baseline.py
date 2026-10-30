import numpy as np
import pandas as pd

from fw47_core.baseline import build_v1, car_offsets, detect, expected, robust_z, severity


def _laps(n_cars=3, n_laps=6, length=1000, step=10, speed=lambda d: 100 + d / 10):
    rows = []
    for c in range(1, n_cars + 1):
        for lap in range(1, n_laps + 1):
            for d in range(0, length, step):
                rows.append((c, lap, float(d), speed(d) * (1 + 0.01 * c)))
    return pd.DataFrame(rows, columns=["driver_number", "lap_number", "lap_distance_m", "speed"])


def test_v1_recovers_a_known_speed_profile():
    s = _laps(speed=lambda d: 200 - d / 20)
    b = build_v1(s)
    e, sc = expected(b, np.array([12.5, 512.5]))
    assert np.allclose(e, (200 - np.array([12.5, 512.5]) / 20) * 1.02, rtol=1e-3)   # median car is 2% fast
    assert (sc >= 3.0).all()


def test_robust_z_sign():
    assert robust_z([90], np.array([100.0]), np.array([5.0]))[0] == -2


def test_car_offset_uses_only_previous_clean_laps():
    s = _laps(n_cars=1, n_laps=8)
    exp = np.full(len(s), 100.0)
    s["speed"] = 100.0 * (1 + 0.01 * s["lap_number"])        # lap L runs L% above expected
    off = pd.Series(car_offsets(s, exp, np.ones(len(s), bool), n_laps=5, min_laps=3)).groupby(s["lap_number"]).first()
    assert off[1] == off[2] == off[3] == 0.0                   # fewer than 3 earlier clean laps
    assert np.isclose(off[4], 0.02)                            # median of laps 1-3
    assert np.isclose(off[8], 0.05)                            # median of laps 3-7


def _ts(seconds):
    return pd.to_datetime(1_700_000_000 + np.asarray(seconds), unit="s", utc=True)


def test_detect_persistence_and_alert_time():
    t = np.arange(0, 10, 0.25)
    z = np.zeros_like(t)
    z[(t >= 2) & (t < 2.5)] = -10        # 0.25 s blip: 2 samples
    z[(t >= 5) & (t < 8)] = -10          # 3 s event
    s = pd.DataFrame({"driver_number": 1, "date": _ts(t), "z": z})
    ep = detect(s, k=4, d_s=1.0)
    assert len(ep) == 1
    assert ep.loc[0, "start"] == _ts([5.0])[0] and ep.loc[0, "alert_at"] == _ts([6.0])[0]
    assert np.isclose(ep.loc[0, "duration_s"], 2.75)
    assert len(detect(s, k=4, d_s=0)) == 2


def test_detect_breaks_runs_at_data_gaps_and_cars():
    s = pd.DataFrame({"driver_number": [1, 1, 1, 2, 2], "date": _ts([0, 0.25, 3.0, 3.25, 3.5]), "z": -10.0})
    ep = detect(s, k=4, d_s=0)
    assert len(ep) == 3


def test_severity_formula():
    score, prio = severity(-40, 15)
    assert score == 100 and prio == "Critical"
    score, prio = severity(-5, 2)
    assert np.isclose(score, 22.5) and prio == "Low"
    assert severity(-1, 0, "engine-stall") == (100.0, "Critical")
