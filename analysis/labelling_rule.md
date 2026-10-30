# B5 labelling rule

Written before any tuning (B6). `analysis/labels.csv` is built from this rule by `analysis/build_labels.py`; the
code is `pipeline/fw47_core/labels.py`. If the rule changes, change this file, the code and the labels together,
and note why at the bottom.

## 1. Which events

**One row per car that did not finish a race**, 2023–2025: every row of the Wikipedia race-classification table
whose result cell is not a race time, a gap (`+12.345`, `+1:03.101`) or laps down (`+1 lap`). This includes cars that
stopped near the end but were still classified (e.g. Russell, Melbourne 2024, classified 17th after crashing on the
last lap), which Jolpica's status misses.

Why Wikipedia: Jolpica gives almost every retirement as just "Retired" and OpenF1 has no cause at all. The
classification tables give the cause the FIA classification reports. Each row keeps a link to its page
(`cause_source`), and the raw page text is cached under `data/raw_cache/wiki/`.

## 2. Classes

From the cause, case-insensitive (`cause_class`):

| Class | Causes | Used for |
|---|---|---|
| **mechanical** | engine, power unit, turbo, gearbox, transmission, clutch, hydraulics, brakes, electrical, oil leak / pressure / temperature, water leak, overheating, fuel leak / pump / system, throttle, steering, chassis | The detector's target. Recall is reported on this class. |
| **ambiguous** | suspension, rear wing, floor, undertray, handling, "hydraulics/accident", "suspension/accident" | Failure or contact damage, or both. Reported separately, never pooled into mechanical recall. |
| **crash** | accident, accident damage, collision, collision damage, spun off, (incident / car) damage, puncture, puncture damage | Separate class. Easy to detect (the car stops abruptly), so it must not inflate mechanical recall. |
| **excluded** | DNS, DSQ, WD (any cause); withdrew, heatstroke, driver injury, qualifying accident, pit stop issue, outside assistance, plank wear, skid block, underweight | Not a car-health event during the race. Kept in the file, never scored. |

A cause not in any list stops the build, so a new cause is always classified by hand.

## 3. Stop

**Stop time:** the first sample after the car's last sample above 50 km/h from which its speed stays below 5 km/h
for 30 s, or to the end of its data. OpenF1's car-off sentinel (brake = 104, throttle 100–104, speed 0–7 km/h) counts
as at rest. Anchoring on the last fast sample skips red-flag stops and long pit stops, after which the car raced
again.

**Stop place:** `pit lane` if the car came to rest within 15 m of the pit lane, else `track`. The pit lane is
learned per race from the slow (≤ 85 km/h) samples of every car around its own pit stops. `rc_stopped` records
whether race control named the car as stopped; this happens only 4 times in three seasons, so race control can't be
the source for "stopped on track".

## 4. Onset

**The onset is the first observable symptom: the start of the car's final departure from how it drove the same
stretch on its own previous laps, which continues until the stop.**

The car is compared with **itself**, not with the field: the reference is its own last 3 clean laps before the
incident lap, per 25 m of lap distance. This is deliberate. The B4 detector compares speed with the field, so an onset
defined by the field baseline would make B6's time-to-signal measure the detector against itself.

A sample departs if any of these holds:

| Reason | Condition |
|---|---|
| `slow` | speed more than 10% below the slowest of the 3 reference laps at that point |
| `lift` | throttle ≤ 20% where all 3 reference laps were at ≥ 90% |
| `crawl` | speed < 30 km/h where the reference is above 100 km/h |
| `rpm_off` | rpm = 0 above 30 km/h (engine off while rolling) |
| `neutral` | gear 0 above 50 km/h |

Departing samples less than 5 s apart form one run. **The proposed onset (`onset_auto`) is the first sample of the
run that reaches the stop**, and `onset_reason` lists the condition(s) that fired there.

Not symptoms:
- **The pit lane and the drive into it.** For a car that stopped in the pit lane, the final stretch along the pit
  lane and the braking leading into it look like any pit stop, so they are masked. When the car ended in the pit
  lane, `slow` also has to be slower than the car's own earlier in-laps.
- **Safety car, VSC and red-flag periods:** everyone slows, so `slow` and `lift` are ignored. `crawl` and the
  impossible states still count.

The run must reach the last unmasked sample before the stop. If it doesn't, there is no onset, and `onset_reason`
says why:
- `no departure`: the car looked normal until it entered the pits, e.g. retired by the team from its own telemetry.
- `no departure before the stop`: an earlier departure ended before the stop.
- `no reference laps`: fewer than 3 clean laps before the incident (early-race and wet-race incidents). Only the
  impossible states can fire here.

## 5. Review

`onset_auto` is a proposal. **Every mechanical and ambiguous row in the tuning seasons is reviewed by hand** from
its plot in `analysis/05_labels.ipynb`. The review result goes in `onset_reviewed`:

- `auto`: the proposal is right.
- a UTC timestamp (`2024-03-24 04:25:08.4`): the onset is somewhere else; say why in `review_note`.
- `none`: no visible symptom before the stop (the event can't be detected from telemetry).

Rebuilding `labels.csv` keeps `onset_reviewed` and `review_note`. The 2025 rows get stop and onset proposals once
the 2025 car data is in. They are reviewed with the same rule **before** the one B6 run on 2025, and without looking
at detector output.

## 6. Negatives

Clean laps (B2) of cars that finished the race: classified with a time, a gap or laps down, and with no row in
`labels.csv` for that race. `negative_laps` in `labels.py`.

## 7. What a label can't tell

- **The cause is the team's stated reason**, as reported in the classification. "Engine" can be a precautionary
  retirement for a reading only the team saw.
- **A failure that built up over several laps** has an onset at the start of its *final* departure only. A slow
  decline before that isn't captured; note it in `review_note` when the plot shows one.
- **Mechanical retirements are few** (39 in 2023–2024, 12 in 2025, and fewer with a visible onset), so B6 reports
  confidence intervals, not single numbers.
