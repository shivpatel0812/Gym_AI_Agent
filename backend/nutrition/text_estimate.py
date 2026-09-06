"""Confidence, hint reconciliation and routing for a *typed* food description.

The photo path has had two passes, a component ledger, a confidence score and
an escalation rule since Sep 2026. The typed path — "3 frankie wraps, I think
that was about 600 calories" — had a single `gpt-4o-mini` call, no ledger, no
confidence, no second opinion, and no way to notice that its answer contradicted
the user's own. This module is the text-side counterpart of `photo_estimate.py`.

It deliberately returns the *same shape* as `build_photo_analysis`, so the scan
results card renders a described meal exactly as it renders a photographed one.
What differs is what gets scored. A photo is graded on whether the food can be
*seen*; a sentence is graded on whether the amount was *stated*. "some rice" and
"180 g of rice" are equally legible strings and nothing like equally estimable,
and no confidence score built on image quality can tell them apart.

The user's own calorie guess
----------------------------
A typed description often carries a number the photo path never has: what the
user thought the meal was. That number is evidence — they saw the food and ate
it — but it is *weak* evidence, because self-reported intake runs low by 20-40%
and correcting exactly that bias is the reason this feature exists. So:

  * it is never used as ground truth, and never clamped to;
  * it is never used as a FLOOR to stack components on top of, which is the bug
    this module was written for (see `parse_calorie_hint`);
  * a large disagreement buys a second, stronger pass, and if the disagreement
    survives that pass it is shown to the user instead of being silently
    resolved in the model's favour.

Showing it is the point. A user who typed "felt like 600" and got 1100 with no
explanation has no way to tell a corrected underestimate from a bug, and both
happen.
"""

import re
from typing import Any, Dict, List, Optional

from .photo_estimate import (
    _choice,
    _number,
    _short_text,
    _text_list,
    normalize_components,
)


# ---------------------------------------------------------------------------
# The user's stated calorie figure
# ---------------------------------------------------------------------------

# "600 cal", "~600 calories", "600kcal", "600 cals", "600 kCal"
_CALORIE_RE = re.compile(
    r"(?:~|about|around|approx\.?|approximately|roughly|maybe|like)?\s*"
    r"(\d{2,5})\s*(?:k?cals?\b|kcal\b|calories\b|calorie\b)",
    re.IGNORECASE,
)

# Markers that a figure is PER UNIT rather than for the meal. "the tortilla was
# 150 cal each" prices one component; the rest of the meal is added on top.
_PART_MARKERS = (
    "each", "apiece", "a piece", "per ", "every ", "one of", "each one",
)

# Markers that a figure covers the whole thing. Anything that survives to here
# without a part marker is treated as whole-meal too — see `parse_calorie_hint`.
_WHOLE_MARKERS = (
    "in total", "total", "altogether", "all together", "the whole thing",
    "overall", "the meal", "all of it", "combined", "the lot",
)

# How far a model may drift from a whole-meal figure the user supplied before
# the disagreement is worth a stronger pass and a line on the results card.
# 25%: a 600 kcal guess answered with 750 is ordinary self-report bias and not
# worth interrupting anyone over; answered with 1100 it is a different meal.
HINT_DISAGREEMENT_RATIO = 0.25


def parse_calorie_hint(query: str) -> Optional[Dict[str, Any]]:
    """Pull the user's own calorie figure, and whether it prices a part or the meal.

    Extracted deterministically rather than asked for, because the failure this
    guards against is the model *mis-scoping* the number, and a model that has
    already mis-scoped it will report the mis-scoped reading back.

    Scope defaults to ``whole``. The old prompt had exactly one rule about user
    calorie figures and it described a PART hint ("the tortilla was 150 cal
    each ... add filling, cooking oil, and extras on top"). With no rule for the
    other case, "I think the whole thing was about 600" read as a floor and the
    model dutifully stacked the filling and the oil on top of it — which is how
    a 600 kcal guess comes back as 1100. Unmarked figures are far more often
    about the meal than about one of its parts, so the default belongs there.
    """
    text = " ".join(str(query or "").split())
    if not text:
        return None
    match = _CALORIE_RE.search(text)
    if not match:
        return None

    value = _number(match.group(1))
    if value <= 0:
        return None

    # Look at the clause the figure sits in, not the whole sentence: "3 wraps,
    # each tortilla was 150 cal" must not be read as whole-meal because the
    # word "total" appears somewhere else.
    tail = text[match.end() : match.end() + 40].lower()
    lead_start = max(0, match.start() - 60)
    lead = text[lead_start : match.start()].lower()
    clause = lead.split(",")[-1] + " " + tail.split(",")[0]

    scope = "whole"
    if any(marker in clause for marker in _PART_MARKERS):
        scope = "part"
    elif any(marker in clause for marker in _WHOLE_MARKERS):
        scope = "whole"

    return {
        "stated_calories": int(round(value)),
        "scope": scope,
        "text": _short_text(match.group(0), 60),
        # The span the number occupies, so quantity detection can ignore it —
        # "600 calories" must not count as "they told us how much they ate".
        "span": [match.start(), match.end()],
    }


def check_hint(hint: Optional[Dict[str, Any]], calories: int) -> Optional[Dict[str, Any]]:
    """Compare a whole-meal figure the user gave against what the model returned.

    Returns None when there is nothing to compare — no figure, or a figure that
    prices one component, which the model is supposed to build on top of and
    which therefore *should* come out higher.

    This never changes the estimate. It records the disagreement so the caller
    can pay for a better answer, and so the card can say "you said 600, this
    comes to 1100 because ..." rather than presenting 1100 as if the user had
    never offered an opinion.
    """
    if not hint or hint.get("scope") != "whole":
        return None
    stated = _number(hint.get("stated_calories"))
    if stated <= 0 or calories <= 0:
        return None

    ratio = (calories - stated) / stated
    return {
        "stated_calories": int(round(stated)),
        "estimated_calories": int(calories),
        "difference_ratio": round(ratio, 3),
        "direction": "higher" if ratio > 0 else "lower" if ratio < 0 else "same",
        "disagrees": abs(ratio) >= HINT_DISAGREEMENT_RATIO,
    }


# ---------------------------------------------------------------------------
# How estimable the description is
# ---------------------------------------------------------------------------

# Words that turn "food" into "an amount of food". Any one of these, or a bare
# digit outside the calorie figure, counts as the user having said how much.
_QUANTITY_WORDS = (
    "half", "quarter", "one", "two", "three", "four", "five", "six", "seven",
    "eight", "nine", "ten", "a dozen", "couple", "single", "double",
)
_MEASURE_WORDS = (
    "g", "gram", "grams", "kg", "oz", "ounce", "ounces", "lb", "ml", "l",
    "cup", "cups", "bowl", "bowls", "plate", "plates", "katori", "tbsp",
    "tsp", "tablespoon", "teaspoon", "slice", "slices", "piece", "pieces",
    "scoop", "scoops", "handful", "serving", "servings", "can", "bottle",
    "packet", "pack", "box", "container", "roti", "rotis",
)
# Preparation changes calories more than almost anything else a sentence can
# say, because it is where the cooking fat lives.
_PREPARATION_WORDS = (
    "fried", "deep fried", "deep-fried", "grilled", "baked", "boiled",
    "steamed", "roasted", "sauteed", "sautéed", "air fried", "air-fried",
    "raw", "poached", "stir fried", "stir-fried", "tossed", "toasted",
    "with oil", "with butter", "with ghee", "no oil", "dry",
)

MIN_KCAL_PER_GRAM = 0.15
MAX_KCAL_PER_GRAM = 8.0


def describe_evidence(query: str, hint: Optional[Dict[str, Any]]) -> Dict[str, bool]:
    """What the sentence actually pins down, before any model is consulted."""
    text = " ".join(str(query or "").split())
    # Blank out the calorie figure so its digits cannot masquerade as a portion.
    if hint and isinstance(hint.get("span"), list) and len(hint["span"]) == 2:
        start, end = hint["span"]
        text = text[:start] + " " * (end - start) + text[end:]
    lowered = text.lower()
    words = set(re.findall(r"[a-z]+", lowered))

    has_digit = bool(re.search(r"\d", lowered))
    has_quantity = (
        has_digit
        or any(word in lowered for word in _QUANTITY_WORDS)
    )
    has_measure = bool(words & set(_MEASURE_WORDS))
    return {
        "quantified": bool(has_quantity or has_measure),
        "has_measure": has_measure,
        "has_preparation": any(word in lowered for word in _PREPARATION_WORDS),
        # A brand or restaurant is the single most determinate thing a typed
        # description can contain: packaged food has a published label.
        "has_proper_noun": bool(re.search(r"\b[A-Z][a-z]{2,}", text[1:])),
        "detailed": len(lowered.split()) >= 6,
    }


def build_text_analysis(
    parsed: Dict[str, Any],
    *,
    query: str,
    hint: Optional[Dict[str, Any]] = None,
    hint_check: Optional[Dict[str, Any]] = None,
    has_saved_prior: bool = False,
) -> Dict[str, Any]:
    """Sanitized observations plus a server-calculated confidence score.

    Same contract as `build_photo_analysis`: the model reports, this decides how
    much to trust it, so a model cannot make an estimate look reliable by
    claiming it is.
    """
    evidence = describe_evidence(query, hint)
    components = normalize_components(parsed.get("components"))
    identity_confidence = _choice(
        parsed.get("identity_confidence"), ("low", "medium", "high"), "low"
    )

    grams = _number(parsed.get("grams"), maximum=5000)
    portion_raw = parsed.get("portion") if isinstance(parsed.get("portion"), dict) else {}
    estimated = _number(portion_raw.get("estimated_grams"), grams, maximum=5000)
    low = _number(portion_raw.get("low_grams"), estimated * 0.8, 5000) if estimated else 0.0
    high = _number(portion_raw.get("high_grams"), estimated * 1.25, 5000) if estimated else 0.0
    low = min(low or estimated * 0.8, estimated) if estimated else 0.0
    high = max(high or estimated * 1.25, estimated) if estimated else 0.0
    portion = {
        "estimated_grams": round(estimated, 1),
        "low_grams": round(low, 1),
        "high_grams": round(high, 1),
    }

    score = 0
    reasons: List[str] = []

    if evidence["quantified"]:
        score += 25
    else:
        reasons.append("You didn't say how much, so the portion is a guess")

    if evidence["has_measure"]:
        score += 10
    if evidence["has_preparation"]:
        score += 10
    else:
        reasons.append("Cooking method wasn't stated, so the oil is assumed")
    if evidence["has_proper_noun"]:
        score += 10
    if evidence["detailed"]:
        score += 5
    else:
        reasons.append("A short description leaves a lot open")

    if identity_confidence == "high":
        score += 15
    elif identity_confidence == "medium":
        score += 8
    else:
        reasons.append("The exact food is uncertain from this wording")

    if estimated > 0:
        spread = (portion["high_grams"] - portion["low_grams"]) / estimated
        if spread <= 0.35:
            score += 15
        elif spread <= 0.75:
            score += 8
            reasons.append("The amount has a moderate range")
        else:
            reasons.append("The amount could be anywhere in a wide range")
    else:
        spread = 999.0
        reasons.append("The amount could not be pinned down")

    if len(components) > 3:
        reasons.append("Several parts to add up, and the errors compound")

    if has_saved_prior:
        score += 10

    if hint_check and hint_check.get("disagrees"):
        reasons.append(
            "This is "
            f"{abs(int(round(hint_check['difference_ratio'] * 100)))}% "
            f"{hint_check['direction']} than the {hint_check['stated_calories']} kcal you guessed"
        )

    # An unquantified description can never be a high-confidence estimate, no
    # matter how confidently the model names the dish. Knowing it is biryani
    # does not tell you whether it was a cup or a platter, and the portion is
    # where the calories are.
    if not evidence["quantified"]:
        score = min(score, 49)
    if identity_confidence == "low" or estimated <= 0:
        score = min(score, 49)

    score = max(0, min(int(round(score)), 100))
    level = "high" if score >= 75 else "medium" if score >= 50 else "low"
    if not reasons:
        reasons.append("You gave an amount and a preparation, which is most of it")

    return {
        "source": "text",
        "confidence": {
            "score": score,
            "level": level,
            "reasons": reasons[:5],
            "should_nudge": level == "low" or spread > 0.75,
        },
        "identity_confidence": identity_confidence,
        "portion": portion,
        "components": components,
        "cooking": {
            "style": "normal",
            "oil_grams": 0.0,
            "basis": "description" if evidence["has_preparation"] else "typical_recipe",
            "visible_evidence": "unknown",
        },
        # No frame to inventory, so nothing can be seen-and-not-counted. The key
        # is present so the client renders one shape for both paths.
        "scene": {"items_seen": [], "excluded": [], "uncounted": []},
        "assumptions": _text_list(parsed.get("assumptions")),
        "uncertainties": _text_list(parsed.get("uncertainties")),
        "matched_saved_food": bool(has_saved_prior),
        "hint_check": hint_check,
        "evidence": evidence,
    }


# ---------------------------------------------------------------------------
# Routing
# ---------------------------------------------------------------------------

# Inherited from the photo path, where it was measured; NOT independently
# calibrated on typed descriptions, because the typed archive has no accepted
# labels to replay yet (`photo_log_store` only covers the photo path). The
# mechanism it targets is the same one: on a multi-component meal the cheap
# model shades each part independently and the errors add.
COMPLEX_MEAL_COMPONENTS = 3
INCOHERENCE_GAP_RATIO = 0.08
MIN_PROTEIN_GAP_GRAMS = 5.0
WIDE_SPREAD_RATIO = 0.9


def should_escalate_text(
    analysis: Dict[str, Any],
    coherence: Optional[Dict[str, Any]] = None,
    hint_check: Optional[Dict[str, Any]] = None,
    *,
    calories: int = 0,
) -> Dict[str, Any]:
    """Whether a cheap first pass on a typed description earned a stronger one.

    Like `should_escalate`, this targets *the model being wrong*, not *the
    description being vague*. A one-word entry scores low confidence and is the
    case a stronger model helps with least — there is nothing more to extract
    from "rice". Routing on the confidence score would spend the budget there
    and skip the detailed multi-component descriptions where it pays.
    """
    triggers: List[str] = []

    if hint_check and hint_check.get("disagrees"):
        # The highest-value trigger on this path. The user is the only witness
        # to the meal, and a big gap is either their underestimate (worth
        # confirming before contradicting them) or the model stacking a
        # whole-meal figure it should have reconciled against.
        triggers.append(
            f"you guessed {hint_check['stated_calories']} kcal, "
            f"the first pass said {hint_check['estimated_calories']}"
        )

    components = analysis.get("components") or []
    if len(components) >= COMPLEX_MEAL_COMPONENTS:
        triggers.append(f"{len(components)} components to add up")

    if coherence and coherence.get("repaired"):
        gap = float(coherence.get("gap_ratio") or 0.0)
        if gap >= INCOHERENCE_GAP_RATIO:
            triggers.append(f"stated calories missed its own parts by {round(gap * 100)}%")
        protein_gap = float(coherence.get("protein_gap_ratio") or 0.0)
        protein_grams = abs(
            float(coherence.get("protein") or 0.0)
            - float(coherence.get("reported_protein") or 0.0)
        )
        if protein_gap >= INCOHERENCE_GAP_RATIO and protein_grams >= MIN_PROTEIN_GAP_GRAMS:
            triggers.append(f"stated protein missed its own parts by {round(protein_gap * 100)}%")

    portion = analysis.get("portion") or {}
    estimated = float(portion.get("estimated_grams") or 0)
    if estimated > 0:
        spread = (
            float(portion.get("high_grams") or 0) - float(portion.get("low_grams") or 0)
        ) / estimated
        if spread >= WIDE_SPREAD_RATIO:
            triggers.append("the amount range is too wide to log")

        # Calorie density is a cheap, model-independent absurdity check that
        # the photo path gets from the image itself. 900 kcal in 80 g of dal is
        # not a portion disagreement, it is arithmetic that went wrong.
        if calories > 0:
            density = calories / estimated
            if density > MAX_KCAL_PER_GRAM or density < MIN_KCAL_PER_GRAM:
                triggers.append(
                    f"{round(density, 1)} kcal per gram is outside anything edible"
                )

    return {"escalate": bool(triggers), "triggers": triggers[:4]}
