"""
The signal pipeline: registry → daily rollup → user_state → readiness seam.

The property that matters most across all of it is the cancel rule: a signal
without enough evidence behind it contributes nothing, at every layer, all the
way up to leaving the recommendation engine byte-identical.
"""

from datetime import datetime, timedelta

import pytest

from fakes import FakeDb, rows, today
from metrics import compute_baseline, registry as reg
from state import DailyRollupBuilder, UserStateBuilder


# --- registry -------------------------------------------------------------

def test_polarity_decides_which_direction_is_a_problem():
    # Sleeping more than target is not a lever; being more fatigued is.
    assert reg.shortfall("sleep_hours", -0.2) == pytest.approx(0.2)
    assert reg.shortfall("sleep_hours", 0.2) == 0.0
    assert reg.shortfall("fatigue", 0.5) == pytest.approx(0.5)
    assert reg.shortfall("fatigue", -0.5) == 0.0


def test_on_target_metrics_count_both_directions():
    # Eating 400 calories over a bulk target is a miss, same as 400 under.
    assert reg.shortfall("calories", 0.15) == pytest.approx(0.15)
    assert reg.shortfall("calories", -0.15) == pytest.approx(0.15)


def test_every_metric_declares_a_direction_and_scale_is_bounded():
    for key, metric in reg.REGISTRY.items():
        assert metric.direction in (
            reg.HIGHER_BETTER, reg.LOWER_BETTER, reg.ON_TARGET, reg.CONTEXT
        ), key
        assert 0.0 <= metric.actionability <= 1.0, key
        if metric.scale:
            assert metric.scale[0] < metric.scale[1], key


def test_subjective_scales_average_rather_than_add():
    # Rating fatigue 4 then 6 in one day is a 5, not a 10.
    assert reg.REGISTRY["fatigue"].aggregate == reg.AGG_MEAN
    assert reg.REGISTRY["steps"].aggregate == reg.AGG_SUM


# --- daily rollup ---------------------------------------------------------

def test_rollup_gives_every_metric_the_same_shape():
    db = FakeDb(collections={
        "sleep": rows("hours_slept", [7.5, 7.0, 8.0, 7.5, 7.0, 7.5, 7.5]),
        "macros": rows("total_protein", [150, 160, 140, 155, 145, 150, 150]),
    })
    day = DailyRollupBuilder(db, "u1").build_day(today())

    assert set(day["metrics"]) == {"sleep_hours", "protein"}
    for reading in day["metrics"].values():
        assert set(reading) == {
            "value", "target", "deviation", "confidence", "status", "target_source"
        }


def test_rollup_keeps_the_value_but_cancels_the_target_on_thin_history():
    # The raw signal is preserved — the layer is lossy about aggregates, never
    # about signals — but with no defensible target there is no deviation, so
    # nothing downstream can act on it.
    db = FakeDb(collections={"sleep": rows("hours_slept", [7.5, 6.0])})
    reading = DailyRollupBuilder(db, "u1").build_day(today())["metrics"]["sleep_hours"]

    assert reading["value"] == 7.5
    assert reading["target"] is None
    assert reading["deviation"] is None
    assert reading["confidence"] == 0.0
    assert reading["status"] == "insufficient_data"


def test_a_day_with_nothing_logged_has_no_metrics():
    db = FakeDb(collections={"sleep": rows("hours_slept", [7.5] * 7, start_offset=3)})
    day = DailyRollupBuilder(db, "u1").build_day(today())
    assert "sleep_hours" not in day["metrics"]


def test_rollup_collapses_several_same_day_entries():
    stamp = today()
    db = FakeDb(collections={
        "physical_activities": [
            {"date": stamp, "steps": 4000},
            {"date": stamp, "steps": 3000},
        ] + rows("steps", [8000] * 6, start_offset=1),
    })
    day = DailyRollupBuilder(db, "u1").build_day(stamp)
    # Two walks in a day are one day of 7000 steps.
    assert day["metrics"]["steps"]["value"] == 7000


def test_rollup_summarizes_training():
    stamp = today()
    db = FakeDb(collections={"workout_sessions": [{
        "date": stamp,
        "exercises": [{
            "exercise_id": "bench",
            "sets": [
                {"weight": 100, "reps": 10, "rpe": 8},
                {"weight": 100, "reps": 8, "rpe": 9},
            ],
        }],
    }]})
    trained = DailyRollupBuilder(db, "u1").build_day(stamp)["trained"]
    assert trained["sessions"] == 1
    assert trained["volume"] == 1800.0
    assert trained["avg_rpe"] == 8.5


def test_rollup_marks_a_rest_day_as_untrained():
    db = FakeDb(collections={"workout_sessions": []})
    assert DailyRollupBuilder(db, "u1").build_day(today())["trained"] is None


def test_declared_targets_beat_inferred_ones():
    db = FakeDb(
        collections={"sleep": rows("hours_slept", [6.0] * 10)},
        profile={"sleep_goal": 8.0},
    )
    reading = DailyRollupBuilder(db, "u1").build_day(today())["metrics"]["sleep_hours"]
    assert reading["target"] == 8.0
    assert reading["target_source"] == "declared"
    assert reading["deviation"] == -0.25


def test_nutrition_plan_supplies_the_protein_target():
    db = FakeDb(collections={
        "macros": rows("total_protein", [140] * 10),
        "nutrition_plans": [{
            "id": "p1", "status": "active", "created_at": "2026-08-01",
            "targets": {"protein": 200},
        }],
    })
    reading = DailyRollupBuilder(db, "u1").build_day(today())["metrics"]["protein"]
    assert reading["target"] == 200.0
    assert reading["target_source"] == "declared"


# --- user state -----------------------------------------------------------

def _struggling_db():
    """Sleeps badly, reports high fatigue, eats well."""
    return FakeDb(
        collections={
            "sleep": rows("hours_slept", [5.5, 5.0, 6.0, 5.5, 6.0, 5.0, 5.5,
                                          7.5, 7.5, 7.5, 8.0, 7.5, 7.5, 8.0]),
            "wellness_survey": rows("fatigue", [8, 8, 7, 8, 7, 8, 8,
                                                4, 4, 4, 4, 4, 5, 4]),
            "macros": rows("total_protein", [190] * 14),
        },
        profile={"sleep_goal": 8.0},
    )


def test_readiness_falls_when_recovery_signals_are_bad():
    state = UserStateBuilder(_struggling_db(), "u1").build()
    assert state.readiness_source == "computed"
    assert state.readiness < 0.9
    assert "sleep_hours" in state.readiness_drivers


def test_readiness_is_neutral_and_says_so_without_data():
    state = UserStateBuilder(FakeDb(), "u1").build()
    assert state.readiness == 1.0
    assert state.readiness_source == "unavailable"
    assert state.next_levers == []


def test_readiness_never_falls_below_the_floor():
    from state.user_state import READINESS_FLOOR

    db = FakeDb(
        collections={
            "sleep": rows("hours_slept", [2.0] * 14),
            "wellness_survey": rows("fatigue", [10] * 14),
            "stress": rows("level", [10] * 14),
        },
        profile={"sleep_goal": 9.0, "typical_stress_level": 2},
    )
    assert UserStateBuilder(db, "u1").build().readiness >= READINESS_FLOOR


def test_levers_are_ranked_and_a_focus_is_named():
    state = UserStateBuilder(_struggling_db(), "u1").build()
    scores = [l["score"] for l in state.next_levers]
    assert scores == sorted(scores, reverse=True)
    assert state.current_focus == state.next_levers[0]["label"]


def test_actionability_can_outrank_a_larger_gap():
    # Protein is 20% short and highly actionable; sleep is 25% short but you
    # cannot prescribe sleep. The more fixable gap should lead.
    db = FakeDb(
        collections={
            "sleep": rows("hours_slept", [6.0] * 14),
            "macros": rows("total_protein", [160] * 14),
            "nutrition_plans": [{
                "id": "p1", "status": "active", "created_at": "2026-08-01",
                "targets": {"protein": 200},
            }],
        },
        profile={"sleep_goal": 8.0},
    )
    state = UserStateBuilder(db, "u1").build()
    assert state.current_focus == "Protein"


def test_negligible_gaps_are_not_levers():
    # An inferred target is a median, so about half of all days sit just below
    # it. Without a floor every metric would always look like a problem.
    db = FakeDb(collections={"macros": rows("total_protein", [190, 191, 189, 190, 190, 191, 189] * 2)})
    assert UserStateBuilder(db, "u1").build().next_levers == []
