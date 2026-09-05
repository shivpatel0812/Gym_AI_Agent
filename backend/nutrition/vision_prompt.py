"""Versioned rule blocks for the meal-photo vision prompt.

Prompt wording is the single biggest lever on estimate accuracy and the easiest
thing to change on a hunch, so the variants live here as named, comparable
constants rather than inline in the call site. `scripts/replay_photo_estimates.py`
replays archived photos through two variants and scores both against what the
user actually logged.

Why v2 exists
-------------
v1's rules are individually correct and collectively biased low.

*Compounding.* "Never assume every dinner plate is the same size" and "do not
infer oil merely because food is homemade" both guard against real failures.
But on a five-compartment plate each component is estimated under the same
"be careful, don't assume" framing, and the errors are correlated — same
instruction, same model, same photo — so they add instead of cancelling. Five
components each shaded ~12% low lands ~30% under.

*Prohibitions without defaults.* Telling a model what not to assume, without
supplying what to assume instead, leaves it no anchor. Under uncertainty with
no anchor it regresses small. v2 replaces the prohibition with standard
servingware dimensions and pushes the uncertainty into the gram range, where it
belongs, instead of into a smaller central estimate.

*Dish fat vs. homemade stereotyping.* Not inferring ghee because food is Indian
and homemade is right. Not inferring the tadka in a kadhi is wrong — that fat
is a property of the recipe, not of whose kitchen it came from. v2 splits the
two and lets the cooking-style hint modulate the amount rather than zero it.

*Forced tidiness hides trouble.* v1 tells the model its calories "should match
the component calorie sum." A model that quietly reconciles the two removes the
disagreement that `assess_macro_coherence` reads as an escalation signal. v2
asks for both numbers honestly and for the difference to be explained.

Why v3 exists
-------------
v1 and v2 both tune how big the estimate is. Neither can catch a component
that was never estimated at all.

Khichdi photographed with a katori of dahi came back as khichdi. Every guard
downstream passed it, because every one of them tests for *inconsistency* and
an omission is perfectly consistent: the missing yogurt is absent from the
components, from the total, and from the macro arithmetic alike, so
`assess_macro_coherence` finds nothing to repair. Worse, `should_escalate`
routes on component COUNT, so dropping an item makes the plate look simpler and
makes the stronger second pass *less* likely -- the case that needed it most was
the one structurally guaranteed not to get it. The confidence score has the same
inversion, awarding points for a short component list.

v3 is v2 plus a step that runs BEFORE estimating: enumerate every edible thing
in the frame, then estimate. Anything enumerated and then left out has to be
named in `scene.excluded` with a reason. That turns a silent omission into
either a line the user can see or a mismatch `should_escalate` can route on.

It does not fix "the model never noticed the yogurt" -- nothing in a text
prompt can guarantee attention. It fixes "the model noticed and dropped it
silently", and it makes the enumeration itself the thing being asked for,
which is a materially easier task than remembering to count a side dish while
also estimating grams.

A protein-plausibility check was considered and rejected: plain khichdi really
is low in protein, so a rule firing on low protein-per-kcal would punish
correct estimates of the dish alone. The error only exists relative to what was
on the table, which is exactly what the inventory step is for.
"""

from typing import Dict

V1_RULES = """- Treat the title and description as strong identity and quantity hints, but flag conflicts with the image.
- Assess lighting, sharpness, whether the full meal is visible, and view angle before estimating.
- Look for portion cues already in frame. A known package is strong; a plate, bowl, utensil, or hand is only a weak-to-medium cue unless its size is known. Never assume every dinner plate is the same size.
- Estimate a best gram amount plus a realistic low/high gram range. A single image without scale should have a wider range.
- Do not infer oil merely because food is homemade. Glistening can be water, sauce, or glaze. Report visible oil evidence separately and use stated preparation, the user's cooking style, or a neutral typical-recipe assumption as the basis.
- Include hidden ingredients, sauces, drinks, and cooking fat only when stated, visible, or customary for the identified preparation. Put uncertain choices in assumptions or uncertainties.
- Break mixed meals into components. Component nutrition and the top-level macros describe the FULL quantity, not per 100g.
- Calories should be arithmetically compatible with protein, carbs, and fat, and should match the component calorie sum when components are supplied."""

V2_RULES = """- Treat the title and description as strong identity and quantity hints, but flag conflicts with the image.
- Assess lighting, sharpness, whether the full meal is visible, and view angle before estimating.
- Look for portion cues already in frame. A known package is strong; a plate, bowl, utensil, or hand is weak-to-medium unless its size is known.
- When no reliable scale reference is present, do NOT shrink the estimate to stay safe. Anchor on standard servingware — dinner plate ~26cm, side plate ~19cm, katori or small bowl ~150ml, soup or cereal bowl ~350ml, tablespoon ~15ml — and widen the low/high gram range instead. Uncertainty belongs in the range, never in a smaller central estimate.
- Estimate a best gram amount plus a realistic low/high gram range. A single image without scale should have a wider range.
- Infer cooking fat from the dish you identified, not from whether the food is homemade. Many preparations are defined by their fat: a tempered dal or kadhi carries its tadka, a sabzi is cooked in oil, a paratha is griddled. Include that fat by default for such dishes.
- A stated cooking style, "homemade", or "less oil" MODULATES that amount down; it never reduces it to zero. Glistening can be water, sauce, or glaze, so report visible oil evidence separately from the amount you assume.
- Include hidden ingredients, sauces, and drinks when stated, visible, or customary for the identified preparation. Put uncertain choices in assumptions or uncertainties.
- Break mixed meals into components. Component nutrition and the top-level macros describe the FULL quantity, not per 100g.
- Estimate each component independently, then stop and check the plate as a whole: is this a plausible total for a meal of this type and size? Independent per-item estimates on a multi-part plate tend to each land low, and those shortfalls add up. If the total reads low against the whole plate, raise it and note that in assumptions.
- Report the component figures you actually derived. Do not quietly adjust individual components to make them add up. If your plate-level total differs from the component sum, keep both honest and explain the gap in assumptions.
- Calories should be arithmetically compatible with protein, carbs, and fat."""

# v3 is v2 with the inventory step in front, and the title rule reworded so a
# single-dish name cannot cap the meal. Built by extension rather than rewritten
# so the delta against v2 stays reviewable and v2's compounding fix cannot be
# lost by accident.
_V3_INVENTORY = """- FIRST, before estimating anything, inventory the frame: list every distinct edible item you can see, including items in separate bowls, katoris, side plates, cups and glasses. A side of yogurt, raita, chutney, pickle or a drink is part of the meal and each is its own item. Do this as a list, then estimate.
- Every item in that inventory must end up either in `components` or in `scene.excluded` with a reason. Never drop one silently. If you are unsure what a side dish is, include it with your best guess and say so in uncertainties — an item counted approximately is far closer to the truth than an item left out.
- The user's title usually names the MAIN dish, not the whole meal. Take it as strong evidence of what the main dish is, and as no evidence at all about what else is on the table."""

# The title rule v3 replaces — restated in _V3_INVENTORY so the two cannot
# contradict each other in the same prompt.
_V2_TITLE_RULE = "- Treat the title and description as strong identity and quantity hints, but flag conflicts with the image.\n"

V3_RULES = _V3_INVENTORY + "\n" + V2_RULES.replace(_V2_TITLE_RULE, "", 1)

PROMPT_VARIANTS: Dict[str, str] = {"v1": V1_RULES, "v2": V2_RULES, "v3": V3_RULES}

DEFAULT_VARIANT = "v3"

# The JSON block each variant adds to the response shape. v1 and v2 add
# nothing: asking them for an inventory would make them into v3 and there would
# be nothing left to compare.
_V3_SCHEMA = """  "scene": {
    "items_seen": ["every distinct edible item visible, side bowls and drinks included"],
    "excluded": [{"item": "an item you chose not to count", "reason": "why"}]
  },
"""

SCHEMA_EXTRAS: Dict[str, str] = {"v1": "", "v2": "", "v3": _V3_SCHEMA}


def resolve_variant(name: str = None) -> str:
    """Map a requested variant name to one that exists."""
    key = str(name or "").strip().lower()
    return key if key in PROMPT_VARIANTS else DEFAULT_VARIANT


def rules_for(name: str = None) -> str:
    return PROMPT_VARIANTS[resolve_variant(name)]


def schema_extra_for(name: str = None) -> str:
    """Extra JSON fields this variant asks for, or "" when it asks for none."""
    return SCHEMA_EXTRAS.get(resolve_variant(name), "")
