"""
AI helpers for the day blueprint: slot fill suggestions + fast-food orders.
"""

from __future__ import annotations

import json
import os
from typing import Any, Dict, List, Optional

from openai import OpenAI

from ai_models import completion_kwargs, resolve_model
from nutrition.slot_targets import SLOT_FRAMING, is_fuel_slot


def _client() -> OpenAI:
    return OpenAI(api_key=os.getenv("OPENAI_API_KEY"))


def _safe_json(text: str) -> Dict[str, Any]:
    text = (text or "").strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.startswith("json"):
            text = text[4:].strip()
    try:
        data = json.loads(text)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _slot_role_line(slot: str) -> str:
    framing = SLOT_FRAMING.get(slot, "is part of the day")
    if is_fuel_slot(slot):
        return (
            f"This slot {framing}. Prioritize easy carbs and a comfortable calorie band. "
            "Do NOT flag low protein, suggest adding protein, or treat this like a main meal — "
            "breakfast, lunch, and dinner carry protein."
        )
    return (
        f"This slot {framing}. Protein against the slot floor matters here; "
        "call out a real protein shortfall when the meal sits well under target."
    )


def suggest_slot_fills(
    plan: Dict[str, Any],
    slot: str,
    stance: Optional[str] = None,
    model: Optional[str] = None,
    count: int = 1,
    exclude_labels: Optional[List[str]] = None,
    slot_target: Optional[Dict[str, Any]] = None,
    log_facts: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Suggest fills for one slot, built on what the user already eats there.

    `log_facts` carries their repeat meals for this slot from the last couple of
    weeks, each already scored against `slot_target`. Given those, the model's
    job is mostly selection rather than invention: promote the meals that fit,
    say why the ones that do not, and only invent something when the history is
    too thin to work with.

    Verdicts on existing anchors are advisory by design. The user built those
    meals; the model can say "this one is light on protein" but nothing here
    removes or rewrites them — and for fuel slots, protein is never the complaint.
    """
    targets = plan.get("targets") or {}
    prefs = plan.get("preferences") or {}
    anchors = [
        a for a in (plan.get("meal_anchors") or [])
        if str(a.get("slot") or "").lower() == slot
    ]
    anchor_digest = [
        {
            "id": a.get("id"),
            "label": a.get("label"),
            "kind": a.get("kind"),
            "foods": [f.get("name") for f in (a.get("foods") or []) if f.get("name")],
            "calories": sum(float(f.get("calories") or 0) for f in (a.get("foods") or [])),
            "protein": sum(float(f.get("protein") or 0) for f in (a.get("foods") or [])),
        }
        for a in anchors
    ]
    go_tos = [g.get("name") for g in (plan.get("go_to_items") or []) if g.get("name")]
    places = [p.get("name") for p in (plan.get("fast_food_places") or []) if p.get("name")]
    n = max(1, min(int(count or 1), 4))
    exclude = [str(x).strip() for x in (exclude_labels or []) if str(x).strip()]
    exclude_line = (
        f"Do NOT repeat these (already shown): {', '.join(exclude[:12])}."
        if exclude
        else ""
    )

    repeat_meals = (log_facts or {}).get("repeat_meals") or []
    days_with_logs = (log_facts or {}).get("days_with_logs") or 0
    if slot_target:
        cal_bit = f"{slot_target.get('calorie_min')}-{slot_target.get('calorie_max')} kcal"
        protein = slot_target.get("protein_min")
        target_line = (
            cal_bit if is_fuel_slot(slot) or not protein
            else f"{cal_bit}, {protein}g+ protein"
        )
    else:
        target_line = "no slot target set"
    role_line = _slot_role_line(slot)

    prompt = f"""You are filling one meal slot on a nutrition day blueprint: {slot}.

SLOT ROLE: {role_line}
THIS SLOT'S TARGET (already computed — do not change these numbers): {target_line}
User goal: {plan.get("goal")} — {plan.get("goal_detail") or ""}
Daily targets: {targets.get("calories")} kcal, {targets.get("protein")}g protein
Slot stance: {stance or "anchors"}
Likes: {", ".join(prefs.get("likes") or []) or "n/a"}
Dislikes: {", ".join(prefs.get("dislikes") or []) or "n/a"}
Restrictions: {prefs.get("dietary_restrictions") or "n/a"}
Foods on hand: {", ".join(prefs.get("foods_on_hand") or []) or "n/a"}
Go-tos: {", ".join(go_tos[:12]) or "n/a"}
Fast food places: {", ".join(places[:8]) or "n/a"}

MEALS THEY ALREADY SAVED FOR THIS SLOT (theirs — never remove or rewrite):
{json.dumps(anchor_digest, indent=2, default=str)[:1200]}

WHAT THEY ACTUALLY LOGGED FOR THIS SLOT ({days_with_logs} days with logs).
"fit" was computed against the slot target above:
{json.dumps(repeat_meals, indent=2, default=str)[:1800]}
{exclude_line}

Return JSON only:
{{
  "ideas": [
    {{
      "label": "short meal name",
      "foods": [{{"name":"food","amount":"1 cup","calories":200,"protein":20,"carbs":20,"fats":5}}],
      "days": ["mon","tue","wed","thu","fri"],
      "notes": "optional tip",
      "from_logs": true
    }}
  ],
  "options_anchor": {{
    "label": "e.g. Dinner options",
    "foods": [{{"name":"one of their logged meals","amount":"","calories":800,"protein":25}}],
    "days": ["mon","tue","wed","thu","fri","sat","sun"],
    "notes": "why these belong together as options"
  }},
  "anchor_verdicts": [
    {{"anchor_id": "id from the saved meals above", "verdict": "solid|adjust", "advice": "one short line"}}
  ],
  "guidance": "one or two sentences: what to aim for in this slot given the target and their history",
  "notes": "one short line of practical guidance",
  "stance_hint": "anchors|uncertain|eat_out|flexible"
}}

Rules:
- Return exactly {n} idea{"s" if n != 1 else ""}.
- Prefer their own logged meals over anything new. If a logged meal has fit "fits",
  offer it as an idea with from_logs true and reuse its real macros. Invent a new
  meal only when their history has nothing usable for this slot.
- options_anchor collects 3-4 of their logged meals that could rotate in this slot,
  so they can save one "options" meal instead of four separate ones. Only include it
  when you have at least 3 logged meals worth rotating; otherwise omit the key.
- anchor_verdicts is advisory. Use "adjust" to point at a real problem for THIS slot's
  role (calories well over/under the band
  {"; never mention protein" if is_fuel_slot(slot) else "; protein too low for the slot target"}).
  Use "solid" with advice like "worth keeping daily" when a meal already fits. Never suggest
  deleting a meal they saved. Omit anchors you have nothing useful to say about.
- If the stance is uncertain or eat_out, guidance should accept that they will not
  plan the food, and give them the number to aim for instead.
- Macros must be realistic. Days are mon..sun abbreviations.
"""

    try:
        resolved = resolve_model(model)
        resp = _client().chat.completions.create(
            messages=[
                {"role": "system", "content": "You are a practical nutrition coach. Reply with JSON only."},
                {"role": "user", "content": prompt},
            ],
            **completion_kwargs(resolved, max_tokens=1100 if n == 1 else 1600),
        )
        data = _safe_json(resp.choices[0].message.content or "")
        ideas = data.get("ideas") if isinstance(data.get("ideas"), list) else []

        options = data.get("options_anchor")
        if not isinstance(options, dict) or len(options.get("foods") or []) < 3:
            options = None

        verdicts = []
        known_ids = {str(a.get("id")) for a in anchors if a.get("id")}
        for item in data.get("anchor_verdicts") or []:
            if not isinstance(item, dict):
                continue
            anchor_id = str(item.get("anchor_id") or "")
            verdict = str(item.get("verdict") or "").strip().lower()
            # A verdict on an anchor that is not in this slot cannot be shown
            # next to anything, so it is dropped rather than displayed loose.
            if anchor_id not in known_ids or verdict not in ("solid", "adjust"):
                continue
            verdicts.append({
                "anchor_id": anchor_id,
                "verdict": verdict,
                "advice": str(item.get("advice") or "").strip()[:160] or None,
            })

        return {
            "ideas": ideas[:n],
            "options_anchor": options,
            "anchor_verdicts": verdicts,
            "guidance": str(data.get("guidance") or "").strip()[:400] or None,
            "notes": str(data.get("notes") or "").strip()[:300] or None,
            "stance_hint": data.get("stance_hint") if data.get("stance_hint") in (
                "anchors", "uncertain", "eat_out", "flexible"
            ) else stance,
        }
    except Exception as e:
        print(f"suggest_slot_fills error: {e}")
        return {
            "ideas": [],
            "options_anchor": None,
            "anchor_verdicts": [],
            "guidance": None,
            "notes": None,
            "stance_hint": stance,
        }


def suggest_fast_food_orders(
    plan: Dict[str, Any],
    place_name: str,
    slot: str = "dinner",
    remaining: Optional[Dict[str, Any]] = None,
    model: Optional[str] = None,
) -> Dict[str, Any]:
    """Suggest concrete menu-style orders for a place given remaining macros."""
    targets = plan.get("targets") or {}
    remaining = remaining or {}
    cal = remaining.get("calories") or targets.get("calories") or 600
    protein = remaining.get("protein") or max(20, int((targets.get("protein") or 160) * 0.3))
    prefs = plan.get("preferences") or {}
    fuel = is_fuel_slot(slot)
    priority = (
        "Prioritize easy carbs that sit well before training; protein is optional here."
        if fuel
        else "Stay under remaining calories when possible; prioritize protein."
    )

    prompt = f"""Suggest {place_name} orders for {slot} that fit remaining macros.

Remaining budget (approx): {cal} kcal{"" if fuel else f", {protein}g protein"}
Daily targets for context: {targets.get("calories")} kcal / {targets.get("protein")}g P
Likes: {", ".join(prefs.get("likes") or []) or "n/a"}
Dislikes: {", ".join(prefs.get("dislikes") or []) or "n/a"}
Restrictions: {prefs.get("dietary_restrictions") or "n/a"}

Return JSON only:
{{
  "orders": [
    {{
      "name": "order nickname",
      "items": ["item 1", "item 2"],
      "calories": 550,
      "protein": 35,
      "carbs": 45,
      "fats": 20,
      "why": "short reason"
    }}
  ],
  "tip": "one practical ordering tip"
}}

Rules:
- 3 orders max. Prefer real menu patterns for that restaurant.
- {priority}
- Avoid foods in dislikes / restrictions.
"""

    try:
        resolved = resolve_model(model)
        resp = _client().chat.completions.create(
            messages=[
                {"role": "system", "content": "You are a practical nutrition coach who knows fast-food menus. JSON only."},
                {"role": "user", "content": prompt},
            ],
            **completion_kwargs(resolved, max_tokens=900),
        )
        data = _safe_json(resp.choices[0].message.content or "")
        orders = data.get("orders") if isinstance(data.get("orders"), list) else []
        return {
            "place": place_name,
            "slot": slot,
            "orders": orders[:3],
            "tip": str(data.get("tip") or "").strip()[:240] or None,
        }
    except Exception as e:
        print(f"suggest_fast_food_orders error: {e}")
        return {"place": place_name, "slot": slot, "orders": [], "tip": None}

