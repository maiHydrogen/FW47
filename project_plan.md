# FW47: Telemetry Anomaly Pipeline — Project Plan v3

- **Status:** Rebuild in progress. Learning project, zero cost (local Docker + a free Atlassian developer site).
- **Plan updated:** 2026-10-29
- **Maintainer:** one person for now; contributions welcome once v3 lands.

## Project history

**The idea.** FW47 started as an entry for Atlassian's Codegeist 2025 hackathon, whose theme was Atlassian
Williams Racing. The pitch was an "AI race engineer for Jira": read signals from a car, work out what's
wrong, file a Jira issue instantly, pull the matching repair procedure (SOP) from Confluence, have Rovo act
as the AI assistant behind it, and predict the best time to pit.

**v1 (Dec 2025): the hackathon build.** A Forge app with a Jira issue panel showing OpenF1 data (we
switched from fastf1 to OpenF1 a week in), webtriggers that create Jira issues, and a Rovo agent with
actions.

**v2 (Sep 2026): first clean-up.** Hand-written anomaly rules, a fixed table of pit windows per tyre
compound, and unit tests for both.

**Why we stopped and didn't submit.** Looking at it honestly:

- The problem was more themed than real. F1 teams have their own telemetry systems, and no race engineer
  files Jira tickets from the pit wall.
- The core of the pitch couldn't be built on public data. It only has six channels at about 4 Hz (no
  temperatures, pressures or hydraulics), so "what's wrong with the car" can't be answered from it.
- There was no ML. The "predictions" were fixed thresholds and a lookup table that had never been checked
  against real races.
- There was no streaming. Forge can only poll every 5 minutes, so the "live" parts weren't live.

**v3 (now): the rebuild.** We kept the parts that hold up (the Forge integration, Jira issue creation, the
Rovo agent, the tests) and are rebuilding the rest as a learning project. The F1 framing stays because it's
one of the few domains with public high-frequency sensor data, but the questions change to ones that data
can actually answer (see below). The pattern itself (stream, detect, route incidents into a system of
record) is the same one used in observability and industrial monitoring. Every claim about v3 must be backed
by a test, a benchmark or an evaluation in this repo. The v2 prototype stays tagged as
`v0-codegeist-prototype`.

## What we're building

A Python service replays recorded F1 sessions as a telemetry stream (and, where possible, reads a live
session). It scores every sample against what that car normally does at that point on the track, and turns
sustained deviations into deduplicated, ranked incidents. A Forge app files each incident in Jira with the
matching SOP from Confluence, writes a report page per session, and lets a Rovo agent summarise the ranked
incidents on request.

```
OFFLINE   OpenF1 data  ──► analysis/ notebooks (inventory · audit · baselines · evaluation)
                                │
                                │  fw47_core: one scoring library, used offline and online
ONLINE                          ▼
 ReplaySource ─┐  Redis    ┌──────────┐  Redis      ┌────────────┐  HMAC-signed  ┌─ Forge app ──────┐
 LiveSource  ──┴─────────► │  scorer  │ ──────────► │ aggregator │ ────────────► │ Jira issues      │
                telemetry  │ < 500 ms │  deviations │ dedupe ·   │  webtrigger   │ Confluence SOPs  │
                           └──────────┘             │ rank       │               │  + session report│
                                                    └────────────┘               │ Rovo · panel     │
                                                                                 └──────────────────┘
```

## The questions

| We'd like to know | Why public data can't answer it | What FW47 answers instead |
|---|---|---|
| What's wrong with the car? | Public telemetry has six channels at ~4 Hz: speed, RPM, gear, throttle, brake (on/off) and DRS. No temperatures, pressures or hydraulics. | Is this car behaving abnormally compared with its normal at this point on the track, and how quickly can we tell? |
| When *should* they pit? | Needs a race simulator and counterfactuals. History only shows what teams did. | When are they likely to pit, given what strategists did historically? (B8) |

## Targets

| Target | Value | Measured in |
|---|---|---|
| Sustained ingest | 50 Hz per car × 22 cars (≈1,100 msg/s) with no growth in consumer lag | A8 |
| Processing latency | p95 < 500 ms from sample published to sample scored | A8 |
| Crash recovery | Scorer or aggregator killed and restarted within the retention window: every sample still scored, no duplicate Jira issues | A8 |
| Alert noise | One Jira issue per fault, not one per sample | A5 |
| Detection quality | Operating point chosen on the tuning seasons, reported once on the held-out season | B6 |

Two notes that apply everywhere:

- Public telemetry is ~4 Hz. Runs at 50 Hz use interpolated samples, flagged `interpolated=true` (A2).
- **Processing latency** (Track A: time from a sample arriving to its score) and **time-to-signal**
  (Track B: time from a fault starting to it being flagged) are different numbers. We report both.

## Order of work and milestones

One person is working on this, so the two tracks run one after the other, in this order:

**Step 0 → B1–B3 → A1–A5 → B4–B6 → A7–A8 → B8 → A6 (rest) → A9 → Finish → stretch (B7, A10)**

Data work comes first because the scorer (A4) needs the rules ported in B3, and the thresholds it ships
with come from B6.

| Milestone | Done when | Target date (suggested) |
|---|---|---|
| M0 | Step 0 | Sun 1 Nov |
| M1: skeleton | B1–B3, A1–A5, and the webtrigger/signature/idempotency part of A6. A replayed race flows end to end into a Jira issue using the ported rules. | Sun 22 Nov |
| M2: measured | B4–B6 and A7–A8. The scorer runs on the chosen baselines and thresholds, and the benchmarks are published. | Sun 13 Dec |
| M3: complete | B8, the rest of A6 (SOPs, Confluence report, Rovo, panel, clean-up), A9 and Finish | Sun 3 Jan |
| Stretch | B7, and A10 (a live run needs a race weekend; the 2026 season ends in early December) | when time allows |

## Working agreements

- **One scoring implementation.** Rules and baselines live in `pipeline/fw47_core/`. Both the notebooks and
  the scorer import them. Never copy rule logic.
- **Numbers come from scripts.** Every number in the README comes from a script or notebook in this repo,
  with the commit hash and the machine it ran on.
- **No peeking.** Fix the held-out season, the labels and the rule for choosing the operating point before
  looking at held-out results.
- **README follows reality.** Update its Status section at each milestone. Nothing is described as built
  until it is.
- **Branches.** Feature branch → PR into `dev` → merge `dev` into `main` at each milestone. Read your own
  PR diff before merging; once contributors join, PRs get a second reviewer.

---

## Step 0: Honesty pass (before anything else)

- [x] Tag the current `main` as `v0-codegeist-prototype` and push the tag.
- [x] Rewrite `README.md` to describe only what exists today. Mark everything else "planned" and link this plan.
  - [x] Replace "Codegeist 2025 Submission" with an origin note: built for Codegeist 2025, not submitted, being rebuilt.
  - [x] Remove claims that aren't built: "Live Telemetry", "real-time", purple/green sectors, radio keyword detection.
  - [x] Fix the install section (unclosed code block, empty webtrigger section).
- [x] Add Python entries to `.gitignore`: `.venv/`, `__pycache__/`, `data/`, the fastf1 cache folder.
- [x] Remove the three webtrigger URLs committed in `.gitignore` and `src/index.js`.
- [ ] Rotate those webtrigger URLs. They've been in the public history since Dec 2025, and anyone who has one can create Jira issues.
- [x] Merge `dev` into `main` so the public default branch shows current work.

**Evidence**
- Every claim in the README points to a file that exists.
- `main` and `dev` match.
- The tag is visible on GitHub.

---

## Track A (SDE): the streaming pipeline

**Goal:** a fault-tolerant service that scores every sample within the latency budget and delivers
deduplicated, signed incidents to Forge. Every design choice is written down and every target is measured.

### A1. Repo layout and tooling
- [ ] Add `pipeline/` (package `fw47_core/` plus `service/`), `analysis/` (notebooks), `bench/` and `docs/`. Leave the Forge app in `src/`.
- [ ] Pin the Python dependencies in `pipeline/pyproject.toml`: pandas, pyarrow, numpy, redis, httpx, prometheus-client, pytest.
- [ ] Install `fw47_core` in editable mode (`pip install -e pipeline`) so the notebooks import the same code.
- [ ] Add `docker-compose.yml` with `redis` (AOF persistence on), `replayer`, `scorer` and `aggregator`, restart policy `unless-stopped`.
- [ ] Add GitHub Actions running `pytest` and `npm test` on every PR.
- [ ] Check that `forge deploy` still works with the new folders.

**Evidence**
- `docker compose up` brings up all four containers.
- CI is green on a PR.

### A2. Message schema and sources
- [ ] Define a versioned `TelemetrySample` schema: `schema_version, session_key, driver_number, t_source, t_published, lap, lap_distance_m, speed, rpm, gear, throttle, brake, drs, interpolated`.
- [ ] Add a `Source` interface (`async for sample in source`) so the pipeline doesn't care where data comes from.
- [ ] `ReplaySource`:
  - [ ] Load a session from the B1 Parquet tables and merge all cars into one time-ordered stream.
  - [ ] Play it back at a configurable speed: 1×, 5×, or as fast as possible.
- [ ] Upsample to 50 Hz:
  - [ ] Interpolate continuous channels (speed, rpm, throttle, distance).
  - [ ] Forward-fill discrete channels (gear, brake, drs).
  - [ ] Set `interpolated=true` on generated samples and pass real samples through unchanged.
- [ ] Add a deterministic mode for tests, with no wall clock: the same session in gives the same messages out.
- [ ] Also publish `lap_completed` events (lap time, compound, tyre life, position). Only B8 needs these.

**Evidence**
- A determinism test: identical message hashes across two runs.
- An upsampling test: real samples are unchanged and interpolated ones are flagged.

### A3. Durable stream with Redis Streams
- [ ] Learn Redis Streams and consumer groups from the official Redis docs.
- [ ] The replayer `XADD`s to `fw47:telemetry` with approximate `MAXLEN` trimming, keeping about 60 s of data.
  - Retention is bounded on purpose, because stale telemetry is worthless: time-to-signal over completeness.
  - If the scorer is down for longer than that, the oldest samples are dropped by design. Record this in an ADR (A9).
- [ ] The scorer reads with `XREADGROUP` in group `scorers` and `XACK`s only after its output is written (at-least-once delivery).
- [ ] On start-up, the scorer reclaims unacknowledged entries (`XAUTOCLAIM`) before reading new ones.

**Evidence**
- An integration test against a real Redis: publish N messages, consume N, all acknowledged.
- A restart test: the scorer resumes from its pending entries.

### A4. Scorer: the hot path
_Needs `fw47_core/rules.py` from B3. Starts on the ported rules; switches to the B4 baselines and B6 thresholds at M2._
- [ ] Keep per-car state: rolling windows, and how long each condition has held.
- [ ] Apply the rules and baselines from `fw47_core`.
  - Persistence is a duration in seconds, not a sample count, so behaviour is the same at 4 Hz and 50 Hz.
- [ ] Emit deviation events to `fw47:deviations`: car, type, severity score, observed vs expected value, `t_source`, `t_scored`.
- [ ] Load the baseline files and thresholds from config at start-up (produced by B4 and B6).
- [ ] Record `t_scored − t_published` for every sample in a latency histogram.
- [ ] Port the still-relevant cases from the JS tests (`anomalyDetection.test.js`, `telemetryBaseline.test.js`) to pytest.

**Evidence**
- A pytest suite for the scorer.
- A latency histogram from a replayed race.

### A5. Incident aggregator and delivery
- [ ] Group deviations into incidents keyed by (session, car, type):
  - [ ] Open an incident on the first deviation.
  - [ ] Only ever raise its severity while it's open.
  - [ ] Close it after a quiet cooldown.
- [ ] Set the incident ID to a deterministic hash of (session, car, type, opened-at). It's the idempotency key everywhere downstream.
- [ ] Keep open incidents ranked by severity.
- [ ] Send `opened` / `escalated` / `closed` / `session_closed` events to the Forge webtrigger, signed with HMAC-SHA256 over timestamp + body.
- [ ] Retry 429 and 5xx responses with exponential backoff and jitter, respecting `Retry-After`. After K failures, move the event to `fw47:dlq`.

**Evidence**
- A table, for one replayed race, of raw rule hits vs incidents created.
- Tests for retry/backoff and for the dead-letter path.

### A6. Forge app: hardened integration

Webtrigger and Jira (needed for M1):
- [ ] Replace the radio and pit webhooks with one `incident-webhook` webtrigger.
  - [ ] Verify the HMAC, with the secret stored via `forge variables set --encrypt`.
  - [ ] Reject requests whose timestamp is more than 5 minutes old.
- [ ] Map incident ID → issue key in Forge storage:
  - `opened` creates the issue only if it doesn't exist yet.
  - `escalated` updates the priority and adds a comment.
  - `closed` adds a comment and transitions the issue.
- [ ] Return 503 when Jira rate-limits, so the aggregator retries. Idempotency makes retries safe.

Confluence, Rovo and panel (needed for M3):
- [ ] Write 5–6 SOP pages in a test Confluence space.
  - Label them by incident type (`sop-engine-stall`, …).
  - Mark them clearly as written for this project.
- [ ] On `opened`, find the SOP by label (CQL) and link it in the issue.
- [ ] On `session_closed`, create or update one Confluence report page per session listing its incidents, timings and issue links. This needs a Confluence write scope.
- [ ] Rovo actions:
  - [ ] Replace `calculate-priority` with `get-ranked-incidents`.
  - [ ] Keep `search-confluence-sops`.
  - [ ] Point `predict-pit-window` at the B8 model's output instead of the fixed table.
- [ ] Update the agent prompt: Rovo explains and summarises, and never sets severity.
- [ ] Issue panel: the incident timeline plus the session's ranked open incidents, refreshed every few seconds (or via Forge Realtime if the app can use it).
- [ ] Remove what's no longer used: scheduled pollers, the radio flow, the JS rule engine, unused panel tabs, and the `api.openf1.org` egress permission if nothing calls it any more.

**Evidence**
- A test showing that the same incident delivered twice creates one issue.
- A test showing that a request with a bad signature is rejected.
- Screenshots: the issue with its SOP link, the Confluence session report, and Rovo answering "what are the worst open incidents?".

### A7. Observability
- [ ] Add `/metrics` (prometheus-client) on the scorer and aggregator: samples in, deviations out, open incidents, consumer lag, latency histogram, delivery failures.
- [ ] Add `/healthz` on each service, wired to Docker health checks.

**Evidence**
- A screenshot or dump of the metrics during a load test.

### A8. Benchmarks and failure tests
- [ ] `bench/load_test.py`: replay a 2026 race (22 cars) at 50 Hz for 10 minutes. Record ingest rate, consumer lag and p50/p95/p99 latency.
  - This measures throughput only. Detection quality is B6's job.
- [ ] Ramp the rate up until p95 passes 500 ms or lag keeps growing. Report that maximum as the real headroom.
- [ ] `bench/failure_test.py`:
  - [ ] Kill the scorer mid-replay and restart it within the retention window.
  - [ ] Then kill the aggregator mid-delivery and restart it.
  - [ ] Assert that every sample was scored at least once and no Jira issue was duplicated.
- [ ] Write `docs/benchmarks.md`: results, plots, machine spec, commit hash and the exact commands to reproduce them.

**Evidence**
- `docs/benchmarks.md`.

### A9. Architecture and decision records
- [ ] `docs/architecture.md`:
  - The diagram, data flow and failure modes.
  - What production high availability would add: several scorers in the consumer group, Redis replication, tooling to replay the DLQ, and lag alerts.
- [ ] Short ADRs in `docs/adr/` (context · decision · alternatives · consequences):
  1. Hot path outside Forge: invocations are short-lived, and scheduled triggers run every 5 minutes at best.
  2. Redis Streams over Kafka.
  3. Rules on the hot path; the LLM only writes summaries.
  4. Bounded stream retention: time-to-signal over completeness.
  5. Signed, idempotent delivery to Forge.
  6. Replay plus interpolation to test at 50 Hz.

**Evidence**
- The documents themselves.

### A10 (stretch). Live source
- [ ] Find a usable live source: OpenF1's real-time access (check whether it's paid) or fastf1's live-timing client (needs an F1 account). Check that personal use fits the terms.
- [ ] Implement `LiveSource` behind the same interface. Compute lap distance by integrating speed from the start of each lap.
- [ ] Run the pipeline through one session of a remaining 2026 race weekend.

**Evidence**
- A run log and incidents from a real session, or a short note on why it didn't work.

---

## Track B (DS): the data analysis

**Goal:** show, on held-out races, how well the detector separates real incidents from normal driving, and
choose its operating point (alert rate vs time-to-signal) from data.

### B1. Data inventory

_Source change (2026-10-29): fastf1 can't be used without an F1 account, because F1's timing archive now
returns 401. We use **OpenF1** (car data, location, laps, stints, pit stops, race control, weather, positions,
intervals, session results; 2023 onwards) and **Jolpica** (results with status). See `analysis/README.md`._

- [ ] Learn: the OpenF1 docs (endpoints and filters). If needed, do the Kaggle *Pandas* and *Data Visualization* micro-courses.
- [x] `analysis/download.py`: cached downloader that writes Parquet tables to `data/parquet/` (git-ignored).
- [x] Download the per-session tables for 2023–2025, and car data + location for 2024.
  - [ ] Car data + location for 2023 and 2025, once the method works on 2024 (~2.5 hours per season).
  - Loading all of 2024 at once peaks at ~6.6 GB of RAM: process one session at a time, or switch to DuckDB or Polars.
- [x] `analysis/01_inventory.ipynb`: coverage per table, counts of races, cars, laps and samples, real sample intervals (histogram), missing data, channel values.
- [x] Quick EDA: speed and throttle traces for a few laps per track, and the distribution of each channel.
- [x] Inventory the possible label sources: Jolpica status, OpenF1 `dnf` flags, race-control messages.
- [x] Fix the split now: **tune on 2023–2024, test once on 2025.**

**Evidence**
- An inventory table.
- A histogram of sample intervals. This is where "~4 Hz" comes from.
- Done: see "Findings" in `analysis/01_inventory.ipynb`. Median interval 0.24 s (4.17 Hz); ~150 retirements over 3 seasons, almost none with a cause.

### B2. Cleaning and alignment
- [x] Attach a lap number and lap distance to every sample: match samples to laps by `date_start`, then integrate speed over time within each lap (check it against the X/Y location data).
- [x] Flag, don't drop: lap 1, in/out laps, SC/VSC/red-flag laps, deleted laps, wet running. Keep the flags as columns so the choices can be reversed.
- [x] Run quality checks: gaps over 1 s, duplicate timestamps, physically impossible values.
- [x] Build a data funnel table: how many samples each filter removes.
- [ ] Re-run `analysis/build_clean.py` for 2023 and 2025 once their car data is downloaded (B1).

**Evidence**
- `analysis/02_cleaning.ipynb` with the funnel table and an example of each excluded category.
- Done for 2024: see "Findings" in the notebook. Code in `pipeline/fw47_core/clean.py`, run by `analysis/build_clean.py`.
  Lap distance is within 0.6–1.7% of official track lengths, with ~9 m lap-to-lap spread. 78% of laps (515 car-hours) are clean.
  OpenF1 quirks found and handled: retired cars stream a car-off reading, `pit.date` falls in the out-lap, laps are renumbered around red flags, some lap boundaries are broken, and the brake channel sometimes sticks on (found in B3).

### B3. Audit the current rules
- [x] Port the JS rules to `pipeline/fw47_core/rules.py` with identical thresholds. Track A imports this.
  - Tests in `pipeline/tests/test_rules.py` port the JS tests and check that the vectorised versions match.
- [x] Run them over clean laps from the tuning seasons: alerts per car-hour, by rule and by track. (2024 only so far; re-run when 2023 car data is in.)
- [x] Plot where each rule fires on the track map, using the X/Y position data.
- [x] Decide for each rule:
  - Keep rules that describe impossible states, e.g. RPM 0 while moving.
  - Replace rules that fire in normal driving.
  - 2026 cars have no DRS (active aero replaced it), so DRS rules only apply up to 2025.

**Evidence**
- `analysis/03_rule_audit.ipynb`: alerts per car-hour per rule, track maps, and the keep/replace decision for each rule.
- Done (2024): the shipped rules raise ~314 false alerts per car-hour, ~99% of them from `emergency-braking` and
  `potential-issue`. Keep `engine-stall` (0 false alerts; caught Hamilton's Melbourne engine failure), `gearbox-failure`,
  and `drs-failure` with a 3-sample persistence condition (2023–2025 only). Replace the rest with the B4 baseline.
  The issue panel rated 29% of clean laps Critical, so its lap-summary mode is dropped.

### B4. Contextual baselines
- [ ] v1: for each track, bin lap distance (e.g. 25 m) and compute the median and MAD of speed over clean tuning-season laps.
- [ ] v2: add a per-car offset learned from that car's earlier clean laps in the same race. Fall back to v1 until the car has a few clean laps.
- [ ] Before testing, list the tracks that are new or re-profiled in 2025 (no v1 baseline) and decide how to handle them.
- [ ] Detector:
  - Compute a robust z-score of speed against the expected value.
  - Flag when z < −k for at least d seconds.
  - Severity combines depth, duration and incident type. Write the formula down.
- [ ] Export the baselines as files the scorer loads (A4).

**Evidence**
- `analysis/04_baselines.ipynb`: the expected-speed band along a lap with a real incident lap overlaid.
- Alerts per car-hour compared with the B3 rules.

### B5. Ground-truth labels
- [ ] Mechanical retirements for 2023–2025, from Jolpica `status` and OpenF1 `dnf` flags. B1 found that Jolpica mostly says just "Retired", without a cause. Decide how to separate mechanical failures from crashes (e.g. race-control messages, whether the car was damaged in contact) and write the rule down.
- [ ] Cars stopping on track, from race-control messages that name a car and from track-status changes.
  - Keep this class separate from mechanical failures so the easy cases don't inflate recall.
- [ ] For each incident, record:
  - The onset, marked by hand from plots using a written rule.
  - The time the car stopped or retired.
- [ ] Negatives: clean laps from cars that finished without problems.
- [ ] Commit `analysis/labels.csv`, with the source of each label, **before** any tuning.
- [ ] Expect only a few dozen mechanical failures. Plan to report confidence intervals, not single numbers.

**Evidence**
- `labels.csv`.
- The written labelling rule.
- Event counts per season and class.

### B6. Tune, choose, evaluate once
- [ ] On the tuning seasons, sweep k and d. For each pair compute:
  - False alerts per car-hour.
  - Recall.
  - Median time-to-signal (flag time − onset).
  - Lead time before the car stopped.
- [ ] Plot the trade-off curve: false alerts per car-hour vs median time-to-signal, with the Pareto front highlighted.
- [ ] Write the selection rule before testing (e.g. "≤ 1 false alert per car per race, then the lowest delay"). Then pick (k, d).
- [ ] Run once on 2025:
  - [ ] Report recall, false alerts per car-hour, and median and p90 time-to-signal.
  - [ ] Add bootstrap confidence intervals by resampling races.
  - [ ] Compare against the B3 fixed rules on the same races.
- [ ] Error analysis: look at every miss and the top false alerts, and group them by cause.
- [ ] Hand the chosen (k, d) and the baselines to the scorer config.

**Evidence**
- `analysis/05_evaluation.ipynb`.
- The trade-off plot.
- The held-out results table with confidence intervals.
- The error-analysis table.
- A one-paragraph conclusion with real numbers for the README.

### B7 (stretch). Learned detector comparison
- [ ] Build windowed features:
  - Residual vs baseline (mean and std).
  - Throttle–speed consistency.
  - Speed/RPM ratio per gear (a mismatch suggests driveline trouble).
- [ ] Train an Isolation Forest on clean laps and evaluate it with the same split, labels and metrics as B6.
- [ ] Measure its scoring cost in the A8 benchmark, then decide whether it beats the rules by enough to be worth it.

**Evidence**
- An extra row in the B6 results table, plus its latency cost.

### B8. Pit-timing model (the supervised ML part; v2's Phase 3)
- [ ] Learn: StatQuest *Machine Learning Fundamentals* and *XGBoost* videos.
- [x] Check the Kaggle dataset before using it (done 2026-10-29). It's **Kaggle Playground Series S6E5**:
  train has 439,140 rows, test has 188,166 unlabelled rows, and the target is `PitNextLap`. Seasons are
  2022–2025, there are 26 races, and the columns are compound, stint, tyre life, position, lap time,
  lap-time delta, cumulative degradation, race progress and position change.
  - **It's synthetic.** Playground datasets are generated from a model trained on real data. What shows this:
    - 887 distinct "drivers". 60% of rows use made-up codes like `D109`, and many three-letter codes aren't real 2022–2025 drivers.
    - Rows don't form races. In 69% of driver-race groups the stint number goes *down* as laps go up.
    - About 20% of rows are labelled "pits next lap". Real races have a few percent.
    - There are no gaps to other cars, track status (SC/VSC) or weather, and no retirement causes.
  - **So it's not used for B5 labels or for B8's training and evaluation.** Results on synthetic rows say nothing about real races.
  - **It is useful as a warm-up**, before B8 proper. Its target is the same as B8's.
    - [ ] Build the B8 pipeline on it end to end (features, cross-validation, XGBoost, PR-AUC, SHAP) and submit to the competition for a leaderboard score.
    - [ ] Then re-run the same code on real OpenF1 laps and compare. Expect a lower score on real data, because the synthetic label rate is inflated. Write down why.
  - [ ] Keep the files out of git (`data/` is git-ignored), and check the competition rules before sharing anything derived from them.
- [ ] Build one row per (race, driver, lap). The label is "pits within the next 3 laps".
- [ ] Use only features known at the end of the lap:
  - Tyre age, compound, stint, laps remaining.
  - Lap-time trend vs the stint's best lap.
  - Gaps to the cars ahead and behind.
  - Track status, track temperature, rainfall, track.
- [ ] Split by season, never mixing laps from one race across splits: OpenF1 starts in 2023, so tune with cross-validation grouped by race on 2023–2024, and test once on 2025. Check 2026 races separately as out-of-distribution data.
- [ ] Baselines: the compound-window table in `src/services/pitStrategy.js`, and a logistic regression.
- [ ] Metrics and explanation:
  - PR-AUC (pit laps are rare).
  - A calibration plot.
  - How many laps early or late the predicted pit lap is.
  - SHAP for explanations.
- [ ] Write the caveats into the results: the model imitates strategists' decisions rather than finding the optimal lap, and the 2026 cars are different.
- [ ] Serve the model: score each car on `lap_completed` (A2), send the probabilities to Forge, and have Rovo's `predict-pit-window` read them.

**Evidence**
- `analysis/06_pit_model.ipynb`: a results table against both baselines, a calibration plot, a SHAP summary and the 2026 result.

---

## Finish: docs and demo (both tracks, M3)
- [ ] README:
  - An honest problem statement and the architecture diagram.
  - How to run it (Docker + Forge).
  - Measured results (A8 + B6).
  - Limitations and origin.
- [ ] Limitations section: six public channels, 50 Hz is interpolated, single node, SOPs written by us, no real users.
- [ ] Record a 2–3 minute demo video: replay a race with a mechanical retirement at 5× → Jira issue with SOP link → Confluence report → Rovo summary.

**Evidence**
- The README and the video.

## Cut from v2

| What | Why |
|---|---|
| Radio flow (webhook, processor, poller) | OpenF1 radio is audio only, so there's no transcript to analyse |
| Scheduled pollers | Forge triggers run every 5 minutes at best; the Python service owns the hot path |
| JS rule engine and baseline | Moved to `fw47_core`, so one implementation serves notebooks and service |
| Pit-stop tickets | A pit stop isn't an incident |
| Panel tabs that don't show incidents | Not part of the story |
| `scripts/send-qatar-incidents.py` | Replaced by the replayer |
| MongoDB (v2 plan) | Parquet files are simpler for offline analysis and need no server |

## Out of scope
- **Root-cause diagnosis.** It needs sensor channels that aren't public.
- **Optimal pit strategy.** It needs a race simulator.
- **Production high availability.** FW47 runs on one node; `docs/architecture.md` says what HA would take.
- **Real users.** Evaluation on historical races stands in for user feedback.
