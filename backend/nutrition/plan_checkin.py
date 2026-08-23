"""
Two-week check-in: how the plan has actually been going, and what to change.

The plan review reads the plan's *structure* — empty slots, protein that does not
add up on paper. This reads the plan against what the user actually ate since
they made it, which is the only way to tell the difference between a plan that is
wrong and a plan that is simply not being followed.

Deliberately two steps. The check-in itself only reports: here is what is
working, here is what to improve. Turning that into plan changes is a separate,
explicit ask, and those changes still land as staged suggestions the user accepts
per meal. Nothing here writes to a plan.

Every number the model is allowed to use is computed first in `checkin_facts`.
"""

from __future__ import annotations

import json
import os
from datetime import datetime
from typing import Any, Dict, List, Optional

from ai_models import completion_kwargs, resolve_model
from nutrition.logged_meals import (
    MACRO_KEYS,
    group_logged_by_slot,
    slot_for_meal,
    _similar,
)
from nutrition.meal_math import anchor_kind, anchor_macros
from nutrition.slot_targets import PRIMARY_SLOTS, resolve_slot_targets, SLOT_LABELS

# Two weeks: long enough that one bad day does not set the direction, short
# enough that it still describes how the user is eating now.
CHECKIN_DAYS = 14

# A meal logged on this many separate days is a habit worth putting in the plan.
HABIT_DAYS = 3

# Under this share of days, a slot is not really being logged, and any average
# from it would be noise dressed up as a finding.
THIN_LOG_RATIO = 0.3


def _num(value, default: float = 0.0) -> float:
    try:
        if value is None or value == "":
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def _day_totals(entries: List[Dict[str, Any]]) -> Dict[str, Dict[str, float]]:
    days: Dict[str, Dict[str, float]] = {}
    for entry in entries or []:
        date = str(entry.get("date") or "")[:10]
        if not date:
            continue
        row = days.setdefault(date, {key: 0.0 for key in MACRO_KEYS})
        for food in entry.get("food_items") or []:
            if isinstance(food, dict):
                for key in MACRO_KEYS:
                    row[key] += _num(food.get(key))
    return days


def _anchor_names(plan: Dict[str, Any], slot: str) -> List[str]:
    names: List[str] = []
    for anchor in plan.get("meal_anchors") or []:
        if not isinstance(anchor, dict):
            continue
        if str(anchor.get("slot") or "").lower() != slot:
            continue
        label = str(anchor.get("label") or "").strip().lower()
        if label:
            names.append(label)
        for food in anchor.get("foods") or []:
            name = str((food or {}).get("name") or "").strip().lower()
            if name:
                names.append(name)
    return names


def _is_planned(name: str, planned_names: List[str]) -> bool:
    key = str(name or "").strip().lower()
    return any(_similar(key, planned) for planned in planned_names)


def checkin_facts(
    plan: Dict[str, Any],
    entries: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """
    Everything checkable about how the last two weeks went against this plan.

    Each entry is something the user could confirm from their own log, which is
    what keeps the readout from drifting into generic advice.
    """
    targets = plan.get("targets") or {}
    cal_target = _num(targets.get("calories"))
    protein_target = _num(targets.get("protein"))

    days = _day_totals(entries)
    logged_days = sorted(days.keys())
    day_count = len(logged_days)

    avg_cal = round(sum(d["calories"] for d in days.values()) / day_count) if day_count else None
    avg_protein = (
        round(sum(d["protein"] for d in days.values()) / day_count) if day_count else None
    )

    # Split the window in half to say whether things are drifting or settling.
    trend = None
    if day_count >= 6:
        half = day_count // 2
        older = logged_days[:half]
        newer = logged_days[half:]
        older_cal = sum(days[d]["calories"] for d in older) / len(older)
        newer_cal = sum(days[d]["calories"] for d in newer) / len(newer)
        older_pro = sum(days[d]["protein"] for d in older) / len(older)
        newer_pro = sum(days[d]["protein"] for d in newer) / len(newer)
        trend = {
            "calories_change": round(newer_cal - older_cal),
            "protein_change": round(newer_pro - older_pro),
        }

    slot_targets = resolve_slot_targets(plan)
    grouped = group_logged_by_slot(entries, limit_per_slot=8)

    slots: List[Dict[str, Any]] = []
    unplanned_habits: List[Dict[str, Any]] = []

    for slot in PRIMARY_SLOTS:
        target = slot_targets.get(slot)
        meals = grouped.get(slot) or []
        if not target and not meals:
            continue

        slot_days = {
            str(entry.get("date") or "")[:10]
            for entry in entries or []
            if any(
                slot_for_meal((f or {}).get("meal")) == slot
                for f in entry.get("food_items") or []
                if isinstance(f, dict)
            )
        }
        slot_days.discard("")

        logged_cal = sum(m["calories"] * m["times_logged"] for m in meals)
        logged_times = sum(m["times_logged"] for m in meals) or 1
        avg_slot_cal = round(logged_cal / logged_times) if meals else None

        low = _num((target or {}).get("calorie_min")) or None
        high = _num((target or {}).get("calorie_max")) or None
        verdict = "unknown"
        if day_count and len(slot_days) / day_count < THIN_LOG_RATIO:
            verdict = "rarely_logged"
        elif avg_slot_cal and low and high:
            if avg_slot_cal < low * 0.85:
                verdict = "under"
            elif avg_slot_cal > high * 1.15:
                verdict = "over"
            else:
                verdict = "on_target"

        planned_names = _anchor_names(plan, slot)
        for meal in meals:
            if meal["times_logged"] < HABIT_DAYS:
                continue
            if _is_planned(meal["name"], planned_names):
                continue
            unplanned_habits.append({**meal, "slot": slot})

        slots.append({
            "slot": slot,
            "label": SLOT_LABELS.get(slot, slot),
            "days_logged": len(slot_days),
            "target_calorie_min": low,
            "target_calorie_max": high,
            "target_protein_min": _num((target or {}).get("protein_min")) or None,
            "avg_logged_calories": avg_slot_cal,
            "verdict": verdict,
            "top_meals": [
                {"name": m["name"], "times_logged": m["times_logged"], "calories": m["calories"]}
                for m in meals[:3]
            ],
        })

    # Meals in the plan that never showed up in the log. Advisory only: the point
    # is to ask whether the plan still matches their life, not to delete them.
    never_logged: List[Dict[str, Any]] = []
    all_logged_names = [
        str((food or {}).get("name") or "").strip().lower()
        for entry in entries or []
        for food in entry.get("food_items") or []
        if isinstance(food, dict) and (food or {}).get("name")
    ]
    for anchor in plan.get("meal_anchors") or []:
        if not isinstance(anchor, dict) or anchor_kind(anchor) == "uncertain":
            continue
        names = [
            str((f or {}).get("name") or "").strip().lower()
            for f in anchor.get("foods") or []
            if (f or {}).get("name")
        ]
        label = str(anchor.get("label") or "").strip().lower()
        probe = names or ([label] if label else [])
        if not probe:
            continue
        if not any(_is_planned(name, all_logged_names) for name in probe):
            never_logged.append({
                "id": anchor.get("id"),
                "label": anchor.get("label"),
                "slot": anchor.get("slot"),
            })

    # Anchors the user keeps eating but never gave macros to. Cheap to fix and it
    # makes every remaining-calorie number on the plan page more honest.
    missing_macros: List[Dict[str, Any]] = []
    for anchor in plan.get("meal_anchors") or []:
        if not isinstance(anchor, dict) or anchor_kind(anchor) == "uncertain":
            continue
        if anchor_macros(anchor)["calories"]:
            continue
        slot = str(anchor.get("slot") or "").lower()
        candidates = grouped.get(slot) or []
        label = str(anchor.get("label") or "").strip().lower()
        match = next(
            (
                m
                for m in candidates
                if _similar(label, m["name"].lower()) and m["calories"]
            ),
            None,
        )
        if match:
            missing_macros.append({
                "id": anchor.get("id"),
                "label": anchor.get("label"),
                "slot": slot,
                "logged_calories": match["calories"],
                "logged_protein": match["protein"],
                "times_logged": match["times_logged"],
            })

    return {
        "window_days": CHECKIN_DAYS,
        "days_logged": day_count,
        "daily_target_calories": cal_target or None,
        "daily_target_protein": protein_target or None,
        "avg_calories": avg_cal,
        "avg_protein": avg_protein,
        "calorie_delta": round(avg_cal - cal_target) if (avg_cal and cal_target) else None,
        "protein_delta": (
            round(avg_protein - protein_target) if (avg_protein and protein_target) else None
        ),
        "trend": trend,
        "slots": slots,
        "unplanned_habits": unplanned_habits[:6],
        "plan_meals_never_logged": never_logged[:6],
        "anchors_missing_macros": missing_macros[:6],
    }


def _deterministic_checkin(facts: Dict[str, Any]) -> Dict[str, Any]:
    """The check-in with no model involved — and the honesty floor for the AI one."""
    keep: List[str] = []
    improve: List[Dict[str, str]] = []

    days = facts.get("days_logged") or 0
    if not days:
        return {
            "summary": "Nothing logged in the last two weeks, so there is nothing to check the plan against yet.",
            "continue": [],
            "improve": [{
                "title": "Log a few days first",
                "why": "A check-in compares your plan to what you actually ate; with no logs there is nothing to compare.",
                "how": "Log your meals for three or four days, then run this again.",
            }],
            "source": "rules",
        }

    cal_delta = facts.get("calorie_delta")
    pro_delta = facts.get("protein_delta")
    progress = facts.get("progress") or {}

    if progress.get("verdict") in ("stall", "too_fast", "under_eating", "overshooting"):
        improve.append({
            "title": {
                "stall": "Progress has stalled",
                "too_fast": "Moving faster than planned",
                "under_eating": "Under-eating the target",
                "overshooting": "Overshooting the target",
            }.get(progress["verdict"], "Pacing needs a look"),
            "why": progress.get("reason") or "The last two weeks are off the expected pace.",
            "how": "Pick a pacing option — diet break, hold, refeed, or a small calorie change.",
        })
    elif progress.get("verdict") == "on_track" and progress.get("reason"):
        keep.append(progress["reason"])

    if cal_delta is not None and abs(cal_delta) <= 150:
        keep.append(
            f"Your average is {facts['avg_calories']} kcal against a "
            f"{facts['daily_target_calories']} target — that is on plan."
        )
    if pro_delta is not None and pro_delta >= -10:
        keep.append(f"Protein is holding around {facts['avg_protein']}g a day.")

    on_target = [s for s in facts.get("slots") or [] if s["verdict"] == "on_target"]
    for slot in on_target[:2]:
        keep.append(f"{slot['label']} is landing in its range most days.")

    if cal_delta is not None and cal_delta < -250:
        improve.append({
            "title": f"You are averaging {abs(cal_delta)} kcal under target",
            "why": (
                f"{facts['avg_calories']} kcal a day against {facts['daily_target_calories']} — "
                "either the target is too high or meals are getting skipped."
            ),
            "how": "Add a go-to item to the meal you skip most, or lower the target to match reality.",
        })
    if cal_delta is not None and cal_delta > 250:
        improve.append({
            "title": f"You are averaging {cal_delta} kcal over target",
            "why": f"{facts['avg_calories']} kcal a day against {facts['daily_target_calories']}.",
            "how": "Trim the slot that runs hottest rather than cutting across every meal.",
        })
    if pro_delta is not None and pro_delta < -20:
        improve.append({
            "title": f"Protein is about {abs(pro_delta)}g short most days",
            "why": f"You are averaging {facts['avg_protein']}g against {facts['daily_target_protein']}g.",
            "how": "Put a protein source in the meal that is currently lightest.",
        })

    for slot in facts.get("slots") or []:
        if slot["verdict"] == "rarely_logged":
            improve.append({
                "title": f"{slot['label']} is barely logged",
                "why": f"Only {slot['days_logged']} of {days} logged days include it, so the plan cannot tell what happens there.",
                "how": f"Either log {slot['label'].lower()} for a week, or mark the slot as one you skip.",
            })
        elif slot["verdict"] == "over" and slot["target_calorie_max"]:
            improve.append({
                "title": f"{slot['label']} runs above its share",
                "why": (
                    f"About {slot['avg_logged_calories']} kcal against a "
                    f"{int(slot['target_calorie_min'])}–{int(slot['target_calorie_max'])} target."
                ),
                "how": "Swap the biggest item, or move some of that slot's share to another meal.",
            })
        elif slot["verdict"] == "under" and slot["target_calorie_min"]:
            improve.append({
                "title": f"{slot['label']} comes in light",
                "why": (
                    f"About {slot['avg_logged_calories']} kcal against a "
                    f"{int(slot['target_calorie_min'])}–{int(slot['target_calorie_max'])} target."
                ),
                "how": "Add a go-to item there so the calories do not have to come from somewhere else.",
            })

    habits = facts.get("unplanned_habits") or []
    if habits:
        names = ", ".join(h["name"] for h in habits[:3])
        improve.append({
            "title": "You eat things that are not in your plan",
            "why": f"{names} keep showing up in your log but are not saved anywhere in the plan.",
            "how": "Save them as meals so your plan matches what you actually eat.",
        })

    missing = facts.get("anchors_missing_macros") or []
    if missing:
        improve.append({
            "title": "Some saved meals still have no macros",
            "why": (
                f"{', '.join(m['label'] for m in missing[:3] if m.get('label'))} count as zero, "
                "so your remaining calories read higher than they are."
            ),
            "how": "Your own logs already have the numbers — fill them in from there.",
        })

    stale = facts.get("plan_meals_never_logged") or []
    if stale:
        improve.append({
            "title": "Some planned meals never got eaten",
            "why": f"{', '.join(m['label'] for m in stale[:3] if m.get('label'))} did not appear in your log at all.",
            "how": "Keep them if they are still the goal, or replace them with what you actually reach for.",
        })

    if improve:
        summary = (
            f"{days} days logged. The plan is mostly holding — "
            f"{len(improve)} thing{'s' if len(improve) != 1 else ''} would tighten it up."
        )
    else:
        summary = f"{days} days logged and the plan is tracking well. Keep going."

    return {
        "summary": summary,
        "continue": keep[:4],
        "improve": improve[:5],
        "source": "rules",
    }


def _prompt(facts: Dict[str, Any]) -> str:
    return f"""A user made a nutrition plan and has been logging meals since. Compare the plan to
what they actually ate over the last two weeks, and tell them what to keep doing and what to
improve.

CHECKED FACTS (computed from their own log and plan — every point you make must come
from this list, and you must not invent numbers):
{json.dumps(facts, indent=2, default=str)}

Return JSON only:
{{
  "summary": "one or two sentences — the honest headline on how it is going",
  "continue": ["2-3 short lines naming what is genuinely working, with their numbers"],
  "improve": [
    {{
      "title": "short and concrete",
      "why": "one sentence using their own numbers",
      "how": "one sentence they could act on in the app"
    }}
  ]
}}

Rules:
- Lead with what is real. If they logged 12 of 14 days, say so before anything else.
- 2-4 improvements, ordered by impact. Never more than 4.
- Distinguish "the plan is wrong" from "the plan is not being followed" — those need
  different fixes and the facts usually make clear which it is.
- Meals they log repeatedly are the strongest material you have. Prefer building the
  plan around those over suggesting anything new.
- Never tell them to delete a meal they chose. Suggest additions and adjustments.
- Plain language, no medical claims, no supplements.
"""


def build_plan_checkin(
    plan: Dict[str, Any],
    entries: List[Dict[str, Any]],
    model: Optional[str] = None,
    weigh_ins: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """Coach-style read on how the plan is actually going. Falls back to rules."""
    from nutrition.pacing import detect_progress, normalize_pacing, pacing_options

    facts = checkin_facts(plan, entries)
    progress = detect_progress(plan, facts, weigh_ins)
    facts["progress"] = progress
    fallback = _deterministic_checkin(facts)
    result = dict(fallback)

    if os.getenv("OPENAI_API_KEY") and facts.get("days_logged"):
        try:
            from openai import OpenAI

            resolved = resolve_model(model)
            response = OpenAI(api_key=os.getenv("OPENAI_API_KEY")).chat.completions.create(
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "You are a practical nutrition coach reviewing how someone's plan "
                            "is going against what they actually ate. Reply with JSON only."
                        ),
                    },
                    {"role": "user", "content": _prompt(facts)},
                ],
                **completion_kwargs(resolved, max_tokens=1000),
            )
            raw = json.loads(response.choices[0].message.content or "{}")
            improve = [
                {
                    "title": str(item.get("title") or "").strip()[:90],
                    "why": str(item.get("why") or "").strip()[:240],
                    "how": str(item.get("how") or "").strip()[:240],
                }
                for item in (raw.get("improve") or [])
                if isinstance(item, dict) and str(item.get("title") or "").strip()
            ][:4]
            keep = [
                str(line).strip()[:160]
                for line in (raw.get("continue") or [])
                if str(line).strip()
            ][:3]
            summary = str(raw.get("summary") or "").strip()[:300]
            if summary and (improve or keep):
                result = {
                    "summary": summary,
                    "continue": keep or fallback["continue"],
                    "improve": improve or fallback["improve"],
                    "source": "ai",
                }
        except Exception as e:
            print(f"build_plan_checkin error, using rules: {e}")

    result["facts"] = facts
    result["progress"] = progress
    result["pacing"] = normalize_pacing(plan.get("pacing"), plan.get("goal"))
    result["pacing_options"] = pacing_options(plan, progress)
    result["generated_at"] = datetime.now().isoformat()
    # Whether asking for concrete edits would actually produce anything, so the
    # button can be hidden rather than offered and then coming back empty.
    actionable_pacing = progress.get("verdict") in (
        "stall", "too_fast", "under_eating", "overshooting",
    )
    result["can_propose_edits"] = bool(
        facts.get("unplanned_habits")
        or facts.get("anchors_missing_macros")
        or actionable_pacing
    )
    result["can_adjust_pacing"] = bool(result["pacing_options"])
    return result


def checkin_edit_candidates(
    plan: Dict[str, Any],
    facts: Dict[str, Any],
    progress: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    """
    Turn check-in findings into raw edit ops for the normal suggestion pipeline.

    Meal fixes stay additive. When progress says the pace is wrong, the
    recommended pacing option's edits are included too — still staged, never
    auto-applied.
    """
    from nutrition.pacing import pacing_options

    candidates: List[Dict[str, Any]] = []

    for habit in facts.get("unplanned_habits") or []:
        candidates.append({
            "op": "add_meal_anchor",
            "payload": {
                "slot": habit.get("slot") or "snack",
                "label": habit.get("name"),
                "kind": "individual",
                "frequency": "most_days" if habit.get("times_logged", 0) >= 4 else "few_times_week",
                "source": "logged",
                "foods": [{
                    "name": habit.get("name"),
                    "amount": habit.get("amount"),
                    "calories": habit.get("calories"),
                    "protein": habit.get("protein"),
                    "carbs": habit.get("carbs"),
                    "fats": habit.get("fats"),
                    "fiber": habit.get("fiber"),
                }],
            },
            "rationale": (
                f"You logged this {habit.get('times_logged')} times in the last two weeks "
                "but it is not in your plan."
            ),
        })

    by_id = {
        str(a.get("id")): a
        for a in plan.get("meal_anchors") or []
        if isinstance(a, dict) and a.get("id")
    }
    for row in facts.get("anchors_missing_macros") or []:
        anchor = by_id.get(str(row.get("id")))
        if not anchor:
            continue
        foods = [dict(f) for f in anchor.get("foods") or [] if isinstance(f, dict)]
        if foods:
            foods[0] = {
                **foods[0],
                "calories": row.get("logged_calories"),
                "protein": row.get("logged_protein"),
            }
        else:
            foods = [{
                "name": anchor.get("label"),
                "calories": row.get("logged_calories"),
                "protein": row.get("logged_protein"),
            }]
        candidates.append({
            "op": "update_meal_anchor",
            "target_id": anchor.get("id"),
            "payload": {"foods": foods},
            "rationale": (
                f"Your log has this at about {int(_num(row.get('logged_calories')))} kcal "
                f"and {int(_num(row.get('logged_protein')))}g protein across "
                f"{row.get('times_logged')} times."
            ),
        })

    # Recommended pacing change when the scale/adherence says the pace is wrong.
    prog = progress or facts.get("progress") or {}
    if prog.get("verdict") in ("stall", "too_fast", "under_eating", "overshooting"):
        options = pacing_options(plan, prog)
        recommended = next((o for o in options if o.get("recommended")), None) or (
            options[0] if options else None
        )
        if recommended:
            for edit in recommended.get("edits") or []:
                candidates.append(edit)

    return candidates
