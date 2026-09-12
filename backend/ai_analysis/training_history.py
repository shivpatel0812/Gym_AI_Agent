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

import re
from collections import Counter
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Set, Tuple

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


# Catalog lookup by name, so exercises logged without an explicit id can still
# be linked to standard catalog IDs.
CATALOG_BY_NAME = {
    str(ex.get("name", "")).strip().lower(): ex_id
    for ex_id, ex in EXERCISE_BY_ID.items()
    if ex.get("name")
}

DAY_FAMILY_KEYWORDS: Dict[str, Set[str]] = {
    "push": {"push", "chest", "pecs", "tricep", "triceps", "bench"},
    "pull": {"pull", "back", "lat", "lats", "bicep", "biceps", "row", "rows", "deadlift"},
    "legs": {
        "leg", "legs", "quad", "quads", "hamstring", "hamstrings",
        "calves", "calf", "glutes", "glute", "squat", "lower",
    },
    "upper": {"upper"},
    "lower": {"lower"},
    "full_body": {"full body", "full-body", "total body", "whole body"},
    "arms": {"arms", "arm"},
    "shoulders": {"shoulder", "shoulders", "delt", "delts"},
    "core": {"core", "abs"},
}


def identify_day_family(day_label: str) -> Optional[str]:
    """Identifies the general training family (push, pull, legs, etc.) of a day name."""
    if not day_label:
        return None
    cleaned = str(day_label).strip().lower()
    if not cleaned:
        return None
    if "full body" in cleaned or "total body" in cleaned or "whole body" in cleaned:
        return "full_body"
    words = set(re.findall(r"[a-z]+", cleaned))
    # Prefer exact token match first
    for family, keywords in DAY_FAMILY_KEYWORDS.items():
        if cleaned in keywords or (words & keywords):
            return family
    # Fallback to substring match
    for family, keywords in DAY_FAMILY_KEYWORDS.items():
        for kw in keywords:
            if kw in cleaned:
                return family
    return None


def infer_session_day_family(session: Dict) -> Optional[str]:
    """Infers the day family from split_day, workout_name, or exercise categories."""
    split_day = session.get("split_day")
    fam = identify_day_family(split_day)
    if fam:
        return fam

    workout_name = session.get("workout_name")
    fam = identify_day_family(workout_name)
    if fam:
        return fam

    exercises = session.get("exercises") or []
    if not exercises:
        return None

    cat_counts: Counter = Counter()
    for ex in exercises:
        if isinstance(ex, dict):
            cat = _category_for(
                str(ex.get("exercise_id") or ""),
                str(ex.get("exercise_name") or ex.get("name") or ""),
            )
            if cat:
                cat_counts[cat] += 1

    push_count = cat_counts.get("CHEST", 0) + cat_counts.get("SHOULDERS", 0) + cat_counts.get("TRICEPS", 0)
    pull_count = cat_counts.get("BACK", 0) + cat_counts.get("BICEPS", 0)
    legs_count = cat_counts.get("LEGS", 0) + cat_counts.get("GLUTES", 0) + cat_counts.get("CALVES", 0)
    total = push_count + pull_count + legs_count

    if total >= 2:
        if push_count / total >= 0.5:
            return "push"
        if pull_count / total >= 0.5:
            return "pull"
        if legs_count / total >= 0.5:
            return "legs"
        if (push_count + pull_count) / total >= 0.7 and legs_count == 0:
            return "upper"
        if legs_count / total >= 0.7:
            return "lower"

    return None


def match_session_to_day_score(session: Dict, day_name: str) -> float:
    """Returns a match score (0.0 to 1.0) between a workout session and a plan day."""
    if not day_name or not session:
        return 0.0

    target = str(day_name).strip().lower()
    split_day = str(session.get("split_day") or "").strip().lower()
    workout_name = str(session.get("workout_name") or "").strip().lower()

    # Exact string match
    if split_day and split_day == target:
        return 1.0
    if workout_name and workout_name == target:
        return 0.98

    # Token check
    target_tokens = set(re.findall(r"[a-z0-9]+", target))
    split_tokens = set(re.findall(r"[a-z0-9]+", split_day)) if split_day else set()
    name_tokens = set(re.findall(r"[a-z0-9]+", workout_name)) if workout_name else set()

    if target_tokens and split_tokens and target_tokens == split_tokens:
        return 1.0
    if target_tokens and name_tokens and target_tokens == name_tokens:
        return 0.98

    # Occurrence qualifier check (A vs B, 1 vs 2)
    qualifiers = {"a", "b", "c", "d", "1", "2", "3"}
    target_q = target_tokens & qualifiers
    split_q = split_tokens & qualifiers
    name_q = name_tokens & qualifiers

    # If both have qualifiers and they conflict:
    if target_q and split_q and target_q != split_q:
        return 0.0
    if target_q and name_q and target_q != name_q:
        return 0.0

    # Matching qualifiers
    if target_q and ((split_q and target_q == split_q) or (name_q and target_q == name_q)):
        return 0.96

    # Prefix match
    if split_day and (split_day.startswith(target) or target.startswith(split_day)):
        return 0.94
    if workout_name and (workout_name.startswith(target) or target.startswith(workout_name)):
        return 0.92

    # Family match
    target_fam = identify_day_family(day_name)
    session_fam = infer_session_day_family(session)
    if target_fam and session_fam and target_fam == session_fam:
        return 0.85

    return 0.0


def extract_session_exercises(session: Dict) -> List[Dict[str, Any]]:
    """Extracts cleaned exercise prescriptions from a logged workout session."""
    raw_exercises = session.get("exercises") or []
    extracted: List[Dict[str, Any]] = []
    seen: Set[str] = set()

    for exercise in raw_exercises:
        if not isinstance(exercise, dict):
            continue
        ex_id = str(exercise.get("exercise_id") or "").strip()
        ex_name = str(exercise.get("exercise_name") or exercise.get("name") or "").strip()

        if not ex_id and ex_name:
            ex_id = CATALOG_BY_NAME.get(ex_name.lower(), "")
        if not ex_name and ex_id:
            ex_name = EXERCISE_BY_ID.get(ex_id, {}).get("name", "Exercise")
        if not ex_name:
            ex_name = "Exercise"

        identity = (ex_id or ex_name).lower()
        if not identity or identity in seen:
            continue
        seen.add(identity)

        sets = exercise.get("sets") or []
        set_count = len(sets) if isinstance(sets, list) else int(sets or 3)
        reps_list = [
            int(s.get("reps") or 0)
            for s in sets
            if isinstance(s, dict) and int(s.get("reps") or 0) > 0
        ] if isinstance(sets, list) else []
        reps = round(sum(reps_list) / len(reps_list)) if reps_list else 8

        weights_list = [
            float(s.get("weight") or 0)
            for s in sets
            if isinstance(s, dict) and float(s.get("weight") or 0) > 0
        ] if isinstance(sets, list) else []
        working_weight = round(sum(weights_list) / len(weights_list), 1) if weights_list else None

        prescription: Dict[str, Any] = {
            "exercise_id": ex_id,
            "exercise_name": ex_name,
            "sets": max(1, min(10, set_count or 3)),
            "reps": max(1, min(30, reps)),
            "order": len(extracted) + 1,
            "notes": exercise.get("notes") or "",
            "source_date": session.get("date"),
        }
        if working_weight is not None:
            prescription["last_working_weight"] = working_weight
        extracted.append(prescription)

    return extracted


def find_latest_workout_for_day(
    sessions: List[Dict],
    day_name: str,
    exclude_session_ids: Optional[Set[str]] = None,
) -> Optional[Dict]:
    """
    Finds the most recent workout session that matches the given day_name.
    sessions are assumed sorted newest to oldest.
    """
    exclude = exclude_session_ids or set()
    best_candidate = None
    best_score = 0.0

    # Pass 1: find highest-scoring match not in exclude
    for session in sessions:
        if not session.get("exercises"):
            continue
        s_id = str(session.get("id") or session.get("date") or "")
        if s_id and s_id in exclude:
            continue
        score = match_session_to_day_score(session, day_name)
        if score >= 0.85:
            if score >= 0.95:
                return session
            if score > best_score:
                best_candidate = session
                best_score = score

    if best_candidate:
        return best_candidate

    # Pass 2: If everything was in exclude, check if an excluded session matched
    if exclude:
        for session in sessions:
            if not session.get("exercises"):
                continue
            score = match_session_to_day_score(session, day_name)
            if score >= 0.85:
                return session

    return None


def discover_days_from_history(sessions: List[Dict], limit_days: int = 45) -> List[str]:
    """
    Discovers the user's active workout day names from their recent sessions.
    Returns days ordered logically (e.g. Push, Pull, Legs or Upper, Lower).
    """
    if not sessions:
        return []

    cutoff = (datetime.now() - timedelta(days=limit_days)).strftime("%Y-%m-%d")
    recent = [s for s in sessions if str(s.get("date") or "") >= cutoff]
    if not recent:
        recent = sessions[:15]

    found_families: List[str] = []
    seen_families: Set[str] = set()
    canonical_names: Dict[str, str] = {}

    for s in recent:
        if not s.get("exercises"):
            continue
        raw_name = str(s.get("split_day") or s.get("workout_name") or "").strip()
        fam = infer_session_day_family(s)
        if fam and fam not in seen_families:
            seen_families.add(fam)
            found_families.append(fam)
            canonical_names[fam] = raw_name if raw_name and len(raw_name) <= 25 else fam.capitalize()

    order_map = {
        "push": 1, "pull": 2, "legs": 3,
        "upper": 1, "lower": 2,
        "full_body": 1,
        "arms": 4, "shoulders": 5, "core": 6,
    }
    found_families.sort(key=lambda f: order_map.get(f, 99))
    return [canonical_names[f] for f in found_families if f in canonical_names]

