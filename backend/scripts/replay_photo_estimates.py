"""
Score a prompt or model change against real meal photos the user already logged.

Every food photo is archived in `users/{uid}/food_photo_logs` with the image,
the model's estimate, the Fix Results chat, and — for anything logged since the
accepted-estimate endpoint shipped — the macros the user actually committed.
That last field is a ground-truth label, which makes the archive an eval set
that accumulated for free.

Without this, prompt tuning is taste: every edit risks silently re-breaking what
the previous edit fixed, and you find out weeks later. With it, "v2 estimates
run 4% low instead of 26% low across 30 photos" is a fact.

    python scripts/replay_photo_estimates.py you@example.com --dry-run
    python scripts/replay_photo_estimates.py you@example.com --limit 20
    python scripts/replay_photo_estimates.py you@example.com --variants v1,v2 --model gpt-4o

Read-only against Firestore. It DOES spend OpenAI credit: one vision call per
photo per variant (more if escalation is on). --dry-run shows the plan and the
labels without calling anything.
"""

import argparse
import base64
import os
import statistics
import sys
import tempfile
from typing import Any, Dict, List, Optional

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from db import db  # noqa: E402
from firebase_admin import auth  # noqa: E402

from nutrition.analyzer import analyze_food_image  # noqa: E402
from nutrition.vision_prompt import PROMPT_VARIANTS  # noqa: E402


# What counts as the truth for a photo, best first. `initial_estimate` is what
# the model guessed and `revised_estimate` is what it guessed after being
# argued with — neither is evidence the user agreed, so both are weak labels
# and are reported as such rather than being silently mixed with real ones.
LABEL_SOURCES = (
    ("accepted_estimate", "accepted", True),
    ("revised_estimate", "revised", False),
    ("initial_estimate", "initial", False),
)


def _label_for(log: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    for field, name, strong in LABEL_SOURCES:
        candidate = log.get(field)
        if isinstance(candidate, dict):
            try:
                calories = float(candidate.get("calories") or 0)
            except (TypeError, ValueError):
                continue
            if calories > 0:
                return {"calories": calories, "source": name, "strong": strong}
    return None


def load_cases(uid: str, limit: int, strong_only: bool) -> List[Dict[str, Any]]:
    """Archived photos that have both an image and something to score against."""
    cases = []
    for doc in db.collection("users").document(uid).collection("food_photo_logs").stream():
        log = doc.to_dict() or {}
        if not log.get("has_image") or not log.get("image_base64"):
            continue
        label = _label_for(log)
        if not label or (strong_only and not label["strong"]):
            continue
        cases.append(
            {
                "id": doc.id,
                "created_at": log.get("created_at") or "",
                "title": log.get("title") or (log.get("initial_estimate") or {}).get("name") or "?",
                "description": log.get("description"),
                "cooking_style": log.get("cooking_style"),
                "image_base64": log["image_base64"],
                "label": label,
            }
        )
    cases.sort(key=lambda c: c["created_at"], reverse=True)
    return cases[:limit]


def run_variant(case: Dict[str, Any], variant: str, model: str, escalate: bool) -> Optional[float]:
    """Replay one photo through one prompt variant. Returns estimated calories."""
    handle, path = tempfile.mkstemp(suffix=".jpg")
    try:
        with os.fdopen(handle, "wb") as out:
            out.write(base64.b64decode(case["image_base64"]))
        result = analyze_food_image(
            path,
            case["description"],
            model=model,
            title=case["title"],
            cooking_style=case["cooking_style"],
            allow_escalation=escalate,
            prompt_variant=variant,
        )
        food = (result or {}).get("food")
        return float(food["calories"]) if food else None
    except Exception as exc:
        print(f"    ! {variant} failed: {exc}")
        return None
    finally:
        if os.path.exists(path):
            os.unlink(path)


def summarize(name: str, errors: List[float]) -> None:
    if not errors:
        print(f"  {name:<6} no scored photos")
        return
    signed = statistics.mean(errors)
    absolute = statistics.median(abs(e) for e in errors)
    within = sum(1 for e in errors if abs(e) <= 15) / len(errors) * 100
    # Mean SIGNED error is the number that matters here: a systematic low bias
    # is the thing being fixed, and it hides inside an absolute-error average.
    print(
        f"  {name:<6} n={len(errors):<3} "
        f"mean signed {signed:+.1f}%   median abs {absolute:.1f}%   within 15%: {within:.0f}%"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("email")
    parser.add_argument("--limit", type=int, default=15, help="photos to replay (default 15)")
    parser.add_argument("--variants", default="v1,v2", help="comma-separated prompt variants")
    parser.add_argument("--model", default="gpt-4o", help="first-pass model")
    parser.add_argument(
        "--escalate",
        action="store_true",
        help="allow the router's second pass (off by default so this measures the PROMPT)",
    )
    parser.add_argument(
        "--strong-labels-only",
        action="store_true",
        help="score only photos the user explicitly committed macros for",
    )
    parser.add_argument("--dry-run", action="store_true", help="show the plan, call nothing")
    args = parser.parse_args()

    variants = [v.strip() for v in args.variants.split(",") if v.strip()]
    unknown = [v for v in variants if v not in PROMPT_VARIANTS]
    if unknown:
        parser.error(f"unknown variant(s): {', '.join(unknown)}. Known: {', '.join(PROMPT_VARIANTS)}")

    uid = auth.get_user_by_email(args.email).uid
    cases = load_cases(uid, args.limit, args.strong_labels_only)
    if not cases:
        print("No archived photos with a usable label yet.")
        print("Log a few meals from a photo and tap through to Add — that writes the label.")
        return

    weak = sum(1 for c in cases if not c["label"]["strong"])
    print(f"{len(cases)} photo(s) for {args.email}   variants: {', '.join(variants)}   model: {args.model}")
    if weak:
        print(
            f"  note: {weak} use a weak label (the model's own estimate, not a committed one) "
            "— pass --strong-labels-only to exclude them"
        )
    print(f"  {len(cases) * len(variants)} vision call(s){'' if args.escalate else ', escalation off'}\n")

    if args.dry_run:
        for case in cases:
            label = case["label"]
            print(f"  {case['created_at'][:10]}  {case['title'][:40]:<40} "
                  f"{label['calories']:>6.0f} kcal ({label['source']})")
        return

    errors: Dict[str, List[float]] = {v: [] for v in variants}
    for case in cases:
        truth = case["label"]["calories"]
        print(f"  {case['title'][:44]:<44} truth {truth:>5.0f} ({case['label']['source']})")
        for variant in variants:
            estimated = run_variant(case, variant, args.model, args.escalate)
            if estimated is None:
                continue
            error = (estimated - truth) / truth * 100
            errors[variant].append(error)
            print(f"    {variant:<4} {estimated:>5.0f} kcal   {error:+6.1f}%")

    print("\nSummary")
    for variant in variants:
        summarize(variant, errors[variant])


if __name__ == "__main__":
    main()
