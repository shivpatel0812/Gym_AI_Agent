"""
How much the user said their split may change, read from the interview.

Plan Mode asks this outright — "keep it, tweak it, or rebuild it" is point 5 of
the interview prompt — and users answer it plainly: "I want to keep the current
structure." That answer then went nowhere. `plan_mode` came from a toggle in
the Create Plan modal which defaults to `adapt_split`, so every plan one user
generated was built as *adapt* while they had explicitly asked for *follow*,
and kept being surprised that exercises moved.

This reads the answer back out of the conversation. Deliberately deterministic
rather than a second model call: the phrases are a small closed set, an LLM
would add latency and a new failure mode to a decision that is already stated
in plain words, and a wrong guess here silently rewrites someone's training.

Ambiguity resolves to None, and the caller keeps its own default. Saying
nothing is not the same as asking for a rebuild.
"""

import re
from typing import Dict, List, Optional

FOLLOW = "follow_split"
ADAPT = "adapt_split"
BUILD = "build_for_me"

# Ordered by how strongly each phrase commits. Matched against user turns only —
# the coach describing the options must never count as the user choosing one.
SCOPE_PATTERNS = (
    (FOLLOW, (
        r"\bkeep (?:the|my) (?:current )?(?:structure|split|routine|program|plan)\b",
        r"\bkeep it (?:the same|as is|as it is)\b",
        r"\b(?:don'?t|do not) (?:change|touch|alter|rebuild|redo) (?:my|the) (?:split|structure|routine|program)\b",
        r"\bsame (?:split|structure|routine)\b",
        r"\bfollow (?:my|the) (?:current )?(?:split|structure|routine)\b",
        r"\bstick (?:to|with) (?:my|the) (?:current )?(?:split|structure|routine)\b",
        r"\bleave (?:my|the) split alone\b",
    )),
    (BUILD, (
        r"\b(?:rebuild|redo|redesign|start over|start from scratch)\b",
        r"\bbuild (?:it |me )?(?:one )?from scratch\b",
        r"\bwhatever (?:you|is) best\b",
        r"\byou (?:decide|choose|pick)\b",
        r"\bcompletely new (?:split|program|plan|routine)\b",
    )),
    (ADAPT, (
        # Only the split itself counts. "Adjust the draft plan" is a request to
        # iterate on a proposal, not a statement about how much the routine may
        # change — matching it read one user as choosing adapt when they had
        # said "keep the current structure" two turns earlier.
        r"\b(?:tweak|adapt|clean up|reorganis|reorganiz|tidy)\w*\b.{0,24}\b(?:split|structure|routine)\b",
        r"\b(?:tweak|adapt) (?:it|them)\b",
        r"\bmostly keep\b",
        r"\bkeep .{0,20}but (?:change|swap|add|remove)\b",
    )),
)

# A choice made later in the conversation supersedes one made earlier.
def infer_plan_scope(conversation: List[Dict]) -> Optional[str]:
    """
    The mode the user asked for, or None when they never said.

    Only the user's own turns are read. The coach lists the three options in
    almost every plan interview, so scanning assistant text would match on the
    question rather than the answer.
    """
    decided: Optional[str] = None
    for message in conversation or []:
        if str(message.get("role") or "").lower() != "user":
            continue
        text = str(message.get("content") or "").lower()
        if not text:
            continue
        for mode, patterns in SCOPE_PATTERNS:
            if any(re.search(pattern, text) for pattern in patterns):
                decided = mode
                break
    return decided


def resolve_plan_mode(
    requested: Optional[str],
    conversation: List[Dict],
    valid_modes,
    default: str,
) -> Dict[str, Optional[str]]:
    """
    Settle on a plan mode and record where it came from.

    An explicit request wins: if the user opened the mode selector and chose,
    that is a direct instruction and outranks anything inferred from prose. The
    client sends None when the selector was never touched, which is when what
    they told the coach should decide.
    """
    if requested and requested in valid_modes:
        return {"mode": requested, "source": "explicit"}

    inferred = infer_plan_scope(conversation)
    if inferred and inferred in valid_modes:
        return {"mode": inferred, "source": "conversation"}

    return {"mode": default, "source": "default"}
