"""
Nutrition pacing: how the plan's calorie target moves over weeks.

The nutrition plan is a static strategy (meals, slots, daily targets). Pacing is
the layer on top that says *how* those calories should change when the goal is
to gain or lose — and what to try when the scale does not cooperate.

Styles are product choices, not medical advice. Every change still lands as a
staged suggestion the user Accepts; nothing here rewrites a live plan on its
own.

Weigh-ins are optional. Without them, progress is judged from calorie
adherence alone (under-eating, overshooting), which is weaker but still useful
and does not invent a weight curve from thin air.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

from nutrition.trajectory import (
    MAX_CALORIE_DRIFT,
    WEEKLY_CALORIE_STEP,
    build_trajectory,
    estimate_maintenance_calories,
)

# ---------------------------------------------------------------------------
# Styles
# ---------------------------------------------------------------------------

PACING_STYLES = (
    "steady",       # Default ramp from trajectory.py
    "hold",         # Flat calories; reassess after the hold window
    "diet_break",   # One week near maintenance inside a cut block
    "refeed",       # 1–2 higher days/week, same weekly average
    "alternate_day",  # Training days higher, rest days lower
    "aggressive",   # Bigger weekly step, shorter drift cap in time
)

STYLE_LABELS = {
    "steady": "Steady ramp",
    "hold": "Hold & assess",
    "diet_break": "Diet break weeks",
    "refeed": "Refeed days",
    "alternate_day": "Training-day tilt",
    "aggressive": "Aggressive step",
}

STYLE_BLURBS = {
    "steady": "Calories move the same amount each week. Predictable, easy to log against.",
    "hold": "Keep the current number for a few weeks, then decide. Best when the scale is noisy.",
    "diet_break": "Every few weeks, eat near maintenance for one week, then resume the cut.",
    "refeed": "One or two higher-calorie days each week inside the same weekly average.",
    "alternate_day": "Same weekly calories — more on lift days, less on rest days.",
    "aggressive": "Bigger weekly jumps, shorter block. Use when you have a deadline.",
}

# Progress verdicts from a check-in window.
PROGRESS_ON_TRACK = "on_track"
PROGRESS_STALL = "stall"
PROGRESS_TOO_FAST = "too_fast"
PROGRESS_UNDER_EATING = "under_eating"
PROGRESS_OVERSHOOTING = "overshooting"
PROGRESS_UNKNOWN = "unknown"

_GAIN_GOALS = {"lean_bulk", "muscle"}
_LOSS_GOALS = {"fat_loss"}


def _num(value, default: float = 0.0) -> float:
    try:
        if value is None or value == "":
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def _style_for_goal(goal: str) -> str:
    """Sensible default when a plan has never chosen a pacing style."""
    if goal in _GAIN_GOALS:
        return "steady"
    if goal in _LOSS_GOALS:
        return "steady"  # flat cut is still "steady" — step is 0
    return "hold"


def normalize_pacing(raw: Any, goal: Optional[str] = None) -> Dict[str, Any]:
    """
    Clamp a pacing blob into something safe to store on the plan.

    Missing or junk input falls back to a goal-appropriate default rather than
    leaving the field absent — the Roadmap and check-in both assume it exists.
    """
    goal_key = goal if goal in WEEKLY_CALORIE_STEP else "maintain"
    data = raw if isinstance(raw, dict) else {}

    style = str(data.get("style") or "").strip().lower()
    if style not in PACING_STYLES:
        style = _style_for_goal(goal_key)

    default_step = WEEKLY_CALORIE_STEP.get(goal_key, 0)
    step_raw = data.get("weekly_step")
    if style == "hold":
        # Hold is always flat — ignore a leftover ramp from a prior style.
        weekly_step = 0
    elif step_raw is None or step_raw == "":
        weekly_step = default_step
        if style == "aggressive" and default_step > 0:
            weekly_step = int(round(default_step * 1.5))
    else:
        weekly_step = int(round(_num(step_raw)))
        weekly_step = max(-250, min(250, weekly_step))

    hold_weeks = int(round(_num(data.get("hold_weeks"), 2)))
    hold_weeks = max(1, min(6, hold_weeks))

    break_every = int(round(_num(data.get("break_every_n_weeks"), 5)))
    break_every = max(3, min(10, break_every))

    refeed_days = []
    for day in data.get("refeed_days") or []:
        key = str(day or "").strip().lower()[:3]
        if key in ("mon", "tue", "wed", "thu", "fri", "sat", "sun") and key not in refeed_days:
            refeed_days.append(key)
    if style == "refeed" and not refeed_days:
        refeed_days = ["sat"]

    training_bump = int(round(_num(data.get("training_day_bump"), 150)))
    training_bump = max(50, min(300, training_bump))

    return {
        "style": style,
        "label": STYLE_LABELS[style],
        "blurb": STYLE_BLURBS[style],
        "weekly_step": weekly_step,
        "hold_weeks": hold_weeks,
        "break_every_n_weeks": break_every,
        "refeed_days": refeed_days,
        "training_day_bump": training_bump,
        "last_reviewed_at": str(data.get("last_reviewed_at") or "").strip()[:40] or None,
    }


def default_pacing(goal: Optional[str] = None) -> Dict[str, Any]:
    return normalize_pacing({}, goal)


# ---------------------------------------------------------------------------
# Trajectory shaped by pacing
# ---------------------------------------------------------------------------

def build_paced_trajectory(
    plan: Dict[str, Any],
    weeks: int,
    profile: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Expand the plan's targets into a week-by-week curve that respects pacing.

    Diet-break weeks sit near maintenance. Refeed and alternate-day do not change
    the *daily average* the chart shows — they annotate how days inside the week
    should tilt, which Today guidance can read later.
    """
    goal = str(plan.get("goal") or "maintain")
    pacing = normalize_pacing(plan.get("pacing"), goal)
    targets = plan.get("targets") or {}

    override = pacing["weekly_step"]
    # Hold and diet_break styles start flat; diet_break injects maintenance weeks
    # after the base trajectory is built.
    if pacing["style"] in ("hold", "diet_break"):
        override = 0

    traj = build_trajectory(
        goal=goal,
        targets=targets,
        weeks=weeks,
        profile=profile,
        weekly_step_override=override,
    )
    payload = traj.to_dict()
    payload["pacing"] = pacing

    maintenance = payload.get("maintenance_calories")
    week_rows = list(payload.get("weeks") or [])

    if pacing["style"] == "diet_break" and maintenance and week_rows:
        every = pacing["break_every_n_weeks"]
        for row in week_rows:
            if row["week"] % every == 0:
                row["calories"] = int(maintenance)
                row["phase"] = "diet_break"
            else:
                row["phase"] = "cut"
        payload["rationale"] = (
            f"Cut weeks hold at {targets.get('calories')} kcal. "
            f"Every {every}th week is a diet break near maintenance (~{maintenance} kcal)."
        )
    elif pacing["style"] == "refeed":
        days = ", ".join(d.title() for d in pacing["refeed_days"]) or "one day"
        bump = 250
        payload["rationale"] = (
            f"Weekly average stays on target. {days}: about +{bump} kcal "
            f"(pull the same amount from other days)."
        )
        payload["day_tilt"] = {
            "mode": "refeed",
            "high_days": pacing["refeed_days"],
            "bump": bump,
        }
    elif pacing["style"] == "alternate_day":
        bump = pacing["training_day_bump"]
        payload["rationale"] = (
            f"Same weekly calories. Training days +{bump} kcal, rest days −{bump} kcal."
        )
        payload["day_tilt"] = {
            "mode": "alternate_day",
            "training_day_bump": bump,
        }
    elif pacing["style"] == "hold":
        payload["rationale"] = (
            f"Calories hold at {targets.get('calories')} kcal for "
            f"{pacing['hold_weeks']} weeks, then we reassess from your check-in."
        )
    elif pacing["style"] == "aggressive" and override:
        payload["rationale"] = (
            f"Aggressive step: +{override} kcal each week. "
            "Shorter runway — reassess as soon as the trend runs hot."
        )

    # Cap aggressive drift tighter in time (still uses MAX via build_trajectory,
    # but surface the style on the payload for the UI).
    payload["weekly_step"] = override if pacing["style"] != "diet_break" else 0
    return payload


# ---------------------------------------------------------------------------
# Weigh-ins (lightweight)
# ---------------------------------------------------------------------------

def save_weigh_in(db, user_id: str, weight_lb: float, date: Optional[str] = None) -> Dict[str, Any]:
    """Append one weigh-in. Used by check-in when the user reports a weight."""
    day = (date or datetime.now().strftime("%Y-%m-%d"))[:10]
    weight = round(float(weight_lb), 1)
    if weight < 70 or weight > 500:
        raise ValueError("Weight must be between 70 and 500 lb.")
    record = {
        "date": day,
        "weight_lb": weight,
        "created_at": datetime.now().isoformat(),
    }
    db.collection("users").document(user_id).collection("weigh_ins").add(record)
    return record


def recent_weigh_ins(db, user_id: str, days: int = 28) -> List[Dict[str, Any]]:
    """Newest-first weigh-ins inside the window. Empty if none logged."""
    cutoff = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")
    try:
        docs = (
            db.collection("users")
            .document(user_id)
            .collection("weigh_ins")
            .where("date", ">=", cutoff)
            .stream()
        )
        rows = []
        for doc in docs:
            data = doc.to_dict() or {}
            w = _num(data.get("weight_lb"))
            d = str(data.get("date") or "")[:10]
            if w and d:
                rows.append({"date": d, "weight_lb": w})
        rows.sort(key=lambda r: r["date"], reverse=True)
        return rows
    except Exception as e:
        print(f"recent_weigh_ins error: {e}")
        return []


def weight_change_lb(weigh_ins: List[Dict[str, Any]], window_days: int = 14) -> Optional[float]:
    """
    Net change from the oldest weigh-in in the window to the newest.

    Needs at least two points at least 5 days apart — anything tighter is noise.
    """
    if len(weigh_ins) < 2:
        return None
    newest = weigh_ins[0]
    oldest = None
    for row in reversed(weigh_ins):
        try:
            gap = (
                datetime.strptime(newest["date"], "%Y-%m-%d")
                - datetime.strptime(row["date"], "%Y-%m-%d")
            ).days
        except ValueError:
            continue
        if gap >= 5:
            oldest = row
            break
    if not oldest:
        return None
    return round(newest["weight_lb"] - oldest["weight_lb"], 1)


# ---------------------------------------------------------------------------
# Progress / stall detection
# ---------------------------------------------------------------------------

def detect_progress(
    plan: Dict[str, Any],
    checkin_facts: Dict[str, Any],
    weigh_ins: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """
    Judge how the last couple of weeks went against the plan's goal.

    Weight trend wins when weigh-ins exist. Otherwise we fall back to calorie
    adherence, which can still catch under-eating and chronic overshooting.
    """
    goal = str(plan.get("goal") or "maintain")
    days_logged = int(checkin_facts.get("days_logged") or 0)
    cal_delta = checkin_facts.get("calorie_delta")
    weight_delta = weight_change_lb(weigh_ins or [])

    result: Dict[str, Any] = {
        "verdict": PROGRESS_UNKNOWN,
        "weight_delta_lb": weight_delta,
        "calorie_delta": cal_delta,
        "days_logged": days_logged,
        "goal": goal,
        "reason": None,
    }

    if days_logged < 5:
        result["reason"] = "Need at least five logged days before pacing advice is useful."
        return result

    # Calorie adherence signals that do not need the scale.
    if cal_delta is not None and cal_delta < -300 and goal in _GAIN_GOALS:
        result["verdict"] = PROGRESS_UNDER_EATING
        result["reason"] = (
            f"Averaging {abs(int(cal_delta))} kcal under your surplus target — "
            "the plan cannot build if the food is not there."
        )
        return result
    if cal_delta is not None and cal_delta > 300 and goal in _LOSS_GOALS:
        result["verdict"] = PROGRESS_OVERSHOOTING
        result["reason"] = (
            f"Averaging {int(cal_delta)} kcal over the cut target. "
            "Tighten logging before cutting deeper."
        )
        return result

    if weight_delta is None:
        if abs(cal_delta or 0) <= 150:
            result["verdict"] = PROGRESS_ON_TRACK
            result["reason"] = "Calories are landing near target. Log weigh-ins to judge the scale."
        else:
            result["verdict"] = PROGRESS_UNKNOWN
            result["reason"] = "Not enough weigh-ins to judge progress. Report a weight on check-in."
        return result

    # Scale-based for gaining.
    if goal in _GAIN_GOALS:
        if weight_delta <= 0.2:
            result["verdict"] = PROGRESS_STALL
            result["reason"] = (
                f"Weight is roughly flat ({weight_delta:+.1f} lb). "
                "A surplus that is not moving the scale usually needs more food or a refeed."
            )
        elif weight_delta >= 1.5:
            result["verdict"] = PROGRESS_TOO_FAST
            result["reason"] = (
                f"Up {weight_delta:.1f} lb across the window — faster than a lean gain wants. "
                "Hold or slow the ramp."
            )
        else:
            result["verdict"] = PROGRESS_ON_TRACK
            result["reason"] = f"Up {weight_delta:.1f} lb — on a reasonable gaining pace."
        return result

    # Scale-based for cutting.
    if goal in _LOSS_GOALS:
        if weight_delta >= -0.2:
            result["verdict"] = PROGRESS_STALL
            result["reason"] = (
                f"Weight is roughly flat ({weight_delta:+.1f} lb) on a cut. "
                "A diet break or a small cut usually beats stacking a deeper deficit."
            )
        elif weight_delta <= -2.5:
            result["verdict"] = PROGRESS_TOO_FAST
            result["reason"] = (
                f"Down {abs(weight_delta):.1f} lb — too fast for muscle retention. "
                "Raise calories toward maintenance for a week."
            )
        else:
            result["verdict"] = PROGRESS_ON_TRACK
            result["reason"] = f"Down {abs(weight_delta):.1f} lb — on a reasonable cutting pace."
        return result

    result["verdict"] = PROGRESS_ON_TRACK
    result["reason"] = f"Weight change {weight_delta:+.1f} lb over the window."
    return result


# ---------------------------------------------------------------------------
# Option cards (rules-first)
# ---------------------------------------------------------------------------

def pacing_options(
    plan: Dict[str, Any],
    progress: Dict[str, Any],
) -> List[Dict[str, Any]]:
    """
    Two or three concrete pacing choices for the current verdict.

    Each option carries a `set_pacing` edit (and sometimes `update_targets`) so
    it can go through the same suggestion Accept path as coach edits.
    """
    goal = str(plan.get("goal") or "maintain")
    current = normalize_pacing(plan.get("pacing"), goal)
    targets = plan.get("targets") or {}
    base_cal = int(_num(targets.get("calories")) or 0)
    verdict = progress.get("verdict") or PROGRESS_UNKNOWN
    options: List[Dict[str, Any]] = []

    def card(
        title: str,
        why: str,
        how: str,
        style: str,
        *,
        weekly_step: Optional[int] = None,
        calorie_delta: int = 0,
        recommended: bool = False,
        extra: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        pacing_payload = {
            "style": style,
            "weekly_step": weekly_step if weekly_step is not None else current["weekly_step"],
            "hold_weeks": current["hold_weeks"],
            "break_every_n_weeks": current["break_every_n_weeks"],
            "refeed_days": current["refeed_days"],
            "training_day_bump": current["training_day_bump"],
            "last_reviewed_at": datetime.now().isoformat(),
            **(extra or {}),
        }
        pacing_payload = normalize_pacing(pacing_payload, goal)
        edits: List[Dict[str, Any]] = [{
            "op": "set_pacing",
            "payload": {"pacing": pacing_payload},
            "rationale": why,
        }]
        if calorie_delta and base_cal:
            new_cal = max(1200, min(4500, base_cal + calorie_delta))
            edits.append({
                "op": "update_targets",
                "payload": {"calories": new_cal},
                "rationale": f"Move daily calories {calorie_delta:+d} to match this pacing.",
            })
        return {
            "id": f"{style}-{calorie_delta}",
            "title": title,
            "why": why,
            "how": how,
            "recommended": recommended,
            "style": style,
            "label": STYLE_LABELS[style],
            "edits": edits,
        }

    if verdict == PROGRESS_UNDER_EATING and goal in _GAIN_GOALS:
        options.append(card(
            "Raise the surplus",
            progress.get("reason") or "You are not hitting the calorie target.",
            f"Bump daily calories by +150 and keep a steady ramp.",
            "steady",
            weekly_step=max(current["weekly_step"], WEEKLY_CALORIE_STEP.get(goal, 75)),
            calorie_delta=150,
            recommended=True,
        ))
        options.append(card(
            "Hold the target, fix logging",
            "Sometimes the plan is fine and the week was just under-logged.",
            "Keep calories where they are for 2 weeks and hit the number most days.",
            "hold",
            weekly_step=0,
        ))

    elif verdict == PROGRESS_STALL and goal in _GAIN_GOALS:
        options.append(card(
            "Bump the surplus",
            progress.get("reason") or "Weight is not moving up.",
            "Add +150 kcal/day and keep the weekly ramp.",
            "steady",
            weekly_step=max(75, current["weekly_step"]),
            calorie_delta=150,
            recommended=True,
        ))
        options.append(card(
            "Add refeed days",
            "Same weekly average, with one or two higher days to push intake up in practice.",
            "Saturday (and optionally Wednesday) run ~+250 kcal; trim other days to match.",
            "refeed",
            weekly_step=0,
            extra={"refeed_days": ["sat", "wed"]},
        ))
        options.append(card(
            "Training-day tilt",
            "Put more food on lift days when hunger and recovery matter most.",
            f"+{current['training_day_bump']} kcal on training days, −{current['training_day_bump']} on rest days.",
            "alternate_day",
            weekly_step=0,
        ))

    elif verdict == PROGRESS_TOO_FAST and goal in _GAIN_GOALS:
        options.append(card(
            "Hold calories",
            progress.get("reason") or "Gaining faster than planned.",
            f"Freeze at {base_cal} kcal for {current['hold_weeks']} weeks, then reassess.",
            "hold",
            weekly_step=0,
            recommended=True,
        ))
        options.append(card(
            "Slow the ramp",
            "Keep moving up, just less aggressively.",
            "Cut the weekly step in half going forward.",
            "steady",
            weekly_step=max(25, current["weekly_step"] // 2),
        ))

    elif verdict == PROGRESS_STALL and goal in _LOSS_GOALS:
        options.append(card(
            "Diet break (recommended)",
            progress.get("reason") or "Cut has stalled.",
            "One week near maintenance every 5 weeks, then resume the cut — "
            "usually beats cutting deeper.",
            "diet_break",
            weekly_step=0,
            recommended=True,
            extra={"break_every_n_weeks": 5},
        ))
        options.append(card(
            "Small cut",
            "Trim a little and reassess in two weeks.",
            "Drop daily calories by 100 and hold flat.",
            "hold",
            weekly_step=0,
            calorie_delta=-100,
        ))
        options.append(card(
            "Training-day tilt",
            "Same weekly deficit, easier on hard training days.",
            f"+{current['training_day_bump']} on lift days, −{current['training_day_bump']} on rest days.",
            "alternate_day",
            weekly_step=0,
        ))

    elif verdict == PROGRESS_TOO_FAST and goal in _LOSS_GOALS:
        options.append(card(
            "Raise toward maintenance",
            progress.get("reason") or "Losing too fast.",
            "Add +150 kcal/day and hold for two weeks.",
            "hold",
            weekly_step=0,
            calorie_delta=150,
            recommended=True,
        ))
        options.append(card(
            "Full diet break week",
            "Take a week near maintenance, then resume.",
            "Switch to diet-break pacing so every 4th week sits near maintenance.",
            "diet_break",
            weekly_step=0,
            extra={"break_every_n_weeks": 4},
        ))

    elif verdict == PROGRESS_OVERSHOOTING and goal in _LOSS_GOALS:
        options.append(card(
            "Hold the target",
            progress.get("reason") or "Logging above the cut.",
            "Keep the number; focus on hitting it 5+ days this week before changing anything.",
            "hold",
            weekly_step=0,
            recommended=True,
        ))
        options.append(card(
            "Refeed structure",
            "One planned higher day can stop weekend overshoots from becoming a free-for-all.",
            "Saturday +250 kcal; pull from two weekdays so the weekly average holds.",
            "refeed",
            weekly_step=0,
            extra={"refeed_days": ["sat"]},
        ))

    else:
        # On-track or unknown: still offer intentional style choices.
        if goal in _GAIN_GOALS:
            options.append(card(
                "Keep the steady ramp",
                "Things look fine — stay the course.",
                STYLE_BLURBS["steady"],
                "steady",
                weekly_step=WEEKLY_CALORIE_STEP.get(goal, 75),
                recommended=True,
            ))
            options.append(card(
                "Go aggressive",
                "Bigger weekly jumps if you want to reach the top of the ramp sooner.",
                STYLE_BLURBS["aggressive"],
                "aggressive",
                weekly_step=int(round(WEEKLY_CALORIE_STEP.get(goal, 75) * 1.5)),
            ))
        elif goal in _LOSS_GOALS:
            options.append(card(
                "Hold the deficit",
                "Steady cut without deepening.",
                STYLE_BLURBS["hold"],
                "hold",
                weekly_step=0,
                recommended=True,
            ))
            options.append(card(
                "Build in diet breaks",
                "Prevent the next stall by scheduling maintenance weeks now.",
                STYLE_BLURBS["diet_break"],
                "diet_break",
                weekly_step=0,
            ))
        else:
            options.append(card(
                "Hold steady",
                STYLE_BLURBS["hold"],
                "Keep calories flat and reassess every couple of weeks.",
                "hold",
                weekly_step=0,
                recommended=True,
            ))

    # Drop a card that is identical to what they already run (unless recommended).
    filtered = []
    for opt in options:
        same_style = opt["style"] == current["style"]
        if same_style and not opt["recommended"] and len(options) > 1:
            continue
        filtered.append(opt)
    return filtered[:3]


def catalog_styles(goal: Optional[str] = None) -> List[Dict[str, Any]]:
    """All styles the user can pick from the Roadmap, with goal-aware defaults."""
    goal_key = goal if goal in WEEKLY_CALORIE_STEP else "maintain"
    out = []
    for style in PACING_STYLES:
        # Diet break / refeed are mostly cut tools; aggressive is mostly a gain tool.
        if style == "diet_break" and goal_key not in _LOSS_GOALS:
            continue
        if style == "aggressive" and goal_key not in _GAIN_GOALS:
            continue
        sample = normalize_pacing({"style": style}, goal_key)
        out.append({
            "style": style,
            "label": sample["label"],
            "blurb": sample["blurb"],
            "weekly_step": sample["weekly_step"],
        })
    return out
