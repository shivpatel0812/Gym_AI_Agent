"""
Body scan change across the visible range.

**There are no photos here, and there cannot be.** `body_scan/store.py` writes
`photos_retained: False` and the router calls `images.clear()` the moment the
vision pass returns; the uploads are ephemeral by design and the user-facing
disclaimer says so. A side-by-side photo compare would mean reversing that
decision, which is a privacy choice for the product to make deliberately and
not a side effect of building a progress screen.

What scans *do* retain is the structured read: per-region development, posture
flags and asymmetries. That is what gets compared, and it is comparable in the
same qualitative vocabulary it was recorded in — no invented percentages, and
still no body-fat figure, which the scan schema refuses on purpose.

`uncertain` at either end is not a change. A scan that could not read someone's
back and a later one that could would otherwise manufacture an improvement out
of better lighting.
"""

from typing import Any, Dict, List, Optional, Tuple

from body_scan.schemas import POSTURE_KEYS, REGIONS

# Development is ordinal in the direction the field is named: a region moves
# from underdeveloped toward prominent as it is trained.
DEVELOPMENT_ORDER = {"underdeveloped": 0, "balanced": 1, "prominent": 2}

# Posture runs the other way — "none" is the good end.
POSTURE_ORDER = {"none": 0, "possible": 1, "likely": 2}

REGION_LABELS = {r: r.replace("_", " ").title() for r in REGIONS}
POSTURE_LABELS = {k: k.replace("_", " ").title() for k in POSTURE_KEYS}


def _scan_day(scan: Dict[str, Any]) -> str:
    return str(scan.get("date") or scan.get("created_at") or "")[:10]


def _observations(scan: Dict[str, Any]) -> Dict[str, Any]:
    obs = scan.get("observations")
    return obs if isinstance(obs, dict) else {}


def _compare(
    earlier: Optional[str],
    later: Optional[str],
    order: Dict[str, int],
    higher_is_better: bool,
) -> Tuple[Optional[str], Optional[int]]:
    """(direction, steps). None when either end could not be read."""
    if earlier not in order or later not in order:
        return None, None
    steps = order[later] - order[earlier]
    if steps == 0:
        return "unchanged", 0
    improved = steps > 0 if higher_is_better else steps < 0
    return ("improved" if improved else "regressed"), abs(steps)


def build_scan_compare(scans: List[Dict[str, Any]], axis: List[str]) -> Optional[Dict[str, Any]]:
    """
    The first and last scan inside the visible range, and what moved between.

    Returns None rather than a half-filled shape when there is nothing to
    compare — one scan is a reading, not a comparison.
    """
    if not axis:
        return None
    window_start, window_end = axis[0], axis[-1]
    inside = [
        s for s in scans or []
        if _scan_day(s) and window_start <= _scan_day(s) <= _add_week(window_end)
    ]
    inside.sort(key=_scan_day)

    if len(inside) < 2:
        return {
            "available": False,
            "scan_count": len(inside),
            "reason": (
                "One scan in this range — a second one is what makes it a comparison."
                if len(inside) == 1
                else "No body scans in this range."
            ),
            "photos_retained": False,
        }

    first, last = inside[0], inside[-1]
    first_obs, last_obs = _observations(first), _observations(last)
    first_regions = first_obs.get("regions") or {}
    last_regions = last_obs.get("regions") or {}

    regions = []
    for key in REGIONS:
        before = (first_regions.get(key) or {}).get("development")
        after = (last_regions.get(key) or {}).get("development")
        direction, steps = _compare(before, after, DEVELOPMENT_ORDER, higher_is_better=True)
        regions.append(
            {
                "key": key,
                "label": REGION_LABELS[key],
                "from": before,
                "to": after,
                "direction": direction,
                "steps": steps,
            }
        )

    first_posture = first_obs.get("posture") or {}
    last_posture = last_obs.get("posture") or {}
    posture = []
    for key in POSTURE_KEYS:
        before = first_posture.get(key)
        after = last_posture.get(key)
        direction, steps = _compare(before, after, POSTURE_ORDER, higher_is_better=False)
        if direction in (None, "unchanged") and after not in POSTURE_ORDER:
            continue
        posture.append(
            {
                "key": key,
                "label": POSTURE_LABELS[key],
                "from": before,
                "to": after,
                "direction": direction,
                "steps": steps,
            }
        )

    moved = [r for r in regions if r["direction"] in ("improved", "regressed")]
    return {
        "available": True,
        "photos_retained": False,
        "note": "Scans keep written observations only — the photos are never stored.",
        "from_date": _scan_day(first),
        "to_date": _scan_day(last),
        "scan_count": len(inside),
        "from_confidence": first_obs.get("confidence"),
        "to_confidence": last_obs.get("confidence"),
        "regions": regions,
        "posture": posture,
        "changed": moved,
        "unread": [r["label"] for r in regions if r["direction"] is None],
    }


def _add_week(week_start: str) -> str:
    from datetime import datetime, timedelta

    try:
        return (datetime.strptime(week_start, "%Y-%m-%d") + timedelta(days=6)).strftime("%Y-%m-%d")
    except ValueError:
        return week_start
