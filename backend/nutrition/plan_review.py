"""
Coach review of a nutrition plan the user built.

This is the layer above meal ideas. Ideas answer "what could I eat in this
slot"; a review answers "is what you have set up actually going to work". It
reads like a coach looking over your shoulder — agreeing with the parts that
are solid and naming the two or three changes that would help most — rather
than proposing a replacement plan.

The findings the model gets are computed first, deterministically, from the
plan itself (`plan_facts`). The model writes the words; it does not invent the
numbers, and with no API key the review still returns real observations.
"""

from __future__ import annotations

import json
import os
from datetime import datetime
from typing import Any, Dict, List, Optional

from ai_models import completion_kwargs, resolve_model
from nutrition.meal_math import DAY_KEYS, anchor_kind, anchor_macros, day_keys
from nutrition.plan_builder import HEALTH_FOCUSES, _health_focus_list
from nutrition.today_guidance import plan_coverage

PRIMARY_SLOTS = ("breakfast", "lunch", "pre_workout", "dinner", "snack")

# Under this and a meal is not really carrying its share of the protein target.
LOW_PROTEIN_MEAL = 15


def _num(value, default: float = 0.0) -> float:
    try:
        if value is None or value == "":
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def _covered_days(anchors: List[Dict]) -> Dict[str, int]:
    """How many anchors land on each weekday."""
    counts = {key: 0 for key in DAY_KEYS}
    for anchor in anchors:
        keys = day_keys(anchor.get("days"))
        if not keys:
            freq = str(anchor.get("frequency") or "daily").lower()
            if freq == "weekdays":
                keys = list(DAY_KEYS[:5])
            elif freq == "weekends":
                keys = list(DAY_KEYS[5:])
            else:
                keys = list(DAY_KEYS)
        for key in keys:
            counts[key] += 1
    return counts


def plan_facts(plan: Dict[str, Any], recent: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """
    Everything checkable about a plan, worked out without a model.

    These are the observations a review is allowed to be built on. Each one is
    something the user could verify by looking at their own plan page.
    """
    anchors = [a for a in (plan.get("meal_anchors") or []) if isinstance(a, dict)]
    coverage = plan_coverage(plan)
    targets = plan.get("targets") or {}
    recent = recent or {}

    by_slot: Dict[str, Dict[str, Any]] = {}
    for anchor in anchors:
        slot = str(anchor.get("slot") or "other").lower()
        macros = anchor_macros(anchor)
        row = by_slot.setdefault(
            slot, {"slot": slot, "count": 0, "calories": 0.0, "protein": 0.0, "kinds": []}
        )
        row["count"] += 1
        row["calories"] += macros["calories"]
        row["protein"] += macros["protein"]
        row["kinds"].append(anchor_kind(anchor))

    day_counts = _covered_days(anchors)
    empty_days = [key for key, count in day_counts.items() if count == 0]
    uncovered_slots = [
        slot for slot in PRIMARY_SLOTS if slot not in by_slot and slot != "pre_workout"
    ]
    low_protein_slots = [
        slot
        for slot, row in by_slot.items()
        if row["protein"] and row["protein"] < LOW_PROTEIN_MEAL
        and slot not in ("snack", "pre_workout")
    ]
    no_macro_anchors = [
        anchor.get("label")
        for anchor in anchors
        if anchor_kind(anchor) != "uncertain" and not anchor_macros(anchor)["calories"]
    ]
    uncertain = [
        {"label": a.get("label"), "slot": a.get("slot"), "place": a.get("place")}
        for a in anchors
        if anchor_kind(a) == "uncertain"
    ]
    option_meals = [
        {"label": a.get("label"), "slot": a.get("slot"), "options": len(a.get("foods") or [])}
        for a in anchors
        if anchor_kind(a) == "potential"
    ]

    focuses = _health_focus_list(plan.get("health_focuses"))
    return {
        "targets": {
            "calories": targets.get("calories"),
            "protein": targets.get("protein"),
            "fiber": targets.get("fiber"),
        },
        "anchor_count": len(anchors),
        "slots": sorted(by_slot.values(), key=lambda r: r["slot"]),
        "days_with_no_anchor": empty_days,
        "slots_with_no_anchor": uncovered_slots,
        "meals_below_15g_protein": low_protein_slots,
        "meals_missing_macros": [label for label in no_macro_anchors if label][:6],
        "uncertain_meals": uncertain,
        "option_meals": option_meals,
        "go_to_count": len(plan.get("go_to_items") or []),
        "flexible_count": len(plan.get("flexible_meals") or []),
        "places": [p.get("name") for p in (plan.get("fast_food_places") or []) if p.get("name")],
        "calorie_gap": coverage.get("calorie_gap"),
        "protein_gap": coverage.get("protein_gap"),
        "planned_calories_max": coverage.get("planned_calories_max"),
        "health_focuses": [
            {"id": key, "label": HEALTH_FOCUSES[key]["label"], "aim": HEALTH_FOCUSES[key]["aim"]}
            for key in focuses
        ],
        "health_notes": plan.get("health_notes"),
        "recent_avg_calories": recent.get("avg_calories"),
        "recent_avg_protein": recent.get("avg_protein"),
        "days_logged": recent.get("days_logged"),
    }


def _deterministic_review(facts: Dict[str, Any]) -> Dict[str, Any]:
    """
    The review with no model involved.

    Used as the fallback, and it is what keeps the feature honest: every point
    the model is allowed to make already exists here as a checkable fact.
    """
    working: List[str] = []
    improvements: List[Dict[str, str]] = []

    if facts["anchor_count"]:
        working.append(
            f"You have {facts['anchor_count']} regular meal"
            f"{'s' if facts['anchor_count'] != 1 else ''} mapped out — that is the hard part done."
        )
    if facts["go_to_count"]:
        working.append(f"{facts['go_to_count']} go-to items ready for the gaps.")
    if facts["option_meals"]:
        working.append(
            f"{len(facts['option_meals'])} meal(s) set up as options rather than one fixed choice, "
            "which is more honest about how days actually go."
        )

    gap = facts.get("calorie_gap")
    if gap is not None and gap > 300:
        improvements.append({
            "title": f"About {int(gap)} kcal a day is unplanned",
            "why": (
                f"Your meals add up to roughly {facts.get('planned_calories_max')} kcal against a "
                f"{facts['targets'].get('calories')} target, so the rest gets decided on the fly."
            ),
            "how": "Add a snack or shake anchor, or widen a flexible meal's range to cover it.",
        })
    pgap = facts.get("protein_gap")
    if pgap is not None and pgap > 25:
        improvements.append({
            "title": f"Protein is about {int(pgap)}g short of target on paper",
            "why": "The meals you have listed do not reach your protein number even on a perfect day.",
            "how": "Add a protein source to your lightest meal, or a shake as a go-to item.",
        })
    if facts["days_with_no_anchor"]:
        days = ", ".join(d.title() for d in facts["days_with_no_anchor"])
        improvements.append({
            "title": f"No meals mapped for {days}",
            "why": "Those days fall back to guesswork, which is usually where plans slip.",
            "how": "Copy an anchor onto those days, or add a place you tend to eat out at.",
        })
    if facts["slots_with_no_anchor"]:
        slots = ", ".join(facts["slots_with_no_anchor"])
        improvements.append({
            "title": f"Nothing set for {slots}",
            "why": "An empty slot is the one most likely to become whatever is nearest.",
            "how": "Even an uncertain meal with a place name beats leaving it blank.",
        })
    if facts["meals_missing_macros"]:
        improvements.append({
            "title": "Some meals have no calories or protein attached",
            "why": (
                f"{', '.join(facts['meals_missing_macros'])} count as zero, so your remaining "
                "budget for the day reads higher than it really is."
            ),
            "how": "Open the meal and add rough macros — an estimate beats a blank.",
        })
    if len(facts["uncertain_meals"]) >= 3:
        improvements.append({
            "title": f"{len(facts['uncertain_meals'])} meals are still undecided",
            "why": "Uncertain meals are not counted in your daily budget at all.",
            "how": "Turn the two you can predict into option meals with three or four choices.",
        })

    for focus in facts["health_focuses"]:
        improvements.append({
            "title": f"Keep {focus['label'].lower()} in view",
            "why": f"Your plan is built around {focus['aim']}.",
            "how": "Check each anchor against that before adding anything new.",
        })

    if not improvements:
        verdict = "This plan holds together — the meals cover your days and reach your targets."
    else:
        verdict = (
            f"The structure is sound. {len(improvements)} thing"
            f"{'s' if len(improvements) != 1 else ''} would make it work harder for you."
        )

    return {
        "verdict": verdict,
        "working": working[:4],
        "improvements": improvements[:5],
        "source": "rules",
    }


def _prompt(facts: Dict[str, Any]) -> str:
    return f"""A user built their own nutrition plan. Review it the way a coach would look over
their shoulder: agree with what they set up, then name the few changes that would help most.

CHECKED FACTS ABOUT THEIR PLAN (these are computed from the plan itself — every
point you make must come from this list, and you must not invent numbers):
{json.dumps(facts, indent=2, default=str)}

Return JSON only:
{{
  "verdict": "one sentence — your overall read, plain and specific",
  "working": ["2-3 short lines naming what they got right, referring to their actual meals"],
  "improvements": [
    {{
      "title": "short, concrete",
      "why": "one sentence on what it costs them today, using their own numbers",
      "how": "one sentence they could act on in the app right now"
    }}
  ]
}}

Rules:
- Open by agreeing with something real. "Your breakfast anchor is doing its job" beats "Great plan!".
- 2-4 improvements, ordered by how much they matter. Never more than 4.
- Refer to their meals by the labels in the facts. No generic diet advice.
- This is their plan. Suggest additions and adjustments — never tell them to
  replace the meals they chose, and never propose a different plan.
- Plain language. No medical claims, no diagnosis, no supplements or medication.
  If a health focus is listed, note once that their doctor or dietitian comes first.
"""


def build_plan_review(
    plan: Dict[str, Any],
    recent: Optional[Dict[str, Any]] = None,
    model: Optional[str] = None,
) -> Dict[str, Any]:
    """Coach-style review of the plan. Falls back to the rules-only version."""
    facts = plan_facts(plan, recent)
    fallback = _deterministic_review(facts)
    review = dict(fallback)

    if os.getenv("OPENAI_API_KEY"):
        try:
            from openai import OpenAI

            resolved = resolve_model(model)
            response = OpenAI(api_key=os.getenv("OPENAI_API_KEY")).chat.completions.create(
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "You are a practical nutrition coach reviewing a plan the user "
                            "built themselves. Reply with JSON only."
                        ),
                    },
                    {"role": "user", "content": _prompt(facts)},
                ],
                **completion_kwargs(resolved, max_tokens=900),
            )
            raw = json.loads(response.choices[0].message.content or "{}")
            improvements = [
                {
                    "title": str(item.get("title") or "").strip()[:80],
                    "why": str(item.get("why") or "").strip()[:240],
                    "how": str(item.get("how") or "").strip()[:240],
                }
                for item in (raw.get("improvements") or [])
                if isinstance(item, dict) and str(item.get("title") or "").strip()
            ][:4]
            working = [str(w).strip()[:160] for w in (raw.get("working") or []) if str(w).strip()][:3]
            verdict = str(raw.get("verdict") or "").strip()[:240]
            if verdict and improvements:
                review = {
                    "verdict": verdict,
                    "working": working or fallback["working"],
                    "improvements": improvements,
                    "source": "ai",
                }
        except Exception as e:
            print(f"build_plan_review error, using rules: {e}")

    review["facts"] = facts
    review["generated_at"] = datetime.now().isoformat()
    return review
