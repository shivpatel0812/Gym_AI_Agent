"""
Coach Tools - Function-calling toolbox for the AI Coach.

The monthly summary the coach carries in its system prompt is aggregate-only:
it cannot answer "what did I bench last Tuesday" or "am I progressing on
squats". These tools let the model pull the specific records it needs, on
demand, instead of us guessing what to stuff into every prompt.

Layering note: this module talks to Firestore directly rather than importing
the routers, because routers/ already imports ai_analysis/.
"""

from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional

from field_aliases import normalize_records
from nutrition.meal_math import anchor_kind, anchor_macros

# Caps to keep tool results from blowing up the context window
MAX_SESSIONS = 20
MAX_EXERCISE_ENTRIES = 12
MAX_CONTEXT_SESSIONS_PER_EXERCISE = 10
MAX_RECORDS = 15
MAX_DAYS_LOOKBACK = 365
# Enough to see the shape of a day without turning one tool call into a wall
# of JSON the model has to read past.
MAX_FOODS_PER_DAY = 12

# Epley's formula loses meaning past ~12 reps; beyond this we report no estimate
MAX_1RM_REPS = 12

DAYS_ORDER = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]


def estimated_1rm(weight: float, reps: int) -> Optional[float]:
    """
    Epley estimate. Returns None for unusable input.

    Epley is only meaningful in low rep ranges, and mis-entered logs (a set
    recorded as 10lb x 120 reps) would otherwise produce a bogus personal
    record, so anything above MAX_1RM_REPS gets no estimate rather than a
    made-up one.
    """
    if not weight or not reps or reps <= 0 or reps > MAX_1RM_REPS:
        return None
    return round(weight * (1 + reps / 30), 1)


def _top_set(sets: List[Dict]) -> Optional[Dict[str, Any]]:
    """The heaviest set in a list, with its estimated 1RM."""
    best = None
    for s in sets:
        weight = s.get("weight") or 0
        reps = s.get("reps") or 0
        if not reps:
            continue
        if best is None or weight > (best.get("weight") or 0):
            best = {"weight": weight, "reps": reps}
            if s.get("rpe") is not None:
                best["rpe"] = s.get("rpe")
    if best:
        best["estimated_1rm"] = estimated_1rm(best["weight"], best["reps"])
    return best


def _exercise_matches(candidate: Dict, exercise_id: Optional[str], name: str) -> bool:
    """Prefer the stable id; exact normalized name is a legacy-log fallback."""
    candidate_id = candidate.get("exercise_id")
    if exercise_id and candidate_id and str(candidate_id) == str(exercise_id):
        return True
    # Exercise catalog ids changed over time and custom exercises may later be
    # linked to a default entry. A mismatched id must not block an exact-name
    # match, or genuine history disappears while the projector invents a seed.
    candidate_name = candidate.get("exercise_name") or candidate.get("name") or ""
    return bool(name and candidate_name.strip().lower() == name.strip().lower())


def _exercise_history_context(
    sessions: List[Dict], exercise_id: Optional[str], exercise_name: str
) -> Dict[str, Any]:
    """Compact lifetime evidence attached to an exercise in an exact-day result."""
    history = []
    for session in sessions:
        for exercise in session.get("exercises", []) or []:
            if not _exercise_matches(exercise, exercise_id, exercise_name):
                continue
            sets = exercise.get("sets", []) or []
            normalized_sets = [
                {
                    "weight": workout_set.get("weight"),
                    "reps": workout_set.get("reps"),
                    "rpe": workout_set.get("rpe"),
                    "completed": workout_set.get("completed"),
                }
                for workout_set in sets
            ]
            history.append({
                "date": session.get("date"),
                "sets": normalized_sets,
                "top_set": _top_set(normalized_sets),
            })

    history.sort(key=lambda item: item.get("date") or "", reverse=True)
    all_sets = [
        {**workout_set, "date": entry.get("date")}
        for entry in history
        for workout_set in entry.get("sets", [])
        if (workout_set.get("reps") or 0) > 0
    ]
    weighted = [workout_set for workout_set in all_sets if (workout_set.get("weight") or 0) > 0]
    bodyweight = [workout_set for workout_set in all_sets if (workout_set.get("weight") or 0) <= 0]

    # For an added-load movement, more external weight wins; reps break ties.
    best_weighted = max(
        weighted,
        key=lambda workout_set: (workout_set.get("weight") or 0, workout_set.get("reps") or 0),
        default=None,
    )
    best_bodyweight = max(
        bodyweight,
        key=lambda workout_set: workout_set.get("reps") or 0,
        default=None,
    )
    most_recent_weighted = weighted[0] if weighted else None

    recent = history[:MAX_CONTEXT_SESSIONS_PER_EXERCISE]
    recent_top_sets = [entry.get("top_set") for entry in reversed(recent) if entry.get("top_set")]
    trend = "insufficient_history"
    if len(recent_top_sets) >= 2:
        first, last = recent_top_sets[0], recent_top_sets[-1]
        first_score = (first.get("weight") or 0) * (1 + (first.get("reps") or 0) / 30)
        last_score = (last.get("weight") or 0) * (1 + (last.get("reps") or 0) / 30)
        trend = "up" if last_score > first_score * 1.02 else "down" if last_score < first_score * .98 else "steady"

    return {
        "lifetime_session_count": len(history),
        "recent_sessions": recent,
        "best_weighted_set": best_weighted,
        "best_bodyweight_rep_set": best_bodyweight,
        "most_recent_weighted_set": most_recent_weighted,
        "recent_trend": trend,
    }


class CoachToolbox:
    """Executes the coach's tool calls against the user's Firestore data."""

    def __init__(self, db, user_id: str, mode: str = "coach", conversation_id: Optional[str] = None):
        self.db = db
        self.user_id = user_id
        # Which toolset the chat turn is allowed to use. Nutrition and plan
        # mode may each stage proposals against their own plan; ordinary coach
        # chat stays read-only.
        self.mode = mode
        self.conversation_id = conversation_id
        # Structured results the client should render as more than chat text
        # (a suggestion card, say). Read by the chat routers after the turn.
        self.artifacts: List[Dict[str, Any]] = []

    # --- internal helpers -------------------------------------------------

    def _collection(self, name: str):
        return self.db.collection("users").document(self.user_id).collection(name)

    def _fetch_range(self, collection: str, days: int) -> List[Dict]:
        """Fetch documents whose `date` falls in the last N days."""
        days = max(1, min(int(days or 7), MAX_DAYS_LOOKBACK))
        end = datetime.now()
        start = end - timedelta(days=days - 1)
        docs = (
            self._collection(collection)
            .where("date", ">=", start.strftime("%Y-%m-%d"))
            .where("date", "<=", end.strftime("%Y-%m-%d"))
            .stream()
        )
        rows = [{"id": d.id, **(d.to_dict() or {})} for d in docs]
        rows.sort(key=lambda r: r.get("date") or "")
        # Older web-written documents use different field names for the same
        # concepts; normalize here so no tool below has to know that.
        return normalize_records(collection, rows)

    # --- tools ------------------------------------------------------------

    def get_recent_sessions(self, days: int = 7) -> Dict[str, Any]:
        """Recent workouts with per-exercise top sets."""
        sessions = self._fetch_range("workout_sessions", days)[-MAX_SESSIONS:]

        result = []
        for session in sessions:
            exercises = []
            for ex in session.get("exercises", []) or []:
                sets = ex.get("sets", []) or []
                exercises.append({
                    "name": ex.get("exercise_name", "Unknown"),
                    "sets_completed": len(sets),
                    "top_set": _top_set(sets),
                })
            entry = {
                "date": session.get("date"),
                "split": session.get("split_name") or session.get("workout_name"),
                "day": session.get("split_day"),
                "exercises": exercises,
            }
            if session.get("notes"):
                entry["notes"] = session["notes"]
            if session.get("cardio_sport"):
                entry["cardio"] = {
                    "sport": session.get("cardio_sport"),
                    "minutes": session.get("cardio_minutes"),
                    "intensity": session.get("cardio_intensity"),
                }
            result.append(entry)

        return {"days": days, "session_count": len(result), "sessions": result}

    def get_workout_session(self, date: str) -> Dict[str, Any]:
        """Every logged exercise and set for one exact calendar date."""
        try:
            requested = datetime.strptime(str(date or ""), "%Y-%m-%d").strftime("%Y-%m-%d")
        except (TypeError, ValueError):
            return {"error": "date must be a real calendar date in YYYY-MM-DD format"}

        docs = self._collection("workout_sessions").where("date", "==", requested).stream()
        rows = normalize_records(
            "workout_sessions",
            [{"id": doc.id, **(doc.to_dict() or {})} for doc in docs],
        )
        # One lifetime scan supplies context for every exercise on the selected
        # day; do not issue a separate Firestore query per exercise.
        all_rows = normalize_records(
            "workout_sessions",
            [{"id": doc.id, **(doc.to_dict() or {})}
             for doc in self._collection("workout_sessions").stream()],
        )
        sessions = []
        for session in rows:
            exercises = []
            for index, exercise in enumerate(session.get("exercises", []) or []):
                sets = []
                for set_index, workout_set in enumerate(exercise.get("sets", []) or []):
                    sets.append({
                        "set_number": workout_set.get("set_number") or set_index + 1,
                        "weight": workout_set.get("weight"),
                        "reps": workout_set.get("reps"),
                        "rpe": workout_set.get("rpe"),
                        "difficulty": workout_set.get("difficulty"),
                        "completed": workout_set.get("completed"),
                    })
                exercises.append({
                    "order": exercise.get("order") or index + 1,
                    "exercise_id": exercise.get("exercise_id"),
                    "name": exercise.get("exercise_name") or exercise.get("name") or "Unknown",
                    "sets": sets,
                    "top_set": _top_set(sets),
                    "notes": exercise.get("notes"),
                    "time": exercise.get("time"),
                    "speed": exercise.get("speed"),
                    "history_context": _exercise_history_context(
                        all_rows,
                        exercise.get("exercise_id"),
                        exercise.get("exercise_name") or exercise.get("name") or "Unknown",
                    ),
                })
            sessions.append({
                "session_id": session.get("id"),
                "date": requested,
                "split": session.get("split_name") or session.get("workout_name"),
                "day": session.get("split_day"),
                "notes": session.get("notes"),
                "exercise_count": len(exercises),
                "exercises": exercises,
            })

        return {
            "date": requested,
            "found": bool(sessions),
            "session_count": len(sessions),
            "sessions": sessions,
            "message": None if sessions else f"No workout was logged on {requested}.",
        }

    def get_exercise_history(self, exercise_name: str, days: int = 90) -> Dict[str, Any]:
        """Progression on one exercise: top set and estimated 1RM per session."""
        if not exercise_name or not exercise_name.strip():
            return {"error": "exercise_name is required"}

        needle = exercise_name.strip().lower()
        sessions = self._fetch_range("workout_sessions", days)

        history = []
        matched_names = set()
        for session in sessions:
            for ex in session.get("exercises", []) or []:
                name = ex.get("exercise_name", "")
                if needle not in name.lower():
                    continue
                matched_names.add(name)
                sets = ex.get("sets", []) or []
                history.append({
                    "date": session.get("date"),
                    "sets": [
                        {"weight": s.get("weight"), "reps": s.get("reps"), "rpe": s.get("rpe")}
                        for s in sets
                    ],
                    "top_set": _top_set(sets),
                })

        if not history:
            return {
                "exercise": exercise_name,
                "found": False,
                "message": f"No logged sets matching '{exercise_name}' in the last {days} days.",
            }

        history = history[-MAX_EXERCISE_ENTRIES:]
        best = max(
            (h["top_set"]["estimated_1rm"] for h in history
             if h.get("top_set") and h["top_set"].get("estimated_1rm")),
            default=None,
        )

        return {
            "exercise": exercise_name,
            "found": True,
            "matched_exercise_names": sorted(matched_names),
            "days": days,
            "session_count": len(history),
            "best_estimated_1rm": best,
            "history": history,
        }

    def get_todays_plan(self) -> Dict[str, Any]:
        """Today's scheduled workout from the active plan."""
        active = list(self._collection("workout_plans").where("is_active", "==", True).stream())
        if not active:
            return {"status": "no_plan", "message": "No active workout plan."}

        plan = active[0].to_dict() or {}
        today = datetime.now()
        day_of_week = today.strftime("%A").lower()
        assignment = (plan.get("weekly_schedule") or {}).get(day_of_week)

        if not assignment or assignment.lower() == "rest":
            schedule = plan.get("weekly_schedule") or {}
            current_idx = DAYS_ORDER.index(day_of_week)
            for i in range(1, 8):
                check_day = DAYS_ORDER[(current_idx + i) % 7]
                check = schedule.get(check_day, "Rest")
                if check and check.lower() != "rest":
                    return {
                        "status": "rest_day",
                        "plan_name": plan.get("plan_name"),
                        "next_workout_day": check_day.capitalize(),
                        "next_workout_name": check,
                    }
            return {"status": "rest_day", "plan_name": plan.get("plan_name")}

        matching = next(
            (d for d in plan.get("days", []) or [] if d.get("day_name") == assignment), None
        )
        if not matching:
            return {"status": "no_plan", "message": "Today's assignment has no matching plan day."}

        today_str = today.strftime("%Y-%m-%d")
        already_logged = any(
            True for _ in self._collection("workout_sessions").where("date", "==", today_str).stream()
        )

        return {
            "status": "workout_day",
            "plan_name": plan.get("plan_name"),
            "day_name": matching.get("day_name"),
            "focus": matching.get("focus"),
            "estimated_duration_minutes": matching.get("estimated_duration_minutes"),
            "exercises": [
                {
                    "name": e.get("exercise_name") or e.get("name"),
                    "sets": e.get("target_sets") or e.get("sets"),
                    "reps": e.get("target_reps") or e.get("reps"),
                    "notes": e.get("notes"),
                }
                for e in (matching.get("exercises") or [])
            ],
            "logged_a_session_today": already_logged,
        }

    def get_current_split(self) -> Dict[str, Any]:
        """The user's current split, reconstructed from logged sessions when needed."""
        try:
            from routers.training_plan import _load_current_split
            context = _load_current_split(self.user_id, None)
        except Exception as e:
            return {"error": f"Could not load split: {e}"}

        days = []
        for day in context.get("days") or []:
            days.append({
                "day_name": day.get("day_name"),
                "focus": day.get("focus"),
                "exercises": [
                    ex.get("exercise_name") or ex.get("name")
                    for ex in (day.get("exercises") or [])
                    if ex.get("exercise_name") or ex.get("name")
                ],
            })
        return {
            "split_id": context.get("split_id"),
            "split_name": context.get("split_name"),
            "days": days,
        }

    def get_nutrition_log(self, days: int = 7, include_foods: bool = True) -> Dict[str, Any]:
        """
        Day-by-day macro totals, and by default the foods behind them.

        Totals alone cannot answer "what did I eat Tuesday?" or notice that
        every dinner this week was the same takeout, so the item names ride
        along unless the caller opts out.
        """
        rows = self._fetch_range("macros", days)
        entries = []
        for r in rows:
            entry = {
                "date": r.get("date"),
                "calories": r.get("total_calories"),
                "protein": r.get("total_protein"),
                "carbs": r.get("total_carbs"),
                "fats": r.get("total_fats"),
                "fiber": r.get("total_fiber"),
            }
            if include_foods:
                entry["foods"] = [
                    {
                        "name": item.get("name"),
                        "meal": item.get("meal"),
                        "calories": item.get("calories"),
                        "protein": item.get("protein"),
                    }
                    for item in (r.get("food_items") or [])[:MAX_FOODS_PER_DAY]
                    if isinstance(item, dict) and item.get("name")
                ]
            entries.append(entry)
        return {"days": days, "days_logged": len(entries), "entries": entries}

    def get_today_remaining(self, date: Optional[str] = None) -> Dict[str, Any]:
        """What is actually left of today's budget, plan-aware."""
        from datetime import datetime as _dt

        from nutrition.plan_store import NutritionPlanStore
        from nutrition.today_guidance import build_today_guidance

        day = str(date or _dt.now().strftime("%Y-%m-%d"))[:10]
        try:
            plan = NutritionPlanStore(self.db, self.user_id).get_active()
        except Exception as e:
            return {"error": f"Could not load nutrition plan: {e}"}
        if not plan:
            return {"status": "no_plan", "message": "No active nutrition plan."}

        try:
            asked = _dt.strptime(day, "%Y-%m-%d")
        except ValueError:
            asked = _dt.now()
            day = asked.strftime("%Y-%m-%d")
        # Reach back far enough to include the day being asked about, not just
        # today, so "what was left on Sunday" still finds Sunday's food.
        lookback = max(1, min((_dt.now() - asked).days + 1, 30))

        foods = []
        for row in self._fetch_range("macros", lookback):
            if str(row.get("date") or "")[:10] == day:
                foods.extend(row.get("food_items") or [])
        weekday = asked.weekday()

        guidance = build_today_guidance(plan, foods, weekday=weekday)
        guidance["date"] = day
        return guidance

    def get_training_plan(self) -> Dict[str, Any]:
        """Active workout/training plan so nutrition advice can support the lifts."""
        try:
            from nutrition.training_context import load_training_context
            context = load_training_context(self.db, self.user_id)
        except Exception as e:
            return {"error": f"Could not load training plan: {e}"}
        if not context.get("has_plan"):
            return {"status": "no_plan", "message": "No active training plan."}
        return {"status": "active", **context}

    def get_nutrition_plan(self) -> Dict[str, Any]:
        """The user's active nutrition strategy: targets, anchors, flexible meals."""
        try:
            from nutrition.plan_store import NutritionPlanStore
            plan = NutritionPlanStore(self.db, self.user_id).get_active()
        except Exception as e:
            return {"error": f"Could not load nutrition plan: {e}"}
        if not plan:
            return {"status": "no_plan", "message": "No active nutrition plan."}
        # ids are included so propose_nutrition_edits can target an existing
        # item instead of proposing a near-duplicate of one.
        return {
            "plan_id": plan.get("id"),
            "status": plan.get("status"),
            "goal": plan.get("goal"),
            "goal_detail": plan.get("goal_detail"),
            "strategy": plan.get("strategy"),
            "targets": plan.get("targets"),
            # Eating-pattern focus the user chose. Respect it in suggestions;
            # it is not a diagnosis and must not be treated as one.
            "health_focuses": plan.get("health_focuses") or [],
            "health_notes": plan.get("health_notes"),
            "meal_anchors": [
                {
                    "id": a.get("id"),
                    "label": a.get("label"),
                    "slot": a.get("slot"),
                    "frequency": a.get("frequency"),
                    # Which weekdays it actually applies to, and whether it is a
                    # fixed meal, a pick from options, or still undecided —
                    # without these the coach edits a meal it cannot see.
                    "days": a.get("days") or [],
                    "kind": anchor_kind(a),
                    "place": a.get("place"),
                    "expected_calories": round(anchor_macros(a)["calories"]) or None,
                    "expected_protein": round(anchor_macros(a)["protein"]) or None,
                    "foods": [
                        {
                            "name": f.get("name"),
                            "amount": f.get("amount"),
                            "calories": f.get("calories"),
                            "protein": f.get("protein"),
                            "alternate_group": f.get("group_key"),
                        }
                        for f in (a.get("foods") or [])
                        if f.get("name")
                    ],
                }
                for a in (plan.get("meal_anchors") or [])
            ],
            "flexible_meals": [
                {
                    "id": m.get("id"),
                    "name": m.get("name"),
                    "frequency": m.get("frequency"),
                    "calorie_min": m.get("calorie_min"),
                    "calorie_max": m.get("calorie_max"),
                    "protein_min": m.get("protein_min"),
                    "protein_max": m.get("protein_max"),
                    "notes": m.get("notes"),
                }
                for m in (plan.get("flexible_meals") or [])
            ],
            "go_to_items": [
                {
                    "id": g.get("id"),
                    "name": g.get("name"),
                    "slot": g.get("slot"),
                    "amount": g.get("amount"),
                    "calories": g.get("calories"),
                    "protein": g.get("protein"),
                }
                for g in (plan.get("go_to_items") or [])
            ],
            "food_priorities": plan.get("food_priorities") or [],
            "preferences": plan.get("preferences") or {},
        }

    def propose_nutrition_edits(
        self, summary: str = "", edits: Optional[List[Dict[str, Any]]] = None
    ) -> Dict[str, Any]:
        """
        Stage plan changes for review. Never writes the live nutrition plan.

        The model's arguments *are* the ops, so proposing costs nothing beyond
        the chat turn the user already paid for. Everything is validated
        against the live plan first — an edit the user could not safely accept
        is rejected here rather than stored.
        """
        try:
            from nutrition.plan_store import NutritionPlanStore
            from nutrition.suggestion_store import SuggestionStore
            from nutrition.plan_edits import normalize_edits, MAX_EDITS

            plan = NutritionPlanStore(self.db, self.user_id).get_active()
        except Exception as e:
            return {"error": f"Could not load nutrition plan: {e}"}

        if not plan:
            return {
                "status": "no_plan",
                "message": (
                    "There is no active nutrition plan to edit. Tell the user to tap "
                    "Generate Nutrition Plan to create one first."
                ),
            }

        clean_summary = str(summary or "").strip()[:200]
        normalized, rejected = normalize_edits(plan, edits)

        if not normalized:
            return {
                "status": "nothing_proposed",
                "rejected": rejected,
                "message": (
                    "No valid edits. Tell the user plainly what you could not change and why. "
                    "Do not claim the plan was updated."
                ),
            }

        try:
            record = SuggestionStore(self.db, self.user_id).create(
                plan=plan,
                edits=normalized,
                summary=clean_summary or f"{len(normalized)} plan updates",
                conversation_id=self.conversation_id,
            )
        except Exception as e:
            return {"error": f"Could not save those suggestions: {e}"}

        self.artifacts.append({
            "type": "nutrition_suggestions",
            "suggestion_set_id": record["id"],
            "plan_id": plan.get("id"),
            "summary": record["summary"],
            "count": len(normalized),
            "titles": [e["title"] for e in normalized],
        })

        return {
            "status": "proposed",
            "suggestion_set_id": record["id"],
            "count": len(normalized),
            "max_edits": MAX_EDITS,
            "proposed": [
                {"title": e["title"], "op": e["op"], "rationale": e.get("rationale")}
                for e in normalized
            ],
            "rejected": rejected,
            "message": (
                "Staged for review. The plan has NOT changed. Explain the changes in plain "
                "language and tell the user to review them on the Nutrition Plan page, where "
                "they can accept or dismiss each one. If anything was rejected, say so."
            ),
        }

    def propose_plan_edits(
        self, summary: str = "", edits: Optional[List[Dict[str, Any]]] = None
    ) -> Dict[str, Any]:
        """
        Stage per-exercise plan changes for review. Never writes the live plan.

        Scoped on purpose: this can retarget a lift the plan already contains
        and nothing else. Restructuring — adding exercises, removing them,
        changing which days exist — belongs to Plan Mode, where the user is
        answering guided questions rather than chatting mid-workout.
        """
        try:
            from ai_analysis.plan_store import PlanStore
            from ai_analysis.plan_suggestion_store import PlanSuggestionStore
            from ai_analysis.plan_edits import normalize_edits, MAX_EDITS

            plan = PlanStore(self.db, self.user_id).get_active()
        except Exception as e:
            return {"error": f"Could not load training plan: {e}"}

        if not plan:
            return {
                "status": "no_plan",
                "message": (
                    "There is no active training plan to edit. Tell the user to create "
                    "one from the Plan tab first."
                ),
            }

        clean_summary = str(summary or "").strip()[:200]
        normalized, rejected = normalize_edits(plan, edits)

        if not normalized:
            return {
                "status": "nothing_proposed",
                "rejected": rejected,
                "message": (
                    "No valid edits. Tell the user plainly what you could not change and "
                    "why. Do not claim the plan was updated."
                ),
            }

        try:
            record = PlanSuggestionStore(self.db, self.user_id).create(
                plan=plan,
                edits=normalized,
                summary=clean_summary or f"{len(normalized)} target updates",
                conversation_id=self.conversation_id,
            )
        except Exception as e:
            return {"error": f"Could not save those suggestions: {e}"}

        self.artifacts.append({
            "type": "plan_suggestions",
            "suggestion_set_id": record["id"],
            "plan_id": plan.get("id"),
            "summary": record["summary"],
            "count": len(normalized),
            "titles": [edit["title"] for edit in normalized],
        })

        return {
            "status": "proposed",
            "suggestion_set_id": record["id"],
            "count": len(normalized),
            "max_edits": MAX_EDITS,
            "proposed": [
                {"title": e["title"], "op": e["op"], "rationale": e.get("rationale")}
                for e in normalized
            ],
            "rejected": rejected,
            "message": (
                "Staged for review. The plan has NOT changed. Explain the changes in "
                "plain language and tell the user to review them on the Plan tab, where "
                "they can accept or discard. If anything was rejected, say so."
            ),
        }

    def get_wellness_log(self, days: int = 7) -> Dict[str, Any]:
        """Day-by-day sleep, stress, and wellness-survey entries."""
        sleep = self._fetch_range("sleep", days)
        stress = self._fetch_range("stress", days)
        wellness = self._fetch_range("wellness_survey", days)

        return {
            "days": days,
            "sleep": [
                {"date": r.get("date"), "hours": r.get("hours_slept"), "quality": r.get("quality")}
                for r in sleep
            ],
            "stress": [{"date": r.get("date"), "level": r.get("level")} for r in stress],
            "wellness": [
                {
                    "date": r.get("date"),
                    "fatigue": r.get("fatigue"),
                    "energy": r.get("energy"),
                    "body_aches": r.get("body_aches"),
                }
                for r in wellness
            ],
        }

    def get_personal_records(self, days: int = 365) -> Dict[str, Any]:
        """Best weight and estimated 1RM per exercise."""
        sessions = self._fetch_range("workout_sessions", days)

        records: Dict[str, Dict[str, Any]] = {}
        for session in sessions:
            for ex in session.get("exercises", []) or []:
                name = ex.get("exercise_name")
                if not name:
                    continue
                top = _top_set(ex.get("sets", []) or [])
                if not top or not top.get("estimated_1rm"):
                    continue
                current = records.get(name)
                if not current or top["estimated_1rm"] > current["estimated_1rm"]:
                    records[name] = {
                        "exercise": name,
                        "weight": top["weight"],
                        "reps": top["reps"],
                        "estimated_1rm": top["estimated_1rm"],
                        "date": session.get("date"),
                    }

        ranked = sorted(records.values(), key=lambda r: r["estimated_1rm"], reverse=True)
        return {"days": days, "records": ranked[:MAX_RECORDS]}

    def get_latest_body_scan(self) -> Dict[str, Any]:
        """Latest body-scan observations + synthesis (no photos)."""
        try:
            from body_scan.store import BodyScanStore
            scan = BodyScanStore(self.db, self.user_id).latest()
        except Exception as e:
            return {"error": f"Could not load body scan: {e}"}
        if not scan:
            return {"status": "no_scan", "message": "No body scan yet."}

        observations = scan.get("observations") or {}
        confidence = str(observations.get("confidence") or "low").lower()
        return {
            "status": "ok",
            "created_at": scan.get("created_at"),
            "next_scan_at": scan.get("next_scan_at"),
            "goal": scan.get("goal"),
            "observations": observations,
            "synthesis": scan.get("synthesis"),
            "photos_retained": False,
            # Spelled out so the model doesn't present a hedged read as fact
            "reliability": {
                "confidence": confidence,
                "emphasis_applied_to_training": confidence != "low",
                "guidance": (
                    "Photos were too unclear to read reliably. Describe the "
                    "observations as inconclusive and suggest retaking the scan; "
                    "do not base training advice on them."
                    if confidence == "low" else
                    "Appearance-based coaching only — not body composition or "
                    "medical assessment. Hedge accordingly."
                ),
            },
        }

    def get_body_scan_progress(self) -> Dict[str, Any]:
        """
        Change between the two most recent body scans.

        The point of storing scans as structured JSON rather than images is
        being able to answer "has this actually changed" — that needs both
        scans, which get_latest_body_scan alone cannot supply.
        """
        try:
            from body_scan.store import BodyScanStore
            from body_scan.synthesizer import diff_scans
            store = BodyScanStore(self.db, self.user_id)
            latest, previous = store.latest_pair()
        except Exception as e:
            return {"error": f"Could not load body scans: {e}"}

        if not latest:
            return {"status": "no_scan", "message": "No body scan yet."}
        if not previous:
            return {
                "status": "insufficient_history",
                "message": "Only one scan so far — no comparison available yet.",
                "scan_count": 1,
                "latest_at": latest.get("created_at"),
                "next_scan_at": latest.get("next_scan_at"),
            }
        return {"status": "ok", **diff_scans(latest, previous)}

    # --- dispatch ---------------------------------------------------------

    def dispatch(self, name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """Run a tool by name. Never raises — errors come back as data."""
        if name in WRITE_TOOLS and name not in {
            t["function"]["name"] for t in tools_for_mode(self.mode)
        }:
            # Belt and braces: the model is only offered write tools in the
            # modes that allow them, but a replayed tool call must not slip past.
            return {"error": f"{name} is not available in this conversation."}

        handler = {
            "get_recent_sessions": self.get_recent_sessions,
            "get_workout_session": self.get_workout_session,
            "get_exercise_history": self.get_exercise_history,
            "get_todays_plan": self.get_todays_plan,
            "get_current_split": self.get_current_split,
            "get_nutrition_log": self.get_nutrition_log,
            "get_today_remaining": self.get_today_remaining,
            "get_nutrition_plan": self.get_nutrition_plan,
            "get_training_plan": self.get_training_plan,
            "get_wellness_log": self.get_wellness_log,
            "get_personal_records": self.get_personal_records,
            "get_latest_body_scan": self.get_latest_body_scan,
            "get_body_scan_progress": self.get_body_scan_progress,
            "propose_nutrition_edits": self.propose_nutrition_edits,
            "propose_plan_edits": self.propose_plan_edits,
        }.get(name)

        if handler is None:
            return {"error": f"Unknown tool: {name}"}

        try:
            return handler(**(arguments or {}))
        except TypeError as e:
            return {"error": f"Invalid arguments for {name}: {e}"}
        except Exception as e:
            print(f"Coach tool {name} failed: {e}")
            return {"error": f"Could not read that data: {e}"}


def _days_param(description: str, default: int) -> Dict[str, Any]:
    return {
        "type": "integer",
        "description": f"{description} (default {default}, max {MAX_DAYS_LOOKBACK}).",
    }


TOOL_SCHEMAS = [
    {
        "type": "function",
        "function": {
            "name": "get_workout_session",
            "description": (
                "Get the complete workout log for one exact date, preserving exercise order "
                "and every set's weight, reps, RPE, difficulty and completion status. Use this "
                "instead of get_recent_sessions whenever the user names a specific workout date "
                "or asks to analyze, repeat, revise, or build from a particular day's session. "
                "Each exercise also includes lifetime/recent history context and separate best "
                "weighted and bodyweight performances; use that context before judging ability "
                "from the selected session alone."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "date": {
                        "type": "string",
                        "description": "The requested local calendar date in YYYY-MM-DD format.",
                    },
                },
                "required": ["date"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_recent_sessions",
            "description": (
                "Get the user's recent workout sessions with the top set for each exercise. "
                "Use for questions about what they trained recently, how a session went, or "
                "whether they have been consistent."
            ),
            "parameters": {
                "type": "object",
                "properties": {"days": _days_param("How many days back to look", 7)},
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_exercise_history",
            "description": (
                "Get the user's logged history for one exercise: sets, weights, reps, RPE and "
                "estimated 1RM over time. Use for questions about progress, plateaus, or what "
                "weight they used on a specific lift. Matches on partial names."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "exercise_name": {
                        "type": "string",
                        "description": "Exercise name or partial name, e.g. 'bench' or 'squat'.",
                    },
                    "days": _days_param("How many days back to look", 90),
                },
                "required": ["exercise_name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_todays_plan",
            "description": (
                "Get today's scheduled workout from the user's active plan, including the "
                "exercises and target sets/reps, or whether today is a rest day. Use whenever "
                "the user asks what they should do today or what is coming up next."
            ),
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_current_split",
            "description": (
                "Get the user's current workout split and the exercises they actually train "
                "on each day. Use in plan interviews to ground follow-ups in their routine."
            ),
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_nutrition_log",
            "description": (
                "Get day-by-day calories, macros (including fiber) and the foods logged "
                "each day. Use for questions about eating patterns, protein or fiber "
                "intake, repetition, or what they actually ate on a given day."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "days": _days_param("How many days back to look", 7),
                    "include_foods": {
                        "type": "boolean",
                        "description": "Include the food names per day (default true). "
                                       "Set false when you only need totals.",
                    },
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_today_remaining",
            "description": (
                "What is left of today's calorie and protein budget right now, after what "
                "has already been logged and after setting aside the planned meals that "
                "still apply today. Call this before answering 'what should I eat for "
                "dinner/next' so the answer uses the real remaining budget instead of "
                "averages. Only the meals mapped to today's weekday are counted."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "date": {
                        "type": "string",
                        "description": "YYYY-MM-DD. Omit for today.",
                    }
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_training_plan",
            "description": (
                "Get the user's active workout/training plan: the main goal, weekly days, "
                "and key lifts. Use in nutrition interviews so eating supports the training "
                "goal (e.g. incline bench, hypertrophy block)."
            ),
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_nutrition_plan",
            "description": (
                "Get the user's active nutrition plan: calorie/protein targets, regular "
                "foods (meal anchors), and flexible/uncontrolled meals. Use this before "
                "suggesting meals so advice fits how they actually eat."
            ),
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_wellness_log",
            "description": (
                "Get day-by-day sleep, stress, fatigue, energy and soreness entries. Use for "
                "questions about recovery, tiredness, or whether to deload or rest."
            ),
            "parameters": {
                "type": "object",
                "properties": {"days": _days_param("How many days back to look", 7)},
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_personal_records",
            "description": (
                "Get the user's best recorded weight and estimated 1RM for each exercise. "
                "Use for questions about personal bests or overall strength level."
            ),
            "parameters": {
                "type": "object",
                "properties": {"days": _days_param("How many days back to look", 365)},
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_latest_body_scan",
            "description": (
                "Get the user's latest AI body scan: qualitative physique observations, "
                "parsed goal, and recommended training emphasis. Photos are never stored. "
                "Call this whenever the user asks why their program emphasizes a "
                "particular muscle, mentions how they look, asks about weak points, "
                "lagging or imbalanced body parts, posture, or symmetry. Check the "
                "'reliability' field before presenting observations as fact."
            ),
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_body_scan_progress",
            "description": (
                "Compare the user's two most recent body scans: which regions improved, "
                "regressed, or stayed the same, and whether asymmetries resolved. Use "
                "for any question about physique change over time — 'am I making "
                "progress', 'has my back caught up', 'is my imbalance better'. Returns "
                "insufficient_history if they only have one scan. Respect the "
                "'comparable' flag: when false, the difference is photo variation, "
                "not established change."
            ),
            "parameters": {"type": "object", "properties": {}},
        },
    },
]


# --- write tools ----------------------------------------------------------
#
# Everything above reads. This one stages a proposal against the live
# nutrition plan for the user to review on the Plan page. It is offered only
# in nutrition mode, and even then it cannot write the plan itself.

WRITE_TOOLS = {"propose_nutrition_edits", "propose_plan_edits"}

EDIT_OPS = [
    "update_targets",
    "set_pacing",
    "add_meal_anchor", "update_meal_anchor", "remove_meal_anchor",
    "add_flexible_meal", "update_flexible_meal", "remove_flexible_meal",
    "add_go_to", "update_go_to", "remove_go_to",
    "add_blueprint_extra", "update_blueprint_extra", "remove_blueprint_extra",
    "update_strategy", "update_preferences", "update_food_priorities",
    "update_typical_day_notes",
]

NUTRITION_WRITE_SCHEMAS = [
    {
        "type": "function",
        "function": {
            "name": "propose_nutrition_edits",
            "description": (
                "Stage specific changes to the user's ACTIVE nutrition plan for them to "
                "review and accept on the Nutrition Plan page. This does NOT change the "
                "plan — it creates reviewable suggestions. Call it once, at the end of "
                "your reply, when the user has asked for a concrete change to an existing "
                "plan (drop breakfast calories, add a post-workout shake, swap a meal, "
                "raise protein). Call get_nutrition_plan first so you can pass the real "
                "target_id of any item you are changing or removing. Do not call this for "
                "a whole-plan rebuild or a goal change — tell the user to tap Generate "
                "Nutrition Plan instead. Never claim the plan changed; say the updates are "
                "ready to review. Only use a remove_* op when the user names that exact "
                "item and asks for it gone. \"Redesign my meals\", \"mix it up\" or "
                "\"give me better options\" means ADD on top of the meals they already "
                "set — their anchors stay."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "summary": {
                        "type": "string",
                        "description": "One short line describing the change set, e.g. "
                                       "'Lower breakfast, add a post-workout shake'.",
                    },
                    "edits": {
                        "type": "array",
                        "description": "The individual changes. Keep it to the few things "
                                       "the user actually asked for.",
                        "items": {
                            "type": "object",
                            "properties": {
                                "op": {
                                    "type": "string",
                                    "enum": EDIT_OPS,
                                    "description": "Which change to make.",
                                },
                                "target_id": {
                                    "type": "string",
                                    "description": "Required for every update_* and remove_* "
                                                   "op on a list item: the id from "
                                                   "get_nutrition_plan. Omit for add_* ops.",
                                },
                                "payload": {
                                    "type": "object",
                                    "description": (
                                        "The new values. For update_targets: any of calories, "
                                        "protein, carbs, fats, fiber. For set_pacing: "
                                        "{\"pacing\": {\"style\": \"steady|hold|diet_break|"
                                        "refeed|alternate_day|aggressive\", \"weekly_step\": N}}. "
                                        "For meal anchors: slot, "
                                        "label, foods[{name, amount, calories, protein, carbs, "
                                        "fats}], frequency, days, notes. For flexible meals: "
                                        "name, frequency, calorie_min, calorie_max, protein_min, "
                                        "protein_max, notes. For go-tos: name, slot, amount, "
                                        "calories, protein. For update_strategy / "
                                        "update_typical_day_notes: {\"value\": \"...\"}. For "
                                        "update_food_priorities: {\"value\": [\"...\"]}. Send "
                                        "only the fields that change; the rest are kept."
                                    ),
                                    "additionalProperties": True,
                                },
                                "rationale": {
                                    "type": "string",
                                    "description": "One short line on why, shown next to the "
                                                   "suggestion on the plan page.",
                                },
                            },
                            "required": ["op"],
                        },
                    },
                },
                "required": ["summary", "edits"],
            },
        },
    },
]

# Read tools are available everywhere; write tools are earned by mode.
READ_TOOL_SCHEMAS = TOOL_SCHEMAS




# Training-plan micro-patches. Offered only in plan mode: the coach may retune
# a lift the plan already contains, never restructure the program.

PLAN_EDIT_OPS = [
    "set_rep_range", "set_sets", "set_priority", "set_goal", "set_notes",
]

PLAN_WRITE_SCHEMAS = [
    {
        "type": "function",
        "function": {
            "name": "propose_plan_edits",
            "description": (
                "Stage per-exercise changes to the user's ACTIVE training plan for them "
                "to accept or discard on the Plan tab. This does NOT change the plan. "
                "Use it when a lift's target should move based on how sessions have "
                "actually gone. It can only retarget exercises already in the plan — it "
                "cannot add or remove exercises or training days, so do not promise "
                "that. Call get_training_plan first so you use exact day and exercise "
                "names."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "summary": {
                        "type": "string",
                        "description": "One short line describing the change set.",
                    },
                    "edits": {
                        "type": "array",
                        "description": "Up to 6 scoped edits.",
                        "items": {
                            "type": "object",
                            "properties": {
                                "op": {"type": "string", "enum": PLAN_EDIT_OPS},
                                "day_name": {
                                    "type": "string",
                                    "description": "Exact day name from the active plan.",
                                },
                                "exercise_name": {
                                    "type": "string",
                                    "description": "Exact exercise name from that day.",
                                },
                                "value": {
                                    "description": (
                                        "set_rep_range: [low, high]. set_sets: integer. "
                                        "set_priority: high|supporting|normal. "
                                        "set_goal: strength|hypertrophy|fat_loss|general. "
                                        "set_notes: short coaching cue."
                                    ),
                                },
                                "rationale": {
                                    "type": "string",
                                    "description": "Why, in one sentence, from their data.",
                                },
                            },
                            "required": ["op", "exercise_name", "value"],
                        },
                    },
                },
                "required": ["edits"],
            },
        },
    },
]


def tools_for_mode(mode: str = "coach") -> List[Dict[str, Any]]:
    """
    The toolset a chat turn may use.

    Write tools are offered only in the mode whose plan they touch: the user
    has explicitly opened a conversation about that plan, so a proposal is
    expected rather than a surprise. Plain coach chat can read everything and
    stage nothing.
    """
    if mode == "nutrition":
        return READ_TOOL_SCHEMAS + NUTRITION_WRITE_SCHEMAS
    if mode == "plan":
        return READ_TOOL_SCHEMAS + PLAN_WRITE_SCHEMAS
    return READ_TOOL_SCHEMAS
