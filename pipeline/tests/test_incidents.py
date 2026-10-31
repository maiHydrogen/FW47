"""Incident grouping (plan step A5): deviations in, opened / escalated / closed / session_closed out."""

import json

from service.incidents import Aggregator, Incident, incident_id
from service.schema import SCHEMA_VERSION, Deviation, SessionEnded, Watermark


def dev(phase, t_start, t, drv=44, type_="engine-stall", priority="Critical", severity=100.0, key=1):
    return Deviation(SCHEMA_VERSION, key, drv, type_, phase, 10, 1500.0, t_start, t, t - t_start, severity, priority,
                     120.0, None, None, t, t)


def wm(t, key=1):
    return Watermark(SCHEMA_VERSION, key, t, t)


def run(msgs, agg=None, **kw):
    agg = agg or Aggregator(**kw)
    return [(e.event, json.loads(e.body)) for m in msgs for e in agg.process(m)]


def kinds(events):
    return [k for k, _ in events]


def test_one_run_opens_then_closes_after_the_cooldown():
    msgs = [dev("open", 100.0, 100.0), dev("close", 100.0, 100.5), wm(150.0), wm(160.4), wm(160.5)]
    ev = run(msgs)
    assert kinds(ev) == ["opened", "closed"]
    opened, closed = ev[0][1], ev[1][1]
    assert opened["incident_id"] == closed["incident_id"] == incident_id(1, 44, "engine-stall", 100.0)
    assert (closed["t_source"], closed["last_activity"], closed["deviations"]) == (160.5, 100.5, 2)


def test_a_run_within_the_cooldown_joins_the_incident_and_a_later_one_starts_a_new_one():
    msgs = [dev("open", 100.0, 100.0), dev("close", 100.0, 100.2),
            dev("open", 130.0, 130.0), dev("close", 130.0, 130.2),      # 30 s later: same incident
            dev("open", 300.0, 300.0), dev("close", 300.0, 300.2)]      # 170 s later: closes it, opens another
    ev = run(msgs)
    assert kinds(ev) == ["opened", "closed", "opened"]
    assert ev[1][1]["deviations"] == 4 and ev[0][1]["incident_id"] != ev[2][1]["incident_id"]


def test_an_open_run_keeps_the_incident_open_past_the_cooldown():
    ev = run([dev("open", 100.0, 100.0), wm(200.0), wm(400.0)])
    assert kinds(ev) == ["opened"]


def test_priority_only_rises_and_each_escalation_has_its_own_event_id():
    s = dict(type_="slowdown")
    msgs = [dev("open", 0.0, 2.0, priority="Medium", severity=30, **s),
            dev("update", 0.0, 5.0, priority="High", severity=60, **s),
            dev("close", 0.0, 6.0, priority="High", severity=60, **s),
            dev("open", 20.0, 22.0, priority="Low", severity=20, **s),        # a milder run: no change
            dev("update", 20.0, 30.0, priority="Critical", severity=90, **s),
            dev("close", 20.0, 31.0, priority="Critical", severity=90, **s)]
    ev = run(msgs, types=["slowdown"])
    assert [(k, b["priority"]) for k, b in ev] == [("opened", "Medium"), ("escalated", "High"), ("escalated", "Critical")]
    assert len({b["event_id"] for _, b in ev}) == 3


def test_same_deviations_give_the_same_events_and_duplicates_add_nothing():
    msgs = [dev("open", 100.0, 100.0), dev("close", 100.0, 100.5), wm(170.0)]
    assert run(msgs) == run(msgs)
    once = run(msgs)
    twice = run([msgs[0], msgs[0], msgs[1], msgs[1], msgs[2], msgs[1]])      # at-least-once redelivery
    assert kinds(twice) == kinds(once) and twice[0][1]["incident_id"] == once[0][1]["incident_id"]


def test_session_end_closes_what_is_open_then_closes_the_session():
    msgs = [dev("open", 100.0, 100.0), dev("open", 105.0, 105.0, drv=1), dev("open", 50.0, 50.0, key=2),
            SessionEnded(SCHEMA_VERSION, 1, 110.0, 110.0)]
    agg = Aggregator()
    ev = run(msgs, agg)
    assert [(k, b.get("driver_number")) for k, b in ev] == [("opened", 44), ("opened", 1), ("opened", 44),
                                                            ("closed", 44), ("closed", 1), ("session_closed", None)]
    assert ev[-1][1]["event_id"] == "session:1:closed" and [i.session_key for i in agg.open.values()] == [2]


def test_slowdowns_are_ignored_by_default():
    agg = Aggregator()
    assert run([dev("open", 0.0, 2.0, type_="slowdown", priority="High", severity=60)], agg) == []
    assert agg.ignored == 1


def test_ranked_lists_open_incidents_worst_first():
    agg = Aggregator(types=["slowdown", "engine-stall"])
    run([dev("open", 0.0, 2.0, drv=1, type_="slowdown", priority="Medium", severity=30),
         dev("open", 0.0, 2.0, drv=2, type_="slowdown", priority="High", severity=60),
         dev("open", 3.0, 3.0, drv=3), dev("close", 3.0, 3.1, drv=3), wm(100.0)], agg)
    # car 3's stall closed after the cooldown; cars 1 and 2 still have open runs
    assert [i.driver_number for i in agg.ranked(1)] == [2, 1]


def test_restored_incidents_carry_on_after_a_restart():
    first = Aggregator()
    run([dev("open", 100.0, 100.0)], first)
    saved = [Incident.from_json(i.to_json()) for i in first.take_dirty()]
    assert first.take_dirty() == []
    second = Aggregator()
    second.restore(saved)
    ev = run([dev("close", 100.0, 100.5), wm(161.0)], second)
    assert kinds(ev) == ["closed"] and ev[0][1]["incident_id"] == saved[0].id
