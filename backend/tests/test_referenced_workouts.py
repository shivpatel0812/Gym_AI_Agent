"""
Which logged sessions a plan request is actually pointing at.

"Use my previous ones" is the most common way a plan gets built, and it was
the path most likely to be missed: resolution read only the user's own turns,
while the coach is the one holding the log and therefore the one who names
dates. A real interview settled on four logged sessions without the user ever
typing one, so nothing was imported and days came back with fewer exercises
than the sessions they were supposedly copied from.
"""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest

from routers.training_plan import (
    _adopts_proposal,
    _referenced_workout_dates,
    _resolve_target_day,
)


def user(text):
    return {"role": "user", "content": text}


def coach(text):
    return {"role": "assistant", "content": text}


class TestAdoptionSignal:
    @pytest.mark.parametrize(
        "text",
        [
            "yah use these logged templates and make the plan for me please",
            "use those",
            "use my september 4 session",
            "go ahead",
            "do it",
            "make the plan",
            "let's do it",
        ],
    )
    def test_explicit_use_intent_counts_at_any_length(self, text):
        assert _adopts_proposal(text) is True

    @pytest.mark.parametrize("text", ["yes", "yah", "yeah", "sure", "ok", "perfect", "sounds good"])
    def test_a_bare_agreement_counts(self, text):
        assert _adopts_proposal(text) is True

    def test_a_long_turn_that_merely_starts_with_ok_does_not(self):
        """
        "ok that makes sense, what should I focus on?" is the conversation
        continuing, not the user adopting a template. Treating it as agreement
        imported a session the coach had only mentioned in passing.
        """
        assert _adopts_proposal("ok that makes sense, what should I focus on?") is False

    @pytest.mark.parametrize(
        "text",
        [
            "why am I not progressing?",
            "add rear flies after the dumbbell rows",
            "is my push day fully built?",
        ],
    )
    def test_ordinary_turns_are_not_agreement(self, text):
        assert _adopts_proposal(text) is False


class TestResolvingReferencedWorkouts:
    def test_a_date_the_user_types_is_always_taken(self):
        assert _referenced_workout_dates(
            [user("build my push day from my 2026-09-04 session")]
        ) == ["2026-09-04"]

    def test_a_date_the_coach_proposes_and_the_user_accepts_is_taken(self):
        """The coach holds the log, so the coach is usually who names it."""
        assert _referenced_workout_dates([
            user("build me a push day"),
            coach("Use your September 4, 2026 push session as the template?"),
            user("yah use those"),
        ]) == ["2026-09-04"]

    def test_a_passing_mention_is_not_a_proposal(self):
        assert _referenced_workout_dates([
            user("why am I not progressing?"),
            coach("You haven't trained since August 30, 2026."),
            user("ok that makes sense, what should I focus on?"),
        ]) == []

    def test_a_rejection_clears_the_table(self):
        assert _referenced_workout_dates([
            user("build me a push day"),
            coach("Use your September 4, 2026 push session?"),
            user("no, build something new"),
        ]) == []

    def test_adoption_takes_everything_still_on_the_table(self):
        """
        The regression this file exists for. An interview converges across many
        turns: a template proposed early, refined over the next few turns, and
        adopted at the end. Crediting only the turn before the agreement picked
        up the last two sessions and dropped the one the conversation had spent
        the most turns on.
        """
        dates = _referenced_workout_dates([
            user("I want 2 pull 2 push and 1 leg day"),
            coach("Your August 17, 2026 pull session had lat pulldowns and rows."),
            user("can you add a hammer curl as well"),
            coach("Sure. Push would come from September 4, 2026 and legs from September 3, 2026."),
            user("yah use these logged templates and make the plan for me please"),
        ])
        assert set(dates) == {"2026-08-17", "2026-09-04", "2026-09-03"}

    def test_a_later_rejection_does_not_undo_an_earlier_adoption(self):
        """Adopted sessions are banked; the table only holds what is pending."""
        dates = _referenced_workout_dates([
            coach("Use your September 4, 2026 push session?"),
            user("yes"),
            coach("And August 30, 2026 for pull?"),
            user("no, not that one"),
        ])
        assert dates == ["2026-09-04"]

    def test_order_of_first_mention_is_preserved(self):
        dates = _referenced_workout_dates([
            coach("August 17, 2026 for pull, then September 4, 2026 for push."),
            user("use those"),
        ])
        assert dates == ["2026-08-17", "2026-09-04"]

    def test_a_date_is_never_repeated(self):
        dates = _referenced_workout_dates([
            user("use my 2026-09-04 session"),
            coach("Confirming September 4, 2026."),
            user("yes"),
        ])
        assert dates == ["2026-09-04"]

    def test_a_conversation_with_no_dates_resolves_to_nothing(self):
        assert _referenced_workout_dates([
            user("build me a push pull legs split"),
            coach("Happy to. What days can you train?"),
            user("monday through friday"),
        ]) == []

    def test_malformed_turns_do_not_crash(self):
        assert _referenced_workout_dates(
            [None, {"role": "user"}, {"content": "orphan"}, user("")]
        ) == []


class TestTargetDayResolution:
    """
    Which plan day a logged session gets copied onto.

    Targeting used to search the transcript for the *ISO* date while chats
    write "August 17, 2026", so the lookup missed every time and the
    no-match branch scanned the entire conversation, returning the first day
    name mentioned anywhere in it. Every referenced session resolved to the
    same day: a real import put a push session, a legs session and two pull
    sessions all onto "Pull A", leaving a pull day holding hack squats.

    This only surfaced once date resolution was fixed. Before that no session
    ever resolved, so the broken targeting was never reached.
    """

    DAYS = ["Pull A", "Push A", "Legs", "Pull B", "Push B"]

    def test_the_session_decides_what_kind_of_day_it_is(self):
        """A legs session is a legs session whatever the chat says around it."""
        assert _resolve_target_day(
            {"split_day": "Legs"},
            "and use your August 17 pull session for Pull A",
            self.DAYS,
            set(),
        ) == "Legs"

    def test_case_and_spacing_in_the_logged_label_are_tolerated(self):
        assert _resolve_target_day({"split_day": "push"}, "", self.DAYS, set()) in (
            "Push A",
            "Push B",
        )

    def test_two_sessions_of_one_kind_fill_a_and_b(self):
        claimed = set()
        first = _resolve_target_day({"split_day": "Pull"}, "", self.DAYS, claimed)
        claimed.add(first)
        second = _resolve_target_day({"split_day": "Pull"}, "", self.DAYS, claimed)
        assert {first, second} == {"Pull A", "Pull B"}

    def test_the_sentence_picks_between_days_of_the_same_kind(self):
        """Context is good for exactly one thing: A or B."""
        assert _resolve_target_day(
            {"split_day": "Pull"},
            "use this complete session for Pull B",
            self.DAYS,
            set(),
        ) == "Pull B"

    def test_an_unknown_kind_falls_back_to_a_day_the_sentence_names(self):
        assert _resolve_target_day(
            {"split_day": "Arms"}, "put it on Push B", self.DAYS, set()
        ) == "Push B"

    def test_an_unknown_kind_with_no_context_keeps_its_own_label(self):
        """Better to create the day than to silently drop the import."""
        assert _resolve_target_day({"split_day": "Arms"}, "", self.DAYS, set()) == "Arms"

    def test_a_session_with_no_label_and_no_context_targets_nothing(self):
        assert _resolve_target_day({}, "", self.DAYS, set()) is None

    def test_a_push_session_never_lands_on_a_pull_day(self):
        """The exact regression: hack squats and incline press on Pull A."""
        claimed = set()
        for split_day, expected_prefix in (
            ("Pull", "Pull"), ("Pull", "Pull"), ("push", "Push"), ("Legs", "Legs"),
        ):
            day = _resolve_target_day({"split_day": split_day}, "", self.DAYS, claimed)
            claimed.add(day)
            assert day.lower().startswith(expected_prefix.lower())
