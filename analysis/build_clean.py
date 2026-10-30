"""Run the B2 cleaning over every downloaded session and write the results.

Reads data/parquet/ (from download.py) and writes, per session:
    data/clean/laps/season=<year>/<session_key>.parquet
    data/clean/samples/season=<year>/<session_key>.parquet

Only sessions with car data are processed. One session at a time keeps memory
around 1-2 GB.

Usage:
    .venv/bin/python analysis/build_clean.py --seasons 2024
"""

import argparse
import time
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
from fw47_core.clean import clean_session

RAW = ROOT / "data" / "parquet"
OUT = ROOT / "data" / "clean"
TABLES = ["car_data", "location", "laps", "stints", "race_control", "weather"]


def load(table, season, key):
    f = RAW / table / f"season={season}" / f"{key}.parquet"
    return pd.read_parquet(f) if f.exists() else pd.DataFrame()


def main():
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--seasons", type=int, nargs="+", default=[2024])
    p.add_argument("--sessions", type=int, nargs="*", help="only these session keys")
    args = p.parse_args()
    for season in args.seasons:
        keys = sorted(int(f.stem) for f in (RAW / "car_data" / f"season={season}").glob("*.parquet"))
        for key in keys:
            if args.sessions and key not in args.sessions:
                continue
            t = time.time()
            lt, samples = clean_session(*(load(tb, season, key) for tb in TABLES))
            for name, df in [("laps", lt), ("samples", samples)]:
                out = OUT / name / f"season={season}" / f"{key}.parquet"
                out.parent.mkdir(parents=True, exist_ok=True)
                df.to_parquet(out, index=False)
            print(f"[{season}] {key}: {len(samples):,} samples, {lt['clean'].mean():.0%} clean laps, "
                  f"{time.time() - t:.0f}s", flush=True)


if __name__ == "__main__":
    main()
