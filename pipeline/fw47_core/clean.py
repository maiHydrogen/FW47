"""Clean and align one race session (plan step B2).

Takes the raw OpenF1 tables for a session and returns:

- a lap table with one row per driver lap and a boolean column per reason to
  distrust that lap (standing start, pit in/out, safety car, yellow flag, ...);
- a sample table: every car_data sample with its lap number, distance into the
  lap, nearest X/Y position, quality flags and the flags of its lap.

Nothing is dropped. Each flag is a column, and `clean` is just the default
combination, so later steps can make a different choice.
"""

import re

import numpy as np
import pandas as pd

# car_data quirks found in B1 (analysis/01_inventory.ipynb, section 8)
DRS_OPEN = {10, 12, 14}
MAX_GEAR = 8
MAX_SPEED_KMH = 380
MAX_RPM = 15_500
BRAKE_STUCK_SAMPLES = 4   # ~1 s at 4 Hz
GAP_S = 1.0       # sample-level gap flag
LAP_GAP_S = 2.0   # lap-level: 1-1.5 s gaps don't measurably change lap length (B2)
WET_COMPOUNDS = {"INTERMEDIATE", "WET"}
START_ZONE_M, START_SPEED_KMH = 400, 30   # below 30 km/h in the first 400 m = started from rest
# (400 m because at some tracks, e.g. Suzuka, the grid extends well past the timing line)

# Lap-level flags that make a lap unclean by default, in funnel order.
LAP_FLAGS = ["standing_start", "pit_in", "pit_out", "safety_car", "vsc", "red_flag", "yellow",
             "deleted", "wet_tyres", "rain", "missing_duration", "has_gap", "bad_length"]
# A lap whose integrated length is this far from the session median has broken
# lap boundaries in the source (e.g. two laps merged into one). Clean laps vary ~0.2%.
LENGTH_TOL = 0.02

_DELETED = re.compile(r"CAR (\d+) .*DELETED.* LAP (\d+)")


# ---------------------------------------------------------------- periods

def _periods(starts, ends, max_len=None):
    """Pair each start time with the first end time after it."""
    ends = np.sort(np.asarray(ends, dtype="datetime64[ns]"))
    out = []
    for s in np.sort(np.asarray(starts, dtype="datetime64[ns]")):
        i = np.searchsorted(ends, s, side="right")
        e = ends[i] if i < len(ends) else None
        if e is None or (max_len is not None and e - s > max_len):
            e = s + (max_len or np.timedelta64(0, "s"))
        out.append((pd.Timestamp(s, tz="UTC"), pd.Timestamp(e, tz="UTC")))
    return out


def neutralised_periods(rc):
    """Safety car, VSC, red flag and yellow-flag periods from race-control messages.

    - SC: "SAFETY CAR DEPLOYED" until the next "TRACK CLEAR".
    - VSC: "VIRTUAL SAFETY CAR DEPLOYED" until the next "VIRTUAL SAFETY CAR ENDING",
      plus 15 s for the cars to get back up to speed.
    - Red flag: "RED FLAG" until the next "SESSION STARTED" (the resumption).
    - Yellow: a (double) yellow in a sector until that sector or the track is
      cleared, capped at 5 minutes in case the clear message is missing.
    """
    rc = rc.sort_values("date")
    msg = rc["message"].fillna("")
    track_clear = rc.loc[(rc["flag"] == "CLEAR") & (rc["scope"] == "Track"), "date"]
    vsc = msg.str.contains("VIRTUAL SAFETY CAR")
    periods = {
        "safety_car": _periods(rc.loc[msg.eq("SAFETY CAR DEPLOYED"), "date"], track_clear),
        "vsc": [(s, e + pd.Timedelta(seconds=15)) for s, e in _periods(
            rc.loc[vsc & msg.str.contains("DEPLOYED"), "date"],
            rc.loc[vsc & msg.str.contains("ENDING"), "date"])],
        "red_flag": _periods(rc.loc[rc["flag"].eq("RED"), "date"],
                             rc.loc[msg.eq("SESSION STARTED"), "date"]),
        "yellow": [],
    }
    yellow = rc[rc["flag"].isin(["YELLOW", "DOUBLE YELLOW"]) & (rc["scope"] == "Sector")]
    for sector, g in yellow.groupby("sector"):
        clears = rc.loc[(rc["flag"] == "CLEAR") & ((rc["sector"] == sector) | (rc["scope"] == "Track")), "date"]
        periods["yellow"] += _periods(g["date"], clears, max_len=np.timedelta64(300, "s"))
    return periods


def _overlaps(start, end, periods):
    """Boolean array: does [start, end) overlap any (s, e) period?"""
    hit = np.zeros(len(start), dtype=bool)
    for s, e in periods:
        hit |= (start < e) & (end > s)
    return hit


# ---------------------------------------------------------------- laps

def lap_table(laps, stints, rc, weather):
    """One row per driver lap with its time span and a column per flag.

    A lap without a duration ends at the car's next lap start. A car's final lap
    without one (usually the lap it retired on, which B5 needs) ends after twice
    the session's median lap time: the car keeps streaming a car-off reading
    (throttle = brake = 104) until the session ends, so its last sample is no use.
    """
    lt = laps[["session_key", "driver_number", "lap_number", "date_start", "lap_duration",
               "is_pit_out_lap"]].dropna(subset=["date_start"]).sort_values(["driver_number", "date_start"])
    lt = lt.reset_index(drop=True)
    nxt = lt.groupby("driver_number")["date_start"].shift(-1)
    lt["date_end"] = (lt["date_start"] + pd.to_timedelta(lt["lap_duration"], unit="s")).fillna(nxt)
    lt["date_end"] = lt["date_end"].fillna(lt["date_start"] + 2 * pd.Timedelta(seconds=lt["lap_duration"].median()))

    start, end = lt["date_start"].to_numpy(), lt["date_end"].to_numpy()
    lt["pit_out"] = lt["is_pit_out_lap"].fillna(False).astype(bool)
    # The lap that ends in the pit lane. OpenF1's pit.date falls after the car has
    # crossed the timing line in the pit lane, i.e. inside the out-lap, so the
    # in-lap is the one before each out-lap (lap 1 out-laps are pit-lane starts).
    nxt_out = lt.groupby("driver_number")["pit_out"].shift(-1).astype("boolean").fillna(False).astype(bool)
    nxt_lap = lt.groupby("driver_number")["lap_number"].shift(-1)
    lt["pit_in"] = nxt_out & nxt_lap.ne(1)

    periods = neutralised_periods(rc)
    for name, ps in periods.items():
        lt[name] = _overlaps(start, end, ps) if ps else False

    # Lap 1 here; clean_session adds red-flag restarts, which need the samples.
    lt["standing_start"] = lt["lap_number"] == 1

    deleted = set()
    for m in rc["message"].dropna():
        if (hit := _DELETED.search(m)) and "REINSTATED" not in m:
            deleted.add((int(hit.group(1)), int(hit.group(2))))
    lt["deleted"] = [(d, n) in deleted for d, n in zip(lt["driver_number"], lt["lap_number"])]

    lt["wet_tyres"] = False
    for s in stints[stints["compound"].isin(WET_COMPOUNDS)].itertuples():
        lt.loc[(lt["driver_number"] == s.driver_number) & lt["lap_number"].between(s.lap_start, s.lap_end),
               "wet_tyres"] = True
    rain = weather.loc[weather["rainfall"] > 0, "date"]
    # weather arrives once a minute; count a lap as rainy if a rainy reading falls within it (± 1 min)
    lt["rain"] = _overlaps(start, end, [(t - pd.Timedelta(minutes=1), t + pd.Timedelta(minutes=1)) for t in rain])
    lt["missing_duration"] = lt["lap_duration"].isna()
    flags = [f for f in LAP_FLAGS if f in lt]
    lt[flags] = lt[flags].astype(bool)
    return lt.drop(columns=["is_pit_out_lap"])


# ---------------------------------------------------------------- samples

def assign_laps(car, lt):
    """Attach lap_number to each sample; samples outside every lap get NaN."""
    car = car.sort_values("date")
    spans = lt[["driver_number", "lap_number", "date_start", "date_end"]].sort_values("date_start")
    s = pd.merge_asof(car, spans, left_on="date", right_on="date_start", by="driver_number", direction="backward")
    outside = s["date_end"].isna() | (s["date"] >= s["date_end"])
    s["lap_number"] = s["lap_number"].astype("Int64").mask(outside)
    return s.drop(columns=["date_end"])


def lap_distance(s):
    """Distance into the lap (m) by integrating speed over time (trapezoid rule).

    The first sample of a lap is integrated from the lap's start time at its own
    speed. Expects columns driver_number, lap_number, date, date_start, speed.
    """
    s = s.sort_values(["driver_number", "date"])
    v = s["speed"].to_numpy(float) / 3.6
    t = s["date"].astype("int64").to_numpy() / 1e9
    key = s["driver_number"].to_numpy() * 1000 + s["lap_number"].fillna(-1).to_numpy()
    first = np.r_[True, key[1:] != key[:-1]]
    dt = np.r_[0.0, np.diff(t)]
    v_avg = np.r_[v[0], (v[1:] + v[:-1]) / 2]
    t0 = s["date_start"].astype("int64").to_numpy() / 1e9
    step = np.where(first, v * np.clip(t - t0, 0, None), v_avg * dt)
    step[s["lap_number"].isna().to_numpy()] = np.nan
    seg = np.cumsum(first)
    out = pd.Series(step, index=s.index).groupby(seg).cumsum()
    return out.reindex(s.index)


def quality_flags(s):
    """Sample-level checks. Out-of-range values are fixed and the raw reading flagged."""
    s = s.sort_values(["driver_number", "date"])
    prev = s.groupby("driver_number")["date"].shift()
    s["gap_before_s"] = (s["date"] - prev).dt.total_seconds()
    s["q_duplicate"] = s["gap_before_s"].eq(0)
    s["q_gap"] = s["gap_before_s"] > GAP_S
    bad_gear = s["n_gear"] > MAX_GEAR
    s["q_bad_value"] = (bad_gear | (s["throttle"] > 100) | ~s["brake"].isin([0, 100])
                        | (s["speed"] > MAX_SPEED_KMH) | (s["rpm"] > MAX_RPM))
    s["throttle"] = s["throttle"].clip(upper=100)
    # Brake "on" at full throttle for ~1 s or more: the brake channel is stuck
    # (found in B3: up to 22 s while the car accelerates). Single samples are the
    # normal overlap as the driver lifts and brakes, and are kept.
    both = (s["brake"] == 100) & (s["throttle"] >= 99)
    run = (both != both.groupby(s["driver_number"]).shift(fill_value=False)).cumsum()
    s["q_brake_stuck"] = both & (both.groupby(run).transform("size") >= BRAKE_STUCK_SAMPLES)
    s["brake_on"] = s["brake"] > 0
    s["n_gear"] = s["n_gear"].where(~bad_gear).astype("Int8")
    s["drs_open"] = s["drs"].isin(DRS_OPEN)
    return s


def attach_xy(s, loc):
    """Nearest location sample (within 0.25 s) for each car sample."""
    loc = loc[["date", "driver_number", "x", "y"]].sort_values("date")
    return pd.merge_asof(s.sort_values("date"), loc, on="date", by="driver_number",
                         direction="nearest", tolerance=pd.Timedelta(milliseconds=250))


def clean_session(car, loc, laps, stints, rc, weather):
    """Return (lap_table, samples) for one session. See the module docstring."""
    lt = lap_table(laps, stints, rc, weather)
    s = quality_flags(assign_laps(car, lt))
    s["lap_distance_m"] = lap_distance(s)

    # Lap length as integrated, and a version rescaled so every lap has the
    # session's median clean-lap length (removes per-lap integration drift),
    # (plus the stretch from the lap's last sample to the line).
    last = s.dropna(subset=["lap_number"]).groupby(["driver_number", "lap_number"]).tail(1)
    last = last.merge(lt[["driver_number", "lap_number", "date_end"]], on=["driver_number", "lap_number"])
    tail = last["speed"] / 3.6 * (last["date_end"] - last["date"]).dt.total_seconds()
    lap_len = (last["lap_distance_m"] + tail).set_axis(
        pd.MultiIndex.from_frame(last[["driver_number", "lap_number"]])).rename("integrated_length_m")
    gaps = s[s["gap_before_s"] > LAP_GAP_S].groupby(["driver_number", "lap_number"]).size().rename("n_gaps")
    lt = lt.join(lap_len, on=["driver_number", "lap_number"]).join(gaps, on=["driver_number", "lap_number"])

    # Standing starts: the car is (nearly) stopped in the first metres of the lap.
    # This catches red-flag restarts, which OpenF1 numbers inconsistently (at
    # Suzuka 2024 "lap 1" is the restart formation lap and lap 3 the real start).
    early = s[s["lap_distance_m"] < START_ZONE_M].groupby(["driver_number", "lap_number"])["speed"].min()
    from_rest = (early < START_SPEED_KMH).rename("from_rest")
    lt = lt.join(from_rest, on=["driver_number", "lap_number"])
    lt["standing_start"] |= lt.pop("from_rest").astype("boolean").fillna(False).astype(bool) & ~lt["pit_out"]
    lt["has_gap"] = lt.pop("n_gaps").fillna(0) > 0
    others = [f for f in LAP_FLAGS if f != "bad_length"]
    track_len = lt.loc[~lt[others].any(axis=1), "integrated_length_m"].median()
    lt["track_length_m"] = track_len
    lt["bad_length"] = ~((lt["integrated_length_m"] / track_len - 1).abs() <= LENGTH_TOL)
    lt["clean"] = ~lt[LAP_FLAGS].any(axis=1)

    s = s.join(lt.set_index(["driver_number", "lap_number"])[LAP_FLAGS + ["clean", "integrated_length_m"]],
               on=["driver_number", "lap_number"])
    s["lap_distance_norm_m"] = s["lap_distance_m"] / s.pop("integrated_length_m") * track_len
    s["in_lap"] = s["lap_number"].notna()
    s["clean"] = s["clean"].astype("boolean").fillna(False).astype(bool) & ~s["q_bad_value"] & ~s["q_duplicate"] & ~s["q_brake_stuck"]
    s = attach_xy(s, loc)
    return lt, s.drop(columns=["date_start"]).sort_values(["driver_number", "date"]).reset_index(drop=True)
