"""Ground-truth labels for retirements (plan step B5).

The written rule is in analysis/labelling_rule.md; this module is its code:

- `cause_class`: the Wikipedia classification cause -> mechanical / ambiguous /
  crash / excluded.
- `stop_time`: when the car came to rest for good.
- `pit_lane_points` / `near`: where the pit lane is, from cars' known pit stops,
  so a stop can be placed on track or in the pit lane.
- `onset`: the proposed onset, the start of the car's final departure from how it
  drove the same stretch on its own previous laps. It deliberately does not use
  the B4 field baseline, so B6 can't score the detector against itself.

Onsets are proposals for review, not labels: analysis/labels.csv keeps the
proposal and the reviewed value in separate columns.
"""

import numpy as np
import pandas as pd
from scipy.spatial import cKDTree

# ---------------------------------------------------------------- causes

MECHANICAL = {
    "engine", "power unit", "turbo", "gearbox", "transmission", "clutch", "hydraulics", "brakes", "electrical",
    "oil leak", "oil pressure", "oil temperature", "water leak", "overheating", "fuel leak", "fuel pump",
    "fuel system", "throttle", "steering", "chassis",
}
# A cause that may be a failure or the result of contact, or both at once.
AMBIGUOUS = {"suspension", "hydraulics/accident", "suspension/accident", "rear wing", "handling", "floor", "undertray"}
CRASH = {
    "accident", "accident damage", "collision", "collision damage", "spun off", "incident damage", "damage",
    "car damaged", "puncture", "puncture damage",
}
# Not a car-health event in the race: didn't start, disqualified, withdrawn, the driver, the team.
EXCLUDED = {
    "withdrew", "heatstroke", "driver injury", "qualifying accident", "pit stop issue", "outside assistance",
    "plank wear", "skid block", "underweight", "underweight car",
}


def cause_class(cause, pos_text):
    """Class of one non-finisher from its Wikipedia result cell and position cell."""
    if str(pos_text).split("|")[0] in {"DNS", "DSQ", "WD", "DNQ", "DNP"}:
        return "excluded"
    c = str(cause).strip().lower()
    for name, group in (("mechanical", MECHANICAL), ("ambiguous", AMBIGUOUS), ("crash", CRASH), ("excluded", EXCLUDED)):
        if c in group:
            return name
    raise ValueError(f"unmapped cause {cause!r}: add it to one of the groups in labels.py")


# ---------------------------------------------------------------- stop

STOP_KMH = 5          # "at rest": below this speed ...
STOP_HOLD_S = 30      # ... for at least this long, or until the data ends
RACING_KMH = 50       # the stop is the first rest after the car's last sample above this


def car_off(car):
    """OpenF1's car-off sentinel: brake reads 104 (and throttle 100-104, speed 0-7) once a car is switched off."""
    return (car["brake"] > 100).to_numpy()


def stop_time(car):
    """When the car came to rest for good.

    The first sample after the car's last sample above RACING_KMH from which speed stays below
    STOP_KMH for STOP_HOLD_S, or to the end of the data. Anchoring on the last fast sample skips
    red-flag stops and long pit stops, after which the car raced again. Slow movement afterwards
    (pushed by marshals, rolled into the garage) doesn't count as racing.

    `car` is one car's samples sorted by date. Returns the index label of that sample, or None.
    """
    v = np.where(car_off(car), 0, car["speed"].to_numpy())
    t = car["date"].to_numpy()
    fast = np.flatnonzero(v > RACING_KMH)
    if len(fast) == 0:
        return None
    for i in range(fast[-1] + 1, len(v)):
        if v[i] >= STOP_KMH or (i > 0 and v[i - 1] < STOP_KMH and i - 1 > fast[-1]):
            continue                      # moving, or not the first still sample of a stretch
        nxt = np.flatnonzero(v[i:] >= STOP_KMH)
        end = t[i + nxt[0]] if len(nxt) else t[-1]
        if not len(nxt) or (end - t[i]) / np.timedelta64(1, "s") >= STOP_HOLD_S:
            return car.index[i]
    return None


# ---------------------------------------------------------------- pit lane

PIT_LIMITER_KMH = 85   # pit lane limit is 60 or 80 km/h (2023-2025 sporting regulations)
NEAR_PIT_M = 15


def pit_lane_points(samples, pit, window_s=40):
    """X/Y points on the pit lane: slow samples of each car around its own pit stops."""
    pts = []
    if "date" not in pit:          # no pit stops recorded for this race
        return np.empty((0, 2))
    for p in pit.dropna(subset=["date"]).itertuples():
        lane = float(p.lane_duration) if pd.notna(p.lane_duration) else 25.0
        w = (samples["driver_number"] == p.driver_number) & samples["date"].between(
            p.date - pd.Timedelta(seconds=window_s), p.date + pd.Timedelta(seconds=lane + window_s))
        s = samples.loc[w & (samples["speed"] <= PIT_LIMITER_KMH), ["x", "y"]].dropna()
        pts.append(s.to_numpy())
    return np.vstack(pts) if pts else np.empty((0, 2))


OFF_LINE_M = 10        # pit-lane samples must also be this far from the racing line


def in_pit_lane(car, lane, line, tol_m=NEAR_PIT_M, off_line_m=OFF_LINE_M):
    """Per sample: on the pit lane, i.e. near a pit-lane point and away from the racing line.

    `line` is X/Y of clean-lap samples (the racing line). Requiring distance from it keeps
    the pit straight itself, which can run close to the pit lane, from being masked.
    """
    xy = car[["x", "y"]].to_numpy(float)
    ok = ~np.isnan(xy).any(axis=1)
    out = np.zeros(len(car), bool)
    if len(lane) == 0 or not ok.any():
        return out
    d_lane = cKDTree(lane).query(xy[ok])[0] / 10
    d_line = cKDTree(line).query(xy[ok])[0] / 10
    out[ok] = (d_lane <= tol_m) & (d_line > off_line_m)
    return out


def pit_approach(car, lane, tol_m=NEAR_PIT_M, noise_kmh=3):
    """Per sample: the final drive into the pit lane of a car that stopped there.

    The last stretch of samples within tol_m of the pit lane (entry road included), extended back
    over the braking that leads into it (speed falling, allowing noise_kmh). That is what a normal
    pit entry looks like, so it can't count as a symptom. `car` ends at the stop.
    """
    xy = car[["x", "y"]].to_numpy(float)
    out = np.zeros(len(car), bool)
    if len(lane) == 0 or len(car) == 0:
        return out
    d = np.full(len(car), np.inf)
    ok = ~np.isnan(xy).any(axis=1)
    d[ok] = cKDTree(lane).query(xy[ok])[0] / 10
    near_lane = d <= tol_m
    i = len(car) - 1
    while i >= 0 and (near_lane[i] or not ok[i]):
        i -= 1
    v = car["speed"].to_numpy(float)
    while i > 0 and v[i - 1] >= v[i] - noise_kmh:      # going back in time, speed rises: braking
        i -= 1
    out[max(i, 0):] = True
    return out


def near(points, x, y, tol_m=NEAR_PIT_M):
    """True if (x, y) is within tol_m of any of `points`. OpenF1 location is in 1/10 m."""
    if len(points) == 0 or pd.isna(x):
        return False
    d = np.hypot(points[:, 0] - x, points[:, 1] - y) / 10
    return bool(d.min() <= tol_m)


# ---------------------------------------------------------------- onset

REF_LAPS = 3            # the car's own last clean laps before the incident lap
SPEED_DROP = 0.10       # slower than every reference lap by more than this fraction
FULL_THROTTLE = 90      # a stretch every reference lap took at >= this throttle ...
LIFT = 20               # ... now at <= this
RPM_OFF_KMH = 30        # rpm 0 above this speed: engine off while rolling
NEUTRAL_KMH = 50        # gear 0 above this speed
CRAWL_KMH = 30          # crawling: below this where the reference is above ...
CRAWL_REF_KMH = 100     # ... this (counts even under a safety car)
JOIN_S = 5.0            # departures closer than this belong to one run
BIN_M = 25


def reference(car, laps, n=REF_LAPS, min_laps=None):
    """Per-25 m min speed and min throttle over the car's last `n` of `laps`, or None if too few."""
    laps = list(laps)[-n:]
    ref = car[car["lap_number"].isin(laps)]
    if ref["lap_number"].nunique() < (n if min_laps is None else min_laps):
        return None
    b = (ref["lap_distance_m"] // BIN_M).astype(int)
    per_lap = ref.groupby([b, ref["lap_number"]]).agg(speed=("speed", "median"), throttle=("throttle", "min"))
    out = per_lap.groupby(level=0).agg(speed=("speed", "min"), throttle=("throttle", "min"))
    out["centre_m"] = out.index * BIN_M + BIN_M / 2
    return out


def departures(car, ref, in_ref=None):
    """Per-sample departure flags, one column per reason, against the car's own reference laps.

    `in_ref`, the car's own earlier in-laps, is used for a car that ended in the pit lane: there
    "slow" means slower than both its racing laps and its normal pit entries, so braking for the
    pit lane isn't a symptom.
    """
    reasons = pd.DataFrame(index=car.index)
    v = car["speed"].to_numpy()
    reasons["rpm_off"] = (car["rpm"] == 0) & (car["speed"] > RPM_OFF_KMH)
    reasons["neutral"] = (car["n_gear"] == 0) & (car["speed"] > NEUTRAL_KMH)
    reasons["crawl"] = reasons["slow"] = reasons["lift"] = False
    if ref is not None:
        d = car["lap_distance_m"].to_numpy()
        ref_v = np.interp(d, ref["centre_m"], ref["speed"])
        ref_t = np.interp(d, ref["centre_m"], ref["throttle"])
        if in_ref is not None:
            ref_v = np.minimum(ref_v, np.interp(d, in_ref["centre_m"], in_ref["speed"]))
            ref_t = np.minimum(ref_t, np.interp(d, in_ref["centre_m"], in_ref["throttle"]))
        reasons["slow"] = v < (1 - SPEED_DROP) * ref_v
        reasons["lift"] = (ref_t >= FULL_THROTTLE) & (car["throttle"].to_numpy() <= LIFT)
        reasons["crawl"] = (v < CRAWL_KMH) & (ref_v > CRAWL_REF_KMH)
    return reasons


def onset(car, stop_idx, incident_lap, laps_before, pit_mask=None, neutral_mask=None, in_laps=()):
    """Proposed onset: start of the final departure run that reaches the stop (or the end of the data).

    Returns (onset index label or None, reason string). A run is a chain of departing samples with
    no gap longer than JOIN_S; the onset is its first sample, and its reason is the condition(s)
    that fired there. None means the car looked normal right up to the stop (e.g. a car called in
    and retired in the garage) or there were no reference laps and no impossible state.

    `pit_mask` and `neutral_mask` (aligned with `car`) mark the pit lane (speed limit: nothing
    there counts) and safety-car / VSC / red-flag periods (everyone slows: only impossible states
    and crawling count). The run must reach the last unmasked sample before the stop, so a car that
    drove into the pits looking normal gets None. `in_laps` are the car's earlier in-laps, used as
    a second reference when it ended in the pit lane.
    """
    upto = car.loc[:stop_idx] if stop_idx is not None else car
    keep = (upto["lap_number"] >= incident_lap - 1).to_numpy(dtype=bool, na_value=False)
    pm = np.zeros(len(upto), bool) if pit_mask is None else np.asarray(pit_mask.loc[upto.index], bool)
    nm = np.zeros(len(upto), bool) if neutral_mask is None else np.asarray(neutral_mask.loc[upto.index], bool)
    upto, pm, nm = upto[keep], pm[keep], nm[keep]
    ref = reference(car, laps_before)
    in_ref = reference(car, in_laps, min_laps=1) if len(in_laps) else None
    r = departures(upto, ref, in_ref)
    r.loc[nm, ["slow", "lift"]] = False
    r[pm] = False
    dep = r.any(axis=1).to_numpy()
    if not dep.any():
        return None, "no departure" if ref is not None else "no reference laps"
    t = upto["date"].to_numpy()
    idx = np.flatnonzero(dep)
    free = ~(pm | nm)
    end = t[np.flatnonzero(free)[-1]] if free.any() else t[-1]
    # the run must reach the end: its last departing sample within JOIN_S of the last unmasked sample
    if (end - t[idx[-1]]) / np.timedelta64(1, "s") > JOIN_S:
        return None, "no departure before the stop"
    gaps = np.diff(t[idx]) / np.timedelta64(1, "s")
    start = idx[np.r_[0, np.flatnonzero(gaps > JOIN_S) + 1][-1]]
    why = "+".join(c for c in r.columns if r.iloc[start][c])
    return upto.index[start], why if ref is not None else why + " (no reference laps)"


# ---------------------------------------------------------------- negatives

def negative_laps(laps, finishers):
    """Clean laps of cars that finished the race: the negatives.

    `laps` is the B2 lap table (session_key, driver_number, clean, ...); `finishers` has the
    session_key and driver_number of every car classified with a time, gap or laps down. Cars
    in labels.csv didn't finish, so they are never in `finishers`.
    """
    f = finishers[["session_key", "driver_number"]].drop_duplicates()
    return laps[laps["clean"].astype(bool)].merge(f, on=["session_key", "driver_number"])
