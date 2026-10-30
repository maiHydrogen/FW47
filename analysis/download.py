"""Download F1 race data from OpenF1 and Jolpica into local Parquet tables.

fastf1 can't be used without an F1 account (F1's timing archive now returns 401),
so B1 uses the two free APIs instead:

- OpenF1 (https://openf1.org): car data, location, laps, stints, pit stops, race
  control, weather, positions, intervals and session results, 2023 onwards.
- Jolpica (https://api.jolpi.ca, the Ergast successor): results with a status
  per driver, used for retirement labels.

Every HTTP response is cached under data/raw_cache/, so re-running never
downloads the same thing twice. Tables are written to
data/parquet/<table>/season=<year>/<session_key>.parquet.

Usage:
    .venv/bin/python analysis/download.py --seasons 2023 2024 2025
    .venv/bin/python analysis/download.py --seasons 2024 --heavy
    .venv/bin/python analysis/download.py --seasons 2024 --heavy --max-races 2
"""

import argparse
import gzip
import hashlib
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
CACHE = DATA / "raw_cache"
PARQUET = DATA / "parquet"

OPENF1 = "https://api.openf1.org/v1/"
JOLPICA = "https://api.jolpi.ca/ergast/f1/"

# One request per session. "intervals" (gaps to the car ahead/leader) only
# exists from 2023 onwards, which matches our seasons.
LIGHT_TABLES = ["laps", "stints", "pit", "race_control", "weather",
                "session_result", "position", "intervals"]
# One request per driver per session; these are the big ones (~35k rows each).
HEAVY_TABLES = ["car_data", "location"]

MIN_SECONDS_BETWEEN_REQUESTS = 1.0
_last_request = 0.0


def fetch_json(url, retries=5):
    """GET a URL as JSON, using the on-disk cache and backing off on errors."""
    global _last_request
    path = CACHE / (hashlib.sha256(url.encode()).hexdigest()[:32] + ".json.gz")
    if path.exists():
        with gzip.open(path, "rt") as f:
            return json.load(f)

    for attempt in range(retries):
        wait = MIN_SECONDS_BETWEEN_REQUESTS - (time.time() - _last_request)
        if wait > 0:
            time.sleep(wait)
        _last_request = time.time()
        try:
            with urllib.request.urlopen(url, timeout=120) as r:
                data = json.load(r)
            break
        except urllib.error.HTTPError as e:
            # OpenF1 answers 404 when a table has no rows for the query.
            if e.code == 404:
                data = []
                break
            if e.code not in (429, 500, 502, 503, 504) or attempt == retries - 1:
                raise
            delay = float(e.headers.get("Retry-After") or 2 ** (attempt + 1))
        except (urllib.error.URLError, TimeoutError):
            if attempt == retries - 1:
                raise
            delay = 2 ** (attempt + 1)
        print(f"  retrying in {delay:.0f}s: {url}", file=sys.stderr)
        time.sleep(delay)

    path.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(path, "wt") as f:
        json.dump(data, f)
    return data


def to_frame(rows):
    df = pd.DataFrame(rows)
    for col in ("date", "date_start", "date_end"):
        if col in df:
            df[col] = pd.to_datetime(df[col], format="ISO8601", utc=True)
    # Some columns mix numbers and text, e.g. gap_to_leader is 1.234 or "+1 LAP".
    # Parquet needs one type per column, so store those as text and parse later.
    for col in df.columns[df.dtypes == object]:
        kinds = {type(v) for v in df[col].dropna()}
        if len(kinds) > 1 or kinds & {list, dict}:
            df[col] = df[col].map(lambda v: None if v is None or v != v else str(v))
    return df


def write(df, table, season, name):
    out = PARQUET / table / f"season={season}" / f"{name}.parquet"
    out.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(out, index=False)


def race_sessions(season):
    return to_frame(fetch_json(f"{OPENF1}sessions?year={season}&session_name=Race"))


def jolpica_results(season):
    """All race results for a season with each driver's status (paginated)."""
    rows, offset = [], 0
    while True:
        m = fetch_json(f"{JOLPICA}{season}/results.json?limit=100&offset={offset}")["MRData"]
        for race in m["RaceTable"]["Races"]:
            for r in race["Results"]:
                rows.append({
                    "season": int(race["season"]),
                    "round": int(race["round"]),
                    "race_name": race["raceName"],
                    "race_date": race["date"],
                    "circuit_id": race["Circuit"]["circuitId"],
                    "driver_number": int(r["number"]),
                    "driver_code": r["Driver"].get("code"),
                    "grid": int(r["grid"]),
                    "position": int(r["position"]),
                    "laps": int(r["laps"]),
                    "status": r["status"],
                })
        offset += int(m["limit"])
        if offset >= int(m["total"]):
            return pd.DataFrame(rows)


def download_season(season, heavy, max_races):
    sessions = race_sessions(season).sort_values("date_start")
    sessions = sessions[sessions["is_cancelled"] != True] if "is_cancelled" in sessions else sessions
    if max_races:
        sessions = sessions.head(max_races)
    write(sessions, "sessions", season, "sessions")
    write(jolpica_results(season), "jolpica_results", season, "results")

    for i, s in enumerate(sessions.itertuples(), 1):
        key = s.session_key
        print(f"[{season}] {i}/{len(sessions)} {s.circuit_short_name} (session {key})")
        for table in LIGHT_TABLES:
            write(to_frame(fetch_json(f"{OPENF1}{table}?session_key={key}")), table, season, key)
        if not heavy:
            continue
        drivers = pd.read_parquet(PARQUET / "session_result" / f"season={season}" / f"{key}.parquet")
        for table in HEAVY_TABLES:
            parts = [to_frame(fetch_json(f"{OPENF1}{table}?session_key={key}&driver_number={d}"))
                     for d in sorted(drivers["driver_number"].unique())]
            write(pd.concat(parts, ignore_index=True), table, season, key)


def main():
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--seasons", type=int, nargs="+", default=[2024])
    p.add_argument("--heavy", action="store_true", help="also download car_data and location")
    p.add_argument("--max-races", type=int, help="only the first N races per season (for testing)")
    args = p.parse_args()
    for season in args.seasons:
        download_season(season, args.heavy, args.max_races)


if __name__ == "__main__":
    main()
