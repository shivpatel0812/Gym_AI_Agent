"""
Deterministic synthesis: scan observations + structured goal + training history
→ emphasis deltas. LLM only explains the why afterward.
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Dict, List, Optional

from nutrition.gpt_fallback import get_openai_client
from ai_models import resolve_model, completion_kwargs
from .schemas import EMPHASIS_GROUPS, normalize_synthesis


REGION_TO_EMPHASIS = {
    "chest": ["chest", "upper_push"],
    "back": ["back", "upper_pull"],
    "shoulders": ["shoulders", "upper_push"],
    "arms": ["arms"],
    "legs": ["legs"],
    "glutes": ["glutes", "legs"],
    "core": ["core"],
}

GOAL_AREA_ALIASES = {
    "shoulder": "shoulders",
    "shoulders": "shoulders",
    "delts": "shoulders",
    "rear_delts": "rear_delts",
    "chest": "chest",
    "pecs": "chest",
    "back": "back",
    "lats": "back",
    "arms": "arms",
    "biceps": "arms",
    "triceps": "arms",
    "legs": "legs",
    "quads": "legs",
    "hamstrings": "legs",
    "glutes": "glutes",
    "core": "core",
    "abs": "core",
}


# How far photo-derived signal is allowed to move emphasis, by vision confidence.
# A blurry, badly-posed scan should not reshape six weeks of training as hard as
# a clean one. Goal text is the user's own words, so it is never scaled down.
CONFIDENCE_CEILING = {"high": 2, "medium": 1, "low": 0}


def _bump(emphasis: Dict[str, str], group: str, delta: int, ceiling: int = 2) -> None:
    """Move a group's emphasis by delta, clamped to +/-2 and to `ceiling` upward."""
    if group not in EMPHASIS_GROUPS:
        return
    if delta > 0 and ceiling <= 0:
        return
    try:
        cur = int(str(emphasis.get(group, "0")).replace("+", "") or "0")
    except ValueError:
        cur = 0
    nxt = max(-2, min(2, cur + delta))
    if nxt > 0:
        nxt = min(nxt, max(ceiling, cur))
    if nxt > 0:
        emphasis[group] = f"+{nxt}"
    elif nxt < 0:
        emphasis[group] = str(nxt)
    else:
        emphasis[group] = "0"


def synthesize(
    observations: Dict[str, Any],
    goal: Dict[str, Any],
    history_summary: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Pure deterministic recommendation deltas."""
    history_summary = history_summary or {}
    emphasis = {g: "0" for g in EMPHASIS_GROUPS}
    flags: List[str] = []
    protect = list(goal.get("protect_lifts") or [])

    # Low-confidence photos still produce a readable report, but they no longer
    # steer training — the observations are shown, the emphasis stays at 0.
    confidence = str(observations.get("confidence") or "low").lower()
    ceiling = CONFIDENCE_CEILING.get(confidence, 0)
    if ceiling == 0:
        flags.append("low_confidence_scan_emphasis_withheld")

    regions = observations.get("regions") or {}
    for region, meta in regions.items():
        if not isinstance(meta, dict):
            continue
        dev = meta.get("development")
        groups = REGION_TO_EMPHASIS.get(region, [])
        if dev == "underdeveloped":
            for g in groups:
                _bump(emphasis, g, 1, ceiling)
            flags.append(f"possible_{region}_lag")

    for asym in observations.get("asymmetries") or []:
        if not isinstance(asym, dict):
            continue
        region = asym.get("region")
        severity = asym.get("severity")
        groups = REGION_TO_EMPHASIS.get(region, [region] if region in EMPHASIS_GROUPS else [])
        bump = 1 if severity == "mild" else 2 if severity == "moderate" else 0
        for g in groups:
            _bump(emphasis, g, bump, ceiling)
        if region:
            flags.append(f"asymmetry_{region}_{asym.get('side') or 'uncertain'}")

    posture = observations.get("posture") or {}
    for key, level in posture.items():
        if level in ("possible", "likely"):
            flags.append(f"posture_{key}_{level}")
            if key in ("rounded_shoulders", "forward_head"):
                _bump(emphasis, "rear_delts", 1, ceiling)
                _bump(emphasis, "upper_pull", 1, ceiling)
            if key == "anterior_pelvic_tilt":
                _bump(emphasis, "glutes", 1, ceiling)
                _bump(emphasis, "core", 1, ceiling)

    # Goal target areas get an extra bump. These are the user's own stated
    # priorities, not a guess off a photo, so photo confidence doesn't cap them.
    for area in goal.get("target_areas") or []:
        raw = str(area).lower().replace(" ", "_")
        key = GOAL_AREA_ALIASES.get(raw) or GOAL_AREA_ALIASES.get(raw.rstrip("s"))
        if key:
            _bump(emphasis, key, 1)
            if key == "shoulders":
                _bump(emphasis, "rear_delts", 1)

    direction = goal.get("direction") or "recomp"
    volume_bias = {
        "hypertrophy": "hypertrophy_volume",
        "strength": "strength_priority",
        "cut": "retain_muscle_cut",
        "recomp": "recomp_balance",
        "maintain": "maintenance",
    }.get(direction)

    # History: logged volume is measured, not inferred from a photo, so it is
    # also exempt from the confidence ceiling.
    undertrained = history_summary.get("undertrained_groups") or []
    for g in undertrained:
        g = str(g).lower()
        if g in EMPHASIS_GROUPS:
            _bump(emphasis, g, 1)
            flags.append(f"history_low_volume_{g}")

    # A group already getting heavy logged volume doesn't need a scan-driven
    # bump on top; walk it back one step so emphasis points at real gaps.
    for g in history_summary.get("high_volume_groups") or []:
        g = str(g).lower()
        if g in EMPHASIS_GROUPS and g not in undertrained:
            _bump(emphasis, g, -1)
            flags.append(f"history_high_volume_{g}")

    # Drop zeros for cleaner payload
    emphasis = {k: v for k, v in emphasis.items() if v != "0"}

    return normalize_synthesis({
        "emphasis": emphasis,
        "protect": protect,
        "volume_bias": volume_bias,
        "flags": flags[:12],
        "next_scan_days": 28,
        "applied": False,
    })


# Ordered worst→best so a move along this axis has a direction.
DEVELOPMENT_RANK = {"underdeveloped": 0, "balanced": 1, "prominent": 2}


def diff_scans(
    latest: Optional[Dict[str, Any]],
    previous: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    """
    Compare two stored scans into a progress delta.

    This is the whole reason scans persist as structured JSON instead of images.
    Only compares regions both scans read confidently — a region that went
    "uncertain" says nothing about the body, only about the photo.
    """
    if not latest or not previous:
        return {"status": "insufficient_history", "scans_compared": 0}

    lat_obs = latest.get("observations") or {}
    prev_obs = previous.get("observations") or {}
    lat_conf = str(lat_obs.get("confidence") or "low").lower()
    prev_conf = str(prev_obs.get("confidence") or "low").lower()

    improved, regressed, unchanged, unreadable = [], [], [], []
    lat_regions = lat_obs.get("regions") or {}
    prev_regions = prev_obs.get("regions") or {}

    for region in REGION_TO_EMPHASIS:
        now = (lat_regions.get(region) or {}).get("development")
        before = (prev_regions.get(region) or {}).get("development")
        if now not in DEVELOPMENT_RANK or before not in DEVELOPMENT_RANK:
            unreadable.append(region)
            continue
        delta = DEVELOPMENT_RANK[now] - DEVELOPMENT_RANK[before]
        entry = {"region": region, "from": before, "to": now}
        if delta > 0:
            improved.append(entry)
        elif delta < 0:
            regressed.append(entry)
        else:
            unchanged.append(entry)

    # Asymmetries are worth calling out by presence, not by severity math —
    # severity is the least reliable thing vision reports.
    def _asym_regions(obs):
        return {
            a.get("region") for a in (obs.get("asymmetries") or [])
            if isinstance(a, dict) and a.get("region")
        }

    prev_asym, lat_asym = _asym_regions(prev_obs), _asym_regions(lat_obs)

    days_between = None
    try:
        t_now = datetime.fromisoformat(str(latest.get("created_at")))
        t_prev = datetime.fromisoformat(str(previous.get("created_at")))
        days_between = abs((t_now - t_prev).days)
    except (TypeError, ValueError):
        pass

    # Two low-confidence reads can differ purely from lighting and pose. Say so
    # rather than letting the coach narrate noise as progress.
    comparable = lat_conf != "low" and prev_conf != "low"

    return {
        "status": "ok",
        "scans_compared": 2,
        "days_between": days_between,
        "comparable": comparable,
        "caveat": (
            None if comparable else
            "One or both scans were low-confidence. Treat these deltas as "
            "photo variation, not established physique change."
        ),
        "latest_at": latest.get("created_at"),
        "previous_at": previous.get("created_at"),
        "confidence": {"latest": lat_conf, "previous": prev_conf},
        "improved": improved,
        "regressed": regressed,
        "unchanged": unchanged,
        "unreadable_regions": unreadable,
        "asymmetries_resolved": sorted(prev_asym - lat_asym),
        "asymmetries_new": sorted(lat_asym - prev_asym),
        "asymmetries_persisting": sorted(lat_asym & prev_asym),
    }


def explain_synthesis(
    observations: Dict[str, Any],
    goal: Dict[str, Any],
    synthesis: Dict[str, Any],
    model: Optional[str] = None,
) -> str:
    """LLM explains the deterministic synthesis — does not invent new numbers."""
    client = get_openai_client()
    fallback = (
        "Based on your photos, goal, and training history, the plan shifts volume "
        "toward the areas that look relatively behind and the muscles you named — "
        "without changing how loads are calculated from your logs."
    )
    if not client:
        return fallback

    prompt = f"""Explain this coaching synthesis in 2-4 short sentences for the athlete.
Do NOT invent body-fat %, weights, or new recommendations. Only explain what is already decided.

Goal: {json.dumps(goal)[:600]}
Observations confidence: {observations.get('confidence')}
Limitations: {observations.get('limitations')}
Overall notes: {observations.get('overall_notes')}
Synthesis: {json.dumps(synthesis)[:800]}

Tone: supportive, clear, non-judgmental. Mention that this is appearance-based coaching, not medical advice.
"""
    try:
        resolved = resolve_model(model)
        resp = client.chat.completions.create(
            **completion_kwargs(resolved, max_tokens=280, temperature=0.4),
            messages=[
                {"role": "system", "content": "You explain training emphasis changes. No medical advice."},
                {"role": "user", "content": prompt},
            ],
        )
        text = (resp.choices[0].message.content or "").strip()
        return text[:900] or fallback
    except Exception as e:
        print(f"body_scan explain error: {e}")
        return fallback


# Matched specific-phrase pass first, then generic. Generic fragments overlap
# across groups — "leg press" and "overhead press" both contain "press",
# "calf raise" contains "raise", "hanging leg raise" contains "leg" — so a
# single ordered pass would misfile whichever group happened to be checked
# first. The full phrase has to resolve before any single word is tried.
SPECIFIC_KEYWORDS = (
    ("legs", ("leg press", "leg extension", "leg curl", "calf raise",
              "romanian deadlift", "rdl", "bulgarian", "hack squat")),
    ("core", ("leg raise", "knee raise", "russian twist", "ab wheel",
              "cable crunch", "hanging")),
    ("shoulders", ("overhead press", "shoulder press", "military press",
                   "lateral raise", "front raise", "rear delt", "face pull",
                   "upright row", "arnold press")),
    ("back", ("pull-up", "pullup", "chin-up", "chinup", "pulldown",
              "back extension", "lat pull", "t-bar", "seated row")),
    ("chest", ("bench press", "chest press", "incline press", "decline press",
               "chest fly", "push-up", "pushup")),
    ("arms", ("tricep extension", "overhead extension", "skull crusher",
              "hammer curl", "preacher curl", "cable curl", "pushdown")),
    ("glutes", ("hip thrust", "glute bridge", "glute kickback")),
)

GENERIC_KEYWORDS = (
    ("glutes", ("glute", "kickback")),
    ("legs", ("squat", "lunge", "hamstring", "quad", "calf", "leg")),
    ("back", ("row", "deadlift", "shrug", "lat", "pulldown")),
    ("shoulders", ("delt", "shoulder", "ohp", "overhead")),
    ("arms", ("bicep", "tricep", "curl", "dip")),
    ("chest", ("bench", "chest", "pec", "fly", "press")),
    ("core", ("plank", "crunch", "sit-up", "situp", "core", "ab ", "oblique")),
)


# The shared catalog splits the arms; body-scan emphasis groups them.
_CATALOG_GROUP_ALIASES = {"biceps": "arms", "triceps": "arms", "forearms": "arms"}


def classify_exercise(name: str, exercise_id: str = "") -> Optional[str]:
    """
    Best-effort muscle group for a logged exercise name, or None.

    Defers to the maintained exercise catalog first — the same classifier the
    recommender uses — so a rename or a new entry there is picked up here for
    free. The keyword tables below remain as a fallback for names the catalog
    does not recognise, which is why they cannot simply be deleted: they still
    catch free-text exercises a user typed themselves.
    """
    name = str(name or "").lower().strip()
    if not name and not exercise_id:
        return None

    try:
        from ai_analysis.workout_recommender.exercise_metadata import (
            resolve_exercise_metadata,
        )

        group = (resolve_exercise_metadata(exercise_id, name).muscle_group or "").lower()
        group = _CATALOG_GROUP_ALIASES.get(group, group)
        if group and group not in ("unknown", "cardio"):
            return group
    except Exception:
        pass  # Fall through to keywords rather than losing the classification.

    for table in (SPECIFIC_KEYWORDS, GENERIC_KEYWORDS):
        for group, keys in table:
            if any(k in name for k in keys):
                return group
    return None


def summarize_training_history(sessions: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Rough volume by keyword from recent workout sessions."""
    counts = {g: 0 for g in ("chest", "back", "shoulders", "arms", "legs", "glutes", "core")}
    for session in sessions or []:
        for ex in session.get("exercises") or []:
            group = classify_exercise(
                ex.get("name") or ex.get("exercise_name"),
                ex.get("exercise_id") or "",
            )
            if group:
                counts[group] += 1
    total = sum(counts.values()) or 1
    undertrained = [g for g, c in counts.items() if c / total < 0.08 and total >= 5]
    high = [g for g, c in counts.items() if c / total > 0.35]
    return {
        "counts": counts,
        "undertrained_groups": undertrained,
        "high_volume_groups": high,
        "sessions_considered": len(sessions or []),
    }
