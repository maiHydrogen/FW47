"""Telemetry anomaly rules, ported unchanged from the Forge app (plan step B3).

Source: src/services/anomalyDetection.js and src/services/telemetryBaseline.js
(tag v0-codegeist-prototype). Thresholds, priorities, rule order and the
priority/incident-type/confidence logic are identical, so the B3 audit measures
the rules the app actually shipped. tests/test_rules.py ports the JS tests.

Two ways of calling them, matching the two places the app used them:

- `detect_anomalies(sample)` on one telemetry snapshot (the radio poller and the
  Rovo `calculate-priority` action). `rule_hits(df)` is the vectorised version
  of the fixed rules, for running over millions of samples.
- `lap_analysis(samples)` for the Jira issue panel: each lap is collapsed into
  one snapshot (`summarize_telemetry_points`) and compared with a baseline built
  from the driver's previous two laps (`build_telemetry_baseline`).
"""

import math
from dataclasses import dataclass
from typing import Callable

import numpy as np
import pandas as pd

PRIORITY_WEIGHT = {"Critical": 4, "High": 3, "Medium": 2, "Low": 1}


@dataclass(frozen=True)
class Rule:
    incident_type: str
    priority: str
    reason: str
    # Works on a dict of scalars (NaN for missing) and on a DataFrame alike.
    test: Callable


# Ordered roughly most- to least-severe; order only matters as a tiebreaker
# when several rules fire at the same priority (first match wins for incident_type).
TELEMETRY_RULES = [
    Rule("emergency-braking", "Critical", "Emergency braking at high speed (>250 km/h)",
         lambda t: (t["brake"] == 100) & (t["speed"] > 250)),
    Rule("engine-stall", "Critical", "Engine cutout detected while car still at speed (RPM=0)",
         lambda t: (t["rpm"] == 0) & (t["speed"] > 80)),
    Rule("gearbox-failure", "Critical",
         "Car in neutral at high speed with engine running - possible gearbox failure",
         lambda t: (t["n_gear"] == 0) & (t["speed"] > 100) & (t["rpm"] > 0)),
    Rule("drs-failure", "Critical", "DRS still open under braking - safety-critical DRS failure",
         lambda t: (t["drs"] > 10) & (t["brake"] == 100)),
    Rule("power-unit", "High", "Possible power unit issue - no throttle response",
         lambda t: (t["throttle"] == 0) & (t["speed"] < 50) & (t["rpm"] > 0)),
    Rule("potential-issue", "Medium", "Low speed with reduced throttle - potential issue",
         lambda t: (t["speed"] < 100) & (t["throttle"] < 30)),
]

URGENT_KEYWORDS = ["box", "problem", "damage", "retire", "issue", "critical", "broken"]

MIN_BASELINE_SAMPLES = 5
BASELINE_MEDIUM_Z = -2
BASELINE_HIGH_Z = -3

FIELDS = ["speed", "rpm", "throttle", "brake", "n_gear", "drs"]


def _num(v):
    """JS `typeof v === 'number' && !isNaN(v)`: anything else becomes NaN, which fails every comparison."""
    if isinstance(v, bool) or not isinstance(v, (int, float, np.integer, np.floating)) or v != v:
        return math.nan
    return v


def normalize_telemetry(telemetry):
    t = telemetry if isinstance(telemetry, dict) else {}
    return {k: _num(t.get(k)) for k in FIELDS}


def _higher_priority(a, b):
    return a if PRIORITY_WEIGHT[a] >= PRIORITY_WEIGHT[b] else b


def _js_round(x):
    return math.floor(x + 0.5)


def detect_anomalies(telemetry_raw, radio_message=None, baseline=None):
    """Port of detectAnomalies(): same output keys, same values."""
    t = normalize_telemetry(telemetry_raw)
    reliable = bool(baseline) and baseline["sampleSize"] >= MIN_BASELINE_SAMPLES
    rules = [r for r in TELEMETRY_RULES if not (reliable and r.incident_type == "potential-issue")]
    matches = [{"incidentType": r.incident_type, "priority": r.priority, "reason": r.reason}
               for r in rules if bool(r.test(t))]

    if reliable and not math.isnan(t["speed"]):
        z = (t["speed"] - baseline["avgSpeed"]) / baseline["stdSpeed"] if baseline["stdSpeed"] > 0 else 0
        if z <= BASELINE_MEDIUM_Z:
            matches.append({
                "incidentType": "potential-issue",
                "priority": "High" if z <= BASELINE_HIGH_Z else "Medium",
                "reason": (f"Speed {_js_round(t['speed'])} km/h is {abs(z):.1f} std dev below this driver's own "
                           f"baseline ({_js_round(baseline['avgSpeed'])} km/h avg over {baseline['sampleSize']} laps)"
                           " - possible pace loss"),
            })

    priority = "Low"
    for m in matches:
        priority = _higher_priority(priority, m["priority"])
    reasons = [m["reason"] for m in matches]
    incident_type = next((m["incidentType"] for m in matches if m["priority"] == priority),
                         matches[0]["incidentType"] if matches else None)

    if isinstance(radio_message, str) and radio_message:
        if any(kw in radio_message.lower() for kw in URGENT_KEYWORDS):
            priority = _higher_priority(priority, "High")
            reasons.append("Urgent keywords detected in radio message")

    return {
        "priority": priority,
        "reasons": reasons,
        "reasoning": "; ".join(reasons) or "No critical issues detected",
        "confidence": min(0.85 + 0.03 * (len(reasons) - 1), 0.95) if reasons else 0.50,
        "incidentType": incident_type,
    }


def rule_hits(df):
    """One boolean column per fixed rule, for every row of a sample DataFrame.

    Equivalent to running detect_anomalies() without a baseline or radio message
    on each row and recording which rules matched. Missing values never match.
    """
    t = {k: pd.to_numeric(df[k], errors="coerce").astype(float) for k in FIELDS}
    return pd.DataFrame({r.incident_type: r.test(t).to_numpy(bool) for r in TELEMETRY_RULES}, index=df.index)


# ---------------------------------------------------------------- baseline (telemetryBaseline.js)

def build_telemetry_baseline(points, min_samples=MIN_BASELINE_SAMPLES):
    """Port of buildTelemetryBaseline(): population std of speed and throttle."""
    if not isinstance(points, list):
        return None
    valid = [p for p in points if isinstance(p, dict)
             and not math.isnan(_num(p.get("speed"))) and not math.isnan(_num(p.get("throttle")))]
    if len(valid) < min_samples:
        return None
    speeds = np.array([p["speed"] for p in valid], float)
    throttles = np.array([p["throttle"] for p in valid], float)
    return {"avgSpeed": speeds.mean(), "stdSpeed": speeds.std(), "avgThrottle": throttles.mean(),
            "stdThrottle": throttles.std(), "sampleSize": len(valid)}


def summarize_telemetry_points(points):
    """Port of summarizeTelemetryPoints(): averages speed/throttle/rpm, takes the max of brake/n_gear/drs.

    Missing values count as 0, as in the JS (`p[key] || 0`, where NaN is falsy too).
    """
    if not isinstance(points, list) or not points:
        return None
    col = lambda k: [0 if (v := p.get(k)) is None or v != v else v for p in points]
    avg = lambda k: sum(col(k)) / len(points)
    return {"speed": avg("speed"), "throttle": avg("throttle"), "brake": max(col("brake")),
            "rpm": avg("rpm"), "n_gear": max(col("n_gear")), "drs": max(col("drs"))}


def lap_analysis(samples):
    """What the Jira issue panel showed for every lap of every car.

    `samples` has driver_number, lap_number and the FIELDS columns (one row per
    car_data sample). For lap n the app summarises lap n's samples and builds a
    baseline from all samples of laps n-2 and n-1. Vectorised, but the same
    arithmetic as summarize_telemetry_points / build_telemetry_baseline /
    detect_anomalies (tests check them against each other).
    """
    s = samples.dropna(subset=["lap_number"]).copy()
    for k in FIELDS:
        s[k] = pd.to_numeric(s[k], errors="coerce").astype(float)
    g = s.groupby(["driver_number", "lap_number"])
    filled = s[FIELDS].fillna(0)
    snap = pd.concat([filled[["speed", "throttle", "rpm"]].groupby([s["driver_number"], s["lap_number"]]).mean(),
                      filled[["brake", "n_gear", "drs"]].groupby([s["driver_number"], s["lap_number"]]).max()], axis=1)

    # Baseline: pooled stats of the previous two lap numbers (only samples with numeric speed and throttle).
    ok = s["speed"].notna() & s["throttle"].notna()
    v = s.loc[ok, "speed"]
    per_lap = pd.DataFrame({"n": v.groupby([s["driver_number"], s["lap_number"]]).size(),
                            "sum": v.groupby([s["driver_number"], s["lap_number"]]).sum(),
                            "sq": (v ** 2).groupby([s["driver_number"], s["lap_number"]]).sum()})
    out = snap.reset_index()
    base = pd.DataFrame(0.0, index=out.index, columns=["n", "sum", "sq"])
    for back in (1, 2):
        key = pd.MultiIndex.from_arrays([out["driver_number"], out["lap_number"] - back])
        base += per_lap.reindex(key).fillna(0).to_numpy()
    out["base_n"] = base["n"].astype(int).to_numpy()
    mean = base["sum"] / base["n"].where(base["n"] > 0)
    out["base_avg"] = mean.to_numpy()
    out["base_std"] = np.sqrt(np.clip(base["sq"] / base["n"].where(base["n"] > 0) - mean ** 2, 0, None)).to_numpy()

    results = [detect_anomalies(
        {k: getattr(r, k) for k in FIELDS}, None,
        {"avgSpeed": r.base_avg, "stdSpeed": r.base_std, "sampleSize": r.base_n} if r.base_n >= MIN_BASELINE_SAMPLES else None)
        for r in out.itertuples()]
    out["priority"] = [r["priority"] for r in results]
    out["incidentType"] = [r["incidentType"] for r in results]
    out["n_reasons"] = [len(r["reasons"]) for r in results]
    return out
