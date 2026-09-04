"""Fix Results chat: the revision must see the photo and edit line items.

The bug these pin: a user photographs a thali, gets 440 kcal, and then spends
three turns dragging it to 600 by naming one missing item at a time. Each turn
the model had no image and no per-item ledger, so it could only nudge a scalar.
"""

import json

from nutrition import adjust_estimate


class _Message:
    def __init__(self, content):
        self.content = content


class _Choice:
    def __init__(self, content):
        self.message = _Message(content)


class _Response:
    def __init__(self, content):
        self.choices = [_Choice(content)]


class _Completions:
    def __init__(self, content):
        self.content = content
        self.kwargs = None

    def create(self, **kwargs):
        self.kwargs = kwargs
        return _Response(self.content)


class _Chat:
    def __init__(self, content):
        self.completions = _Completions(content)


class _Client:
    def __init__(self, content):
        self.chat = _Chat(content)


def _reply(payload: dict, prose: str = "Got it, I added that.") -> str:
    return f"{prose}\n\n```json\n{json.dumps(payload)}\n```"


CURRENT = {
    "name": "Indian thali",
    "amount": "1 tray",
    "calories": 440,
    "protein": 16,
    "carbs": 73,
    "fats": 10.5,
    "fiber": 9,
    "components": [
        {"item": "chapati", "amount": "1 medium", "calories": 130, "protein": 4, "carbs": 26, "fats": 1},
        {"item": "kadhi", "calories": 230, "protein": 9, "carbs": 34, "fats": 7},
        {"item": "sabzi", "calories": 80, "protein": 3, "carbs": 13, "fats": 2.5},
    ],
}

REVISED_PAYLOAD = {
    "name": "Indian thali",
    "amount": "1 tray",
    "components": [
        {"item": "chapati", "calories": 130, "protein": 4, "carbs": 26, "fats": 1},
        {"item": "kadhi", "calories": 230, "protein": 9, "carbs": 34, "fats": 7},
        {"item": "sabzi", "calories": 80, "protein": 3, "carbs": 13, "fats": 2.5},
        {"item": "chakri (4 pieces)", "calories": 120, "protein": 2, "carbs": 12, "fats": 7},
    ],
    "calories": 560,
    "protein": 18,
    "carbs": 85,
    "fats": 17.5,
    "fiber": 9,
    "revision_note": "Added 4 chakri.",
}


def _run(monkeypatch, *, image_data_url=None, current=None, reply=None):
    client = _Client(reply if reply is not None else _reply(REVISED_PAYLOAD))
    monkeypatch.setattr(adjust_estimate, "get_openai_client", lambda: client)
    result = adjust_estimate.adjust_macro_estimate(
        current_estimate=current if current is not None else CURRENT,
        user_message="did u count the chakori",
        image_data_url=image_data_url,
    )
    return result, client.chat.completions.kwargs


def test_component_ledger_reaches_the_model(monkeypatch):
    _, request = _run(monkeypatch)
    context = request["messages"][1]["content"]
    assert "chapati (1 medium): 130 kcal" in context
    assert "kadhi: 230 kcal" in context
    assert "sabzi: 80 kcal" in context


def test_photo_is_reattached_at_full_detail(monkeypatch):
    data_url = "data:image/jpeg;base64,QUJD"
    _, request = _run(monkeypatch, image_data_url=data_url)

    content = request["messages"][-1]["content"]
    assert content[0]["text"] == "did u count the chakori"
    assert content[1]["image_url"]["url"] == data_url
    # A revision that re-reads the photo at lower fidelity than the original
    # estimate would make corrections worse, not better.
    assert content[1]["image_url"]["detail"] == "high"


def test_text_only_turn_stays_a_plain_string(monkeypatch):
    _, request = _run(monkeypatch)
    assert request["messages"][-1]["content"] == "did u count the chakori"
    systems = [m["content"] for m in request["messages"] if m["role"] == "system"]
    assert all("Re-read it before revising" not in s for s in systems)


def test_revision_returns_the_full_reprized_ledger(monkeypatch):
    result, _ = _run(monkeypatch)
    revised = result["revised_estimate"]

    assert revised["calories"] == 560
    names = [c["name"] for c in revised["components"]]
    assert names == ["chapati", "kadhi", "sabzi", "chakri (4 pieces)"]
    # The named item is priced on its own merits, not folded into the total.
    assert revised["components"][-1]["calories"] == 120


def test_dropped_ledger_falls_back_to_the_previous_one(monkeypatch):
    payload = {k: v for k, v in REVISED_PAYLOAD.items() if k != "components"}
    result, _ = _run(monkeypatch, reply=_reply(payload))
    revised = result["revised_estimate"]

    # Without this a model that forgets `components` would strand later turns
    # with no line items to edit.
    assert [c["name"] for c in revised["components"]] == ["chapati", "kadhi", "sabzi"]


def test_unitemized_estimate_still_works(monkeypatch):
    current = {k: v for k, v in CURRENT.items() if k != "components"}
    result, request = _run(monkeypatch, current=current)

    assert "Components: (not itemized)" in request["messages"][1]["content"]
    assert result["revised_estimate"]["calories"] == 560


def test_history_carries_text_only(monkeypatch):
    result, _ = _run(monkeypatch, image_data_url="data:image/jpeg;base64,QUJD")
    history = result["conversation_history"]

    # The photo is re-attached per turn rather than duplicated into history.
    assert [turn["role"] for turn in history] == ["user", "assistant"]
    assert all(isinstance(turn["content"], str) for turn in history)


def test_reasoning_model_gets_headroom_for_thinking(monkeypatch):
    """Reasoning tokens come out of max_completion_tokens.

    At the old flat 900 the thinking pass can consume the whole budget, the
    reply comes back without its JSON block, and `_extract_revised_estimate`
    quietly returns the estimate unchanged — a correction that looks accepted
    and changes nothing.
    """
    client = _Client(_reply(REVISED_PAYLOAD))
    monkeypatch.setattr(adjust_estimate, "get_openai_client", lambda: client)
    adjust_estimate.adjust_macro_estimate(
        current_estimate=CURRENT, user_message="add the chakri", model="gpt-5.6-sol"
    )
    kwargs = client.chat.completions.kwargs

    assert kwargs["model"] == "gpt-5.6-sol"
    assert kwargs["max_completion_tokens"] == 4000
    assert "max_tokens" not in kwargs


def test_non_reasoning_model_keeps_the_tight_budget(monkeypatch):
    client = _Client(_reply(REVISED_PAYLOAD))
    monkeypatch.setattr(adjust_estimate, "get_openai_client", lambda: client)
    adjust_estimate.adjust_macro_estimate(
        current_estimate=CURRENT, user_message="add the chakri", model="gpt-4o"
    )
    kwargs = client.chat.completions.kwargs

    assert kwargs["max_tokens"] == 900
    assert "max_completion_tokens" not in kwargs
