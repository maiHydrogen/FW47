import asyncio
import hashlib
import time

import numpy as np
import pandas as pd
import pytest

from service.schema import LapCompleted, TelemetrySample, canonical, from_fields, to_fields
from service.sources import ReplaySource, upsample

T0 = pd.Timestamp("2024-03-02 15:03:00", tz="UTC")


def _car(**over):
    """Five real samples of one car: 0.25 s apart, then a 2 s outage, crossing the line between 3 and 4."""
    d = dict(t=[0.0, 0.25, 0.5, 0.75, 2.75], speed=[100, 110, 120, 130, 140], rpm=[10000, 10100, 10200, 10300, 10400],
             throttle=[100, 100, 50, 0, 0], gear=[6, 6, 7, None, 7], brake=[0, 0, 0, 100, 100], drs=[0, 0, 12, 12, 0],
             lap=[3, 3, 3, 3, 4], dist=[5000.0, 5007.6, 5015.9, np.nan, 20.0])
    d.update(over)
    return d


def test_real_samples_pass_through_unchanged():
    car = _car()
    real = [s for s in upsample(1, 44, **car) if not s.interpolated]
    assert [s.t_source for s in real] == car["t"]
    assert [s.speed for s in real] == car["speed"]
    assert [s.gear for s in real] == car["gear"]
    assert [s.lap_distance_m for s in real] == [5000.0, 5007.6, 5015.9, None, 20.0]


def test_interpolated_samples_fill_to_50_hz_and_are_flagged():
    out = list(upsample(1, 44, **_car()))
    t = [s.t_source for s in out]
    assert t == sorted(t)
    gaps = np.diff(t)
    assert gaps[gaps < 1].max() <= 0.02 + 1e-9
    # 3 gaps of 0.25 s -> 12 added in each; nothing added across the 2 s outage
    assert sum(s.interpolated for s in out) == 36
    assert not any(s.interpolated for s in out if s.t_source > 0.75)


def test_interpolation_rules_per_channel():
    out = list(upsample(1, 44, **_car()))
    mid = next(s for s in out if s.interpolated and abs(s.t_source - 0.375) < 0.011)   # between 0.25 and 0.5
    f = (mid.t_source - 0.25) / 0.25
    assert mid.speed == pytest.approx(110 + 10 * f)          # continuous: linear
    assert mid.throttle == pytest.approx(100 - 50 * f)
    assert mid.lap_distance_m == pytest.approx(5007.6 + (5015.9 - 5007.6) * f)
    assert (mid.gear, mid.drs, mid.brake, mid.lap) == (6, 0, 0, 3)   # discrete: carried forward
    # next to a missing distance it can't be interpolated
    assert all(s.lap_distance_m is None for s in out if s.interpolated and 0.5 < s.t_source < 0.75)


def test_lap_change_gives_no_distance():
    car = _car(t=[0.0, 0.25], speed=[300, 300], rpm=[1, 1], throttle=[100, 100], gear=[8, 8], brake=[0, 0],
               drs=[0, 0], lap=[3, 4], dist=[5410.0, 10.0])
    added = [s for s in upsample(1, 44, **car) if s.interpolated]
    assert added and all(s.lap_distance_m is None and s.lap == 3 for s in added)


def test_schema_round_trip():
    s = TelemetrySample(1, 9472, 44, 1709391920.123456789, 1709391920.5, None, None, 287.4, 11000.0, None, 99.5,
                        104, 12, True)
    raw = {k.encode(): v.encode() for k, v in to_fields(s).items()}   # as redis-py hands them back
    assert from_fields(raw) == s
    lap = LapCompleted(1, 9472, 44, 1709391920.1, None, 12, None, "SOFT", 13, 2)
    assert from_fields(to_fields(lap)) == lap
    assert to_fields(TelemetrySample(1, 1, 1, np.float64(1.5), None, 1, 1.0, 1.0, 1.0, 1, 1.0, 0, 0, False))[
        "t_source"] == "1.5"


def test_unknown_schema_version_is_refused():
    f = to_fields(LapCompleted(1, 9472, 44, 1.0, None, 12, 90.0, "SOFT", 13, 2)) | {"schema_version": "2"}
    with pytest.raises(ValueError):
        from_fields(f)


@pytest.fixture
def data_dir(tmp_path):
    """A two-car, three-lap race in the layout ReplaySource reads."""
    rng = np.random.default_rng(0)
    samples, laps = [], []
    for drv in (1, 44):
        t = T0 + pd.to_timedelta(np.cumsum(rng.uniform(.2, .3, 1200)), unit="s")
        lap_no = np.repeat([1, 2, 3], 400)
        samples.append(pd.DataFrame(dict(
            date=t, driver_number=drv, lap_number=pd.array(lap_no, dtype="Int64"),
            lap_distance_m=np.tile(np.linspace(0, 5000, 400), 3), speed=rng.integers(80, 330, 1200),
            rpm=rng.integers(9000, 12000, 1200), n_gear=pd.array(rng.integers(1, 9, 1200), dtype="Int8"),
            throttle=rng.integers(0, 101, 1200), brake=rng.choice([0, 100], 1200), drs=rng.choice([0, 12], 1200))))
        for k in range(3):
            laps.append(dict(driver_number=drv, lap_number=k + 1, date_start=t[400 * k], date_end=t[400 * k + 399],
                             lap_duration=(t[400 * k + 399] - t[400 * k]).total_seconds()))
    write = lambda df, *p: (tmp_path.joinpath(*p, "season=2024").mkdir(parents=True, exist_ok=True),
                            df.to_parquet(tmp_path.joinpath(*p, "season=2024", "1.parquet")))
    write(pd.concat(samples), "clean", "samples")
    write(pd.DataFrame(laps), "clean", "laps")
    write(pd.DataFrame(dict(driver_number=[1, 1, 44], lap_start=[1, 3, 1], lap_end=[2, 3, 3],
                            compound=["SOFT", "HARD", "MEDIUM"], tyre_age_at_start=[3, 0, 0])), "parquet", "stints")
    write(pd.DataFrame(dict(date=[T0, T0, T0 + np.timedelta64(150, "s")], driver_number=[1, 44, 44],
                            position=[1, 2, 1])), "parquet", "position")
    return tmp_path


def _collect(src):
    async def go():
        return [m async for m in src]
    return asyncio.run(go())


def test_replay_is_deterministic(data_dir):
    def digest():
        h = hashlib.sha256()
        for m in _collect(ReplaySource(data_dir, 2024, 1, deterministic=True)):
            h.update(canonical(m).encode())
        return h.hexdigest()
    assert digest() == digest()


def test_replay_merges_cars_in_time_order(data_dir):
    msgs = _collect(ReplaySource(data_dir, 2024, 1, deterministic=True))
    t = [m.t_source for m in msgs]
    assert t == sorted(t)
    assert msgs[-1].KIND == "session_ended" and msgs[-1].t_source == t[-2]
    assert {m.driver_number for m in msgs[:-1]} == {1, 44}
    assert all(m.t_published == m.t_source for m in msgs)
    assert sum(not m.interpolated for m in msgs if m.KIND == "telemetry") == 2400


def test_lap_completed_events(data_dir):
    laps = {(m.driver_number, m.lap): m for m in ReplaySource(data_dir, 2024, 1).laps()}
    assert len(laps) == 6
    assert (laps[1, 1].compound, laps[1, 1].tyre_life) == ("SOFT", 4)     # 3 laps old at the start
    assert (laps[1, 2].compound, laps[1, 2].tyre_life) == ("SOFT", 5)
    assert (laps[1, 3].compound, laps[1, 3].tyre_life) == ("HARD", 1)     # new set after a stop
    assert laps[44, 1].position == 2 and laps[44, 3].position == 1


def test_playback_speed_paces_against_the_wall_clock(data_dir):
    src = ReplaySource(data_dir, 2024, 1, speed=200.0, hz=None, race_only=False)
    span = None
    start = time.monotonic()
    msgs = _collect(src)
    took = time.monotonic() - start
    span = msgs[-1].t_source - msgs[0].t_source          # ~300 s of race at 200x = ~1.5 s
    assert took == pytest.approx(span / 200, rel=0.25)
    assert all(b.t_published >= a.t_published for a, b in zip(msgs, msgs[1:]))
