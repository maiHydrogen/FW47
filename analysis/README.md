# analysis/

Notebooks and scripts for Track B (the data analysis) in [project_plan.md](../project_plan.md).

## Setup

From the repo root:

```bash
python3 -m venv .venv
.venv/bin/pip install -r analysis/requirements.txt
```

This installs `pipeline/` (the `fw47_core` library) in editable mode, with the pins from
`pipeline/pyproject.toml`, so scripts and notebooks import `fw47_core` directly.

If `venv` complains that `ensurepip` is missing (Debian/Ubuntu without `python3-venv`), create the
environment without pip and install into it with the system pip instead:

```bash
python3 -m venv --without-pip .venv
pip --python .venv/bin/python install -r analysis/requirements.txt
```

## Data

Data comes from two free APIs. fastf1 isn't used: F1's timing archive, which fastf1 reads, now needs a
signed-in F1 account.

- [OpenF1](https://openf1.org): car data, location, laps, stints, pit stops, race control, weather,
  positions, intervals and session results (2023 onwards).
- [Jolpica](https://github.com/jolpica/jolpica-f1) (the Ergast successor): race results with a status per
  driver.

`download.py` caches every response in `data/raw_cache/` and writes Parquet tables to
`data/parquet/<table>/season=<year>/<session_key>.parquet`. `data/` is git-ignored.

```bash
# Per-session tables (laps, stints, pit, race control, ...) for all three seasons: ~30 minutes
.venv/bin/python analysis/download.py --seasons 2023 2024 2025

# Car data and location as well (~2.5 hours per season; ~160 MB of Parquet plus ~300 MB of cache)
.venv/bin/python analysis/download.py --seasons 2024 --heavy
```

## Cleaning (B2)

`build_clean.py` runs `pipeline/fw47_core/clean.py` over every session that has car data. For each session, it
writes a lap table (one row per driver lap, with a column per reason to distrust it) and a sample table (each
sample with lap number, lap distance, X/Y, quality flags and its lap's flags) to `data/clean/`:

```bash
.venv/bin/python analysis/build_clean.py --seasons 2024   # ~1 minute
```

## Notebooks

Run them from this folder (`cd analysis && ../.venv/bin/jupyter lab`).

| Notebook | Plan step |
|---|---|
| `01_inventory.ipynb` | B1: what data exists, sample rates, missing data, label sources |
| `02_cleaning.ipynb` | B2: lap distance checks, lap flags, quality checks, data funnel (needs `build_clean.py` first) |
| `03_rule_audit.ipynb` | B3: the Forge app's anomaly rules on clean laps: false alerts per car-hour, track maps, keep/replace decisions, 2023 vs 2024 |
| `04_baselines.ipynb` | B4: contextual speed baselines and the slowdown detector: false alerts vs B3, blue flags, severity, across seasons (needs both `score_b4.py` runs first) |
| `05_labels.ipynb` | B5: ground-truth labels: events per season and class, where cars stopped, onset review plots, negatives (needs `build_labels.py` first) |

## Baselines (B4)

```bash
.venv/bin/python analysis/score_b4.py --seasons 2024                          # z-scores per sample, leave-one-car-out (~2 min)
.venv/bin/python analysis/score_b4.py --seasons 2024 --baseline-seasons 2023  # cross-season: 2023 baseline scoring 2024
.venv/bin/python analysis/export_baselines.py --seasons 2023 2024             # per-track baselines for the scorer -> pipeline/baselines/
```

## Labels (B5)

```bash
.venv/bin/python analysis/fetch_causes.py --seasons 2023 2024 2025   # retirement causes from the Wikipedia classification tables (cached)
.venv/bin/python analysis/build_labels.py --seasons 2023 2024 2025   # -> analysis/labels.csv (keeps reviewed onsets)
```

The rule is in [`labelling_rule.md`](labelling_rule.md).

The shared code lives in `pipeline/fw47_core/` (`clean.py` for B2, `rules.py` for the ported rules, `baseline.py`
for B4, `labels.py` for B5). Run its tests with:

```bash
.venv/bin/python -m pytest pipeline/tests
```
