"""Score every 2024 sample against the B4 contextual baselines (cross-fitted).

For each race and each car, the v1 baseline is built from the *other* cars'
clean laps in that race (leave-one-car-out), so a car is never scored against
its own laps. v2 adds the car's own pace offset from its previous clean laps.

Writes data/scored/b4/season=<year>/<session_key>.parquet with, per in-lap
sample: expected speed and spread, z (v1) and z2 (v2), plus the columns the
notebook needs. Also writes the full (not cross-fitted) per-track v1 baselines
to data/scored/b4/baselines_<year>.parquet.

With --baseline-seasons, the v1 baseline instead comes from those seasons'
clean laps at the same circuit (the cross-season check: a 2023 baseline scoring
2024, as the live scorer would use last year's data). Output then goes to
data/scored/b4_from_<seasons>/. Circuits without a baseline in those seasons
are skipped.

Usage:
    .venv/bin/python analysis/score_b4.py --seasons 2024
    .venv/bin/python analysis/score_b4.py --seasons 2024 --baseline-seasons 2023
"""

import argparse
import time
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
from fw47_core.baseline import build_v1, car_offsets, expected, robust_z

CLEAN = ROOT / "data" / "clean"
OUT = ROOT / "data" / "scored" / "b4"
COLS = ["session_key", "driver_number", "lap_number", "date", "speed", "rpm", "throttle", "brake", "n_gear", "drs",
        "lap_distance_m", "x", "y", "in_lap", "clean", "missing_duration", "pit_in", "pit_out", "standing_start",
        "safety_car", "vsc", "red_flag", "yellow", "wet_tyres", "rain"]


def prior_baselines(seasons):
    """v1 baseline per circuit_key from the clean laps of `seasons` (pooled)."""
    parts = {}
    for season in seasons:
        circuits = pd.read_parquet(ROOT / "data" / "parquet" / "sessions" / f"season={season}" / "sessions.parquet"
                                   ).set_index("session_key")["circuit_key"]
        for f in sorted((CLEAN / "samples" / f"season={season}").glob("*.parquet")):
            s = pd.read_parquet(f, columns=["driver_number", "lap_number", "lap_distance_m", "speed", "clean"])
            s = s[s["clean"]].assign(driver_number=lambda d: season * 100 + d["driver_number"])
            parts.setdefault(int(circuits.loc[int(f.stem)]), []).append(s)
    return {ck: build_v1(pd.concat(p, ignore_index=True)) for ck, p in parts.items()
            if sum(len(x) for x in p)}


def score_session(s, prior=None):
    """Score one session. `prior` is a fixed v1 baseline; without it, leave-one-car-out."""
    s = s[s["in_lap"]].sort_values(["driver_number", "date"]).reset_index(drop=True)
    for c in COLS[14:]:
        s[c] = s[c].astype("boolean").fillna(False).astype(bool)
    s["exp_kmh"] = np.nan
    s["scale_kmh"] = np.nan
    if prior is not None:
        s["exp_kmh"], s["scale_kmh"] = expected(prior, s["lap_distance_m"].to_numpy())
    for drv in ([] if prior is not None else s["driver_number"].unique()):
        mine = s["driver_number"] == drv
        base = build_v1(s[~mine & s["clean"]])
        if base.empty:   # no clean laps to learn from (Interlagos 2024 was wet throughout)
            continue
        e, sc = expected(base, s.loc[mine, "lap_distance_m"].to_numpy())
        s.loc[mine, "exp_kmh"], s.loc[mine, "scale_kmh"] = e, sc
    s["z"] = robust_z(s["speed"], s["exp_kmh"], s["scale_kmh"])
    s["offset"] = car_offsets(s, s["exp_kmh"].to_numpy(), s["clean"].to_numpy())
    s["exp2_kmh"] = s["exp_kmh"] * (1 + s["offset"])
    s["z2"] = robust_z(s["speed"], s["exp2_kmh"], s["scale_kmh"])
    return s


def main():
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--seasons", type=int, nargs="+", default=[2024])
    p.add_argument("--baseline-seasons", type=int, nargs="+", help="build v1 from these seasons instead")
    args = p.parse_args()
    prior = prior_baselines(args.baseline_seasons) if args.baseline_seasons else None
    out_dir = OUT if prior is None else OUT.with_name("b4_from_" + "_".join(map(str, args.baseline_seasons)))
    for season in args.seasons:
        sessions = pd.read_parquet(ROOT / "data" / "parquet" / "sessions" / f"season={season}" / "sessions.parquet")
        baselines = []
        for f in sorted((CLEAN / "samples" / f"season={season}").glob("*.parquet")):
            t = time.time()
            info = sessions.set_index("session_key").loc[int(f.stem)]
            if prior is not None and int(info["circuit_key"]) not in prior:
                print(f"[{season}] {info['circuit_short_name']}: no baseline in {args.baseline_seasons}, skipped")
                continue
            s = score_session(pd.read_parquet(f, columns=COLS),
                              None if prior is None else prior[int(info["circuit_key"])])
            out = out_dir / f"season={season}" / f.name
            out.parent.mkdir(parents=True, exist_ok=True)
            s.to_parquet(out, index=False)
            if s["clean"].any():
                baselines.append(build_v1(s[s["clean"]]).assign(
                    season=season, session_key=int(f.stem), circuit_key=int(info["circuit_key"]),
                    circuit_short_name=info["circuit_short_name"]))
            print(f"[{season}] {info['circuit_short_name']}: {len(s):,} samples, {time.time() - t:.0f}s", flush=True)
        if prior is None:
            pd.concat(baselines, ignore_index=True).to_parquet(OUT / f"baselines_{season}.parquet", index=False)


if __name__ == "__main__":
    main()
