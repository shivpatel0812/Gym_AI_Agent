"""
AI helpers for the day blueprint: slot fill suggestions + fast-food orders.
"""

from __future__ import annotations

import json
import os
from typing import Any, Dict, List, Optional

from openai import OpenAI

from ai_models import completion_kwargs, resolve_model


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


def suggest_slot_fills(
    plan: Dict[str, Any],
    slot: str,
    stance: Optional[str] = None,
    model: Optional[str] = None,
    count: int = 1,
    exclude_labels: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """Suggest meal-anchor style fills or notes for a given slot."""
    targets = plan.get("targets") or {}
    prefs = plan.get("preferences") or {}
    anchors = [
        a for a in (plan.get("meal_anchors") or [])
        if str(a.get("slot") or "").lower() == slot
    ]
    go_tos = [g.get("name") for g in (plan.get("go_to_items") or []) if g.get("name")]
    places = [p.get("name") for p in (plan.get("fast_food_places") or []) if p.get("name")]
    n = max(1, min(int(count or 1), 4))
    exclude = [str(x).strip() for x in (exclude_labels or []) if str(x).strip()]
    exclude_line = (
        f"Do NOT suggest these (already shown): {', '.join(exclude[:12])}."
        if exclude
        else ""
    )

    prompt = f"""You help fill a nutrition day blueprint.

User goal: {plan.get("goal")} — {plan.get("goal_detail") or ""}
Daily targets: {targets.get("calories")} kcal, {targets.get("protein")}g protein, {targets.get("carbs")}g carbs, {targets.get("fats")}g fat
Likes: {", ".join(prefs.get("likes") or []) or "n/a"}
Dislikes: {", ".join(prefs.get("dislikes") or []) or "n/a"}
Restrictions: {prefs.get("dietary_restrictions") or "n/a"}
Foods on hand: {", ".join(prefs.get("foods_on_hand") or []) or "n/a"}
Existing {slot} anchors: {json.dumps(anchors)[:800]}
Go-tos: {", ".join(go_tos[:12]) or "n/a"}
Fast food places: {", ".join(places[:8]) or "n/a"}
Slot stance: {stance or "anchors"}
{exclude_line}

Return JSON only:
{{
  "ideas": [
    {{
      "label": "short meal name",
      "foods": [{{"name":"food","amount":"1 cup","calories":200,"protein":20,"carbs":20,"fats":5}}],
      "days": ["mon","tue","wed","thu","fri"],
      "notes": "optional tip"
    }}
  ],
  "notes": "one sentence of guidance for this slot",
  "stance_hint": "anchors|uncertain|eat_out|flexible"
}}

Rules:
- Return exactly {n} idea{"s" if n != 1 else ""}. Prefer foods the user already likes / has on hand.
- If stance is eat_out or uncertain, ideas can be lighter and notes should acknowledge flexibility.
- Macros should be realistic. Days should be mon..sun abbreviations.
"""

    try:
        resolved = resolve_model(model)
        resp = _client().chat.completions.create(
            model=resolved,
            messages=[
                {"role": "system", "content": "You are a practical nutrition coach. Reply with JSON only."},
                {"role": "user", "content": prompt},
            ],
            **completion_kwargs(resolved, max_tokens=500 if n == 1 else 900),
        )
        data = _safe_json(resp.choices[0].message.content or "")
        ideas = data.get("ideas") if isinstance(data.get("ideas"), list) else []
        return {
            "ideas": ideas[:n],
            "notes": str(data.get("notes") or "").strip()[:300] or None,
            "stance_hint": data.get("stance_hint") if data.get("stance_hint") in (
                "anchors", "uncertain", "eat_out", "flexible"
            ) else stance,
        }
    except Exception as e:
        print(f"suggest_slot_fills error: {e}")
        return {"ideas": [], "notes": None, "stance_hint": stance}


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

    prompt = f"""Suggest {place_name} orders for {slot} that fit remaining macros.

Remaining budget (approx): {cal} kcal, {protein}g protein
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
- Stay under remaining calories when possible; prioritize protein.
- Avoid foods in dislikes / restrictions.
"""

    try:
        resolved = resolve_model(model)
        resp = _client().chat.completions.create(
            model=resolved,
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
