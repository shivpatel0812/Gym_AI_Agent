"""
Coach Tools - Function-calling toolbox for the AI Coach.

The monthly summary the coach carries in its system prompt is aggregate-only:
it cannot answer "what did I bench last Tuesday" or "am I progressing on
squats". These tools let the model pull the specific records it needs, on
demand, instead of us guessing what to stuff into every prompt.

Layering note: this module talks to Firestore directly rather than importing
the routers, because routers/ already imports ai_analysis/.
"""

import re
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional

import user_time
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

# How many archived meal photos one chat turn may put in front of the model.
# Each is a full-detail image; the point of the tool is to look at the meal the
# user is asking about, not to re-read the album.
MAX_PHOTO_VIEWS_PER_TURN = 2

_PHOTO_NOUN = r"(?:photo(?:graph)?s?|pics?|pictures?|images?)"
_VIEW_VERB = (
    r"(?:look(?:ing)?\s+at|look|see|view|viewing|check|inspect|examine|"
    r"pull\s+up|open|show|read|zoom(?:\s+in)?|analy[sz]e|re-?read)"
)
_PHOTO_VIEW_RE = re.compile(
    # "look at the photo", "can you see my lunch picture", "pull up that image"
    rf"\b{_VIEW_VERB}\b[^.?!]{{0,45}}\b{_PHOTO_NOUN}\b"
    # "the photo shows", "what does the picture say", "in the photo, was there"
    rf"|\b{_PHOTO_NOUN}\b[^.?!]{{0,25}}\b(?:show|shows|showed|say|says|look|"
    rf"looks|again|yourself|directly)\b"
    # "based on the photo", "from the picture"
    rf"|\b(?:based\s+on|from|in|using)\s+(?:the|my|that|this)\s+{_PHOTO_NOUN}\b",
    re.IGNORECASE,
)


def asks_to_see_a_meal_photo(message: str) -> bool:
    """Did the user actually ask the coach to LOOK at a meal photo?

    The archive holds every meal image the user has ever logged, and the coach
    reads the same archive for macros through `get_meal_photo_history`. Those
    are different acts: reading back what was logged is answering a question
    about their diet, while opening the image is looking at a photograph of
    them and their table. The second one happens because they asked for it,
    not because the model judged it might help.

    So the tool is not merely *described* as opt-in — it is withheld from the
    toolset entirely unless this returns True, and refused at dispatch if a
    replayed call slips through. Prompt instructions are advisory; a tool that
    was never offered cannot be called.

    Gated on the current message alone. A follow-up that does not mention the
    photo is answered from the stored ledger, which is the right default —
    and in practice a question *about* a photo names it.
    """
    return bool(_PHOTO_VIEW_RE.search(str(message or "")))


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
    sessions: List[Dict],
    exercise_id: Optional[str],
    exercise_name: str,
    recent_limit: int = MAX_CONTEXT_SESSIONS_PER_EXERCISE,
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
                    # Carried through so a client that hides unticked sets can
                    # still label the remaining ones by the number the user
                    # actually logged, rather than renumbering from 1.
                    "set_number": workout_set.get("set_number") or index + 1,
                    "weight": workout_set.get("weight"),
                    "reps": workout_set.get("reps"),
                    "rpe": workout_set.get("rpe"),
                    "completed": workout_set.get("completed"),
                }
                for index, workout_set in enumerate(sets)
            ]
            history.append({
                "date": session.get("date"),
                "session_id": session.get("id"),
                "sets": normalized_sets,
                "top_set": _top_set(normalized_sets),
            })

    history.sort(key=lambda item: item.get("date") or "", reverse=True)
    # `set_number` exists for rendering a session's rows in order; the
    # best-set records are single sets pulled out of context, where an
    # ordinal means nothing and would only widen the LLM payload.
    all_sets = [
        {
            **{k: v for k, v in workout_set.items() if k != "set_number"},
            "date": entry.get("date"),
        }
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

    recent = history[:recent_limit]
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

    def __init__(
        self,
        db,
        user_id: str,
        mode: str = "coach",
        conversation_id: Optional[str] = None,
        allow_photo_view: bool = False,
    ):
        self.db = db
        self.user_id = user_id
        # Which toolset the chat turn is allowed to use. Nutrition and plan
        # mode may each stage proposals against their own plan; ordinary coach
        # chat stays read-only.
        self.mode = mode
        self.conversation_id = conversation_id
        self._local_now: Optional[datetime] = None
        # Structured results the client should render as more than chat text
        # (a suggestion card, say). Read by the chat routers after the turn.
        self.artifacts: List[Dict[str, Any]] = []
        # Whether this turn may open a meal photograph. Set from the user's own
        # words (`asks_to_see_a_meal_photo`), never inferred by the model.
        self.allow_photo_view = bool(allow_photo_view)
        # Images the chat loop should attach to the model's view after the tool
        # results. They travel here rather than inside the tool's JSON result:
        # a tool message is a string, so an image in it would be a wasted
        # megabyte of base64 the model cannot actually see.
        self.pending_images: List[Dict[str, Any]] = []

    # --- internal helpers -------------------------------------------------

    def _collection(self, name: str):
        return self.db.collection("users").document(self.user_id).collection(name)

    def local_now(self) -> datetime:
        """One consistent user-local clock for the whole chat turn."""
        if self._local_now is None:
            self._local_now = user_time.now(self.db, self.user_id)
        return self._local_now

    def _fetch_range(self, collection: str, days: int) -> List[Dict]:
        """Fetch documents whose `date` falls in the last N days."""
        days = max(1, min(int(days or 7), MAX_DAYS_LOOKBACK))
        end = self.local_now()
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

    # --- progress hub -----------------------------------------------------
    #
    # These read the same builders the Progress tab renders, so the coach and
    # the screen can never disagree about how someone is doing. Recomputing
    # any of it here with different rules is how an app ends up telling a user
    # one thing in a chart and another in chat.

    def _progress_hub(self, weeks: int = 12) -> Dict[str, Any]:
        from progress import ProgressHubBuilder

        if getattr(self, "_hub_cache", None) is None:
            self._hub_cache = {}
        if weeks not in self._hub_cache:
            self._hub_cache[weeks] = ProgressHubBuilder(self.db, self.user_id).build(weeks=weeks)
        return self._hub_cache[weeks]

    def get_progress_index(self, weeks: int = 12) -> Dict[str, Any]:
        """The index, its state, and each domain — trimmed of the week series."""
        hub = self._progress_hub(weeks)
        index = hub.get("index") or {}
        return {
            "level": index.get("level"),
            "state": index.get("state"),
            "state_label": index.get("state_label"),
            "reason": index.get("reason"),
            "band": index.get("band"),
            "confidence": index.get("confidence"),
            "change_over_range": (index.get("range_delta") or {}).get("value"),
            "drivers": (index.get("range_delta") or {}).get("drivers"),
            "weeks": hub.get("weeks"),
            "goal_direction": hub.get("goal_direction"),
            "domains": [
                {
                    "key": d["key"],
                    "label": d["label"],
                    "level": d["level"],
                    "change": d.get("change"),
                    "coverage": d.get("coverage"),
                    "unavailable_reason": d.get("unavailable_reason"),
                }
                for d in hub.get("domains") or []
            ],
            "coverage": hub.get("coverage"),
            "scan_compare": hub.get("scan_compare"),
            "how_to_read": (
                "100 is this user's own starting point, never a population norm. "
                "The level is what they have demonstrated and cannot fall on one bad "
                "week; 'holding' is a normal state and is not a warning. Do not read "
                "a flat week as failure, and quote the state's own reason rather than "
                "inventing a verdict. Low coverage means thin logging, not poor "
                "training."
            ),
        }

    def get_lift_positions(self, weeks: int = 12) -> Dict[str, Any]:
        """Every tracked lift with its peak e1RM and change, best first."""
        hub = self._progress_hub(weeks)
        strength = next((d for d in hub.get("domains") or [] if d["key"] == "strength"), None)
        if not strength or strength.get("unavailable_reason"):
            return {
                "positions": [],
                "reason": (strength or {}).get("unavailable_reason") or "No strength data.",
            }
        detail = strength.get("detail") or {}
        return {
            "positions": detail.get("positions") or [],
            "movers": detail.get("movers") or [],
            "laggards": detail.get("laggards") or [],
            "note": (
                "e1RM is peak-to-date within a single set. 'weeks_stale' counts weeks "
                "since the lift was last trained; an estimate marked softening is "
                "decaying from disuse, not a measured loss."
            ),
        }

    def get_progress_goals(self, include_done: bool = False) -> Dict[str, Any]:
        """The user's goals, scored against the hub."""
        from progress.goals import GoalStore, evaluate

        hub = self._progress_hub()
        goals = GoalStore(self.db, self.user_id).list(include_done=include_done)
        return {
            "goals": [evaluate(goal, hub) for goal in goals],
            "note": (
                "on_track may be null, which means it is genuinely too early or there "
                "is no data — say that rather than guessing a verdict."
            ),
        }

    def get_meal_photo_history(self, limit: int = 20) -> Dict[str, Any]:
        """
        Meal photos and what the user actually logged for each.

        `logged` is the only figure that is what they ate; a first guess the
        user never accepted is not evidence about their diet.
        """
        from progress.photo_hub import build_photo_hub
        from progress.weeks import week_axis

        axis = week_axis(self.local_now().date(), 12)
        try:
            docs = self._collection("food_photo_logs").limit(300).stream()
            logs = [{"id": d.id, **(d.to_dict() or {})} for d in docs]
        except Exception as exc:
            return {"error": f"Could not read the photo archive: {exc}"}
        hub = build_photo_hub(logs, axis, limit=max(1, min(int(limit or 20), 60)))
        hub.pop("by_week", None)
        return hub

    def view_meal_photo(
        self,
        log_id: Optional[str] = None,
        date: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Open one archived meal photograph and put it in front of the model.

        Only callable when the user asked for it in this turn — see
        `asks_to_see_a_meal_photo`. Everything else about their food is
        answerable from `get_meal_photo_history`, which reads the same archive
        without opening the image.

        Body scan photos are NOT here and never will be: `body_scan/store.py`
        writes `photos_retained: False` and the router clears the upload the
        moment the vision pass returns. Only meal photos are archived, and
        only because the estimate has to be re-checkable against them.
        """
        if not self.allow_photo_view:
            return {
                "error": "not_permitted",
                "message": (
                    "Opening a meal photo needs the user to ask for it in "
                    "their own words. Answer from get_meal_photo_history "
                    "instead, and offer to look at the photo if they want."
                ),
            }
        if len(self.pending_images) >= MAX_PHOTO_VIEWS_PER_TURN:
            return {
                "error": "limit_reached",
                "message": (
                    f"Already viewing {MAX_PHOTO_VIEWS_PER_TURN} photos this "
                    "turn. Answer from those, or ask which meal they mean."
                ),
            }

        from progress.photo_hub import summarize_log

        try:
            docs = self._collection("food_photo_logs").limit(300).stream()
            logs = [{"id": d.id, **(d.to_dict() or {})} for d in docs]
        except Exception as exc:
            return {"error": f"Could not read the photo archive: {exc}"}

        with_images = [log for log in logs if log.get("has_image") and log.get("image_base64")]
        if not with_images:
            return {
                "status": "no_photos",
                "message": (
                    "No meal photo is stored. Some logs keep no image — the "
                    "meal was typed rather than photographed, or the archive "
                    "could not hold it."
                ),
            }

        target = None
        if log_id:
            target = next((log for log in with_images if log.get("id") == log_id), None)
            if target is None:
                return {
                    "status": "not_found",
                    "message": (
                        f"No stored photo for log {log_id}. Call "
                        "get_meal_photo_history for ids that have one "
                        "(`has_image` is true)."
                    ),
                }
        else:
            rows = sorted(
                ((summarize_log(log), log) for log in with_images),
                key=lambda pair: pair[0].get("date") or "",
                reverse=True,
            )
            if date:
                rows = [pair for pair in rows if pair[0].get("date") == date] or []
                if not rows:
                    return {
                        "status": "not_found",
                        "message": f"No stored meal photo for {date}.",
                    }
            # Newest photo is the one "my last meal" means.
            target = rows[0][1]

        summary = summarize_log(target)
        mime = str(target.get("image_content_type") or "image/jpeg")
        self.pending_images.append(
            {
                "log_id": summary.get("id"),
                "label": summary.get("title") or "meal photo",
                "date": summary.get("date"),
                "data_url": f"data:{mime};base64,{target['image_base64']}",
            }
        )
        return {
            "status": "ok",
            "attached": True,
            "log_id": summary.get("id"),
            "date": summary.get("date"),
            "title": summary.get("title"),
            # What the user committed, which is the only figure that is what
            # they ate. Null when they never accepted an estimate for it.
            "logged": summary.get("logged"),
            "first_guess_calories": summary.get("first_guess_calories"),
            "was_corrected": summary.get("was_corrected"),
            "message": (
                "The photo is attached to the next message. Describe only what "
                "you can actually see in it; if it is unclear, say so rather "
                "than filling the gap from the logged macros."
            ),
        }

    def propose_progress_goal(
        self,
        kind: str,
        target_value: float,
        target_date: Optional[str] = None,
        exercise_id: Optional[str] = None,
        label: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Stage a goal for the user to accept on the Progress tab.

        Staged, not written live — same stance as every other write tool here.
        A goal the user did not agree to is not their goal, and one that
        appeared without being accepted is something they will be measured
        against without having chosen it.
        """
        from progress.goals import GoalStore

        hub = self._progress_hub()
        try:
            goal = GoalStore(self.db, self.user_id).create(
                {
                    "kind": kind,
                    "target_value": target_value,
                    "target_date": target_date,
                    "exercise_id": exercise_id,
                    "label": label,
                    "status": "proposed",
                    "source": "coach",
                },
                hub,
            )
        except ValueError as exc:
            return {"error": str(exc)}
        self.artifacts.append({"type": "progress_goal_proposal", "goal": goal})
        return {
            "status": "proposed",
            "goal": goal,
            "note": "Staged on the Progress tab. Tell the user it is waiting for them to accept it.",
        }

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
                    "exercise_id": ex.get("exercise_id"),
                    "sets_completed": len(sets),
                    "top_set": _top_set(sets),
                })
            entry = {
                "date": session.get("date"),
                "session_id": session.get("id"),
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

    def session_digest(self, days: int = 14) -> str:
        """
        Compact day-by-day workout lines for the system prompt.

        Averages alone made the coach sound informed without naming any session.
        This is the antidote: short enough to always inject, concrete enough to
        cite ("Tuesday Push had incline…").
        """
        data = self.get_recent_sessions(days=days)
        sessions = data.get("sessions") or []
        if not sessions:
            return (
                f"RECENT WORKOUTS (last {days} days): none logged. "
                "Say so rather than inventing a routine."
            )

        lines = [f"RECENT WORKOUTS (last {days} days, {len(sessions)} sessions):"]
        for session in sessions[-12:]:
            day_label = session.get("day") or session.get("split") or "workout"
            names = []
            for ex in (session.get("exercises") or [])[:8]:
                top = ex.get("top_set") or {}
                bit = ex.get("name") or "lift"
                if top.get("weight") and top.get("reps"):
                    bit = f"{bit} {top['weight']}x{top['reps']}"
                elif top.get("reps"):
                    bit = f"{bit} x{top['reps']}"
                names.append(bit)
            detail = ", ".join(names) if names else "no exercises recorded"
            lines.append(f"- {session.get('date')}: {day_label} — {detail}")
        lines.append(
            "When the user wants to base a plan day on a real workout, cite a "
            "date above and call get_workout_session for the full set list."
        )
        return "\n".join(lines)

    def compact_active_plan(self) -> str:
        """Day → exercise snapshot so plan edits target exact names."""
        try:
            from ai_analysis.plan_store import PlanStore
            plan = PlanStore(self.db, self.user_id).get_active()
        except Exception:
            return ""
        if not plan:
            return "ACTIVE TRAINING PLAN: none. Create one before proposing edits."

        lines = [
            f"ACTIVE TRAINING PLAN ({plan.get('plan_name') or plan.get('id')}):",
            "Use these exact day_name and exercise_name values in propose_plan_edits.",
        ]
        for day in plan.get("days") or []:
            lifts = []
            for ex in day.get("exercises") or []:
                band = ex.get("target_rep_range")
                band_s = (
                    f" {band[0]}-{band[1]}r"
                    if isinstance(band, (list, tuple)) and len(band) == 2
                    else ""
                )
                pri = ex.get("priority") or "normal"
                lifts.append(
                    f"{ex.get('exercise_name')} [{pri}{band_s}, "
                    f"{ex.get('sets') or '?'} sets]"
                )
            lines.append(
                f"- {day.get('day_name')}: "
                + (", ".join(lifts) if lifts else "(empty — fill from logged workouts)")
            )
        return "\n".join(lines)

    def get_recent_activity(
        self, days: int = 7, include_foods: bool = True
    ) -> Dict[str, Any]:
        """One fresh read for questions spanning both training and nutrition."""
        return {
            "as_of": self.local_now().strftime("%Y-%m-%d"),
            "workouts": self.get_recent_sessions(days=days),
            "nutrition": self.get_nutrition_log(
                days=days, include_foods=include_foods
            ),
        }

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
        today = self.local_now()
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
        from nutrition.plan_store import NutritionPlanStore
        from nutrition.today_guidance import build_today_guidance

        now = self.local_now()
        day = str(date or now.strftime("%Y-%m-%d"))[:10]
        try:
            plan = NutritionPlanStore(self.db, self.user_id).get_active()
        except Exception as e:
            return {"error": f"Could not load nutrition plan: {e}"}
        if not plan:
            return {"status": "no_plan", "message": "No active nutrition plan."}

        try:
            asked = datetime.strptime(day, "%Y-%m-%d")
        except ValueError:
            asked = now.replace(tzinfo=None)
            day = asked.strftime("%Y-%m-%d")
        # Reach back far enough to include the day being asked about, not just
        # today, so "what was left on Sunday" still finds Sunday's food.
        lookback = max(1, min((now.date() - asked.date()).days + 1, 30))

        foods = []
        for row in self._fetch_range("macros", lookback):
            if str(row.get("date") or "")[:10] == day:
                foods.extend(row.get("food_items") or [])
        weekday = asked.weekday()

        guidance = build_today_guidance(plan, foods, weekday=weekday)
        guidance["date"] = day
        return guidance

    def get_training_plan(self) -> Dict[str, Any]:
        """Active training plan with exact day/exercise names for edits."""
        try:
            from ai_analysis.plan_store import PlanStore
            plan = PlanStore(self.db, self.user_id).get_active()
        except Exception as e:
            return {"error": f"Could not load training plan: {e}"}
        if not plan:
            return {"status": "no_plan", "message": "No active training plan."}

        days = []
        for day in plan.get("days") or []:
            exercises = []
            for ex in day.get("exercises") or []:
                exercises.append({
                    "exercise_id": ex.get("exercise_id"),
                    "exercise_name": ex.get("exercise_name") or ex.get("name"),
                    "sets": ex.get("sets"),
                    "reps": ex.get("reps"),
                    "target_rep_range": ex.get("target_rep_range"),
                    "priority": ex.get("priority") or "normal",
                    "goal": ex.get("goal"),
                    "notes": ex.get("notes"),
                })
            days.append({
                "day_name": day.get("day_name"),
                "focus": day.get("focus"),
                "exercises": exercises,
            })
        return {
            "status": "active",
            "plan_id": plan.get("id"),
            "plan_name": plan.get("plan_name"),
            "primary_goal": plan.get("primary_goal"),
            "duration_weeks": plan.get("duration_weeks"),
            "weekly_schedule": plan.get("weekly_schedule") or {},
            "days": days,
            "hint": (
                "Use these exact day_name and exercise_name values in "
                "propose_plan_edits. To fill a sparse day, call get_workout_session "
                "for a logged date then replace_day_exercises."
            ),
        }

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
        Stage plan changes for review. Never writes the live plan.

        Supports field retargets (reps/sets/priority/goal/notes) and structure
        ops (add/remove exercise or day, replace a day's exercise list from a
        logged session). Accept on Plan Hub is the only write path.
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

        if name in PHOTO_VIEW_TOOLS and not self.allow_photo_view:
            # The schema is withheld when the user did not ask, so reaching
            # here means a replayed or hallucinated call. `view_meal_photo`
            # refuses on the same flag, but opening someone's photograph
            # because a model decided to is worth stopping twice.
            return {
                "error": (
                    f"{name} is only available when the user asks to look at "
                    "a photo. Use get_meal_photo_history instead."
                )
            }

        handler = {
            "get_recent_activity": self.get_recent_activity,
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
            "get_progress_index": self.get_progress_index,
            "get_lift_positions": self.get_lift_positions,
            "get_progress_goals": self.get_progress_goals,
            "get_meal_photo_history": self.get_meal_photo_history,
            "view_meal_photo": self.view_meal_photo,
            "propose_progress_goal": self.propose_progress_goal,
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
            "name": "get_recent_activity",
            "description": (
                "Get recent workout sessions and day-by-day nutrition logs together. "
                "Use for questions about how the user's recent day or week went overall, "
                "or any question that compares/covers both training and nutrition."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "days": _days_param("How many days back to look", 7),
                    "include_foods": {
                        "type": "boolean",
                        "description": "Include food names (default true).",
                    },
                },
            },
        },
    },
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
    {
        "type": "function",
        "function": {
            "name": "get_progress_index",
            "description": (
                "The user's Progress Hub reading: the weekly index, what state it is in "
                "(building / holding / stalled / declining / unknown), why, and each "
                "domain's level. THIS IS THE CANONICAL ANSWER to 'how am I doing', 'am I "
                "making progress', 'is this working'. Always prefer it over assembling "
                "your own verdict from raw logs, so chat and the Progress tab agree. "
                "100 is the user's own starting point, not a population norm. 'holding' "
                "is a normal state, NOT a warning — never tell someone a held week is a "
                "failure. Quote the state's own reason. If confidence is low that means "
                "thin logging, not bad training."
            ),
            "parameters": {
                "type": "object",
                "properties": {"weeks": _days_param("Weeks of history to read", 12)},
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_lift_positions",
            "description": (
                "Every tracked lift with its peak estimated 1RM, percent change since "
                "baseline, and how many weeks since it was last trained. Use for 'which "
                "lifts are moving', 'what's stalled', 'what should I focus on'. "
                "'laggards' are the lifts that have not moved. A position marked "
                "estimated/softening is decaying from disuse — that is not a measured "
                "strength loss and must not be described as one."
            ),
            "parameters": {
                "type": "object",
                "properties": {"weeks": _days_param("Weeks of history to read", 12)},
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_progress_goals",
            "description": (
                "The user's progress goals with current value, percent complete and "
                "whether they are on pace. Call this whenever they mention a goal, a "
                "target, a deadline, or ask whether they will get there. `on_track` is "
                "null when it is genuinely too early or there is no data — report that "
                "honestly instead of guessing."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "include_done": {
                        "type": "boolean",
                        "description": "Include achieved and abandoned goals (default false).",
                    }
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_meal_photo_history",
            "description": (
                "The archive of meal photos with the macros the user ACTUALLY logged for "
                "each, plus whether their photo estimates tend to read high or low. Use "
                "for 'what have I been eating', 'are my scans accurate', or when "
                "reviewing diet quality against real meals rather than daily totals. "
                "Only the `logged` figures are what they ate — a first guess they never "
                "accepted is not evidence about their diet. Respect bias.measurable: "
                "when false there are too few corrected photos to claim a direction."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "limit": {"type": "integer", "description": "Photos to return (default 20, max 60)."}
                },
            },
        },
    },
]


# --- opt-in photo viewing -------------------------------------------------
#
# Offered only when the user asked, in this turn, to look at a photo. The
# description below tells the model what the tool is for; the *guarantee* that
# it is not called unprompted is `asks_to_see_a_meal_photo` withholding the
# schema, not this prose.

PHOTO_VIEW_TOOLS = {"view_meal_photo"}

PHOTO_VIEW_SCHEMAS = [
    {
        "type": "function",
        "function": {
            "name": "view_meal_photo",
            "description": (
                "Open one archived MEAL photo and actually look at it. The user "
                "has asked you to in this turn — this tool is not offered "
                "otherwise, so if you can see it, you may use it. Prefer "
                "get_meal_photo_history for anything answerable from the logged "
                "macros; use this only to report what is visibly in the frame "
                "(portion size, a component that was or was not counted, how the "
                "plate was actually filled). Describe only what you can see — if "
                "the image is unclear, say so rather than filling the gap from "
                "the logged numbers. Body scan / progress photos are NOT "
                "available and are never stored; say so if asked for those."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "log_id": {
                        "type": "string",
                        "description": (
                            "Photo log id from get_meal_photo_history (one whose "
                            "`has_image` is true). Omit for the most recent photo."
                        ),
                    },
                    "date": {
                        "type": "string",
                        "description": "YYYY-MM-DD to pick that day's newest photo.",
                    },
                },
            },
        },
    },
]


# --- write tools ----------------------------------------------------------
#
# Everything above reads. This one stages a proposal against the live
# nutrition plan for the user to review on the Plan page. It is offered only
# in nutrition mode, and even then it cannot write the plan itself.

WRITE_TOOLS = {"propose_nutrition_edits", "propose_plan_edits", "propose_progress_goal"}

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




# Training-plan patches. Offered in plan mode and coach mode: every write is
# staged for Accept on Plan Hub, so coach can improve a plan without a silent
# overwrite. Nutrition writes stay nutrition-mode-only.

PLAN_EDIT_OPS = [
    "set_rep_range", "set_sets", "set_priority", "set_goal", "set_notes",
    "set_destination", "clear_destination",
    "add_exercise", "remove_exercise", "add_day", "remove_day",
    "replace_day_exercises",
]

PLAN_WRITE_SCHEMAS = [
    {
        "type": "function",
        "function": {
            "name": "propose_plan_edits",
            "description": (
                "Stage changes to the user's ACTIVE training plan for them to accept or "
                "discard on the Plan tab. This does NOT change the plan until they accept. "
                "Use for retargeting a lift AND for structure: add/remove exercises or "
                "days, or replace_day_exercises with a full list pulled from "
                "get_workout_session / get_recent_sessions. Call get_training_plan (or use "
                "the ACTIVE TRAINING PLAN snapshot) so day and exercise names match exactly. "
                "Prefer replace_day_exercises when filling an under-filled day from a real "
                "logged workout instead of inventing lifts."
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
                        "description": "Up to 16 reviewable edits.",
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
                                    "description": (
                                        "Exercise name for field/add/remove ops. "
                                        "For day-level ops, may match the day."
                                    ),
                                },
                                "value": {
                                    "description": (
                                        "set_rep_range: [low, high]. set_sets: integer. "
                                        "set_priority: high|supporting|normal. "
                                        "set_goal: strength|hypertrophy|fat_loss|general. "
                                        "set_notes: short coaching cue. "
                                        "set_destination: {weight, reps, weeks?} finish line "
                                        "(e.g. 85 lb × 8 in 10 weeks). clear_destination: true. "
                                        "add_exercise: {exercise_name, sets?, target_rep_range?, "
                                        "priority?, goal?, notes?} or just rely on exercise_name. "
                                        "add_day: day name string. "
                                        "replace_day_exercises: [{exercise_name, sets, "
                                        "target_rep_range?, priority?, goal?}]."
                                    ),
                                },
                                "rationale": {
                                    "type": "string",
                                    "description": "Why, in one sentence, from their data.",
                                },
                            },
                            "required": ["op"],
                        },
                    },
                },
                "required": ["edits"],
            },
        },
    },
]


PROGRESS_WRITE_SCHEMAS = [
    {
        "type": "function",
        "function": {
            "name": "propose_progress_goal",
            "description": (
                "Stage a progress goal for the user to accept on the Progress tab. Use "
                "when they ask to set a goal or say they want to hit a number by a date. "
                "It is STAGED, never live — always tell them it is waiting for them to "
                "accept it. Pick a target the projection supports rather than a "
                "flattering one; a goal they cannot reach is worse than no goal."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "kind": {
                        "type": "string",
                        "enum": ["exercise_e1rm", "bodyweight", "index_level", "sessions_per_week"],
                        "description": "What is being targeted.",
                    },
                    "target_value": {
                        "type": "number",
                        "description": "The number to reach (lb for lifts and bodyweight).",
                    },
                    "target_date": {
                        "type": "string",
                        "description": "YYYY-MM-DD. Omit for an open-ended goal with no pace.",
                    },
                    "exercise_id": {
                        "type": "string",
                        "description": "Required for exercise_e1rm. Use an id from get_lift_positions.",
                    },
                    "label": {"type": "string", "description": "Short human name for the goal."},
                },
                "required": ["kind", "target_value"],
            },
        },
    },
]


def tools_for_mode(
    mode: str = "coach",
    allow_photo_view: bool = False,
) -> List[Dict[str, Any]]:
    """
    The toolset a chat turn may use.

    Nutrition writes stay in nutrition mode. Training-plan writes are available
    in plan mode and coach mode because every proposal is staged for review —
    "improve my plan" must be able to stage patches without a mode toggle.

    `allow_photo_view` adds the meal-photo viewer, and defaults to off in every
    mode. Opening a photograph of the user's table is not a reasoning step the
    model gets to choose; it is withheld from the toolset until they ask.
    """
    if mode == "nutrition":
        base = READ_TOOL_SCHEMAS + NUTRITION_WRITE_SCHEMAS + PROGRESS_WRITE_SCHEMAS
    else:
        base = READ_TOOL_SCHEMAS + PLAN_WRITE_SCHEMAS + PROGRESS_WRITE_SCHEMAS
    return base + PHOTO_VIEW_SCHEMAS if allow_photo_view else base
