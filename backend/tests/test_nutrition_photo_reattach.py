"""The correction chat must know — and say — whether it has the photo.

The complaint these pin: "sometimes when I put a picture and ask it to make an
adjustment it feels like it doesn't remember the picture." It was right. Four
paths reach the Fix Results chat with no image, all of them silent, and the
model then wrote confident prose about a plate it had never been sent.
"""

import json

import pytest

from ai_models import stronger_model
from nutrition import adjust_estimate, photo_log_store


# ---------------------------------------------------------------------------
# Fake Firestore
# ---------------------------------------------------------------------------


class _Snap:
    def __init__(self, data):
        self._data = data
        self.exists = data is not None

    def to_dict(self):
        return self._data


class _Doc:
    def __init__(self, store, doc_id, fail_writes_over=None):
        self._store = store
        self.id = doc_id
        self._fail_over = fail_writes_over

    def get(self):
        return _Snap(self._store.get(self.id))

    def set(self, payload, merge=False):
        if self._fail_over is not None:
            size = len(json.dumps(payload, default=str))
            if size > self._fail_over:
                raise RuntimeError("document exceeds the maximum allowed size")
        if merge and self.id in self._store:
            self._store[self.id].update(payload)
        else:
            self._store[self.id] = dict(payload)


class _Collection:
    def __init__(self, store, fail_writes_over=None):
        self._store = store
        self._fail_over = fail_writes_over
        self._next = 0

    def document(self, doc_id=None):
        if doc_id is None:
            self._next += 1
            doc_id = f"log-{self._next}"
        return _Doc(self._store, doc_id, self._fail_over)


class _FakeDB:
    """Minimal stand-in for the chained Firestore builder used by the store."""

    def __init__(self, store=None, fail_writes_over=None):
        self.store = store if store is not None else {}
        self.fail_writes_over = fail_writes_over

    def collection(self, _name):
        return self

    def document(self, _doc_id=None):
        return self


@pytest.fixture
def fake_store(monkeypatch):
    store = {}

    def _collection(_db, _user_id, _store=store):
        return _Collection(_store, getattr(_db, "fail_writes_over", None))

    monkeypatch.setattr(photo_log_store, "_collection", _collection)
    return store


# ---------------------------------------------------------------------------
# load_archived_image_result — every way it can come back empty is named
# ---------------------------------------------------------------------------


def test_missing_log_id_reports_no_log(fake_store):
    result = photo_log_store.load_archived_image_result(_FakeDB(), "u", None)
    assert result["data_url"] is None
    assert result["status"] == photo_log_store.PHOTO_NO_LOG


def test_absent_document_reports_log_missing(fake_store):
    result = photo_log_store.load_archived_image_result(_FakeDB(), "u", "nope")
    assert result["status"] == photo_log_store.PHOTO_LOG_MISSING


def test_log_without_an_archived_image_says_so(fake_store):
    """The silent case: the log exists, so the chat linked to it happily.

    `has_image: False` means the compression or the write dropped the photo.
    Returning a bare None here let the revision run blind.
    """
    fake_store["log-a"] = {"has_image": False, "model": "gpt-4o"}
    result = photo_log_store.load_archived_image_result(_FakeDB(), "u", "log-a")
    assert result["data_url"] is None
    assert result["status"] == photo_log_store.PHOTO_NOT_ARCHIVED
    assert result["model"] == "gpt-4o"


def test_archived_image_comes_back_as_a_data_url(fake_store):
    fake_store["log-a"] = {
        "has_image": True,
        "image_base64": "QUJD",
        "image_content_type": "image/jpeg",
        "model": "gpt-5.6-sol",
    }
    result = photo_log_store.load_archived_image_result(_FakeDB(), "u", "log-a")
    assert result["data_url"] == "data:image/jpeg;base64,QUJD"
    assert result["status"] == photo_log_store.PHOTO_OK
    # Read from the same document rather than a second round trip.
    assert result["model"] == "gpt-5.6-sol"


def test_read_failure_is_a_status_not_a_shrug(fake_store, monkeypatch):
    def _boom(_db, _user_id):
        raise RuntimeError("firestore unavailable")

    monkeypatch.setattr(photo_log_store, "_collection", _boom)
    result = photo_log_store.load_archived_image_result(_FakeDB(), "u", "log-a")
    assert result["status"] == photo_log_store.PHOTO_READ_ERROR


# ---------------------------------------------------------------------------
# The write that used to take the whole log down with it
# ---------------------------------------------------------------------------


def test_oversized_write_keeps_the_log_and_drops_the_image(fake_store):
    """A doc too large to write lost the log, the chat link and the label.

    Losing the image is bad; losing the log is worse, because the accepted
    estimate is the archive's only real label. Keep the log, mark the photo.
    """
    db = _FakeDB(fail_writes_over=2000)
    log_id = photo_log_store.create_photo_log(
        db,
        "u",
        estimate={"name": "thali", "calories": 560},
        archive={
            "image_base64": "Q" * 5000,
            "image_content_type": "image/jpeg",
            "image_bytes": 3750,
            "image_width": 1024,
            "image_height": 768,
        },
        model="gpt-4o",
    )
    assert log_id is not None
    stored = fake_store[log_id]
    assert stored["has_image"] is False
    assert stored["archive_dropped"] == "write_failed"
    assert "image_base64" not in stored
    # And the estimate itself survived.
    assert stored["initial_estimate"]["calories"] == 560


def test_encoded_image_over_the_document_budget_is_not_stored(tmp_path, monkeypatch):
    """Reject at compression time so the write never has to fail at all."""
    from PIL import Image

    path = tmp_path / "meal.jpg"
    Image.new("RGB", (64, 64), (120, 90, 60)).save(path, format="JPEG")
    monkeypatch.setattr(photo_log_store, "ARCHIVE_MAX_ENCODED_BYTES", 10)
    assert photo_log_store.compress_image_for_archive(str(path)) is None


def test_a_normal_photo_still_archives(tmp_path):
    from PIL import Image

    path = tmp_path / "meal.jpg"
    Image.new("RGB", (1600, 1200), (200, 140, 90)).save(path, format="JPEG")
    archive = photo_log_store.compress_image_for_archive(str(path))
    assert archive is not None
    assert len(archive["image_base64"]) <= photo_log_store.ARCHIVE_MAX_ENCODED_BYTES
    assert max(archive["image_width"], archive["image_height"]) <= (
        photo_log_store.ARCHIVE_MAX_EDGE
    )


# ---------------------------------------------------------------------------
# The prompt must not let a blind revision sound like a sighted one
# ---------------------------------------------------------------------------


class _Completions:
    def __init__(self, content):
        self.content = content
        self.kwargs = None

    def create(self, **kwargs):
        self.kwargs = kwargs
        return type(
            "R",
            (),
            {"choices": [type("C", (), {"message": type("M", (), {"content": self.content})()})()]},
        )()


class _Client:
    def __init__(self, content):
        self.chat = type("Chat", (), {"completions": _Completions(content)})()


CURRENT = {
    "name": "khichdi",
    "calories": 440,
    "protein": 12,
    "carbs": 73,
    "fats": 10,
    "fiber": 6,
    "components": [{"item": "khichdi", "calories": 440, "protein": 12, "carbs": 73, "fats": 10}],
}

REPLY = "Updated.\n\n```json\n" + json.dumps(
    {
        "name": "khichdi",
        "components": [
            {"item": "khichdi", "calories": 440, "protein": 12, "carbs": 73, "fats": 10},
            {"item": "dahi", "calories": 120, "protein": 7, "carbs": 9, "fats": 6},
        ],
        "calories": 560,
        "protein": 19,
        "carbs": 82,
        "fats": 16,
        "fiber": 6,
    }
) + "\n```"


def _systems(monkeypatch, image_data_url=None):
    client = _Client(REPLY)
    monkeypatch.setattr(adjust_estimate, "get_openai_client", lambda: client)
    result = adjust_estimate.adjust_macro_estimate(
        current_estimate=CURRENT,
        user_message="you missed the dahi",
        image_data_url=image_data_url,
    )
    kwargs = client.chat.completions.kwargs
    return result, [m["content"] for m in kwargs["messages"] if m["role"] == "system"]


def test_without_a_photo_the_model_is_told_not_to_pretend(monkeypatch):
    result, systems = _systems(monkeypatch)
    joined = "\n".join(systems)
    assert "NO PHOTO IS AVAILABLE" in joined
    assert "Do not claim or imply that you looked at" in joined
    assert result["photo_attached"] is False


def test_with_a_photo_it_is_told_to_look_again(monkeypatch):
    result, systems = _systems(monkeypatch, image_data_url="data:image/jpeg;base64,QUJD")
    joined = "\n".join(systems)
    assert "Re-read it before revising" in joined
    assert "NO PHOTO IS AVAILABLE" not in joined
    assert result["photo_attached"] is True


# ---------------------------------------------------------------------------
# The correction must not be weaker than the pass it is correcting
# ---------------------------------------------------------------------------


def test_correction_runs_on_at_least_the_estimating_model():
    # Client picker says 4o; the estimate escalated to sol. Sol wins.
    assert stronger_model("gpt-4o", "gpt-5.6-sol") == "gpt-5.6-sol"
    # And a stronger picker is not dragged down by an older log.
    assert stronger_model("gpt-5.6-sol", "gpt-4o") == "gpt-5.6-sol"
    # Nothing known either way still resolves to something allowlisted.
    assert stronger_model(None, None) == "gpt-4o"
    assert stronger_model("nonsense", None) == "gpt-4o"
