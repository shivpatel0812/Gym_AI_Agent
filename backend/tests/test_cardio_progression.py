"""
Cardio progression.

The behaviour being replaced added one minute AND half a mile per hour to every
session regardless of goal, modality, or how the last one went. Compounded, it
prescribed 50 minutes at 16 mph — a 3:45 mile held for most of an hour. Each
test here pins one of the reasons that happened.
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from ai_analysis.workout_recommender.cardio_progression import (
    CARDIO_GOAL_CONFIGS,
    SPEED_CEILINGS,
    CardioModality,
    CardioOutcome,
    classify_modality,
    compute_cardio_progression,
    evaluate_cardio_session,
    resolve_cardio_config,
)
from ai_analysis.workout_recommender.progression_engine import (
    Decision,
    ProgressionEngine,
)

RUN = "default-cardio-run"
WALK = "default-cardio-normal-walk"
BASKETBALL = "default-cardio-sport-basketball"


def session(time=None, speed=None, fatigue=None, intensity=None, date="2026-08-20"):
    return {
        "date": date,
        "time": time,
        "speed": speed,
        "fatigue": fatigue,
        "intensity": intensity,
    }


def progress(exercise_id, history, goal="Lose Fat", name="", focus=None):
    return compute_cardio_progression(
        exercise_id=exercise_id,
        exercise_name=name,
        history=history,
        user_goal=goal,
        focus_goal=focus,
    )


# --- modality --------------------------------------------------------------


def test_sport_and_steady_are_told_apart():
    assert classify_modality(BASKETBALL, "Basketball") is CardioModality.SPORT
    assert classify_modality(RUN, "Run") is CardioModality.STEADY
    assert classify_modality("custom-1", "Sunday soccer") is CardioModality.SPORT


# --- one variable at a time ------------------------------------------------


def test_duration_builds_first_and_pace_is_held():
    """Moving both at once is what compounded into fiction."""
    result = progress(RUN, [session(time=20, speed=6.0)])

    assert result.time == 23, "duration steps toward the goal target"
    assert result.speed == 6.0, "pace must not move while duration is building"


def test_pace_only_moves_once_the_duration_target_is_held():
    config = CARDIO_GOAL_CONFIGS["fat_loss"]
    result = progress(RUN, [session(time=config.target_duration_min, speed=6.0)])

    assert result.time == config.target_duration_min, "duration now holds"
    assert result.speed == 6.2, "and pace takes one small step"


def test_duration_never_overshoots_its_target():
    config = CARDIO_GOAL_CONFIGS["fat_loss"]
    result = progress(RUN, [session(time=config.target_duration_min - 1, speed=6.0)])
    assert result.time == config.target_duration_min


# --- ceilings --------------------------------------------------------------


def test_pace_stops_at_a_credible_ceiling():
    ceiling = SPEED_CEILINGS[RUN]
    result = progress(RUN, [session(time=45, speed=ceiling)])

    assert result.speed == ceiling
    assert result.decision == "cardio_maintain"


def test_twenty_sessions_no_longer_produce_a_world_record():
    """The exact failure: 20 iterations used to reach 50 min at 16 mph."""
    history = [session(time=30, speed=6.0, fatigue=5)]
    for _ in range(20):
        result = progress(RUN, history)
        history = [session(time=result.time, speed=result.speed, fatigue=5)]

    assert history[0]["time"] <= CARDIO_GOAL_CONFIGS["fat_loss"].max_duration_min
    assert history[0]["speed"] <= SPEED_CEILINGS[RUN]
    assert history[0]["speed"] < 16.0


def test_walking_pace_is_capped_far_below_running_pace():
    """A 4 mph walk is brisk; the old engine would have jogged it to 16."""
    history = [session(time=45, speed=3.0, fatigue=5)]
    for _ in range(30):
        result = progress(WALK, history)
        history = [session(time=result.time, speed=result.speed, fatigue=5)]

    assert history[0]["speed"] <= SPEED_CEILINGS[WALK]


# --- the goal actually matters ---------------------------------------------


def test_fat_loss_and_strength_get_different_cardio():
    same_history = [session(time=25, speed=6.0)]
    fat_loss = progress(RUN, same_history, goal="Lose Fat")
    strength = progress(RUN, same_history, goal="Get Stronger")

    # Fat loss is still building duration at 25 min; strength has passed its
    # (deliberately low) target and is holding, so the lifting isn't taxed.
    assert fat_loss.time > strength.time
    assert strength.time <= CARDIO_GOAL_CONFIGS["strength"].max_duration_min


def test_a_per_exercise_focus_beats_the_profile_goal():
    config = resolve_cardio_config("Lose Fat", focus_goal="strength")
    assert config is CARDIO_GOAL_CONFIGS["strength"]


# --- reading how the last one went -----------------------------------------


def test_high_fatigue_holds_instead_of_adding():
    result = progress(RUN, [session(time=30, speed=6.0, fatigue=9)])

    assert result.decision == "cardio_hold"
    assert result.time == 30
    assert result.speed == 6.0


def test_an_abandoned_session_backs_off():
    history = [
        session(time=12, speed=6.0, date="2026-08-20"),
        session(time=40, speed=6.0, date="2026-08-18"),
    ]
    result = progress(RUN, history)

    assert result.decision == "cardio_backoff"
    assert result.time < 40
    assert "Finish" in (result.guidance or "")


def test_outcomes_are_classified_from_what_was_logged():
    assert evaluate_cardio_session([]) is CardioOutcome.NO_HISTORY
    assert evaluate_cardio_session([session(time=30, fatigue=9)]) is CardioOutcome.HARD
    assert evaluate_cardio_session([session(time=30, fatigue=2)]) is CardioOutcome.EASY
    assert evaluate_cardio_session(
        [session(time=10, date="2026-08-20"), session(time=40, date="2026-08-18")]
    ) is CardioOutcome.CUT_SHORT


# --- sport -----------------------------------------------------------------


def test_sport_gets_an_effort_target_not_a_pace():
    """Basketball used to return time: None, speed: None — nothing at all."""
    result = progress(BASKETBALL, [session(time=60, intensity=9, fatigue=8)], name="Basketball")

    assert result.modality is CardioModality.SPORT
    assert result.time is not None
    assert result.speed is None, "there is no pace to prescribe for a pickup game"
    assert result.target_intensity is not None


def test_sport_reads_the_fatigue_the_app_already_collects():
    # 40 minutes, so there is headroom below the duration ceiling and the
    # comparison reflects the fatigue rating rather than the cap.
    hard = progress(BASKETBALL, [session(time=40, fatigue=9)], name="Basketball")
    easy = progress(BASKETBALL, [session(time=40, fatigue=2)], name="Basketball")

    assert hard.decision == "cardio_hold"
    assert easy.time > hard.time


def test_sport_duration_is_capped_too():
    history = [session(time=40, fatigue=2)]
    for _ in range(20):
        result = progress(BASKETBALL, history, name="Basketball")
        history = [session(time=result.time, fatigue=2)]

    assert history[0]["time"] <= CARDIO_GOAL_CONFIGS["fat_loss"].max_duration_min


# --- first session ---------------------------------------------------------


def test_a_first_session_does_not_invent_a_pace():
    result = progress(RUN, [])

    assert result.decision == "cardio_first_session"
    assert result.speed is None
    assert result.time == 15


def test_duration_target_met_but_no_pace_logged_asks_for_one():
    result = progress(RUN, [session(time=45)])

    assert result.decision == "cardio_needs_pace"
    assert result.speed is None
    assert "Log the speed" in (result.guidance or "")


# --- wiring ----------------------------------------------------------------


def test_the_engine_routes_cardio_through_this_module():
    engine = ProgressionEngine()
    result = engine.compute_recommendation(
        exercise_id=RUN,
        exercise_name="Run",
        user_goal="Lose Fat",
        recent_sessions=[session(time=20, speed=6.0)],
        num_sets=1,
    )

    assert result.decision == Decision.CARDIO_PROGRESS
    assert result.time == 23 and result.speed == 6.0
    assert result.cardio_modality == "steady"
    assert result.guidance
    payload = result.to_dict()
    assert payload["cardio_modality"] == "steady"
    assert payload["guidance"]


def test_sport_reaches_the_engine_without_time_or_speed():
    """
    The history reader used to require time or speed, so a sport session
    logged only with intensity and fatigue was filtered out before the engine
    saw it — which is why basketball returned an empty recommendation.
    """
    engine = ProgressionEngine()
    result = engine.compute_recommendation(
        exercise_id=BASKETBALL,
        exercise_name="Basketball",
        user_goal="Lose Fat",
        recent_sessions=[{"date": "2026-08-20", "sets": [], "intensity": 9, "fatigue": 8}],
        num_sets=1,
    )

    assert result.time is not None
    assert result.target_intensity is not None
    assert result.decision == Decision.CARDIO_HOLD
