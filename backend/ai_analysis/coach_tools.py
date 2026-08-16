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

# Caps to keep tool results from blowing up the context window
MAX_SESSIONS = 20
MAX_EXERCISE_ENTRIES = 12
MAX_RECORDS = 15
MAX_DAYS_LOOKBACK = 365

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


class CoachToolbox:
    """Executes the coach's tool calls against the user's Firestore data."""

    def __init__(self, db, user_id: str):
        self.db = db
        self.user_id = user_id

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
        return rows

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

    def get_nutrition_log(self, days: int = 7) -> Dict[str, Any]:
        """Day-by-day macro totals."""
        rows = self._fetch_range("macros", days)
        return {
            "days": days,
            "days_logged": len(rows),
            "entries": [
                {
                    "date": r.get("date"),
                    "calories": r.get("total_calories"),
                    "protein": r.get("total_protein"),
                    "carbs": r.get("total_carbs"),
                    "fats": r.get("total_fats"),
                }
                for r in rows
            ],
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

    # --- dispatch ---------------------------------------------------------

    def dispatch(self, name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """Run a tool by name. Never raises — errors come back as data."""
        handler = {
            "get_recent_sessions": self.get_recent_sessions,
            "get_exercise_history": self.get_exercise_history,
            "get_todays_plan": self.get_todays_plan,
            "get_nutrition_log": self.get_nutrition_log,
            "get_wellness_log": self.get_wellness_log,
            "get_personal_records": self.get_personal_records,
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
            "name": "get_nutrition_log",
            "description": (
                "Get day-by-day calorie and macro totals. Use for questions about eating "
                "patterns, protein intake, or nutrition consistency on specific days."
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
]
