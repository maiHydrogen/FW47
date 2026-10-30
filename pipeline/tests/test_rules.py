"""Ports of src/services/anomalyDetection.test.js and telemetryBaseline.test.js,
plus checks that the vectorised paths agree with the scalar ones."""

import re

import numpy as np
import pandas as pd
import pytest

from fw47_core.rules import (TELEMETRY_RULES, build_telemetry_baseline, detect_anomalies,
                             lap_analysis, rule_hits, summarize_telemetry_points)


# ---------------------------------------------------------------- anomalyDetection.test.js

def test_no_telemetry_no_radio_is_low():
    r = detect_anomalies({}, None)
    assert r["priority"] == "Low" and r["reasons"] == [] and r["incidentType"] is None
    assert r["confidence"] == 0.50


@pytest.mark.parametrize("t, priority, incident", [
    ({"brake": 100, "speed": 300}, "Critical", "emergency-braking"),
    ({"rpm": 0, "speed": 150, "throttle": 0}, "Critical", "engine-stall"),
    ({"n_gear": 0, "speed": 200, "rpm": 8000}, "Critical", "gearbox-failure"),
    ({"drs": 12, "brake": 100, "speed": 100}, "Critical", "drs-failure"),
    ({"throttle": 0, "speed": 30, "rpm": 5000}, "High", "power-unit"),
    ({"speed": 80, "throttle": 20}, "Medium", "potential-issue"),
    ({"speed": 95, "throttle": 20}, "Medium", "potential-issue"),
    ({"brake": 100, "speed": 300, "throttle": 20}, "Critical", "emergency-braking"),
])
def test_single_rules(t, priority, incident):
    r = detect_anomalies(t)
    assert r["priority"] == priority and r["incidentType"] == incident


def test_emergency_braking_reasoning():
    assert re.search("Emergency braking", detect_anomalies({"brake": 100, "speed": 300})["reasoning"])


def test_normal_green_flag_is_low():
    r = detect_anomalies({"speed": 300, "throttle": 100, "brake": 0, "rpm": 11000, "n_gear": 8, "drs": 12})
    assert r["priority"] == "Low" and r["reasons"] == []


def test_radio_keyword_escalates_low_to_high():
    r = detect_anomalies({"speed": 300, "throttle": 100}, "We've got a problem, box box")
    assert r["priority"] == "High" and "Urgent keywords" in r["reasoning"]


def test_radio_keyword_never_downgrades_critical():
    assert detect_anomalies({"brake": 100, "speed": 300}, "box box box")["priority"] == "Critical"


def test_malformed_telemetry_stays_low():
    assert detect_anomalies({"speed": "fast", "brake": "on"}, None)["priority"] == "Low"


def test_reliable_baseline_replaces_flat_threshold():
    r = detect_anomalies({"speed": 95, "throttle": 20}, None, {"avgSpeed": 100, "stdSpeed": 10, "sampleSize": 8})
    assert r["priority"] == "Low" and r["reasons"] == []


def test_pace_drop_vs_baseline_flagged():
    r = detect_anomalies({"speed": 250, "throttle": 60}, None, {"avgSpeed": 300, "stdSpeed": 10, "sampleSize": 6})
    assert r["incidentType"] == "potential-issue" and r["priority"] in ("Medium", "High")
    assert "std dev below" in r["reasoning"]


def test_large_drop_is_high():
    r = detect_anomalies({"speed": 260, "throttle": 60}, None, {"avgSpeed": 300, "stdSpeed": 10, "sampleSize": 6})
    assert r["priority"] == "High"


def test_thin_baseline_ignored():
    r = detect_anomalies({"speed": 95, "throttle": 20}, None, {"avgSpeed": 300, "stdSpeed": 5, "sampleSize": 2})
    assert r["priority"] == "Medium" and r["incidentType"] == "potential-issue"
    assert "std dev below" not in r["reasoning"]


def test_baseline_never_suppresses_safety_rule():
    r = detect_anomalies({"brake": 100, "speed": 300}, None, {"avgSpeed": 100, "stdSpeed": 5, "sampleSize": 10})
    assert r["priority"] == "Critical" and r["incidentType"] == "emergency-braking"


# ---------------------------------------------------------------- telemetryBaseline.test.js

def test_baseline_none_for_non_list():
    assert build_telemetry_baseline(None) is None
    assert build_telemetry_baseline("nope") is None


def test_baseline_none_when_too_few():
    assert build_telemetry_baseline([{"speed": 300, "throttle": 100}, {"speed": 290, "throttle": 95}]) is None


def test_baseline_filters_invalid_points():
    pts = [{"speed": 300, "throttle": 100}, {"speed": 290, "throttle": 95}, {"speed": "fast", "throttle": 90},
           {"throttle": 80}, {"speed": 310, "throttle": 98}, {"speed": 305, "throttle": 99},
           {"speed": 295, "throttle": 97}]
    assert build_telemetry_baseline(pts)["sampleSize"] == 5


def test_baseline_mean_and_std():
    b = build_telemetry_baseline([{"speed": 100, "throttle": 50}] * 5)
    assert b["avgSpeed"] == 100 and b["stdSpeed"] == 0


def test_baseline_custom_min_samples():
    pts = [{"speed": 300, "throttle": 100}, {"speed": 290, "throttle": 95}]
    assert build_telemetry_baseline(pts, min_samples=2)["sampleSize"] == 2


def test_summarize_empty():
    assert summarize_telemetry_points([]) is None and summarize_telemetry_points(None) is None


def test_summarize_avg_and_max():
    s = summarize_telemetry_points([
        {"speed": 200, "throttle": 50, "brake": 0, "rpm": 10000, "n_gear": 5, "drs": 0},
        {"speed": 300, "throttle": 100, "brake": 100, "rpm": 11000, "n_gear": 7, "drs": 12},
        {"speed": 250, "throttle": 75, "brake": 0, "rpm": 10500, "n_gear": 6, "drs": 0}])
    assert (s["speed"], s["throttle"], s["brake"], s["n_gear"], s["drs"]) == (250, 75, 100, 7, 12)


def test_summarize_missing_fields_are_zero():
    s = summarize_telemetry_points([{"speed": 100}, {"speed": 200}])
    assert s["speed"] == 150 and s["throttle"] == 0


def test_summarize_nan_is_zero_like_js():
    s = summarize_telemetry_points([{"speed": 100, "rpm": float("nan")}, {"speed": 200, "rpm": 1000}])
    assert s["rpm"] == 500


# ---------------------------------------------------------------- vectorised == scalar

def _random_samples(n=3000, seed=0):
    rng = np.random.default_rng(seed)
    df = pd.DataFrame({
        "speed": rng.integers(0, 340, n), "rpm": rng.choice([0, 3000, 9000, 12000], n),
        "throttle": rng.choice([0, 10, 50, 100], n), "brake": rng.choice([0, 100, 104], n),
        "n_gear": rng.integers(0, 9, n), "drs": rng.choice([0, 1, 8, 10, 12, 14], n)}).astype(float)
    df.loc[rng.random(n) < .05, "rpm"] = np.nan
    return df


def test_rule_hits_matches_detect_anomalies():
    df = _random_samples()
    hits = rule_hits(df)
    for i, row in df.iterrows():
        r = detect_anomalies(row.to_dict())
        expected = {m.incident_type for m in TELEMETRY_RULES if m.reason in r["reasons"]}
        assert set(hits.columns[hits.loc[i]]) == expected


def test_lap_analysis_matches_scalar_path():
    df = _random_samples(600, seed=1)
    df["driver_number"] = 1
    df["lap_number"] = np.repeat(np.arange(1, 7), 100)
    out = lap_analysis(df).set_index("lap_number")
    for lap in range(1, 7):
        pts = lambda n: df[df.lap_number == n].drop(columns=["driver_number", "lap_number"]).to_dict("records")
        prior = [p for n in (lap - 2, lap - 1) if n > 0 for p in pts(n)]
        expected = detect_anomalies(summarize_telemetry_points(pts(lap)), None, build_telemetry_baseline(prior))
        assert out.loc[lap, "priority"] == expected["priority"]
        assert out.loc[lap, "incidentType"] == expected["incidentType"]
