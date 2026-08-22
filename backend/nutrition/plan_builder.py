"""
Nutrition Plan Builder - turns questionnaire answers into a structured plan.

The model estimates targets and meal-anchor macros, and writes a short
strategy. It does not invent a 7-day meal spreadsheet. If the model is
unavailable, a deterministic fallback still produces a usable plan from
the answers the user already gave.
"""

import json
import uuid
from typing import Any, Dict, List, Optional

GOAL_KEYS = {
    "fat_loss": "Lose fat",
    "maintain": "Maintain",
    "muscle": "Gain muscle",
    "lean_bulk": "Lean bulk",
    "health": "General health/performance",
}

GOAL_DEFAULTS = {
    "fat_loss": {"calories": 2000, "protein": 170, "carbs": 180, "fats": 65, "fiber": 30},
    "maintain": {"calories": 2200, "protein": 160, "carbs": 220, "fats": 75, "fiber": 30},
    "muscle": {"calories": 2600, "protein": 185, "carbs": 280, "fats": 80, "fiber": 32},
    "lean_bulk": {"calories": 2800, "protein": 190, "carbs": 310, "fats": 85, "fiber": 32},
    "health": {"calories": 2200, "protein": 160, "carbs": 230, "fats": 75, "fiber": 30},
}

VALID_SLOTS = {"breakfast", "lunch", "snack", "shake", "dinner", "late_night", "pre_workout", "other"}
PRIMARY_SLOTS = ("breakfast", "lunch", "pre_workout", "dinner", "snack")
VALID_BANDS = {"Morning", "Midday", "Evening", "Late"}
VALID_FREQ = {"daily", "most_days", "weekdays", "weekends", "few_times_week", "occasionally"}
VALID_STYLE = {"strict", "flexible"}
VALID_DAYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
VALID_STANCES = {"anchors", "uncertain", "eat_out", "flexible"}


def _new_id() -> str:
    return uuid.uuid4().hex[:12]


def _num(value, default=None):
    try:
        if value is None or value == "":
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def _str_list(value) -> List[str]:
    if not value:
        return []
    if isinstance(value, str):
        parts = [p.strip() for p in value.split(",")]
        return [p for p in parts if p][:12]
    if isinstance(value, list):
        return [str(x).strip() for x in value if str(x).strip()][:12]
    return []


def _clamp(n, lo, hi):
    if n is None:
        return None
    return max(lo, min(hi, n))


def suggest_nutrition_goal(training: Optional[Dict] = None) -> Dict[str, Any]:
    """
    Propose a nutrition goal from the active training plan, with the reason.

    The wizard uses this to lead with a suggestion instead of a blank picker,
    so someone on a hypertrophy block does not silently get a maintenance plan.
    """
    training = training or {}
    goal = infer_nutrition_goal(None, training)

    if not training.get("has_plan"):
        return {
            "goal": goal,
            "label": GOAL_KEYS[goal],
            "from_training": False,
            "reason": "No active training plan yet, so this is just a starting point.",
            "plan_name": None,
        }

    plan_name = training.get("plan_name")
    primary = training.get("primary_goal")
    day_count = len(training.get("days") or [])

    bits = []
    if plan_name:
        bits.append(str(plan_name))
    if primary and str(primary).lower() not in str(plan_name or "").lower():
        bits.append(str(primary))
    if day_count:
        bits.append(f"{day_count} days/week")
    detail = ", ".join(bits) if bits else "your training plan"

    return {
        "goal": goal,
        "label": GOAL_KEYS[goal],
        "from_training": True,
        "reason": f"Based on {detail}.",
        "plan_name": plan_name,
    }


def infer_nutrition_goal(answers: Optional[Dict] = None, training: Optional[Dict] = None) -> str:
    """Use an explicit nutrition goal, or infer one from training / chat notes."""
    answers = answers or {}
    if answers.get("goal") in GOAL_KEYS:
        return answers["goal"]

    parts = [
        answers.get("goal_notes") or "",
        answers.get("typical_day") or "",
        answers.get("conversation_notes") or "",
        (training or {}).get("primary_goal") or "",
        (training or {}).get("plan_name") or "",
    ]
    for day in (training or {}).get("days") or []:
        parts.append(day.get("name") or "")
        parts.append(day.get("focus") or "")
        parts.append(" ".join(day.get("exercises") or []))
    text = " ".join(str(p) for p in parts).lower()

    if any(word in text for word in ("cut", "deficit", "lose fat", "fat loss", "lose weight")):
        return "fat_loss"
    if any(word in text for word in ("lean bulk", "slow bulk", "surplus")):
        return "lean_bulk"
    if any(
        word in text
        for word in (
            "muscle", "hypertrophy", "strong", "strength", "bench", "press",
            "squat", "deadlift", "incline",
        )
    ):
        return "muscle"
    return "maintain"


class NutritionPlanBuilder:
    def __init__(self, api_key: Optional[str] = None, model: str = "gpt-4o"):
        self.api_key = api_key
        self.model = model

    def build_plan(
        self,
        answers: Dict[str, Any],
        profile: Optional[Dict] = None,
        recent_nutrition: Optional[Dict] = None,
        training_context: Optional[Dict] = None,
        existing_plan: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Returns {status, plan} or {status, error}.

        `existing_plan` is the plan the user is already running. Anything on it
        is carried into the new plan untouched — a regenerate adds, it never
        overwrites what someone entered by hand.
        """
        answers = dict(answers or {})
        if training_context:
            answers["training_context"] = training_context
        answers["goal"] = infer_nutrition_goal(answers, training_context)

        if self.api_key:
            try:
                raw = self._generate(
                    answers, profile or {}, recent_nutrition or {}, training_context, existing_plan
                )
                plan = self.validate_plan(raw, answers)
                return {"status": "success", "plan": self.preserve_existing(plan, existing_plan)}
            except Exception as e:
                print(f"Nutrition plan generation failed, using fallback: {e}")

        fallback = self.fallback_plan(answers, profile, recent_nutrition)
        return {"status": "success", "plan": self.preserve_existing(fallback, existing_plan)}

    def _generate(
        self,
        answers: Dict,
        profile: Dict,
        recent: Dict,
        training: Optional[Dict] = None,
        existing: Optional[Dict] = None,
    ) -> Dict:
        from openai import OpenAI

        locked = ""
        if existing:
            locked = f"""
MEALS THE USER ALREADY SET (LOCKED — these stay in the plan exactly as they are):
{json.dumps({
    "meal_anchors": existing.get("meal_anchors") or [],
    "flexible_meals": existing.get("flexible_meals") or [],
    "go_to_items": existing.get("go_to_items") or [],
    "fast_food_places": existing.get("fast_food_places") or [],
}, indent=2, default=str)[:4000]}

These are locked even if the user asked to "redesign" or "start over". Do NOT
restate, rename, re-time, or replace them — they are added back automatically
and any copy you return is discarded. Only return meal_anchors that are NEW
additions sitting on top of the locked ones (a second breakfast option, a
snack that closes a protein gap), and write the strategy as "keep your current
anchors, and add ...".
"""

        client = OpenAI(api_key=self.api_key)
        prompt = f"""You design a persistent nutrition STRATEGY, not a 7-day meal plan.

The user already told us how they actually eat. Plan AROUND their regular foods
and flexible/uncontrolled meals. Do not replace Greek yogurt with a new breakfast
every day. Prefer their saved foods.
{locked}

QUESTIONNAIRE ANSWERS:
{json.dumps(answers, indent=2, default=str)}

USER PROFILE:
{json.dumps(profile, indent=2, default=str)}

RECENT LOGGED NUTRITION (if any):
{json.dumps(recent, indent=2, default=str)}

ACTIVE TRAINING PLAN (align calories, protein, and strategy with this):
{json.dumps(training or {"has_plan": False}, indent=2, default=str)}

Return JSON with exactly this shape:
{{
  "goal": "fat_loss|maintain|muscle|lean_bulk|health",
  "goal_detail": "one sentence",
  "targets": {{
    "calories": number,
    "calories_min": number,
    "calories_max": number,
    "protein": number,
    "carbs": number,
    "fats": number,
    "fiber": number
  }},
  "strategy": "2-4 sentences explaining how the day should work, especially around flexible meals",
  "typical_day_notes": "short restatement of their usual day",
  "meal_anchors": [
    {{
      "slot": "breakfast|lunch|snack|shake|dinner|late_night|other",
      "label": "Breakfast",
      "frequency": "daily|most_days|weekdays|weekends|few_times_week|occasionally",
      "notes": "",
      "foods": [
        {{"name": "Greek yogurt", "amount": "1 cup", "calories": 150, "protein": 20, "carbs": 8, "fats": 4, "fiber": 0}}
      ]
    }}
  ],
  "flexible_meals": [
    {{
      "name": "Dinner",
      "frequency": "most_days",
      "calorie_min": 650,
      "calorie_max": 900,
      "protein_min": 25,
      "protein_max": 40,
      "user_controls_food": false,
      "notes": "Family dinner, calories are approximate"
    }}
  ],
  "preferences": {{
    "likes": ["..."],
    "dislikes": ["..."],
    "dietary_restrictions": "",
    "foods_on_hand": ["..."],
    "preferred_meal_count": 3,
    "larger_dinner": true,
    "guidance_style": "strict|flexible"
  }},
  "food_priorities": [
    "Keep breakfast and daytime meals high in protein",
    "Leave calorie flexibility for dinner"
  ]
}}

Rules:
- Keep meal_anchors the user listed. You may estimate missing macros; do not invent a totally different breakfast.
- Never remove or rewrite a locked meal. New meal_anchors must be additions the
  user can take or leave, and each one should say in "notes" how it fits next to
  what they already eat.
- Keep flexible meals they listed. Ranges can be rough.
- Targets should be realistic given their recent intake if provided, and the goal.
- If a training plan is present, align the nutrition goal and targets with it
  (strength/hypertrophy → enough protein and calories to progress key lifts;
  a cut → a modest deficit that still supports training). Mention the training
  goal or key lifts in strategy when it helps.
- 3-6 food_priorities, practical, not medical.
- Calories must be between 1200 and 4500. Protein 60-300.
"""
        from ai_models import completion_kwargs

        response = client.chat.completions.create(
            **completion_kwargs(self.model, max_tokens=2200, temperature=0.4),
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a nutrition coach who plans around how people actually eat. "
                        "Output strict JSON only."
                    ),
                },
                {"role": "user", "content": prompt},
            ],
            response_format={"type": "json_object"},
        )
        return json.loads(response.choices[0].message.content)

    @staticmethod
    def fallback_plan(
        answers: Dict[str, Any],
        profile: Optional[Dict] = None,
        recent: Optional[Dict] = None,
    ) -> Dict[str, Any]:
        goal = answers.get("goal") if answers.get("goal") in GOAL_KEYS else "maintain"
        defaults = dict(GOAL_DEFAULTS[goal])
        avg_cal = _num((recent or {}).get("avg_calories"))
        if avg_cal and 1200 <= avg_cal <= 4500:
            if goal == "fat_loss":
                defaults["calories"] = int(round(avg_cal * 0.85))
            elif goal in ("muscle", "lean_bulk"):
                defaults["calories"] = int(round(avg_cal * 1.08))
            else:
                defaults["calories"] = int(round(avg_cal))

        anchors = NutritionPlanBuilder._normalize_anchors(answers.get("meal_anchors"))
        flexible = NutritionPlanBuilder._normalize_flexible(answers.get("flexible_meals"))
        prefs = NutritionPlanBuilder._normalize_preferences(answers.get("preferences"))

        flex_names = ", ".join(m["name"] for m in flexible) or "uncontrolled meals"
        training = (answers or {}).get("training_context") or {}
        training_goal = training.get("primary_goal") if training.get("has_plan") else None
        if flexible:
            strategy = (
                f"Keep regular foods predictable earlier in the day so there is enough "
                f"calorie and protein room for {flex_names}. Plan around what you already eat "
                f"instead of inventing a new menu."
            )
        else:
            strategy = (
                "Use your regular foods as the backbone of the day and fill remaining "
                "calories and protein with foods you already like."
            )
        if training_goal:
            strategy += f" Align intake with your training goal: {training_goal}."

        priorities = [
            "Prioritize protein in meals you control",
            "Use regular foods you already eat rather than new recipes",
        ]
        if flexible:
            priorities.append(f"Leave calorie flexibility for {flex_names}")
        if prefs.get("guidance_style") == "strict":
            priorities.append("Stay close to the calorie and protein targets on days you can")
        else:
            priorities.append("Treat targets as a range, not a perfect daily hit")

        cal = defaults["calories"]
        return NutritionPlanBuilder.validate_plan(
            {
                "goal": goal,
                "goal_detail": answers.get("goal_notes") or GOAL_KEYS[goal],
                "targets": {
                    "calories": cal,
                    "calories_min": int(cal * 0.93),
                    "calories_max": int(cal * 1.07),
                    "protein": defaults["protein"],
                    "carbs": defaults["carbs"],
                    "fats": defaults["fats"],
                    "fiber": defaults["fiber"],
                },
                "strategy": strategy,
                "typical_day_notes": answers.get("typical_day") or "",
                "meal_anchors": anchors,
                "flexible_meals": flexible,
                "preferences": prefs,
                "food_priorities": priorities,
            },
            answers,
        )

    @staticmethod
    def validate_plan(plan: Dict, answers: Optional[Dict] = None) -> Dict[str, Any]:
        plan = dict(plan or {})
        answers = answers or {}

        goal = plan.get("goal") if plan.get("goal") in GOAL_KEYS else answers.get("goal")
        if goal not in GOAL_KEYS:
            goal = "maintain"
        plan["goal"] = goal
        plan["goal_detail"] = str(plan.get("goal_detail") or answers.get("goal_notes") or GOAL_KEYS[goal])[:240]

        defaults = GOAL_DEFAULTS[goal]
        raw_t = plan.get("targets") if isinstance(plan.get("targets"), dict) else {}
        calories = _clamp(_num(raw_t.get("calories"), defaults["calories"]), 1200, 4500)
        protein = _clamp(_num(raw_t.get("protein"), defaults["protein"]), 60, 300)
        carbs = _clamp(_num(raw_t.get("carbs"), defaults["carbs"]), 40, 500)
        fats = _clamp(_num(raw_t.get("fats"), defaults["fats"]), 20, 180)
        fiber = _clamp(_num(raw_t.get("fiber"), defaults["fiber"]), 0, 80)
        cmin = _clamp(_num(raw_t.get("calories_min"), calories * 0.93), 1100, 4500)
        cmax = _clamp(_num(raw_t.get("calories_max"), calories * 1.07), 1200, 5000)
        if cmin and cmax and cmin > cmax:
            cmin, cmax = cmax, cmin
        plan["targets"] = {
            "calories": int(round(calories)),
            "calories_min": int(round(cmin)) if cmin else None,
            "calories_max": int(round(cmax)) if cmax else None,
            "protein": int(round(protein)),
            "carbs": int(round(carbs)),
            "fats": int(round(fats)),
            "fiber": int(round(fiber)),
        }

        plan["strategy"] = str(plan.get("strategy") or "").strip()[:800] or None
        plan["carryover_note"] = str(plan.get("carryover_note") or "").strip()[:400] or None
        plan["typical_day_notes"] = (
            str(plan.get("typical_day_notes") or answers.get("typical_day") or "").strip()[:800] or None
        )
        plan["food_priorities"] = _str_list(plan.get("food_priorities"))[:8]
        plan["meal_anchors"] = NutritionPlanBuilder._normalize_anchors(
            plan.get("meal_anchors") or answers.get("meal_anchors")
        )
        plan["flexible_meals"] = NutritionPlanBuilder._normalize_flexible(
            plan.get("flexible_meals") or answers.get("flexible_meals")
        )
        plan["go_to_items"] = NutritionPlanBuilder._normalize_go_to_items(
            plan.get("go_to_items") or answers.get("go_to_items")
        )
        plan["blueprint_extras"] = NutritionPlanBuilder._normalize_blueprint_extras(
            plan.get("blueprint_extras") or answers.get("blueprint_extras")
        )
        plan["slot_profiles"] = NutritionPlanBuilder._normalize_slot_profiles(
            plan.get("slot_profiles") or answers.get("slot_profiles")
        )
        plan["fast_food_places"] = NutritionPlanBuilder._normalize_fast_food_places(
            plan.get("fast_food_places") or answers.get("fast_food_places")
        )
        merged_prefs = {}
        if isinstance(answers.get("preferences"), dict):
            merged_prefs.update(answers["preferences"])
        if isinstance(plan.get("preferences"), dict):
            merged_prefs.update({k: v for k, v in plan["preferences"].items() if v not in (None, [], "")})
        plan["preferences"] = NutritionPlanBuilder._normalize_preferences(merged_prefs)
        return plan

    # Fields the user owns. A regenerate may add to these lists, never rewrite
    # or drop what someone already entered. (field, key_fn, max_len)
    CARRYOVER_LISTS = (
        (
            "meal_anchors",
            lambda i: (str(i.get("slot") or "").lower(), str(i.get("label") or "").strip().lower()),
            10,
        ),
        ("flexible_meals", lambda i: str(i.get("name") or "").strip().lower(), 6),
        (
            "go_to_items",
            lambda i: (str(i.get("slot") or "").lower(), str(i.get("name") or "").strip().lower()),
            20,
        ),
        (
            "blueprint_extras",
            lambda i: (str(i.get("band") or "").lower(), str(i.get("label") or "").strip().lower()),
            16,
        ),
        ("fast_food_places", lambda i: str(i.get("name") or "").strip().lower(), 12),
    )

    @staticmethod
    def preserve_existing(plan: Dict[str, Any], existing: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Keep everything the user already entered; the AI may only add on top.

        "Redesign my meal plan" must not delete a breakfast someone typed in.
        Entries already on the live plan are carried over verbatim — same ids,
        days, kind, foods, places — and AI entries that collide with one are
        dropped. Whatever is genuinely new is appended and labelled as an
        addition, and the plan gets a carryover note explaining the split.
        """
        if not existing:
            return plan

        plan = dict(plan or {})
        added: List[str] = []

        for field, key_fn, cap in NutritionPlanBuilder.CARRYOVER_LISTS:
            kept = [dict(i) for i in (existing.get(field) or []) if isinstance(i, dict)]
            seen_ids = {str(i.get("id")) for i in kept if i.get("id")}
            seen_keys = {key_fn(i) for i in kept}
            extras = []
            for item in plan.get(field) or []:
                if not isinstance(item, dict):
                    continue
                if str(item.get("id") or "") in seen_ids:
                    continue
                key = key_fn(item)
                if key in seen_keys:
                    continue
                seen_keys.add(key)
                item = dict(item)
                item["id"] = _new_id()
                if field == "meal_anchors":
                    note = str(item.get("notes") or "").strip()
                    item["notes"] = (
                        f"{note} · Added on top of your current meals." if note
                        else "Added on top of your current meals — keep your usual, use this for variety."
                    )[:240]
                extras.append(item)
                label = str(item.get("label") or item.get("name") or "").strip()
                if label and field == "meal_anchors":
                    added.append(label)
            # Existing entries come first, so a cap can only ever drop an
            # AI addition — never something the user wrote.
            plan[field] = (kept + extras)[:cap]

        # Stances are per slot and the user sets them by hand.
        if existing.get("slot_profiles"):
            plan["slot_profiles"] = [dict(p) for p in existing["slot_profiles"] if isinstance(p, dict)]

        prefs = dict(plan.get("preferences") or {})
        old_prefs = existing.get("preferences") or {}
        for key in ("likes", "dislikes", "foods_on_hand"):
            merged = list(old_prefs.get(key) or [])
            for value in prefs.get(key) or []:
                if value not in merged:
                    merged.append(value)
            if merged:
                prefs[key] = merged
        for key in ("dietary_restrictions", "preferred_meal_count", "larger_dinner", "guidance_style"):
            if old_prefs.get(key) not in (None, "", []):
                prefs[key] = old_prefs[key]
        plan["preferences"] = prefs

        if added:
            plan["carryover_note"] = (
                "Your current anchors stay exactly as you set them — follow those first. "
                f"Added on top: {', '.join(added[:6])}."
            )[:400]
        else:
            plan["carryover_note"] = (
                "Your current anchors stay exactly as you set them — follow those first. "
                "This update only changes targets and strategy."
            )
        return plan

    @staticmethod
    def _normalize_anchors(raw) -> List[Dict]:
        items = raw if isinstance(raw, list) else []
        out = []
        for item in items[:10]:
            if not isinstance(item, dict):
                continue
            foods_in = item.get("foods") if isinstance(item.get("foods"), list) else []
            if not foods_in and item.get("name"):
                foods_in = [{"name": item.get("name"), "amount": item.get("amount")}]
            foods = []
            for food in foods_in[:12]:
                if isinstance(food, str) and food.strip():
                    foods.append({"name": food.strip()})
                    continue
                if not isinstance(food, dict):
                    continue
                name = str(food.get("name") or "").strip()
                if not name:
                    continue
                gk = str(food.get("group_key") or "").strip()[:40] or None
                foods.append({
                    "name": name[:80],
                    "amount": str(food.get("amount") or "").strip()[:40] or None,
                    "calories": _clamp(_num(food.get("calories")), 0, 2000),
                    "protein": _clamp(_num(food.get("protein")), 0, 150),
                    "carbs": _clamp(_num(food.get("carbs")), 0, 200),
                    "fats": _clamp(_num(food.get("fats")), 0, 100),
                    "fiber": _clamp(_num(food.get("fiber")), 0, 40),
                    "group_key": gk,
                    "match_similar": bool(food.get("match_similar")) if food.get("match_similar") else None,
                })
            label = str(item.get("label") or item.get("name") or (foods[0]["name"] if foods else "Regular meal")).strip()[:60]
            if not label:
                continue
            slot = str(item.get("slot") or "other").strip().lower()
            if slot not in VALID_SLOTS:
                slot = "other"
            freq = str(item.get("frequency") or "most_days").strip().lower()
            # Older mobile clients sent "custom" for partial week selections.
            if freq == "custom":
                freq = "most_days"
            if freq not in VALID_FREQ:
                freq = "most_days"
            days_in = item.get("days") if isinstance(item.get("days"), list) else []
            days = []
            for d in days_in:
                key = str(d or "").strip().lower()[:3]
                # accept "monday" / "mon" / "Mon"
                if len(key) >= 3:
                    key = key[:3]
                if key in VALID_DAYS and key not in days:
                    days.append(key)
            # Empty days = use frequency. Full week if frequency is daily.
            if not days and freq == "daily":
                days = list(VALID_DAYS)
            varies = bool(item.get("varies"))
            uncertain = bool(item.get("uncertain"))
            kind_raw = str(item.get("kind") or "").strip().lower()
            if kind_raw not in ("individual", "potential", "uncertain"):
                if uncertain:
                    kind_raw = "uncertain"
                elif varies:
                    kind_raw = "potential"
                else:
                    kind_raw = "individual"
            # Keep flags in sync with kind so older clients still work.
            varies = kind_raw == "potential"
            uncertain = kind_raw == "uncertain"
            place = str(item.get("place") or "").strip()[:80] or None
            out.append({
                "id": str(item.get("id") or _new_id()),
                "slot": slot,
                "label": label,
                "foods": foods,
                "frequency": freq,
                "days": days,
                "notes": str(item.get("notes") or "").strip()[:240] or None,
                "kind": kind_raw,
                "varies": varies,
                "uncertain": uncertain,
                "place": place,
            })
        return out

    @staticmethod
    def _normalize_flexible(raw) -> List[Dict]:
        items = raw if isinstance(raw, list) else []
        out = []
        for item in items[:6]:
            if isinstance(item, str) and item.strip():
                item = {"name": item.strip()}
            if not isinstance(item, dict):
                continue
            name = str(item.get("name") or "").strip()[:40]
            if not name:
                continue
            freq = str(item.get("frequency") or "most_days").strip().lower()
            if freq not in VALID_FREQ:
                freq = "most_days"
            cmin = _clamp(_num(item.get("calorie_min")), 0, 2500)
            cmax = _clamp(_num(item.get("calorie_max")), 0, 3000)
            if cmin and cmax and cmin > cmax:
                cmin, cmax = cmax, cmin
            pmin = _clamp(_num(item.get("protein_min")), 0, 150)
            pmax = _clamp(_num(item.get("protein_max")), 0, 180)
            if pmin and pmax and pmin > pmax:
                pmin, pmax = pmax, pmin
            out.append({
                "id": str(item.get("id") or _new_id()),
                "name": name,
                "frequency": freq,
                "calorie_min": int(round(cmin)) if cmin is not None else None,
                "calorie_max": int(round(cmax)) if cmax is not None else None,
                "protein_min": int(round(pmin)) if pmin is not None else None,
                "protein_max": int(round(pmax)) if pmax is not None else None,
                "user_controls_food": bool(item.get("user_controls_food", False)),
                "notes": str(item.get("notes") or "").strip()[:240] or None,
            })
        return out

    @staticmethod
    def _normalize_go_to_items(raw) -> List[Dict]:
        items = raw if isinstance(raw, list) else []
        out = []
        for item in items[:20]:
            if isinstance(item, str) and item.strip():
                item = {"name": item.strip()}
            if not isinstance(item, dict):
                continue
            name = str(item.get("name") or "").strip()[:80]
            if not name:
                continue
            slot = str(item.get("slot") or "other").strip().lower()
            if slot not in VALID_SLOTS:
                slot = "other"
            days_in = item.get("days") if isinstance(item.get("days"), list) else []
            days = []
            for d in days_in:
                key = str(d or "").strip().lower()[:3]
                if key in VALID_DAYS and key not in days:
                    days.append(key)
            out.append({
                "id": str(item.get("id") or _new_id()),
                "slot": slot,
                "name": name,
                "days": days,
                **{
                    k: v
                    for k, v in {
                        "amount": str(item.get("amount") or "").strip()[:40] or None,
                        "calories": _clamp(_num(item.get("calories")), 0, 2000),
                        "protein": _clamp(_num(item.get("protein")), 0, 150),
                        "carbs": _clamp(_num(item.get("carbs")), 0, 200),
                        "fats": _clamp(_num(item.get("fats")), 0, 100),
                        "fiber": _clamp(_num(item.get("fiber")), 0, 40),
                        "notes": str(item.get("notes") or "").strip()[:240] or None,
                    }.items()
                    if v is not None
                },
            })
        return out

    @staticmethod
    def _normalize_blueprint_extras(raw) -> List[Dict]:
        """One-time / band extras on the day blueprint (not forever anchors)."""
        items = raw if isinstance(raw, list) else []
        out = []
        for item in items[:16]:
            if not isinstance(item, dict):
                continue
            label = str(item.get("label") or item.get("name") or "").strip()[:60]
            if not label:
                continue
            band = str(item.get("band") or "").strip()
            if band not in VALID_BANDS:
                band = "Midday"
            slot = str(item.get("slot") or "snack").strip().lower()
            if slot not in VALID_SLOTS:
                slot = "snack"
            foods_in = item.get("foods") if isinstance(item.get("foods"), list) else []
            foods = []
            for food in foods_in[:6]:
                if isinstance(food, str) and food.strip():
                    foods.append({"name": food.strip()[:80]})
                    continue
                if not isinstance(food, dict):
                    continue
                name = str(food.get("name") or "").strip()
                if not name:
                    continue
                foods.append({
                    "name": name[:80],
                    "amount": str(food.get("amount") or "").strip()[:40] or None,
                    "calories": _clamp(_num(food.get("calories")), 0, 2000),
                    "protein": _clamp(_num(food.get("protein")), 0, 150),
                    "carbs": _clamp(_num(food.get("carbs")), 0, 200),
                    "fats": _clamp(_num(food.get("fats")), 0, 100),
                    "fiber": _clamp(_num(food.get("fiber")), 0, 40),
                })
            cmin = _clamp(_num(item.get("calorie_min")), 0, 2500)
            cmax = _clamp(_num(item.get("calorie_max")), 0, 3000)
            if cmin and cmax and cmin > cmax:
                cmin, cmax = cmax, cmin
            pmin = _clamp(_num(item.get("protein_min")), 0, 150)
            pmax = _clamp(_num(item.get("protein_max")), 0, 180)
            if pmin and pmax and pmin > pmax:
                pmin, pmax = pmax, pmin
            out.append({
                "id": str(item.get("id") or _new_id()),
                "band": band,
                "slot": slot,
                "label": label,
                "foods": foods,
                "calories": _clamp(_num(item.get("calories")), 0, 2000),
                "protein": _clamp(_num(item.get("protein")), 0, 150),
                "calorie_min": int(round(cmin)) if cmin is not None else None,
                "calorie_max": int(round(cmax)) if cmax is not None else None,
                "protein_min": int(round(pmin)) if pmin is not None else None,
                "protein_max": int(round(pmax)) if pmax is not None else None,
                "notes": str(item.get("notes") or "").strip()[:240] or None,
            })
        return out

    @staticmethod
    def _normalize_slot_profiles(raw) -> List[Dict]:
        """Stance per primary meal slot: anchors / uncertain / eat_out / flexible."""
        items = raw if isinstance(raw, list) else []
        by_slot: Dict[str, Dict] = {}
        for item in items:
            if not isinstance(item, dict):
                continue
            slot = str(item.get("slot") or "").strip().lower()
            if slot not in PRIMARY_SLOTS:
                continue
            stance = str(item.get("stance") or "anchors").strip().lower()
            if stance not in VALID_STANCES:
                stance = "anchors"
            by_slot[slot] = {
                "slot": slot,
                "stance": stance,
                "notes": str(item.get("notes") or "").strip()[:240] or None,
            }
        # Always return all primary slots so the UI has a complete day.
        out = []
        for slot in PRIMARY_SLOTS:
            if slot in by_slot:
                out.append(by_slot[slot])
            else:
                out.append({"slot": slot, "stance": "anchors", "notes": None})
        return out

    @staticmethod
    def _normalize_fast_food_places(raw) -> List[Dict]:
        items = raw if isinstance(raw, list) else []
        out = []
        for item in items[:12]:
            if isinstance(item, str) and item.strip():
                item = {"name": item.strip()}
            if not isinstance(item, dict):
                continue
            name = str(item.get("name") or "").strip()[:60]
            if not name:
                continue
            slots_in = item.get("slots") if isinstance(item.get("slots"), list) else ["lunch", "dinner"]
            slots = []
            for s in slots_in:
                key = str(s or "").strip().lower()
                if key in ("lunch", "dinner") and key not in slots:
                    slots.append(key)
            if not slots:
                slots = ["lunch", "dinner"]
            days_in = item.get("days") if isinstance(item.get("days"), list) else []
            days = []
            for d in days_in:
                key = str(d or "").strip().lower()[:3]
                if key in VALID_DAYS and key not in days:
                    days.append(key)
            out.append({
                "id": str(item.get("id") or _new_id()),
                "name": name,
                "slots": slots,
                "days": days,
                "notes": str(item.get("notes") or "").strip()[:240] or None,
            })
        return out

    @staticmethod
    def _normalize_preferences(raw) -> Dict[str, Any]:
        prefs = raw if isinstance(raw, dict) else {}
        style = prefs.get("guidance_style")
        if style not in VALID_STYLE:
            style = "flexible"
        meal_count = prefs.get("preferred_meal_count")
        try:
            meal_count = int(meal_count) if meal_count is not None else None
        except (TypeError, ValueError):
            meal_count = None
        if meal_count is not None:
            meal_count = max(1, min(8, meal_count))
        return {
            "likes": _str_list(prefs.get("likes")),
            "dislikes": _str_list(prefs.get("dislikes")),
            "dietary_restrictions": str(prefs.get("dietary_restrictions") or "").strip()[:160] or None,
            "foods_on_hand": _str_list(prefs.get("foods_on_hand")),
            "preferred_meal_count": meal_count,
            "larger_dinner": bool(prefs["larger_dinner"]) if prefs.get("larger_dinner") is not None else None,
            "guidance_style": style,
        }
