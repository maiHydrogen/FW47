"""Raw rule hits vs incidents for replayed races (the A5 evidence table).

Runs the replay through the scorer and the aggregator in one process, in source time (no Redis), at the
recorded ~4 Hz: the scorer gives the same alerts at 50 Hz (test_scorer). Prints a table and writes it to
bench/results/incidents.json.

    .venv/bin/python -I bench/incidents.py 2024:9472 2024:9488
"""

import argparse
import json
from collections import Counter
from pathlib import Path

from service.incidents import DEFAULT_TYPES, Aggregator
from service.schema import Deviation
from service.scorer import Scorer, load_baselines
from service.sources import ReplaySource

ROOT = Path(__file__).resolve().parents[1]


def race(season, session_key, curves, params):
    src = ReplaySource(ROOT / "data", season, session_key, deterministic=True, hz=None)
    info = src.session_info()
    sc = Scorer(curves, params, watermark_s=1.0, clock=lambda: 0.0)
    sc.start_session(session_key, int(info["circuit_key"]))
    scored = [m for msg in src.messages() for m in sc.process(msg)]
    devs = [d for d in scored if isinstance(d, Deviation)]
    row = {"race": f"{season} {info['circuit_short_name']} ({session_key})",
           "rule_hits": dict(Counter(d.type for d in devs if d.phase == "open"))}
    for name, types in (("delivered", DEFAULT_TYPES), ("all_types", (*DEFAULT_TYPES, "slowdown"))):
        agg = Aggregator(types=types)
        events = [e for m in scored for e in agg.process(m)]
        row[name] = dict(Counter(e.event for e in events))
        row[f"{name}_incidents_by_type"] = dict(Counter(json.loads(e.body)["type"] for e in events if e.event == "opened"))
    return row


def main():
    p = argparse.ArgumentParser()
    p.add_argument("races", nargs="+", help="season:session_key")
    args = p.parse_args()
    curves, params = load_baselines()
    rows = [race(int(s), int(k), curves, params) for s, k in (r.split(":") for r in args.races)]
    out = ROOT / "bench" / "results" / "incidents.json"
    out.write_text(json.dumps(rows, indent=1))
    for r in rows:
        print(r["race"])
        print("  rule hits (runs that alerted):", r["rule_hits"])
        print("  incidents, delivered types:   ", r["delivered_incidents_by_type"], r["delivered"])
        print("  incidents, slowdowns too:     ", r["all_types_incidents_by_type"], r["all_types"])
    print(f"written to {out}")


if __name__ == "__main__":
    main()
