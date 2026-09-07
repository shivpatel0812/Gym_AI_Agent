"""
Turn "hit 90s for 3 in 12 weeks" into numbers, then say what it would take.

Three things had to be true before this could exist, and all three were false
until recently:

  * The goal had to become numbers. It was stored as free text in
    `primary_goal`, so nothing downstream could check it, pace toward it, or
    notice the plan never trained it.
  * The rate of gain had to depend on the lifter. A flat novice rate made every
    goal look reachable.
  * Energy balance had to be resolved from evidence rather than from a label on
    the plan, or "you need to eat more" could not be said with a straight face.

What this adds is the join: given a lift, a target, and a horizon, it reports
whether the horizon is long enough, and if it is not, which of the two levers —
more time, or more food — closes the gap. It never silently moves the goal.

Deterministic throughout. A feasibility verdict that changes between Tuesday
and Thursday for the same numbers is worse than one consistently a little
wrong, which is the argument `goals.py` and `user_state.py` already make.
"""

import math
import re
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from ai_analysis.plan_projection import (
    EXPERIENCE_WEEKLY_E1RM_GAIN,
    MAX_PROJECTION_WEEKS,
    e1rm,
    plausible_weekly_gain,
)

# Cheapest first. The order is the point: a strength goal reachable at
# maintenance must never be answered with "start bulking".
BALANCE_LADDER = ("lose", "maintain", "gain")

# How far out it is still worth naming a number of weeks. Past this the plan
# will have been revised and the person's life will have changed, which is the
# same reason MAX_PROJECTION_WEEKS exists.
MAX_SUGGESTED_WEEKS = 52


@dataclass
class LiftGoal:
    """A finish line: this load, for these reps, by then."""

    weight: float
    reps: int
    weeks: Optional[int]
    exercise_hint: str
    raw: str

    def to_dict(self) -> Dict[str, Any]:
        return {
            "weight": self.weight,
            "reps": self.reps,
            "weeks": self.weeks,
            "exercise_hint": self.exercise_hint,
            "e1rm": round(e1rm(self.weight, self.reps), 1),
        }


# "in 12 weeks", "over 10 wks", "3 months"
_WEEKS_RE = re.compile(r"(\d{1,2})\s*(?:week|wk)s?\b", re.I)
_MONTHS_RE = re.compile(r"(\d{1,2})\s*(?:month|mo)s?\b", re.I)

# "90s for 3", "90 lb x 3", "225 for 5 reps", "85s for 6-8"
#
# The rep side accepts a range and the destination takes its floor: a goal of
# "85 for 6-8" is met the first time 85 goes for 6. Taking the top would leave
# a user who did exactly what they set out to do still reading "not reached".
_LIFT_RE = re.compile(
    r"(\d{2,4}(?:\.\d+)?)\s*(?:s\b|lbs?\b|pounds?\b|kg\b)?\s*"
    r"(?:for|x|×|@|by)\s*"
    r"(\d{1,2})(?:\s*[-–]\s*(\d{1,2}))?\s*(?:rep|reps)?",
    re.I,
)

# Words that name the lift, taken from the clause before the numbers.
_NOISE = {
    "i", "want", "to", "a", "an", "the", "my", "me", "get", "hit", "reach",
    "increase", "improve", "raise", "push", "build", "up", "on", "for", "of",
    "in", "by", "and", "goal", "is", "be", "able", "can", "would", "like",
    "please", "help", "make", "sure", "am", "at", "with", "do", "week", "weeks",
}


def _clean_hint(text: str) -> str:
    words = [w for w in re.split(r"[^A-Za-z]+", text or "") if w]
    kept = [w for w in words if w.lower() not in _NOISE]
    return " ".join(kept[-4:]).strip()


def parse_lift_goal(text: Optional[str]) -> Optional[LiftGoal]:
    """
    Read a load, a rep count and a horizon out of a sentence, or return None.

    The horizon is consumed **before** the lift is looked for, because "12
    weeks" and "90s for 3" are both a number next to a small number, and a
    reader that takes them in the other order parses "in 12 weeks" as a 12 lb
    triple. Blanking the matched span first is the same trick
    `parse_calorie_hint` uses to stop a calorie figure being read as a portion.
    """
    raw = str(text or "").strip()
    if not raw:
        return None

    weeks: Optional[int] = None
    working = raw

    match = _WEEKS_RE.search(working)
    if match:
        weeks = int(match.group(1))
        working = working[: match.start()] + " " * len(match.group(0)) + working[match.end():]
    else:
        match = _MONTHS_RE.search(working)
        if match:
            weeks = int(match.group(1)) * 4
            working = (
                working[: match.start()] + " " * len(match.group(0)) + working[match.end():]
            )

    lift = _LIFT_RE.search(working)
    if not lift:
        return None

    weight = float(lift.group(1))
    reps = int(lift.group(2))
    if weight <= 0 or reps <= 0 or reps > 30:
        return None

    if weeks is not None:
        weeks = max(1, min(MAX_SUGGESTED_WEEKS, weeks))

    return LiftGoal(
        weight=weight,
        reps=reps,
        weeks=weeks,
        exercise_hint=_clean_hint(working[: lift.start()]),
        raw=raw,
    )


def required_weekly_gain(
    baseline_e1rm: float, target_e1rm: float, weeks: int
) -> Optional[float]:
    """The compounding weekly rate that arrives exactly on time."""
    if not baseline_e1rm or baseline_e1rm <= 0 or not target_e1rm or not weeks:
        return None
    if target_e1rm <= baseline_e1rm:
        return 0.0
    return (target_e1rm / baseline_e1rm) ** (1.0 / max(1, weeks)) - 1.0


def weeks_required(
    baseline_e1rm: float, target_e1rm: float, weekly_gain: float
) -> Optional[int]:
    """How long this goal takes at a given rate, rounded up to a whole week."""
    if not baseline_e1rm or baseline_e1rm <= 0 or not target_e1rm or weekly_gain <= 0:
        return None
    if target_e1rm <= baseline_e1rm:
        return 0
    weeks = math.log(target_e1rm / baseline_e1rm) / math.log(1 + weekly_gain)
    # Compounding a rate derived from this same pair lands a hair over the
    # target, so a goal that takes exactly twelve weeks computes as 12.0000001
    # and a bare ceil reports thirteen. Round to the week before ceiling.
    return max(1, math.ceil(round(weeks, 6)))


def cheapest_sufficient_balance(
    required_rate: float, experience_level: Optional[str]
) -> Optional[str]:
    """
    The least demanding diet that still delivers the goal on time.

    Cheapest first, so a goal a maintenance eater can reach is never answered
    with a surplus they did not ask for. None when even a surplus is not enough
    — that is a horizon problem, not a food problem, and saying "eat more"
    would be the wrong advice as well as an ineffective one.
    """
    for balance in BALANCE_LADDER:
        if plausible_weekly_gain(experience_level, balance) >= required_rate:
            return balance
    return None


@dataclass
class GoalAssessment:
    goal: LiftGoal
    baseline_e1rm: Optional[float]
    target_e1rm: float
    weeks: int
    required_weekly_gain: Optional[float]
    experience_level: str
    current_balance: Optional[str]
    current_weekly_gain: float
    reachable: Optional[bool]
    # The cheapest diet that would make it reachable; None when time is the
    # binding constraint rather than food.
    needed_balance: Optional[str] = None
    weeks_at_current_intake: Optional[int] = None
    nutrition: Optional[Dict[str, Any]] = None
    calorie_change: Optional[int] = None
    verdict: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            "goal": self.goal.to_dict(),
            "baseline_e1rm": round(self.baseline_e1rm, 1) if self.baseline_e1rm else None,
            "target_e1rm": round(self.target_e1rm, 1),
            "weeks": self.weeks,
            "required_weekly_gain": (
                round(self.required_weekly_gain, 5)
                if self.required_weekly_gain is not None
                else None
            ),
            "experience_level": self.experience_level,
            "current_balance": self.current_balance,
            "current_weekly_gain": round(self.current_weekly_gain, 5),
            "reachable": self.reachable,
            "needed_balance": self.needed_balance,
            "weeks_at_current_intake": self.weeks_at_current_intake,
            "nutrition": self.nutrition,
            "calorie_change": self.calorie_change,
            "verdict": self.verdict,
        }


def assess_goal(
    goal: LiftGoal,
    baseline_e1rm: Optional[float],
    profile: Optional[Dict[str, Any]] = None,
    energy_balance: Optional[str] = None,
    current_calories: Optional[float] = None,
    default_weeks: int = 12,
) -> GoalAssessment:
    """
    Whether this finish line fits this horizon, and what it would take.

    Nutrition comes back from `build_training_macros`, not from arithmetic
    invented here, so the calorie and protein figures a goal implies are the
    same ones the nutrition plan would set for that goal. Two places computing
    macros differently is how an app tells a user one number on the plan card
    and another on the nutrition tab.
    """
    from nutrition.training_macros import build_training_macros

    profile = profile or {}
    weeks = goal.weeks or default_weeks
    target = e1rm(goal.weight, goal.reps)
    level = str(
        profile.get("experience_level") or "intermediate"
    ).strip().lower()
    current_rate = plausible_weekly_gain(level, energy_balance)

    required = required_weekly_gain(baseline_e1rm or 0, target, weeks)

    assessment = GoalAssessment(
        goal=goal,
        baseline_e1rm=baseline_e1rm,
        target_e1rm=target,
        weeks=weeks,
        required_weekly_gain=required,
        experience_level=level,
        current_balance=energy_balance,
        current_weekly_gain=current_rate,
        reachable=None,
    )

    if not baseline_e1rm or baseline_e1rm <= 0:
        assessment.verdict = (
            f"No logged history for {goal.exercise_hint or 'this lift'} yet, so "
            "there is nothing to measure the goal against. Log a session and "
            "this will fill in."
        )
        return assessment

    if required is not None and required <= 0:
        assessment.reachable = True
        assessment.verdict = (
            f"You are already at or past {goal.weight:g}x{goal.reps}. Worth "
            "setting a further target."
        )
        return assessment

    assessment.reachable = current_rate >= (required or 0)
    assessment.weeks_at_current_intake = weeks_required(
        baseline_e1rm, target, current_rate
    )

    if assessment.reachable:
        assessment.verdict = (
            f"{goal.weight:g}x{goal.reps} in {weeks} weeks is within reach on "
            f"what you are eating now."
        )
    else:
        assessment.needed_balance = cheapest_sufficient_balance(required or 0, level)

    # What to eat. Asked for whenever a diet change would help, and also when
    # the goal already fits, because "keep eating this" is an answer too.
    goal_balance = assessment.needed_balance or (
        energy_balance if energy_balance in BALANCE_LADDER else "maintain"
    )
    macros = build_training_macros(profile, goal=goal_balance)
    if macros.get("status") == "ready" and macros.get("targets"):
        assessment.nutrition = {
            "for_balance": goal_balance,
            "targets": macros["targets"],
            "source": macros.get("source"),
        }
        target_calories = macros["targets"].get("calories")
        if target_calories and current_calories:
            assessment.calorie_change = int(round(target_calories - current_calories))
    else:
        assessment.nutrition = {
            "for_balance": goal_balance,
            "targets": None,
            "status": macros.get("status"),
            "missing_fields": macros.get("missing_fields"),
        }

    if not assessment.reachable:
        if assessment.needed_balance:
            change = assessment.calorie_change
            eat = ""
            if assessment.nutrition and assessment.nutrition.get("targets"):
                kcal = assessment.nutrition["targets"]["calories"]
                eat = f" That means eating about {kcal:.0f} kcal a day"
                if change and change > 0:
                    eat += f", roughly {change:+d} on what you have been logging"
                eat += "."
            assessment.verdict = (
                f"{goal.weight:g}x{goal.reps} in {weeks} weeks needs about "
                f"{(required or 0) * 100:.2f}% a week, which is more than the "
                f"{current_rate * 100:.2f}% an {level} lifter gets "
                f"{_balance_phrase(energy_balance)}. It is reachable "
                f"{_balance_phrase(assessment.needed_balance)}.{eat}"
            )
        else:
            longer = weeks_required(
                baseline_e1rm,
                target,
                plausible_weekly_gain(level, BALANCE_LADDER[-1]),
            )
            horizon = (
                f" At best it takes about {longer} weeks."
                if longer and longer <= MAX_SUGGESTED_WEEKS
                else " It needs considerably longer than this block."
            )
            assessment.verdict = (
                f"{goal.weight:g}x{goal.reps} in {weeks} weeks is more than "
                f"training delivers at any diet for an {level} lifter."
                f"{horizon} Food is not the lever here — time is."
            )

    return assessment


def _balance_phrase(balance: Optional[str]) -> str:
    """The diet named as a phrase, so verdicts read as English rather than
    splicing a raw enum value into a sentence ("reachable at maintain")."""
    return {
        "lose": "eating in a deficit",
        "maintain": "eating at maintenance",
        "gain": "eating in a surplus",
    }.get(str(balance or "").lower(), "on an unknown diet")


def destination_for_plan(
    goal: LiftGoal, weeks: Optional[int] = None
) -> Dict[str, Any]:
    """The three fields `PlanExercise` already carries for a finish line."""
    return {
        "target_weight": goal.weight,
        "target_reps": goal.reps,
        "target_weeks": max(1, min(MAX_PROJECTION_WEEKS, goal.weeks or weeks or 12)),
    }


def match_exercise(
    hint: str, exercises: List[Dict[str, Any]]
) -> Optional[Dict[str, Any]]:
    """
    The plan exercise a goal is about, by shared identifying words.

    Word overlap rather than substring: "incline" must match "Incline Dumbbell
    Press", and a substring test on the whole hint would not. Returns None
    rather than a best guess when nothing overlaps, so a goal about a lift the
    plan does not contain is left unattached instead of stamped onto whatever
    sorted first.
    """
    words = {w for w in re.split(r"[^a-z]+", (hint or "").lower()) if len(w) > 2}
    if not words:
        return None

    best, best_score = None, 0
    for exercise in exercises or []:
        name = str(exercise.get("exercise_name") or "").lower()
        name_words = {w for w in re.split(r"[^a-z]+", name) if len(w) > 2}
        score = len(words & name_words)
        if score > best_score:
            best, best_score = exercise, score
    return best if best_score else None
