"""The coach may look at a meal photo — only when the user asks it to.

Reading the archive for macros and opening the photograph are different acts.
The first answers a question about someone's diet; the second opens a picture
of them and their table. The second one happens because they asked, so the
tool is withheld from the toolset entirely rather than merely described as
opt-in — a tool that was never offered cannot be called.
"""

import json

import pytest

from ai_analysis.ai_coach import attach_pending_images
from ai_analysis.coach_tools import (
    MAX_PHOTO_VIEWS_PER_TURN,
    CoachToolbox,
    asks_to_see_a_meal_photo,
    tools_for_mode,
)


# ---------------------------------------------------------------------------
# Fake Firestore
# ---------------------------------------------------------------------------


class _Doc:
    def __init__(self, doc_id, data):
        self.id = doc_id
        self._data = data

    def to_dict(self):
        return self._data


class _Query:
    def __init__(self, docs):
        self._docs = docs

    def limit(self, _n):
        return self

    def stream(self):
        return iter(self._docs)


class _DB:
    def __init__(self, docs):
        self._docs = docs

    def collection(self, _name):
        return self

    def document(self, _doc_id=None):
        return self

    def limit(self, _n):
        return _Query(self._docs)


def _log(doc_id, date, *, title, image=True, calories=520):
    return _Doc(
        doc_id,
        {
            "created_at": f"{date}T12:30:00",
            "title": title,
            "has_image": image,
            "image_base64": "QUJD" if image else None,
            "image_content_type": "image/jpeg",
            "initial_estimate": {"name": title, "calories": 440},
            "accepted_estimate": {"name": title, "calories": calories},
            "chat_turn_count": 1,
        },
    )


def _toolbox(docs, allow=True):
    return CoachToolbox(_DB(docs), "u1", allow_photo_view=allow)


# ---------------------------------------------------------------------------
# The gate is read from the user's words, not the model's judgement
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "message",
    [
        "look at the photo of my lunch",
        "can you see my lunch picture",
        "pull up that image",
        "what does the photo show",
        "based on the photo, was there rice",
        "re-read the picture",
        "show me the image again",
        "check the photo yourself",
        "zoom in on the picture",
    ],
)
def test_an_explicit_ask_opens_the_gate(message):
    assert asks_to_see_a_meal_photo(message) is True


@pytest.mark.parametrize(
    "message",
    [
        "what did I eat today",
        "how many calories was lunch",
        "are my scans accurate",
        "show me my macros",
        "what have I been eating this week",
        "how did my week go",
        "I took a picture earlier",
        "explain progressive overload",
    ],
)
def test_ordinary_questions_leave_it_shut(message):
    """These are all answerable from the logged macros.

    Every one of them is a question the coach should answer without opening
    a photograph — including "I took a picture earlier", which mentions one
    without asking anybody to look at it.
    """
    assert asks_to_see_a_meal_photo(message) is False


# ---------------------------------------------------------------------------
# Withheld, not just discouraged
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("mode", ["coach", "nutrition", "plan"])
def test_the_tool_is_absent_from_every_mode_by_default(mode):
    offered = {t["function"]["name"] for t in tools_for_mode(mode)}
    assert "view_meal_photo" not in offered
    # The archive is still readable — just not viewable.
    assert "get_meal_photo_history" in offered


@pytest.mark.parametrize("mode", ["coach", "nutrition", "plan"])
def test_the_tool_appears_only_when_allowed(mode):
    offered = {t["function"]["name"] for t in tools_for_mode(mode, allow_photo_view=True)}
    assert "view_meal_photo" in offered


def test_dispatch_refuses_a_call_that_was_never_offered():
    """Belt and braces against a replayed or hallucinated tool call."""
    box = _toolbox([_log("a", "2026-09-05", title="thali")], allow=False)
    result = box.dispatch("view_meal_photo", {})
    assert "only available when the user asks" in result["error"]
    assert box.pending_images == []


def test_the_tool_itself_also_checks_the_flag():
    box = _toolbox([_log("a", "2026-09-05", title="thali")], allow=False)
    result = box.view_meal_photo()
    assert result["error"] == "not_permitted"
    assert box.pending_images == []


# ---------------------------------------------------------------------------
# What the tool returns, and where the image actually goes
# ---------------------------------------------------------------------------


def test_the_image_never_travels_inside_the_tool_result():
    """A tool message is a string — base64 in it is wasted, not seen.

    The model cannot read an image out of a JSON string, so putting it there
    would spend a megabyte of context to show it nothing.
    """
    box = _toolbox([_log("a", "2026-09-05", title="thali")])
    result = box.view_meal_photo()
    assert result["status"] == "ok"
    assert "QUJD" not in json.dumps(result, default=str)
    assert result["log_id"] == "a"
    # The macros the user actually committed, not the first guess.
    assert result["logged"]["calories"] == 520
    assert result["first_guess_calories"] == 440
    # The image is parked for the chat loop to attach.
    assert len(box.pending_images) == 1
    assert box.pending_images[0]["data_url"] == "data:image/jpeg;base64,QUJD"


def test_no_argument_picks_the_most_recent_photo():
    box = _toolbox([
        _log("old", "2026-09-01", title="oats"),
        _log("new", "2026-09-05", title="thali"),
    ])
    assert box.view_meal_photo()["log_id"] == "new"


def test_a_specific_log_id_is_honoured():
    box = _toolbox([
        _log("old", "2026-09-01", title="oats"),
        _log("new", "2026-09-05", title="thali"),
    ])
    assert box.view_meal_photo(log_id="old")["title"] == "oats"


def test_a_date_selects_that_day():
    box = _toolbox([
        _log("old", "2026-09-01", title="oats"),
        _log("new", "2026-09-05", title="thali"),
    ])
    assert box.view_meal_photo(date="2026-09-01")["log_id"] == "old"


def test_logs_that_kept_no_image_are_reported_not_invented():
    """A typed meal, or one whose archive write dropped the image."""
    box = _toolbox([_log("a", "2026-09-05", title="thali", image=False)])
    result = box.view_meal_photo()
    assert result["status"] == "no_photos"
    assert box.pending_images == []


def test_an_unknown_id_says_where_to_get_real_ones():
    box = _toolbox([_log("a", "2026-09-05", title="thali")])
    result = box.view_meal_photo(log_id="nope")
    assert result["status"] == "not_found"
    assert "get_meal_photo_history" in result["message"]


def test_a_turn_cannot_page_through_the_album():
    box = _toolbox([
        _log(f"log-{i}", f"2026-09-0{i}", title=f"meal {i}") for i in range(1, 6)
    ])
    for i in range(1, 6):
        box.view_meal_photo(log_id=f"log-{i}")
    assert len(box.pending_images) == MAX_PHOTO_VIEWS_PER_TURN
    assert box.view_meal_photo(log_id="log-5")["error"] == "limit_reached"


# ---------------------------------------------------------------------------
# Handing the image to the model
# ---------------------------------------------------------------------------


def test_pending_images_become_a_real_image_message():
    box = _toolbox([_log("a", "2026-09-05", title="thali")])
    box.view_meal_photo()
    messages = [{"role": "tool", "tool_call_id": "1", "content": "{}"}]

    assert attach_pending_images(messages, box) == 1

    attached = messages[-1]
    assert attached["role"] == "user"
    images = [part for part in attached["content"] if part["type"] == "image_url"]
    assert len(images) == 1
    assert images[0]["image_url"]["url"] == "data:image/jpeg;base64,QUJD"
    # Looking again at lower fidelity than the estimate was made at would make
    # the coach worse at the one job this tool exists for.
    assert images[0]["image_url"]["detail"] == "high"
    # Drained, so a later round cannot re-attach the same photo.
    assert box.pending_images == []


def test_nothing_is_appended_when_no_photo_was_opened():
    box = _toolbox([_log("a", "2026-09-05", title="thali")])
    messages = [{"role": "tool", "tool_call_id": "1", "content": "{}"}]
    assert attach_pending_images(messages, box) == 0
    assert len(messages) == 1
