"""Nutrition pacing: styles, stalls, option cards, paced trajectories."""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from nutrition.pacing import (
    build_paced_trajectory,
    detect_progress,
    normalize_pacing,
    pacing_options,
    weight_change_lb,
)
from nutrition.plan_builder import NutritionPlanBuilder
from nutrition.plan_edits import apply_edits, normalize_edits
from nutrition.plan_checkin import checkin_edit_candidates


def _plan(goal="muscle", **overrides):
    plan = NutritionPlanBuilder.validate_plan({
        "goal": goal,
        "targets": {"calories": 2800, "protein": 180, "carbs": 300, "fats": 80},
        **overrides,
    })
    return plan


def test_every_plan_gets_a_default_pacing():
    plan = _plan("fat_loss")
    assert plan["pacing"]["style"] == "steady"
    assert plan["pacing"]["weekly_step"] == 0  # cuts stay flat by default


def test_normalize_rejects_unknown_styles():
    pacing = normalize_pacing({"style": "chaos", "weekly_step": 999}, "muscle")
    assert pacing["style"] == "steady"
    assert pacing["weekly_step"] == 250  # clamped


def test_hold_forces_flat_even_when_step_carries_over():
    pacing = normalize_pacing({"style": "hold", "weekly_step": 75}, "muscle")
    assert pacing["weekly_step"] == 0


def test_style_only_defaults_drop_stale_step():
    """Mirrors Roadmap: pick Steady after Hold without sending weekly_step."""
    from nutrition.pacing import normalize_pacing as norm

    hold = {"style": "hold", "weekly_step": 0, "hold_weeks": 2}
    merged = {**hold, "style": "steady"}
    merged.pop("weekly_step", None)
    pacing = norm(merged, "muscle")
    assert pacing["style"] == "steady"
    assert pacing["weekly_step"] == 75


def test_diet_break_injects_maintenance_weeks():
    plan = _plan("fat_loss", pacing={"style": "diet_break", "break_every_n_weeks": 4})
    profile = {
        "weight": 180,
        "age": 28,
        "gender": "male",
        "height_ft": 5,
        "height_in": 10,
        "preferred_workout_frequency": "4-5",
    }
    traj = build_paced_trajectory(plan, weeks=8, profile=profile)
    breaks = [w for w in traj["weeks"] if w.get("phase") == "diet_break"]
    assert breaks
    assert all(w["calories"] == traj["maintenance_calories"] for w in breaks)


def test_aggressive_raises_the_weekly_step_on_a_gain():
    plan = _plan("muscle", pacing={"style": "aggressive"})
    traj = build_paced_trajectory(plan, weeks=6)
    assert traj["weekly_step"] > 75
    assert traj["pacing"]["style"] == "aggressive"


def test_weight_change_needs_spaced_points():
    assert weight_change_lb([{"date": "2026-08-20", "weight_lb": 180}]) is None
    # Same day twice is not a trend.
    assert (
        weight_change_lb([
            {"date": "2026-08-20", "weight_lb": 180},
            {"date": "2026-08-20", "weight_lb": 181},
        ])
        is None
    )
    delta = weight_change_lb([
        {"date": "2026-08-20", "weight_lb": 182},
        {"date": "2026-08-10", "weight_lb": 180},
    ])
    assert delta == 2.0


def test_cut_stall_recommends_diet_break():
    plan = _plan("fat_loss")
    progress = detect_progress(
        plan,
        {"days_logged": 10, "calorie_delta": -20},
        [
            {"date": "2026-08-20", "weight_lb": 180.0},
            {"date": "2026-08-08", "weight_lb": 180.1},
        ],
    )
    assert progress["verdict"] == "stall"
    options = pacing_options(plan, progress)
    assert options[0]["style"] == "diet_break"
    assert options[0]["recommended"]


def test_gain_under_eating_bumps_calories():
    plan = _plan("muscle")
    progress = detect_progress(
        plan,
        {"days_logged": 8, "calorie_delta": -400},
        [],
    )
    assert progress["verdict"] == "under_eating"
    options = pacing_options(plan, progress)
    assert any(
        e["op"] == "update_targets"
        for opt in options
        for e in opt["edits"]
    )


def test_set_pacing_round_trips_through_edits():
    plan = _plan("fat_loss")
    progress = {"verdict": "stall", "reason": "flat"}
    option = pacing_options(plan, progress)[0]
    edits, rejected = normalize_edits(plan, option["edits"])
    assert not rejected
    assert edits[0]["op"] == "set_pacing"
    patch, outcomes = apply_edits(plan, edits)
    assert all(v == "applied" for v in outcomes.values())
    assert patch["pacing"]["style"] == option["style"]


def test_checkin_candidates_include_recommended_pacing():
    plan = _plan("fat_loss")
    facts = {
        "unplanned_habits": [],
        "anchors_missing_macros": [],
        "progress": {
            "verdict": "stall",
            "reason": "flat on a cut",
        },
    }
    candidates = checkin_edit_candidates(plan, facts, progress=facts["progress"])
    assert any(c["op"] == "set_pacing" for c in candidates)
