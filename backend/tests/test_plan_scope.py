"""
The interview asks how much the split may change; the answer must be used.

Plan Mode asks "keep it, tweak it, or rebuild it" in almost every interview,
and one user answered "I want to keep the current structure" — then had ten
consecutive plans built in adapt mode, because plan_mode came from a modal
toggle that defaulted to adapt and the answer was never read.
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from ai_analysis.plan_builder import DEFAULT_PLAN_MODE, PLAN_MODES
from ai_analysis.plan_scope import infer_plan_scope, resolve_plan_mode


def convo(*turns):
    """Alternating user/assistant turns, starting with the user."""
    return [
        {"role": "user" if i % 2 == 0 else "assistant", "content": text}
        for i, text in enumerate(turns)
    ]


def test_keeping_the_structure_is_read_as_follow():
    messages = convo(
        "I want 85s for 6-8 clean reps. I can sustain 5 weekly sessions. "
        "I want to keep the current structure."
    )
    assert infer_plan_scope(messages) == "follow_split"


def test_asking_for_a_rebuild_is_read_as_build():
    assert infer_plan_scope(convo("honestly just rebuild it from scratch")) == "build_for_me"
    assert infer_plan_scope(convo("you decide, whatever is best")) == "build_for_me"


def test_asking_for_tweaks_is_read_as_adapt():
    assert infer_plan_scope(convo("you can tweak my split where it helps")) == "adapt_split"


def test_adjusting_a_draft_is_not_a_scope_decision():
    """
    The exact false positive: two turns after choosing "keep the structure",
    the user wrote "I want to adjust the draft plan" — a request to iterate on
    a proposal. Reading that as a scope change flipped them into adapt mode.
    """
    messages = convo(
        "I want to keep the current structure.",
        "Understood — I'll keep your split.",
        'I want to adjust the draft plan "Incline Power Push". '
        "Can you make sure the weighted dips are in the push day?",
    )
    assert infer_plan_scope(messages) == "follow_split"


def test_only_the_users_own_words_count():
    """The coach lists all three options in nearly every interview."""
    messages = [
        {"role": "assistant", "content":
            "May I rebuild the split, or do you want to keep its current "
            "structure and only tweak it?"},
    ]
    assert infer_plan_scope(messages) is None


def test_saying_nothing_infers_nothing():
    assert infer_plan_scope(convo("I want a bigger chest")) is None
    assert infer_plan_scope([]) is None


def test_a_later_change_of_mind_wins():
    messages = convo(
        "keep my current split",
        "Got it.",
        "actually, start from scratch",
    )
    assert infer_plan_scope(messages) == "build_for_me"


# --- resolution ------------------------------------------------------------


def test_an_explicit_selection_outranks_the_conversation():
    """Opening the selector and choosing is a direct instruction."""
    messages = convo("keep the current structure")
    resolved = resolve_plan_mode("build_for_me", messages, PLAN_MODES, DEFAULT_PLAN_MODE)

    assert resolved["mode"] == "build_for_me"
    assert resolved["source"] == "explicit"


def test_an_untouched_selector_defers_to_the_conversation():
    messages = convo("keep the current structure")
    resolved = resolve_plan_mode(None, messages, PLAN_MODES, DEFAULT_PLAN_MODE)

    assert resolved["mode"] == "follow_split"
    assert resolved["source"] == "conversation"


def test_silence_falls_back_to_the_default():
    resolved = resolve_plan_mode(None, convo("I want a bigger chest"),
                                 PLAN_MODES, DEFAULT_PLAN_MODE)

    assert resolved["mode"] == DEFAULT_PLAN_MODE
    assert resolved["source"] == "default"


def test_an_unknown_requested_mode_does_not_leak_through():
    resolved = resolve_plan_mode("nonsense", convo("keep my split"),
                                 PLAN_MODES, DEFAULT_PLAN_MODE)
    assert resolved["mode"] in PLAN_MODES
