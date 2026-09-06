"""
The progress hub: one read, one payload.

Assembles the weekly index, its four domains, the lift "positions", the event
timeline and the coverage stats the client renders. Every Firestore collection
is read exactly once here and passed down; the domain builders are pure
functions over lists so they can be tested without a database.

Coverage is reported and never folded into a score. If missing logs lowered
the number, the index would measure how diligently someone opens the app
rather than how they are training — but if missing logs cost nothing at all,
the way to a perfect score is to stop logging. Surfacing it as its own stat is
what resolves that: visible, honest, and outside the math.
"""

from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from nutrition.targets import resolve_targets
from . import index as index_mod
from .domains import (
    Domain,
    build_activity,
    build_body,
    build_consistency,
    build_hydration,
    build_nutrition,
    build_sleep,
    build_strength,
    build_stress,
    goal_direction,
)
from .scan_compare import build_scan_compare
from .weeks import bucket_by_week, parse_day, week_axis, week_label, week_start_of

DEFAULT_WEEKS = 12
MAX_WEEKS = 52

# Pacing styles that mean the plan deliberately asked for a light week. Those
# weeks are annotated on the chart and excluded from the state machine's
# streaks — scoring someone down for complying with their own diet break would
# be the feature arguing against the plan it generated.
PLANNED_LOW_STYLES = {"diet_break", "hold"}

WEEKDAYS = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")


def _safe(fn, default=None):
    """Reads are best-effort: one empty collection must not blank the hub."""
    try:
        return fn()
    except Exception as exc:  # noqa: BLE001 - a missing collection is normal
        print(f"progress hub read failed: {exc}")
        return default


class ProgressHubBuilder:
    def __init__(self, db, user_id: str):
        self.db = db
        self.user_id = user_id

    # --- reads -----------------------------------------------------------

    def _user(self):
        return self.db.collection("users").document(self.user_id)

    def _dated(self, collection: str, since: str) -> List[Dict[str, Any]]:
        def read():
            docs = self._user().collection(collection).where("date", ">=", since).stream()
            return [{"id": d.id, **(d.to_dict() or {})} for d in docs]

        return _safe(read, []) or []

    def _profile(self) -> Dict[str, Any]:
        def read():
            doc = self._user().collection("user_profile").document("profile").get()
            return (doc.to_dict() or {}) if doc.exists else {}

        return _safe(read, {}) or {}

    def _nutrition_plan(self) -> Optional[Dict[str, Any]]:
        def read():
            from nutrition.plan_store import NutritionPlanStore

            return NutritionPlanStore(self.db, self.user_id).get_active()

        return _safe(read, None)

    def _workout_plan(self) -> Optional[Dict[str, Any]]:
        def read():
            from ai_analysis.plan_store import PlanStore

            return PlanStore(self.db, self.user_id).get_active()

        return _safe(read, None)

    def _body_scans(self) -> List[Dict[str, Any]]:
        def read():
            from body_scan.store import BodyScanStore

            return BodyScanStore(self.db, self.user_id).list(limit=20) or []

        return _safe(read, []) or []

    def _levers(self) -> List[Dict[str, Any]]:
        """Cached only. The hub is a read surface and must not trigger a rebuild."""

        def read():
            from state import UserStateBuilder

            cached = UserStateBuilder(self.db, self.user_id).read()
            return (cached or {}).get("next_levers") or []

        return _safe(read, []) or []

    # --- assembly --------------------------------------------------------

    def build(self, weeks: int = DEFAULT_WEEKS, today: Optional[str] = None) -> Dict[str, Any]:
        weeks = max(4, min(MAX_WEEKS, int(weeks or DEFAULT_WEEKS)))
        end = parse_day(today) or datetime.now().date()
        axis = week_axis(end, weeks)
        since = axis[0]

        sessions = self._dated("workout_sessions", since)
        macro_rows = self._dated("macros", since)
        weigh_ins = self._dated("weigh_ins", since)
        sleep_rows = self._dated("sleep", since)
        hydration_rows = self._dated("hydration", since)
        stress_rows = self._dated("stress", since)
        activity_rows = self._dated("physical_activities", since)
        profile = self._profile()
        nutrition_plan = self._nutrition_plan() or {}
        workout_plan = self._workout_plan() or {}

        goal = (
            nutrition_plan.get("goal")
            or profile.get("primary_goal")
            or profile.get("goal")
        )
        direction = goal_direction(goal)
        targets = resolve_targets(
            profile.get("nutrition_targets"), nutrition_plan.get("targets")
        )

        weeks_with_any_data = self._weeks_with_data(
            axis,
            sessions,
            macro_rows,
            weigh_ins,
            sleep_rows,
            hydration_rows,
            stress_rows,
            activity_rows,
        )

        domains: List[Domain] = [
            build_strength(sessions, axis),
            build_consistency(
                sessions, axis, self._expected_sessions(workout_plan, profile), weeks_with_any_data
            ),
            build_nutrition(macro_rows, axis, targets),
            build_body(weigh_ins, axis, goal),
            # Optional lifestyle — each returns unavailable_reason until the
            # user has enough logs; build_series then drops them from the mean.
            build_sleep(sleep_rows, axis, profile.get("sleep_goal")),
            build_hydration(hydration_rows, axis, profile.get("hydration_goal")),
            build_stress(stress_rows, axis, profile.get("typical_stress_level")),
            build_activity(activity_rows, axis, profile.get("steps_goal")),
        ]

        planned_low = self._planned_low_weeks(axis, nutrition_plan)
        points = index_mod.build_series(domains, axis, direction, planned_low)
        band = index_mod.noise_band(points)
        state = index_mod.classify(points, band)
        delta = index_mod.range_delta(points, domains)

        levers = self._levers()
        scans = self._body_scans()
        events = self._events(axis, domains, scans, planned_low, weeks_with_any_data)

        latest = points[-1] if points else None
        return {
            "formula_version": index_mod.FORMULA_VERSION,
            "generated_at": datetime.now().isoformat(),
            "weeks": weeks,
            "goal": goal,
            "goal_direction": direction,
            "index": {
                "level": latest.level if latest else None,
                "confidence": latest.confidence if latest else 0.0,
                "state": state["state"],
                "state_label": state["label"],
                "reason": state["reason"],
                "week_delta": state["delta"],
                "band": band,
                "range_delta": delta,
            },
            "series": [
                {**p.to_dict(), "label": week_label(p.week_start)} for p in points
            ],
            "domains": [self._domain_payload(d, levers) for d in domains],
            "events": events,
            "coverage": self._coverage(
                axis,
                sessions,
                macro_rows,
                weigh_ins,
                sleep_rows,
                hydration_rows,
                stress_rows,
                activity_rows,
                weeks_with_any_data,
            ),
            "scan_compare": build_scan_compare(scans, axis),
            "weights": index_mod.weights_for(direction),
        }

    def current_levels(self, weeks: int = DEFAULT_WEEKS) -> Dict[str, Any]:
        """Today's per-domain levels and goal, for the forward projection."""
        hub = self.build(weeks=weeks)
        return {
            "levels": {d["key"]: d["level"] for d in hub["domains"]},
            "goal_direction": hub["goal_direction"],
            "last_week": hub["series"][-1]["week_start"] if hub["series"] else None,
        }

    # --- pieces ----------------------------------------------------------

    @staticmethod
    def _domain_payload(domain: Domain, levers: List[Dict[str, Any]]) -> Dict[str, Any]:
        payload = domain.to_dict()
        payload["label_for_axis"] = [week_label(p.week_start) for p in domain.series]
        payload["lever"] = _lever_for(domain.key, levers)

        scored = [p for p in domain.series if p.level is not None]
        if len(scored) >= 2:
            payload["change"] = round(scored[-1].level - scored[0].level, 1)
        else:
            payload["change"] = None
        latest = domain.latest()
        payload["coverage"] = latest.coverage if latest else 0.0
        payload["estimated"] = bool(latest.estimated) if latest else False
        return payload

    @staticmethod
    def _expected_sessions(workout_plan: Dict[str, Any], profile: Dict[str, Any]) -> Optional[float]:
        schedule = workout_plan.get("weekly_schedule") or {}
        if isinstance(schedule, dict):
            planned = [
                day
                for key in WEEKDAYS
                for day in [schedule.get(key)]
                if day and str(day).strip().lower() not in ("rest", "off", "none")
            ]
            if planned:
                return float(len(planned))
        preferred = profile.get("preferred_workout_days")
        if isinstance(preferred, list) and preferred:
            return float(len(preferred))
        return None

    @staticmethod
    def _weeks_with_data(
        axis: List[str],
        *row_groups: List[Dict[str, Any]],
    ) -> Dict[str, bool]:
        """
        Did the user log anything at all this week?

        This is what separates "missed my workouts" from "was not using the
        app". Food logged with no sessions is real evidence of missed
        sessions; a completely silent week is evidence of nothing. Sleep,
        hydration, stress and steps count the same way — they prove the week
        was observed.
        """
        present = {w: False for w in axis}
        for rows in row_groups:
            for row in rows or []:
                week = week_start_of(row.get("date"))
                if week in present:
                    present[week] = True
        return present

    @staticmethod
    def _planned_low_weeks(axis: List[str], nutrition_plan: Dict[str, Any]) -> set:
        """
        Weeks the plan deliberately asked to be light.

        Pacing is stored as the plan's *current* style with no start date, so
        only the live week can be attributed to it. That is a real limit, not
        an oversight: back-dating a diet break across weeks the user may have
        been on a different style would invent history.
        """
        pacing = nutrition_plan.get("pacing") or {}
        style = str(pacing.get("style") or "").strip().lower()
        if style in PLANNED_LOW_STYLES and axis:
            return {axis[-1]}
        return set()

    @staticmethod
    def _coverage(
        axis: List[str],
        sessions: List[Dict[str, Any]],
        macro_rows: List[Dict[str, Any]],
        weigh_ins: List[Dict[str, Any]],
        sleep_rows: List[Dict[str, Any]],
        hydration_rows: List[Dict[str, Any]],
        stress_rows: List[Dict[str, Any]],
        activity_rows: List[Dict[str, Any]],
        weeks_with_any_data: Dict[str, bool],
    ) -> Dict[str, Any]:
        last_week = axis[-1] if axis else None
        session_days = {str(r.get("date"))[:10] for r in sessions}
        food_days = {str(r.get("date"))[:10] for r in macro_rows}
        last_bucket = bucket_by_week(macro_rows, axis).get(last_week, []) if last_week else []
        return {
            "weeks_with_data": sum(1 for w in axis if weeks_with_any_data.get(w)),
            "weeks_total": len(axis),
            "sessions_logged": len(session_days),
            "days_food_logged": len(food_days),
            "weigh_ins": len(weigh_ins),
            "nights_sleep_logged": len({str(r.get("date"))[:10] for r in sleep_rows}),
            "days_hydration_logged": len({str(r.get("date"))[:10] for r in hydration_rows}),
            "days_stress_logged": len({str(r.get("date"))[:10] for r in stress_rows}),
            "days_activity_logged": len(
                {
                    str(r.get("date"))[:10]
                    for r in activity_rows
                    if (r.get("steps") or 0)
                }
            ),
            "days_logged_this_week": len({str(r.get("date"))[:10] for r in last_bucket}),
        }

    @staticmethod
    def _events(
        axis: List[str],
        domains: List[Domain],
        scans: List[Dict[str, Any]],
        planned_low: set,
        weeks_with_any_data: Dict[str, bool],
    ) -> List[Dict[str, Any]]:
        """
        What happened, so a move in the line has a cause next to it.

        The news feed is the part of the stock-profile metaphor that actually
        pays: a number that moves without an explanation beside it is the thing
        users stop trusting.
        """
        events: List[Dict[str, Any]] = []
        allowed = set(axis)

        strength = next((d for d in domains if d.key == "strength"), None)
        if strength:
            for position in (strength.detail.get("positions") or [])[:5]:
                if position["change_pct"] <= 0:
                    continue
                # Stamp the week the peak was earned, not the latest axis week.
                # Tagging axis[-1] made every range-wide gain look like it
                # happened "this week" under the scrub card.
                peak_week = position.get("peak_week")
                if not peak_week:
                    for row in position.get("history") or []:
                        if row.get("is_peak") and row.get("week_start"):
                            peak_week = row["week_start"]
                            break
                if peak_week not in allowed:
                    continue
                events.append(
                    {
                        "week_start": peak_week,
                        "kind": "pr",
                        "title": f"{position['name']} up {position['change_pct']:.0f}%",
                        "detail": f"Peak e1RM {position['peak_e1rm']} lb, from {position['baseline_e1rm']} lb.",
                    }
                )

        for scan in scans:
            week = week_start_of(scan.get("date") or scan.get("created_at"))
            if week in allowed:
                events.append(
                    {
                        "week_start": week,
                        "kind": "scan",
                        "title": "Body scan",
                        "detail": "Photos and region notes captured.",
                    }
                )

        for week in planned_low:
            events.append(
                {
                    "week_start": week,
                    "kind": "planned_low",
                    "title": "Planned light week",
                    "detail": "Your plan asked for this. It does not count against the index.",
                }
            )

        for week in axis:
            if not weeks_with_any_data.get(week):
                events.append(
                    {
                        "week_start": week,
                        "kind": "no_evidence",
                        "title": "Nothing logged",
                        "detail": "No sessions, food or weigh-ins. The index held rather than dropped.",
                    }
                )

        events.sort(key=lambda e: e["week_start"], reverse=True)
        return events[:20]


def _lever_for(domain_key: str, levers: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """
    The one thing to change, borrowed from the shared state doc.

    Ranking lives in `state/user_state.py` so Home, the coach, the plan and
    this hub all argue for the same priority. Re-ranking here would put the
    app in contradiction with itself.
    """
    mapping = {
        "nutrition": {"protein", "calories", "fiber", "carbs", "fats"},
        "consistency": set(),
        "body": set(),
        "strength": set(),
        "sleep": {"sleep_hours", "sleep_quality"},
        "hydration": {"hydration"},
        "stress": {"stress"},
        "activity": {"steps"},
    }
    keys = mapping.get(domain_key, set())
    for lever in levers:
        if lever.get("metric") in keys:
            return {
                "metric": lever.get("metric"),
                "label": lever.get("label"),
                "value": lever.get("value"),
                "target": lever.get("target"),
                "unit": lever.get("unit"),
                "direction": lever.get("direction"),
            }
    return None
