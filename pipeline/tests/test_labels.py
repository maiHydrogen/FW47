import numpy as np
import pandas as pd
import pytest

from fw47_core import labels as lb


def car(speeds, dt=0.25, **cols):
    n = len(speeds)
    df = pd.DataFrame({"date": pd.Timestamp("2024-01-01", tz="UTC") + pd.to_timedelta(np.arange(n) * dt, unit="s"),
                       "speed": speeds, "brake": 0, "throttle": 50, "rpm": 10000, "n_gear": 5,
                       "lap_number": 10, "lap_distance_m": np.arange(n) * 10.0, "clean": False})
    for k, v in cols.items():
        df[k] = v
    return df


def test_cause_class():
    assert lb.cause_class("Power unit", "Ret") == "mechanical"
    assert lb.cause_class("Collision damage", "Ret") == "crash"
    assert lb.cause_class("Suspension/Accident", "Ret") == "ambiguous"
    assert lb.cause_class("Engine", "DNS") == "excluded"
    assert lb.cause_class("Plank wear", "DSQ") == "excluded"
    with pytest.raises(ValueError):
        lb.cause_class("Gremlins", "Ret")


def test_stop_time_after_last_fast_sample():
    # races, stops 40 s (red flag), races again, then stops for good
    v = [200] * 40 + [0] * 160 + [200] * 40 + [0] * 200
    c = car(v)
    assert lb.stop_time(c) == 240


def test_stop_time_treats_car_off_sentinel_as_rest():
    v = [200] * 40 + [7] * 400
    c = car(v)
    c.loc[40:, "brake"] = 104
    assert lb.stop_time(c) == 40


def test_stop_time_none_without_a_long_rest():
    assert lb.stop_time(car([200] * 40 + [0] * 20 + [200] * 40)) is None


def _with_reference(incident, lap9=200):
    """Three clean reference laps at 200 km/h, a clean lap 9 at `lap9` running straight into the incident lap."""
    ref = pd.concat([car([200] * 100).assign(lap_number=k, clean=True, date=lambda d, k=k: d["date"] - pd.Timedelta(minutes=10 - k))
                     for k in (6, 7, 8)] + [car([lap9] * 100).assign(lap_number=9, clean=True,
                                                                      date=lambda d: d["date"] - pd.Timedelta(seconds=25))])
    return pd.concat([ref, incident], ignore_index=True).sort_values("date").reset_index(drop=True)


def test_onset_is_start_of_final_departure():
    # normal, a brief dip 7.5 s before (more than JOIN_S), normal, then slows to a stop from sample 70
    v = [200] * 38 + [150] * 2 + [200] * 30 + list(np.linspace(150, 0, 30))
    c = _with_reference(car(v))
    stop = c.index[-1]
    on, why = lb.onset(c, stop, 10, [6, 7, 8, 9])
    assert c.loc[on, "date"] == c[c["lap_number"] == 10]["date"].iloc[70]
    assert "slow" in why


def test_onset_none_when_car_looked_normal():
    c = _with_reference(car([200] * 100))
    assert lb.onset(c, c.index[-1], 10, [6, 7, 8, 9])[0] is None


def test_a_slow_lap_before_the_incident_is_searched_not_used_as_reference():
    # lap 9 is clean (no gaps, normal length) but already 30% slow: the failure started there
    c = _with_reference(car(list(np.linspace(140, 0, 100))), lap9=140)
    assert lb.reference_laps([6, 7, 8, 9], 10) == [6, 7, 8]
    on, why = lb.onset(c, c.index[-1], 10, [6, 7, 8, 9])
    assert c.loc[on, "lap_number"] == 9 and why == "slow"


def test_neutralised_period_hides_slow_but_not_crawl():
    v = [200] * 40 + [120] * 30 + [20] * 30
    inc = car(v)
    c = _with_reference(inc)
    neut = pd.Series(c["date"] >= inc["date"].iloc[40], index=c.index)   # SC from sample 40 on
    on, why = lb.onset(c, c.index[-1], 10, [6, 7, 8, 9], neutral_mask=neut)
    assert c.loc[on, "date"] == inc["date"].iloc[70] and why.startswith("crawl")


def test_negative_laps():
    laps = pd.DataFrame({"session_key": [1, 1, 1], "driver_number": [44, 44, 1], "clean": [True, False, True]})
    neg = lb.negative_laps(laps, pd.DataFrame({"session_key": [1], "driver_number": [44]}))
    assert len(neg) == 1
