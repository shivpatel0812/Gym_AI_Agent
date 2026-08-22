"""The user's clock decides what day it is, not the server's."""

import os
import sys
from datetime import datetime
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import user_time


class _Doc:
    def __init__(self, data):
        self._data = data
        self.exists = data is not None

    def to_dict(self):
        return self._data


class _Ref:
    def __init__(self, store):
        self.store = store

    def get(self):
        return _Doc(self.store.get("profile"))

    def set(self, values, merge=False):
        current = self.store.get("profile") or {} if merge else {}
        self.store["profile"] = {**current, **values}


class _FakeDb:
    """Just enough Firestore to reach users/{uid}/user_profile/profile."""

    def __init__(self, profile=None):
        self.store = {"profile": profile}

    def collection(self, _name):
        return self

    def document(self, _name):
        return self

    # The chain ends at the profile doc either way.
    def get(self):
        return _Doc(self.store.get("profile"))

    def set(self, values, merge=False):
        _Ref(self.store).set(values, merge=merge)


def test_unknown_timezone_is_rejected():
    assert user_time.normalize_timezone("America/New_York") == "America/New_York"
    assert user_time.normalize_timezone("Mars/Olympus") is None
    assert user_time.normalize_timezone("") is None
    assert user_time.normalize_timezone(None) is None


def test_missing_timezone_falls_back_to_utc():
    assert user_time.get_timezone(_FakeDb(), "u1") == "UTC"
    assert user_time.get_timezone(_FakeDb({"name": "no tz here"}), "u1") == "UTC"


def test_stored_timezone_is_used():
    db = _FakeDb({"timezone": "America/New_York"})
    assert user_time.get_timezone(db, "u1") == "America/New_York"


def test_set_timezone_merges_and_validates():
    db = _FakeDb({"name": "existing"})
    assert user_time.set_timezone(db, "u1", "Europe/London") == "Europe/London"
    assert db.store["profile"]["name"] == "existing"
    assert db.store["profile"]["timezone"] == "Europe/London"
    assert user_time.set_timezone(db, "u1", "Not/AZone") is None


def test_evening_in_new_york_is_still_the_same_day():
    """9pm Thursday in NY is already Friday in UTC — the user's day wins."""
    ny = ZoneInfo("America/New_York")
    evening = datetime(2026, 8, 20, 21, 30, tzinfo=ny)

    assert evening.strftime("%Y-%m-%d") == "2026-08-20"
    assert evening.astimezone(ZoneInfo("UTC")).strftime("%Y-%m-%d") == "2026-08-21"
