"""Build analysis/labels.csv: one row per car that didn't finish a race (plan step B5).

Sources, per row:
- cause: the race-classification table of the Wikipedia race report (fetch_causes.py)
- class: `cause_class` in pipeline/fw47_core/labels.py, the mapping written down in
  analysis/labelling_rule.md
- stop time and place, and the proposed onset: the car's own telemetry (B2 clean
  samples), where it has been downloaded (2023-2024 so far; 2025 rows get these
  once its car data is in)
- rc_stopped: a race-control message naming the car as stopped

`onset_reviewed` and `review_note` are left for the review (05_labels.ipynb) and
are carried over from an existing labels.csv when it is rebuilt, so re-running
never loses reviewed onsets.

Usage:
    .venv/bin/python analysis/build_labels.py --seasons 2023 2024 2025
"""

import argparse
import re
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
from fw47_core import labels as lb
from fw47_core.clean import neutralised_periods

RAW = ROOT / "data" / "parquet"
CLEAN = ROOT / "data" / "clean"
OUT = ROOT / "analysis" / "labels.csv"
REVIEW_COLS = ["onset_reviewed", "review_note"]
SAMPLE_COLS = ["driver_number", "date", "lap_number", "speed", "rpm", "throttle", "n_gear", "brake",
               "lap_distance_m", "clean", "pit_in", "x", "y"]


def race_sessions(season):
    """Jolpica rounds matched to OpenF1 race session keys (by order, checked by date)."""
    ses = pd.read_parquet(RAW / "sessions" / f"season={season}" / "sessions.parquet")
    ses = ses[ses["session_type"].eq("Race") & ses["session_name"].eq("Race")].sort_values("date_start")
    rounds = (pd.read_parquet(RAW / "jolpica_results" / f"season={season}" / "results.parquet")
              .drop_duplicates("round").sort_values("round"))
    if len(ses) != len(rounds):
        raise ValueError(f"{season}: {len(ses)} OpenF1 races vs {len(rounds)} Jolpica rounds")
    days = (pd.to_datetime(ses["date_start"]).dt.tz_localize(None).dt.normalize().to_numpy()
            - pd.to_datetime(rounds["race_date"]).to_numpy()) / np.timedelta64(1, "D")
    if np.abs(days).max() > 1:
        raise ValueError(f"{season}: race dates don't line up")
    return dict(zip(rounds["round"], zip(ses["session_key"], ses["circuit_short_name"])))


def rc_stopped(season, session_key):
    """Car numbers race control reported as stopped."""
    rc = pd.read_parquet(RAW / "race_control" / f"season={season}" / f"{session_key}.parquet")
    msgs = rc.loc[rc["message"].str.contains("STOPPED", na=False), "message"]
    return {int(n) for m in msgs for n in re.findall(r"\b(\d+) \([A-Z]{3}\)", m)}


def timing(season, session_key, cars):
    """Stop and proposed onset for each car number in `cars`, from the cleaned samples."""
    path = CLEAN / "samples" / f"season={season}" / f"{session_key}.parquet"
    if not path.exists():
        return {}
    s = pd.read_parquet(path, columns=SAMPLE_COLS).sort_values(["driver_number", "date"]).reset_index(drop=True)
    for c in ("clean", "pit_in"):
        s[c] = s[c].astype("boolean").fillna(False).astype(bool)
    pit = pd.read_parquet(RAW / "pit" / f"season={season}" / f"{session_key}.parquet")
    lane = lb.pit_lane_points(s, pit)
    line = s.loc[s["clean"], ["x", "y"]].dropna().to_numpy(float)[::5]
    rc = pd.read_parquet(RAW / "race_control" / f"season={season}" / f"{session_key}.parquet")
    neutral = [p_ for k_, v in neutralised_periods(rc).items() if k_ != "yellow" for p_ in v]
    out = {}
    for drv in cars:
        car = s[s["driver_number"] == drv]
        if car.empty:
            out[drv] = dict(timing_note="no car data")
            continue
        if car["lap_number"].isna().all():
            out[drv] = dict(timing_note="car data but no laps")
            continue
        stop = lb.stop_time(car)
        last = car.loc[stop] if stop is not None else car.loc[car[car["speed"] > lb.STOP_KMH].index[-1]]
        lap = int(last["lap_number"]) if pd.notna(last["lap_number"]) else int(car["lap_number"].max())
        before = sorted(car.loc[car["clean"] & (car["lap_number"] < lap), "lap_number"].unique())
        in_pit = lb.in_pit_lane(car, lane, line)
        neut = np.zeros(len(car), bool)
        for a, b in neutral:
            neut |= car["date"].between(a, b, inclusive="left").to_numpy()
        where = ("pit lane" if lb.near(lane, last["x"], last["y"]) else "track") if stop is not None else ""
        if where == "pit lane":
            upto = car.loc[:stop]
            in_pit[:len(upto)] |= lb.pit_approach(upto, lane)
        in_laps = sorted(car.loc[car["pit_in"] & (car["lap_number"] < lap), "lap_number"].unique()) if where == "pit lane" else []
        on, why = lb.onset(car, stop, lap, before, pd.Series(in_pit, index=car.index),
                           pd.Series(neut, index=car.index), in_laps)
        row = dict(stop_time=last["date"] if stop is not None else pd.NaT,
                   last_moving=car.loc[car["speed"] >= lb.STOP_KMH, "date"].max(),
                   stop_lap=lap, stop_x=last["x"], stop_y=last["y"],
                   stop_where=where,
                   onset_auto=car.loc[on, "date"] if on is not None else pd.NaT, onset_reason=why,
                   timing_note="" if stop is not None else "never at rest for 30 s after its last fast lap")
        if on is not None and stop is not None:
            row["lead_s"] = (row["stop_time"] - row["onset_auto"]).total_seconds()
        out[drv] = row
    return out


def main():
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--seasons", type=int, nargs="+", required=True)
    args = p.parse_args()
    rows = []
    for season in args.seasons:
        cls = pd.read_parquet(RAW / "wiki_classification" / f"season={season}" / "classification.parquet")
        sessions = race_sessions(season)
        for rnd, race in cls[~cls["finished"]].groupby("round"):
            key, track = sessions[rnd]
            race = race.assign(cls=[lb.cause_class(c, p_) for c, p_ in zip(race["result"], race["pos_text"])])
            stopped = rc_stopped(season, key)
            tm = timing(season, key, race.loc[race["cls"] != "excluded", "driver_number"].tolist())
            for r in race.itertuples():
                rows.append(dict(
                    season=season, round=rnd, race=r.race_name, session_key=key, track=track,
                    driver_number=r.driver_number, driver=r.driver, constructor=r.constructor,
                    cause=r.result, **{"class": r.cls},
                    classified=r.pos_text[:1].isdigit(), laps_completed=r.laps,
                    cause_source=f"https://en.wikipedia.org/wiki/{season}_{r.race_name.replace(' ', '_')}",
                    rc_stopped=r.driver_number in stopped, **tm.get(r.driver_number, {})))
        print(f"[{season}] {sum(x['season'] == season for x in rows)} non-finishers", flush=True)
    out = pd.DataFrame(rows)
    if OUT.exists():   # keep reviewed onsets across rebuilds
        old = pd.read_csv(OUT, usecols=["season", "round", "driver_number"] + REVIEW_COLS)
        out = out.merge(old, on=["season", "round", "driver_number"], how="left")
    for c in REVIEW_COLS:
        if c not in out:
            out[c] = ""
    cols = ["season", "round", "race", "session_key", "track", "driver_number", "driver", "constructor", "cause",
            "class", "classified", "laps_completed", "stop_time", "last_moving", "stop_lap", "stop_where", "stop_x",
            "stop_y", "rc_stopped", "onset_auto", "onset_reason", "lead_s", "timing_note"] + REVIEW_COLS + ["cause_source"]
    out = out.reindex(columns=cols).sort_values(["season", "round", "driver_number"])
    out.to_csv(OUT, index=False)
    print(out.groupby(["season", "class"]).size().unstack(fill_value=0).to_string())


if __name__ == "__main__":
    main()
