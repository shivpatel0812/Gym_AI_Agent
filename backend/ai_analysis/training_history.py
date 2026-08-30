"""
What the user actually trains, read from logged sessions.

The plan builder used to learn the user's exercises from exactly one source:
a split reconstruction keyed on `split_day` string equality. That is fragile in
both directions. A day whose sessions were never labelled comes back empty — a
real user's "Legs" reconstructed to zero exercises while "Push" reconstructed
to twenty — and a day labelled wrongly comes back polluted, so the planner was
told the user's push day contains curls and pull-ups.

This module reads every session instead, with no dependency on labels being
right, and answers three questions the builder needs:

  * which exercises does this person actually do, how often, how heavy
  * which muscle groups is nobody training
  * which day labels is each exercise logged under

The third one matters because it makes mislabelling visible rather than
authoritative: an exercise logged under two different day names is reported as
such, and the model can weigh that instead of trusting the label blindly.
"""

from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from data.default_exercises import EXERCISE_BY_ID

# Enough to describe a training life without turning the prompt into a ledger.
MAX_CATALOG_ENTRIES = 40

# An exercise seen once six months ago is noise, not a preference.
MIN_SESSIONS_TO_LIST = 1
DEFAULT_LOOKBACK_DAYS = 120

# The exercise catalog and the recommender's classifier disagree on wording
# ("BICEPS" vs "biceps", "legs" vs "LEGS"), so both are normalised here before
# anything counts them. Categories not listed pass through uppercased.
CATEGORY_ALIASES = {
    "QUADS": "LEGS",
    "HAMSTRINGS": "LEGS",
    "ABS": "CORE",
}

# Muscle groups a balanced program is expected to cover. Absence from this
# list is what turns "the user has no leg day" from an invisible reconstruction
# artefact into something the prompt can state outright.
EXPECTED_CATEGORIES = ("CHEST", "BACK", "SHOULDERS", "BICEPS", "TRICEPS", "LEGS")

# Lower body is reported as one number as well as three, because "LEGS: 1,
# GLUTES: 0, CALVES: 0" reads as three small gaps rather than the single large
# one it actually is.
LOWER_BODY_CATEGORIES = ("LEGS", "GLUTES", "CALVES")

# Below this many logged sessions a category counts as untrained rather than
# lightly trained — one squat session in four months is not a leg day.
CATEGORY_PRESENT_THRESHOLD = 2


def _normalize_category(value: Any) -> Optional[str]:
    text = str(value or "").strip().upper()
    if not text or text == "UNKNOWN":
        return None
    return CATEGORY_ALIASES.get(text, text)


def _category_for(exercise_id: str, exercise_name: str) -> Optional[str]:
    """
    Catalog category, falling back to the recommender's own classifier.

    The fallback is what catches this user's custom entries — "Bayesian cable
    cork", "Cable Tricept Pushdown" — which are absent from the catalog and
    would otherwise count toward no muscle group at all.
    """
    entry = EXERCISE_BY_ID.get(exercise_id)
    category = _normalize_category(entry.get("category")) if entry else None
    if category:
        return category
    try:
        from .workout_recommender.exercise_metadata import resolve_exercise_metadata

        metadata = resolve_exercise_metadata(
            exercise_id=exercise_id, exercise_name=exercise_name
        )
        return _normalize_category(getattr(metadata, "muscle_group", None))
    except Exception:
        return None


def _within_lookback(date_value: Any, cutoff: Optional[str]) -> bool:
    if not cutoff:
        return True
    return str(date_value or "") >= cutoff


def build_exercise_catalog(
    sessions: List[Dict],
    lookback_days: int = DEFAULT_LOOKBACK_DAYS,
    limit: int = MAX_CATALOG_ENTRIES,
    today: Optional[datetime] = None,
) -> List[Dict[str, Any]]:
    """
    Every exercise the user has logged, most-trained first.

    Sessions are read whole; no `split_day` label is required for an exercise
    to be counted, which is the entire point.
    """
    cutoff = None
    if lookback_days:
        cutoff = ((today or datetime.now()) - timedelta(days=lookback_days)).strftime(
            "%Y-%m-%d"
        )

    by_key: Dict[str, Dict[str, Any]] = {}
    for session in sessions or []:
        date = session.get("date")
        if not _within_lookback(date, cutoff):
            continue
        day_label = str(session.get("split_day") or "").strip()

        for exercise in session.get("exercises") or []:
            name = str(exercise.get("exercise_name") or "").strip()
            exercise_id = str(exercise.get("exercise_id") or "").strip()
            if not name and not exercise_id:
                continue
            key = exercise_id or name.lower()

            entry = by_key.setdefault(
                key,
                {
                    "exercise_id": exercise_id,
                    "exercise_name": name or exercise_id,
                    "sessions": 0,
                    "last_trained": None,
                    "best_set": None,
                    "logged_under_days": {},
                    "_set_counts": [],
                    "_rep_values": [],
                },
            )
            entry["sessions"] += 1
            if date and (not entry["last_trained"] or date > entry["last_trained"]):
                entry["last_trained"] = date
            if day_label:
                entry["logged_under_days"][day_label] = (
                    entry["logged_under_days"].get(day_label, 0) + 1
                )

            sets = [s for s in (exercise.get("sets") or []) if isinstance(s, dict)]
            working = [s for s in sets if (s.get("reps") or 0) > 0]
            if working:
                entry["_set_counts"].append(len(working))
                entry["_rep_values"].extend(int(s.get("reps") or 0) for s in working)
                best = max(
                    working,
                    key=lambda s: ((s.get("weight") or 0), (s.get("reps") or 0)),
                )
                weight = float(best.get("weight") or 0)
                reps = int(best.get("reps") or 0)
                current = entry["best_set"]
                if not current or (weight, reps) > (
                    current["weight"],
                    current["reps"],
                ):
                    entry["best_set"] = {
                        "weight": weight,
                        "reps": reps,
                        "date": date,
                    }

    catalog = []
    for entry in by_key.values():
        if entry["sessions"] < MIN_SESSIONS_TO_LIST:
            continue
        set_counts = entry.pop("_set_counts")
        rep_values = entry.pop("_rep_values")
        if set_counts:
            entry["typical_sets"] = round(sum(set_counts) / len(set_counts))
        if rep_values:
            entry["typical_reps"] = round(sum(rep_values) / len(rep_values))
        category = _category_for(entry["exercise_id"], entry["exercise_name"])
        if category:
            entry["category"] = category
        if not entry["logged_under_days"]:
            entry.pop("logged_under_days")
        if entry["best_set"] is None:
            entry.pop("best_set")
        catalog.append(entry)

    catalog.sort(
        key=lambda item: (item["sessions"], item.get("last_trained") or ""),
        reverse=True,
    )
    return catalog[:limit]


def coverage_gaps(catalog: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Which muscle groups this person is and is not training.

    Reported explicitly because the failure it exists to catch is silent: a day
    with nothing to reconstruct simply vanishes from the plan, and the user
    sees a program with no leg day and no statement that anything is missing.
    """
    counts: Dict[str, int] = {}
    for entry in catalog:
        category = entry.get("category")
        if category:
            counts[category] = counts.get(category, 0) + entry.get("sessions", 0)

    trained = sorted(
        category for category, n in counts.items() if n >= CATEGORY_PRESENT_THRESHOLD
    )
    lower_body = sum(counts.get(c, 0) for c in LOWER_BODY_CATEGORIES)
    return {
        "sessions_by_category": counts,
        "trained": trained,
        "untrained": [c for c in EXPECTED_CATEGORIES if c not in trained],
        "lower_body_sessions": lower_body,
        "trains_lower_body": lower_body >= CATEGORY_PRESENT_THRESHOLD,
    }


def mislabelled_exercises(catalog: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Exercises logged under more than one day name, most-confused first.

    Not an error — a movement can legitimately appear on two days — but when
    the split reconstruction treats `split_day` as ground truth, this is the
    list that explains why a push day came back full of curls.
    """
    confused = []
    for entry in catalog:
        labels = entry.get("logged_under_days") or {}
        if len(labels) > 1:
            confused.append(
                {
                    "exercise_name": entry["exercise_name"],
                    "logged_under_days": labels,
                    "sessions": entry["sessions"],
                }
            )
    confused.sort(key=lambda item: len(item["logged_under_days"]), reverse=True)
    return confused


def build_history_context(
    sessions: List[Dict],
    lookback_days: int = DEFAULT_LOOKBACK_DAYS,
    limit: int = MAX_CATALOG_ENTRIES,
    today: Optional[datetime] = None,
) -> Dict[str, Any]:
    """The whole picture, as handed to the plan builder."""
    catalog = build_exercise_catalog(
        sessions, lookback_days=lookback_days, limit=limit, today=today
    )
    return {
        "lookback_days": lookback_days,
        "exercises": catalog,
        "coverage": coverage_gaps(catalog),
        "labels_to_distrust": mislabelled_exercises(catalog)[:10],
    }


def name_to_id_map(catalog: List[Dict[str, Any]]) -> Dict[str, str]:
    """Exercise name -> the id this user's own logs use for it."""
    return {
        entry["exercise_name"].strip().lower(): entry["exercise_id"]
        for entry in catalog
        if entry.get("exercise_id") and entry.get("exercise_name")
    }
