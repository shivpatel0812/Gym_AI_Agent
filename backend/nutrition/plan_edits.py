"""
Typed edit operations against an existing nutrition plan.

The AI coach proposes changes as a list of ops rather than a whole new plan,
so the user reviews a scoped diff on the Plan page instead of re-activating a
second draft. Nothing here touches Firestore: normalize_edits() turns raw
model output into reviewable edits, apply_edits() turns accepted edits into a
patch the existing PATCH /nutrition-plan/{id} path can validate and write.

Ops map one-to-one onto fields UpdateNutritionPlanRequest already accepts, so
applying an edit is a validated merge, never a second schema.
"""

import uuid
from typing import Any, Dict, List, Optional, Tuple

from nutrition.plan_builder import NutritionPlanBuilder

# A suggestion set is meant to be reviewed in one sitting. More than this and
# the plan page becomes the wall of JSON we are trying to avoid.
MAX_EDITS = 8

# SAFETY_RAILS in the coach prompt forbids sub-1200-calorie advice, but a
# prompt cannot bind a stored edit the user applies with one tap later. The
# floor is re-enforced here, where it is actually load-bearing.
MIN_CALORIES = 1200
MAX_CALORIES = 4500

EDIT_STATUS_PENDING = "pending"
EDIT_STATUS_APPLIED = "applied"
EDIT_STATUS_DISMISSED = "dismissed"
EDIT_STATUS_STALE = "stale"

SET_STATUS_PENDING = "pending"
SET_STATUS_PARTIALLY_APPLIED = "partially_applied"
SET_STATUS_APPLIED = "applied"
SET_STATUS_DISMISSED = "dismissed"
SET_STATUS_SUPERSEDED = "superseded"


class ListSpec:
    """How one plan list is addressed by add/update/remove ops."""

    def __init__(self, field: str, normalizer, label_key: str, noun: str):
        self.field = field
        self.normalizer = normalizer
        self.label_key = label_key
        self.noun = noun

    def label(self, item: Dict[str, Any]) -> str:
        return str(item.get(self.label_key) or item.get("label") or item.get("name") or self.noun)


LIST_SPECS: Dict[str, ListSpec] = {
    "meal_anchor": ListSpec(
        "meal_anchors", NutritionPlanBuilder._normalize_anchors, "label", "meal"
    ),
    "flexible_meal": ListSpec(
        "flexible_meals", NutritionPlanBuilder._normalize_flexible, "name", "flexible meal"
    ),
    "go_to": ListSpec(
        "go_to_items", NutritionPlanBuilder._normalize_go_to_items, "name", "go-to item"
    ),
    "blueprint_extra": ListSpec(
        "blueprint_extras", NutritionPlanBuilder._normalize_blueprint_extras, "label", "extra"
    ),
}

SCALAR_OPS = {
    "update_targets": "targets",
    "update_strategy": "strategy",
    "update_preferences": "preferences",
    "update_food_priorities": "food_priorities",
    "update_typical_day_notes": "typical_day_notes",
}

VALID_OPS = set(SCALAR_OPS)
for _noun in LIST_SPECS:
    VALID_OPS.update({f"add_{_noun}", f"update_{_noun}", f"remove_{_noun}"})


def _new_edit_id() -> str:
    return uuid.uuid4().hex[:10]


def _split_op(op: str) -> Tuple[Optional[str], Optional[ListSpec]]:
    """('update_meal_anchor') -> ('update', <meal_anchor spec>)."""
    for action in ("add", "update", "remove"):
        prefix = f"{action}_"
        if op.startswith(prefix):
            spec = LIST_SPECS.get(op[len(prefix):])
            if spec:
                return action, spec
    return None, None


def _find(items: List[Dict], target_id: str) -> Optional[int]:
    for i, item in enumerate(items or []):
        if item.get("id") and str(item["id"]) == str(target_id):
            return i
    return None


def _num(value) -> Optional[float]:
    try:
        if value is None or isinstance(value, bool):
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _fmt_int(value) -> Optional[str]:
    n = _num(value)
    return f"{int(round(n)):,}" if n is not None else None


def _targets_title(payload: Dict[str, Any]) -> str:
    parts = []
    if payload.get("calories") is not None:
        parts.append(f"{_fmt_int(payload['calories'])} kcal")
    for key, unit in (("protein", "g protein"), ("carbs", "g carbs"),
                      ("fats", "g fat"), ("fiber", "g fiber")):
        if payload.get(key) is not None:
            parts.append(f"{_fmt_int(payload[key])}{unit}")
    return "Targets → " + " · ".join(parts) if parts else "Update targets"


def _foods_summary(item: Dict[str, Any]) -> Optional[str]:
    names = [str(f.get("name")).strip() for f in (item.get("foods") or [])
             if isinstance(f, dict) and f.get("name")]
    return " + ".join(names[:3]) if names else None


def _list_title(action: str, spec: ListSpec, item: Dict[str, Any]) -> str:
    label = spec.label(item)
    if action == "remove":
        return f"Remove {label}"
    if action == "update":
        return f"Update {label}"
    foods = _foods_summary(item)
    return f"Add {label}: {foods}" if foods else f"Add {label}"


def _trim_before(value: Any) -> Any:
    """A compact snapshot of what the edit replaces, for the diff row."""
    if isinstance(value, dict):
        return {k: v for k, v in value.items() if v not in (None, [], {}, "")}
    return value


def _reject(reason: str) -> Dict[str, Any]:
    return {"ok": False, "reason": reason}


def _validate_targets(payload: Dict[str, Any], plan: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(payload, dict):
        return _reject("targets must be an object")
    known = {"calories", "calories_min", "calories_max", "protein", "carbs", "fats", "fiber"}
    cleaned = {k: _num(v) for k, v in payload.items() if k in known and v is not None}
    if not cleaned:
        return _reject("no recognised target fields")

    calories = cleaned.get("calories")
    if calories is not None and calories < MIN_CALORIES:
        # Hard stop rather than a clamp: an edit the user taps to accept should
        # never quietly become a different number than the coach described.
        return _reject(f"calorie target below the {MIN_CALORIES} kcal floor")
    if calories is not None and calories > MAX_CALORIES:
        return _reject(f"calorie target above {MAX_CALORIES} kcal")

    merged = {**(plan.get("targets") or {}), **cleaned}
    return {"ok": True, "payload": cleaned, "before": _trim_before(plan.get("targets") or {}),
            "title": _targets_title(cleaned), "merged": merged}


def normalize_edits(plan: Dict[str, Any], raw_edits: Any) -> Tuple[List[Dict[str, Any]], List[str]]:
    """
    Turn raw model-proposed ops into reviewable edits against `plan`.

    Returns (edits, rejections). Unknown ops, ops pointing at items that are
    not in the plan, and anything failing a safety floor are dropped with a
    reason rather than stored — a suggestion the user cannot safely accept
    should never reach the plan page.
    """
    edits: List[Dict[str, Any]] = []
    rejected: List[str] = []

    for raw in (raw_edits if isinstance(raw_edits, list) else [])[: MAX_EDITS * 2]:
        if len(edits) >= MAX_EDITS:
            rejected.append("too many edits proposed; extras dropped")
            break
        if not isinstance(raw, dict):
            continue

        op = str(raw.get("op") or "").strip().lower()
        if op not in VALID_OPS:
            rejected.append(f"unknown op '{op}'")
            continue

        payload = raw.get("payload") if isinstance(raw.get("payload"), dict) else {}
        rationale = str(raw.get("rationale") or "").strip()[:240] or None
        target_id = str(raw.get("target_id") or "").strip() or None

        edit: Dict[str, Any] = {
            "id": _new_edit_id(),
            "op": op,
            "target_id": target_id,
            "rationale": rationale,
            "status": EDIT_STATUS_PENDING,
        }

        if op == "update_targets":
            result = _validate_targets(payload or raw.get("targets") or {}, plan)
            if not result["ok"]:
                rejected.append(f"update_targets: {result['reason']}")
                continue
            edit.update({"payload": result["payload"], "before": result["before"],
                         "title": result["title"], "field": "targets"})
            edits.append(edit)
            continue

        if op in SCALAR_OPS:
            field = SCALAR_OPS[op]
            value = raw.get("value")
            if value is None and payload:
                value = payload.get(field) if field in payload else payload
            if field == "food_priorities":
                if not isinstance(value, list):
                    rejected.append("food_priorities must be a list")
                    continue
                value = [str(v).strip()[:60] for v in value if str(v or "").strip()][:8]
                title = "Food priorities → " + ", ".join(value[:3]) if value else "Clear food priorities"
            elif field == "preferences":
                if not isinstance(value, dict):
                    rejected.append("preferences must be an object")
                    continue
                title = "Update preferences"
            else:
                if not isinstance(value, str) or not value.strip():
                    rejected.append(f"{op} needs text")
                    continue
                value = value.strip()[:800]
                title = "Update strategy" if field == "strategy" else "Update typical day notes"
            edit.update({"payload": {field: value}, "before": _trim_before(plan.get(field)),
                         "title": title, "field": field})
            edits.append(edit)
            continue

        action, spec = _split_op(op)
        if not spec:
            rejected.append(f"unknown op '{op}'")
            continue
        items = plan.get(spec.field) or []

        if action == "add":
            if not payload:
                rejected.append(f"{op}: nothing to add")
                continue
            candidate = spec.normalizer([payload])
            if not candidate:
                rejected.append(f"{op}: could not read the proposed {spec.noun}")
                continue
            item = candidate[0]
            edit.update({"payload": item, "before": None, "field": spec.field,
                         "title": _list_title("add", spec, item)})
            edits.append(edit)
            continue

        index = _find(items, target_id) if target_id else None
        if index is None:
            # The coach named something that is not in the plan. Adding it
            # instead would be a silent write of an unreviewed item.
            rejected.append(f"{op}: no {spec.noun} with id '{target_id}'")
            continue
        existing = items[index]

        if action == "remove":
            edit.update({"payload": {}, "before": _trim_before(existing), "field": spec.field,
                         "title": _list_title("remove", spec, existing)})
            edits.append(edit)
            continue

        if not payload:
            rejected.append(f"{op}: nothing to change")
            continue
        merged = spec.normalizer([{**existing, **payload, "id": existing.get("id")}])
        if not merged:
            rejected.append(f"{op}: could not read the proposed {spec.noun}")
            continue
        edit.update({"payload": merged[0], "before": _trim_before(existing), "field": spec.field,
                     "title": _list_title("update", spec, merged[0])})
        edits.append(edit)

    return edits, rejected


def apply_edits(
    plan: Dict[str, Any], edits: List[Dict[str, Any]]
) -> Tuple[Dict[str, Any], Dict[str, str]]:
    """
    Fold accepted edits into a patch for PATCH /nutrition-plan/{id}.

    Returns (patch, outcomes) where outcomes maps edit id -> "applied" or
    "stale". An edit is stale when the plan moved on underneath it: the item
    it targets was renamed away, or deleted by hand since the coach proposed
    the change. Stale edits are skipped, never resurrected.
    """
    patch: Dict[str, Any] = {}
    outcomes: Dict[str, str] = {}

    working: Dict[str, List[Dict]] = {}

    def rows(field: str) -> List[Dict]:
        if field not in working:
            working[field] = [dict(item) for item in (plan.get(field) or [])]
        return working[field]

    for edit in edits or []:
        edit_id = str(edit.get("id") or "")
        op = str(edit.get("op") or "")

        if op == "update_targets":
            merged = {**(plan.get("targets") or {}), **(edit.get("payload") or {})}
            calories = _num(merged.get("calories"))
            if calories is not None and calories < MIN_CALORIES:
                outcomes[edit_id] = EDIT_STATUS_STALE
                continue
            patch["targets"] = merged
            outcomes[edit_id] = EDIT_STATUS_APPLIED
            continue

        if op in SCALAR_OPS:
            payload = edit.get("payload") or {}
            field = SCALAR_OPS[op]
            if field not in payload:
                outcomes[edit_id] = EDIT_STATUS_STALE
                continue
            patch[field] = payload[field]
            outcomes[edit_id] = EDIT_STATUS_APPLIED
            continue

        action, spec = _split_op(op)
        if not spec:
            outcomes[edit_id] = EDIT_STATUS_STALE
            continue

        items = rows(spec.field)
        payload = edit.get("payload") or {}

        if action == "add":
            if not payload:
                outcomes[edit_id] = EDIT_STATUS_STALE
                continue
            if payload.get("id") and _find(items, payload["id"]) is not None:
                # Already applied once — accepting again would duplicate it.
                outcomes[edit_id] = EDIT_STATUS_STALE
                continue
            # Stamp so the plan page can label coach-added meals.
            items.append({**payload, "source": payload.get("source") or "ai_coach"})
            patch[spec.field] = items
            outcomes[edit_id] = EDIT_STATUS_APPLIED
            continue

        index = _find(items, edit.get("target_id") or "")
        if index is None:
            outcomes[edit_id] = EDIT_STATUS_STALE
            continue

        if action == "remove":
            items.pop(index)
        else:
            items[index] = {
                **items[index],
                **payload,
                "id": items[index].get("id"),
                "source": "ai_coach",
            }
        patch[spec.field] = items
        outcomes[edit_id] = EDIT_STATUS_APPLIED

    return patch, outcomes


def set_status_for(edits: List[Dict[str, Any]]) -> str:
    """Derive the suggestion set's status from its edits."""
    statuses = [str(e.get("status") or EDIT_STATUS_PENDING) for e in edits or []]
    if not statuses:
        return SET_STATUS_DISMISSED
    if any(s == EDIT_STATUS_PENDING for s in statuses):
        return (
            SET_STATUS_PARTIALLY_APPLIED
            if any(s == EDIT_STATUS_APPLIED for s in statuses)
            else SET_STATUS_PENDING
        )
    if any(s == EDIT_STATUS_APPLIED for s in statuses):
        return SET_STATUS_APPLIED
    return SET_STATUS_DISMISSED


def pending_count(suggestion_set: Optional[Dict[str, Any]]) -> int:
    if not suggestion_set:
        return 0
    return sum(
        1 for e in (suggestion_set.get("edits") or [])
        if str(e.get("status")) == EDIT_STATUS_PENDING
    )
