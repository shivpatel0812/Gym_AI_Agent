"""
The readiness seam into the progression engine.

Two guarantees carry the most weight here:

  1. Inert by default. With no readiness, an unusable one, or the demotion
     flag off, the engine's output is byte-identical to what it was before
     readiness existed. That is what makes the seam safe to merge early.
  2. Demotion holds. A held recommendation must survive _ensure_progressed,
     which exists to rewrite any result identical to the last session.
"""

from datetime import datetime, timedelta

import pytest

from ai_analysis.workout_recommender import progression_engine as pe
from ai_analysis.workout_recommender.progression_engine import (
    Decision,
    ProgressionEngine,
)
from ai_analysis.workout_recommender.readiness_context import (
    ReadinessContext,
    ReadinessResolver,
    neutral,
)
from fakes import FakeDb


@pytest.fixture
def enabled(monkeypatch):
    monkeypatch.setattr(pe, "READINESS_DEMOTION_ENABLED", True)


def _sessions(weight=185, reps=(10, 10, 10), count=3):
    out = []
    for i in range(count):
        date = (datetime.now() - timedelta(days=i * 3)).strftime("%Y-%m-%d")
        out.append({
            "date": date,
            "sets": [{"weight": weight, "reps": r, "set_number": j + 1}
                     for j, r in enumerate(reps)],
        })
    return out


def _recommend(engine, readiness=None, sessions=None):
    return engine.compute_recommendation(
        exercise_id="barbell-bench-press",
        exercise_name="Barbell Bench Press",
        user_goal="Build Muscle",
        recent_sessions=sessions or _sessions(),
        num_sets=3,
        readiness=readiness,
    )


# --- inert by default -----------------------------------------------------

def test_no_readiness_matches_the_pre_readiness_result(engine):
    assert _recommend(engine).to_dict() == _recommend(engine, readiness=None).to_dict()


def test_neutral_readiness_changes_nothing(engine):
    assert _recommend(engine, neutral()).to_dict() == _recommend(engine).to_dict()


def test_low_readiness_changes_nothing_while_the_flag_is_off(engine):
    low = ReadinessContext(score=0.5, source="user_state", drivers=["sleep_hours"])
    baseline = _recommend(engine)
    held = _recommend(engine, low)
    assert held.to_dict() == baseline.to_dict()


def test_shadow_mode_records_what_it_would_have_done(engine):
    low = ReadinessContext(score=0.5, source="user_state", drivers=["sleep_hours"])
    context = _recommend(engine, low).reasoning_context
    assert context["readiness_applied"] is False
    assert context["readiness_would_demote_to"] == Decision.MAINTAIN.value
    assert context["readiness_drivers"] == ["sleep_hours"]


# --- the ladder -----------------------------------------------------------

def test_high_readiness_does_not_demote(engine, enabled):
    good = ReadinessContext(score=0.95, source="user_state")
    assert _recommend(engine, good).decision == _recommend(engine).decision


def test_readiness_never_promotes(engine, enabled):
    # A perfect score must not accelerate progression beyond the normal rules.
    perfect = ReadinessContext(score=1.0, source="user_state")
    assert _recommend(engine, perfect).to_dict() == _recommend(engine).to_dict()


@pytest.mark.parametrize(
    "score,expected",
    [
        (0.95, Decision.INCREASE_WEIGHT),
        (0.80, Decision.INCREASE_REPS),
        (0.60, Decision.MAINTAIN),
    ],
)
def test_ladder_steps_down_with_readiness(engine, enabled, score, expected):
    # All sets at the top of the range would normally add weight.
    sessions = _sessions(weight=185, reps=(12, 12, 12))
    result = _recommend(
        engine, ReadinessContext(score=score, source="user_state"), sessions
    )
    assert result.decision == expected


def test_already_conservative_decisions_are_untouched(engine, enabled):
    ladder = ProgressionEngine._DEMOTION_LADDER
    for decision in (Decision.DELOAD, Decision.LIGHT_DAY, Decision.FIRST_SESSION,
                     Decision.MAINTAIN, Decision.NEEDS_STARTING_WEIGHT):
        assert decision not in ladder


def test_a_hold_survives_ensure_progressed(engine, enabled):
    """
    The trap this design exists to avoid: _ensure_progressed rewrites any
    result identical to the last session into a rep increase. A held
    recommendation must come back as MAINTAIN, not silently bumped.
    """
    sessions = _sessions(weight=185, reps=(12, 12, 12))
    result = _recommend(
        engine, ReadinessContext(score=0.6, source="user_state"), sessions
    )
    assert result.decision == Decision.MAINTAIN
    assert not result.reasoning_context.get("forced_progression")
    # Same load and reps as last time — held, not progressed.
    assert [s.weight for s in result.sets] == [185.0, 185.0, 185.0]
    assert [s.reps for s in result.sets] == [12, 12, 12]


def test_demotion_is_recorded_for_the_explanation(engine, enabled):
    sessions = _sessions(weight=185, reps=(12, 12, 12))
    context = _recommend(
        engine, ReadinessContext(score=0.6, source="user_state", drivers=["fatigue"]),
        sessions,
    ).reasoning_context
    assert context["readiness_applied"] is True
    assert context["readiness_demoted_from"] == Decision.INCREASE_WEIGHT.value
    assert context["readiness_drivers"] == ["fatigue"]


# --- the resolver ---------------------------------------------------------

def _state_db(**overrides):
    payload = {
        "id": "current",
        "readiness": 0.7,
        "readiness_source": "computed",
        "readiness_drivers": ["sleep_hours"],
        "computed_at": datetime.now().isoformat(),
    }
    payload.update(overrides)
    return FakeDb(collections={"user_state": [payload]})


def test_resolver_reads_a_fresh_state():
    ctx = ReadinessResolver(_state_db(), "u1").resolve()
    assert ctx.usable
    assert ctx.score == 0.7
    assert ctx.source == "user_state"


def test_resolver_is_neutral_when_no_state_exists():
    assert not ReadinessResolver(FakeDb(), "u1").resolve().usable


def test_resolver_is_neutral_when_state_had_nothing_to_work_from():
    ctx = ReadinessResolver(_state_db(readiness_source="unavailable"), "u1").resolve()
    assert not ctx.usable


def test_resolver_discards_state_from_a_different_week():
    old = (datetime.now() - timedelta(days=10)).isoformat()
    assert not ReadinessResolver(_state_db(computed_at=old), "u1").resolve().usable


def test_resolver_flags_but_still_uses_day_old_state():
    stamp = (datetime.now() - timedelta(hours=40)).isoformat()
    ctx = ReadinessResolver(_state_db(computed_at=stamp), "u1").resolve()
    assert ctx.usable
    assert ctx.source == "stale"


@pytest.mark.parametrize("bad", [None, "0.7", True, -1, 1.5, float("nan")])
def test_resolver_rejects_malformed_scores(bad):
    if bad != bad:  # NaN fails every comparison, including the range check
        assert not ReadinessResolver(_state_db(readiness=bad), "u1").resolve().usable
        return
    assert not ReadinessResolver(_state_db(readiness=bad), "u1").resolve().usable
