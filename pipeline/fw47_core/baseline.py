"""Contextual speed baselines and the slowdown detector (plan step B4).

The B3 audit showed fixed thresholds can't work: "slow" depends on where the car
is on the lap. Here "normal" is learned per track and per point of the lap:

- v1 (`build_v1`): for each track and each 25 m of lap distance, the median speed
  of clean laps and a robust spread (1.4826 x MAD of the residuals). Between bin
  centres the expected speed is interpolated, so braking zones aren't smeared.
- v2 (`car_offsets`): the same, scaled by the car's own pace this race: the median
  relative residual over its last few clean laps (causal: only earlier laps).

`robust_z` scores samples against a baseline; `detect` turns z-scores into alert
episodes ("z < -k for at least d seconds"); `severity` gives each one a score
and a Jira priority.

Distance is the raw integrated `lap_distance_m` from B2, not the normalised one:
a live scorer can't know a lap's final length until the lap ends.
"""

import numpy as np
import pandas as pd

BIN_M = 25
MAD_TO_SD = 1.4826
MIN_SCALE_KMH = 3.0      # floor on the spread, so a near-constant bin can't produce huge z
V2_LAPS = 5              # car offset: median over this many previous clean laps
V2_MIN_LAPS = 3          # ... and only once the car has at least this many
SAMPLE_GAP_S = 1.0       # an episode is broken by a gap in the data longer than this
# Provisional detector settings from B4 (false alerts only); B6 picks the final
# ones on the labelled 2023-2024 data.
DEFAULT_K = 6.0
DEFAULT_D_S = 2.0


# ---------------------------------------------------------------- v1

def _interp(baseline, dist, col):
    """Linear interpolation of a per-bin column at bin centres; flat beyond the ends."""
    return np.interp(dist, baseline["centre_m"].to_numpy(), baseline[col].to_numpy())


def build_v1(samples, bin_m=BIN_M):
    """Baseline for one track from its clean samples (lap_distance_m, speed, driver_number, lap_number).

    Two passes: the median speed per bin gives the expected speed (interpolated
    between bin centres); the spread is the MAD of residuals from that curve.
    """
    s = samples.dropna(subset=["lap_distance_m", "speed"])
    b = (s["lap_distance_m"] // bin_m).astype(int)
    g = s.groupby(b)
    base = pd.DataFrame({"expected_kmh": g["speed"].median(),
                         "n_samples": g.size(),
                         "n_laps": (s["driver_number"] * 1000 + s["lap_number"]).groupby(b).nunique()})
    base.index.name = "bin"
    base = base.reset_index()
    base["start_m"] = base["bin"] * bin_m
    base["centre_m"] = base["start_m"] + bin_m / 2
    resid = (s["speed"] - _interp(base, s["lap_distance_m"], "expected_kmh")).abs()
    mad = resid.groupby(b).median().reindex(base["bin"]).to_numpy()
    base["scale_kmh"] = np.maximum(MAD_TO_SD * mad, MIN_SCALE_KMH)
    return base[["bin", "start_m", "centre_m", "expected_kmh", "scale_kmh", "n_laps", "n_samples"]]


def expected(baseline, dist):
    """Expected speed and spread at each lap distance."""
    return _interp(baseline, dist, "expected_kmh"), _interp(baseline, dist, "scale_kmh")


# ---------------------------------------------------------------- v2

def car_offsets(samples, exp_kmh, clean, n_laps=V2_LAPS, min_laps=V2_MIN_LAPS):
    """Per-sample relative pace offset of each car, from its *previous* clean laps only.

    For each clean lap: r = median of (speed / expected - 1). For any lap L of a
    car, the offset is the median r of that car's last `n_laps` clean laps that
    started before L, or 0 while it has fewer than `min_laps` of them.
    """
    rel = pd.Series(np.asarray(samples["speed"], float) / exp_kmh - 1, index=samples.index)
    clean = np.asarray(clean, bool)
    r = rel[clean].groupby([samples["driver_number"][clean], samples["lap_number"][clean]]).median()
    offsets = {}
    for (drv, laps) in samples[["driver_number", "lap_number"]].drop_duplicates().dropna().groupby("driver_number")["lap_number"]:
        hist = r.get(drv, pd.Series(dtype=float)).sort_index()
        for lap in laps:
            prev = hist[hist.index < lap].to_numpy()[-n_laps:]
            offsets[(drv, lap)] = float(np.median(prev)) if len(prev) >= min_laps else 0.0
    keys = list(zip(samples["driver_number"], samples["lap_number"]))
    return np.array([offsets.get(k, 0.0) for k in keys])


# ---------------------------------------------------------------- scoring

def robust_z(speed, exp_kmh, scale_kmh):
    return (np.asarray(speed, float) - exp_kmh) / scale_kmh


def detect(s, k, d_s, z_col="z", gap_s=SAMPLE_GAP_S):
    """Alert episodes: runs of z < -k lasting at least d_s seconds.

    `s` has driver_number, date and `z_col`, sorted by driver_number then date.
    A run ends at the first sample that isn't below -k, or at a data gap longer
    than `gap_s`. Its duration is last - first below-threshold sample, so
    d_s = 0 alerts on a single sample. `alert_at` is when a live detector would
    fire (the first sample with duration >= d_s), so `alert_at - start` is the
    detector's own delay.
    """
    below = (s[z_col] < -k).to_numpy()
    drv = s["driver_number"].to_numpy()
    t = s["date"].astype("int64").to_numpy() / 1e9
    new = np.r_[True, (drv[1:] != drv[:-1]) | (np.diff(t) > gap_s) | ~below[:-1]]
    run = np.cumsum(new)
    df = pd.DataFrame({"run": run[below], "t": t[below], "z": s[z_col].to_numpy()[below], "i": np.flatnonzero(below)})
    id_cols = [c for c in ("driver_number", "lap_number") if c in s]
    cols = id_cols + ["first_i", "start", "alert_at", "end", "duration_s", "z_min"]
    if df.empty:
        return pd.DataFrame(columns=cols)
    g = df.groupby("run")
    ep = pd.DataFrame({"first_i": g["i"].first(), "last_i": g["i"].last(),
                       "start_t": g["t"].first(), "z_min": g["z"].min()})
    ep["duration_s"] = g["t"].last() - ep["start_t"]
    ep = ep[ep["duration_s"] >= d_s].copy()
    # first sample at which the run has lasted d_s
    df = df[df["run"].isin(ep.index)].copy()
    df["elapsed"] = df["t"] - df["run"].map(ep["start_t"])
    ep["alert_i"] = df[df["elapsed"] >= d_s].groupby("run")["i"].first()
    ep = ep.reset_index(drop=True)
    for col, idx in (("start", "first_i"), ("end", "last_i"), ("alert_at", "alert_i")):
        ep[col] = s["date"].iloc[ep[idx].to_numpy()].to_numpy()   # exact sample timestamps
    ids = s.iloc[ep["first_i"].to_numpy()]
    for c in id_cols:
        ep[c] = ids[c].to_numpy()
    return ep[cols]


# ---------------------------------------------------------------- severity

# Impossible-state rules kept from B3 are binary facts, not degrees of slowness:
# they go straight to Critical. Slowdowns get a score.
IMPOSSIBLE_STATE = {"engine-stall", "gearbox-failure", "drs-stuck-open"}
Z_FULL = 20.0        # depth: z of -20 or below counts as maximal
DURATION_FULL_S = 10.0
PRIORITY_BANDS = [(75, "Critical"), (50, "High"), (25, "Medium"), (0, "Low")]


def severity(z_min, duration_s, incident_type="slowdown"):
    """Severity score 0-100 and Jira priority for an alert episode.

        depth    D = min(1, -z_min / 20)
        duration T = min(1, duration_s / 10 s)
        score      = 100 * (D + T) / 2              for slowdowns
        score      = 100 (Critical)                 for impossible-state rules

    Priority bands: >= 75 Critical, >= 50 High, >= 25 Medium, else Low. A car
    rolling to a stop (z far below -20, lasting 10 s+) scores 100; a 2 s lift
    at z = -5 scores ~22 (Low).
    """
    if incident_type in IMPOSSIBLE_STATE:
        return 100.0, "Critical"
    d = np.clip(-np.asarray(z_min, float) / Z_FULL, 0, 1)
    t = np.clip(np.asarray(duration_s, float) / DURATION_FULL_S, 0, 1)
    score = 100 * (d + t) / 2
    prio = np.select([score >= b for b, _ in PRIORITY_BANDS[:-1]], [p for _, p in PRIORITY_BANDS[:-1]], "Low")
    return score, prio


# ---------------------------------------------------------------- context

BLUE_FLAG_WINDOW_S = 30.0


def blue_flags(race_control):
    """Times at which each car was shown a blue flag (being lapped: it must let faster cars by)."""
    b = race_control[(race_control["flag"] == "BLUE") & race_control["driver_number"].notna()]
    return b[["driver_number", "date"]].astype({"driver_number": int}).sort_values("date")


def after_blue_flag(driver_number, at, blue, window_s=BLUE_FLAG_WINDOW_S):
    """True where the car was shown a blue flag in the `window_s` seconds before `at`.

    Causal: only flags already shown when the alert would fire count, which is
    what a live scorer would know. Lapped cars lift to let leaders through, which
    the B4 audit found behind ~3/4 of the remaining false alerts.
    """
    out = np.zeros(len(at), bool)
    w = pd.Timedelta(seconds=window_s)
    for i, (d, t) in enumerate(zip(driver_number, at)):
        times = blue.loc[blue["driver_number"] == d, "date"]
        out[i] = ((times <= t) & (times >= t - w)).any()
    return out
