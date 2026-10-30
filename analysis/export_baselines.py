"""Export the v1 speed baselines for the scorer (plan step B4 -> A4).

Pools the clean samples of the given seasons per circuit and writes
    pipeline/baselines/speed_v1.csv   one row per circuit and 25 m bin
    pipeline/baselines/speed_v1.json  how it was built, and the detector settings

The files are small (~200 KB) so the scorer can load them without the data/ folder.

Usage:
    .venv/bin/python analysis/export_baselines.py --seasons 2024
"""

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
from fw47_core import baseline as bl

CLEAN = ROOT / "data" / "clean" / "samples"
OUT = ROOT / "pipeline" / "baselines"


def main():
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--seasons", type=int, nargs="+", required=True)
    args = p.parse_args()

    per_circuit = {}
    for season in args.seasons:
        sessions = pd.read_parquet(ROOT / "data" / "parquet" / "sessions" / f"season={season}" / "sessions.parquet")
        circuits = sessions.set_index("session_key")[["circuit_key", "circuit_short_name"]]
        for f in sorted((CLEAN / f"season={season}").glob("*.parquet")):
            s = pd.read_parquet(f, columns=["driver_number", "lap_number", "lap_distance_m", "speed", "clean"])
            s = s[s["clean"]].drop(columns="clean")
            s["driver_number"] = season * 100 + s["driver_number"]   # keep laps distinct across seasons
            ck, name = circuits.loc[int(f.stem)]
            per_circuit.setdefault((int(ck), name), []).append(s)

    rows = []
    for (ck, name), parts in sorted(per_circuit.items()):
        s = pd.concat(parts, ignore_index=True)
        if s.empty:
            continue
        rows.append(bl.build_v1(s).assign(circuit_key=ck, circuit_short_name=name))
    out = pd.concat(rows, ignore_index=True)
    cols = ["circuit_key", "circuit_short_name", "bin", "start_m", "centre_m", "expected_kmh", "scale_kmh", "n_laps", "n_samples"]
    OUT.mkdir(parents=True, exist_ok=True)
    out[cols].round({"expected_kmh": 2, "scale_kmh": 2}).to_csv(OUT / "speed_v1.csv", index=False)
    meta = {
        "version": "speed_v1",
        "built_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "seasons": args.seasons,
        "circuits": int(out["circuit_key"].nunique()),
        "bin_m": bl.BIN_M,
        "distance": "raw integrated lap_distance_m (B2), metres from the timing line",
        "expected": "median speed of clean laps, interpolated between bin centres",
        "scale": f"max({bl.MAD_TO_SD} * MAD of residuals, {bl.MIN_SCALE_KMH} km/h)",
        "v2": {"laps": bl.V2_LAPS, "min_laps": bl.V2_MIN_LAPS,
               "rule": "expected * (1 + median relative residual over the car's previous clean laps)"},
        "detector": {"k": bl.DEFAULT_K, "d_s": bl.DEFAULT_D_S, "sample_gap_s": bl.SAMPLE_GAP_S,
                     "blue_flag_window_s": bl.BLUE_FLAG_WINDOW_S, "status": "provisional until B6"},
    }
    (OUT / "speed_v1.json").write_text(json.dumps(meta, indent=2) + "\n")
    print(f"{len(out):,} rows for {meta['circuits']} circuits -> {OUT}")


if __name__ == "__main__":
    main()
