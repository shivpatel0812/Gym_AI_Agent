"""
The forward projection and the scan comparison.

Both are places where it would be easy to show the user something more
confident than the data supports — a single encouraging line, or a body change
inferred from better lighting.
"""

import pytest

from progress.projection import build_forward_series
from progress.scan_compare import build_scan_compare
from progress.weeks import week_axis
from datetime import date

AXIS = week_axis(date(2026, 9, 5), 12)
FORWARD = ["2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28"]

LEVELS = {"strength": 120.0, "consistency": 100.0, "nutrition": 100.0, "body": 100.0}


def lift(best_step: float, real_step: float, base: float = 200.0):
    return {
        "current": {"e1rm": base},
        "best_case": [{"week": w, "e1rm": base + w * best_step} for w in range(1, 5)],
        "realistic": [{"week": w, "e1rm": base + w * real_step} for w in range(1, 5)],
    }


class TestForwardProjection:
    def test_two_lines_never_one(self):
        """A single confident forward line reads well on day one and tells the
        user they are failing by week five while they train normally."""
        out = build_forward_series([lift(5, 3)], LEVELS, "gain", FORWARD)
        assert out["available"] is True
        assert out["best_case"][-1]["level"] > out["realistic"][-1]["level"]

    def test_it_starts_where_the_measured_line_ends(self):
        """A forward series that opens above today's index draws a jump the
        plan never prescribed."""
        out = build_forward_series([lift(5, 3)], LEVELS, "gain", FORWARD)
        weights = {"strength": 0.35, "consistency": 0.25, "nutrition": 0.25, "body": 0.15}
        today = sum(LEVELS[k] * w for k, w in weights.items())
        assert out["realistic"][0]["level"] == pytest.approx(today, abs=1.0)

    def test_only_lifts_are_projected_and_it_says_so(self):
        """The plan can say what it will prescribe; it cannot say whether
        someone will log their food. Ramping the rest would invent the most
        flattering part of the picture."""
        out = build_forward_series([lift(5, 3)], LEVELS, "gain", FORWARD)
        assert out["projected_domains"] == ["strength"]
        assert set(out["held_domains"]) == {"consistency", "nutrition", "body"}
        assert "not whether you'll log your food" in out["assumption"]

    def test_the_forward_line_never_saw_teeth(self):
        """e1RM dips on the session a weight jump lands, so reading each week
        directly would imply losses the plan never prescribes."""
        dippy = {
            "current": {"e1rm": 200.0},
            "best_case": [
                {"week": 1, "e1rm": 210},
                {"week": 2, "e1rm": 204},   # the jump week
                {"week": 3, "e1rm": 215},
                {"week": 4, "e1rm": 208},
            ],
            "realistic": [{"week": w, "e1rm": 200 + w} for w in range(1, 5)],
        }
        levels = [p["level"] for p in build_forward_series([dippy], LEVELS, "gain", FORWARD)["best_case"]]
        assert levels == sorted(levels)

    def test_no_history_refuses_rather_than_drawing_a_flat_line(self):
        out = build_forward_series([lift(5, 3)], {"strength": None}, "gain", FORWARD)
        assert out["available"] is False
        assert out["reason"]

    def test_cardio_entries_are_skipped_not_counted_as_zero(self):
        out = build_forward_series(
            [lift(5, 3), {"is_cardio": True, "current": None}], LEVELS, "gain", FORWARD
        )
        assert out["lifts"] == 1


class TestScanCompare:
    @staticmethod
    def scan(day, regions, posture=None, confidence="medium"):
        return {
            "date": day,
            "observations": {
                "confidence": confidence,
                "regions": {k: {"development": v} for k, v in regions.items()},
                "posture": posture or {},
            },
        }

    def test_photos_are_never_claimed(self):
        """`body_scan/store.py` writes photos_retained: False and the router
        clears the uploads. The hub must not imply otherwise."""
        out = build_scan_compare(
            [
                self.scan("2026-06-20", {"chest": "underdeveloped"}),
                self.scan("2026-08-29", {"chest": "balanced"}),
            ],
            AXIS,
        )
        assert out["photos_retained"] is False
        assert "never stored" in out["note"]

    def test_a_region_that_developed_reads_as_improved(self):
        out = build_scan_compare(
            [
                self.scan("2026-06-20", {"chest": "underdeveloped"}),
                self.scan("2026-08-29", {"chest": "balanced"}),
            ],
            AXIS,
        )
        chest = next(r for r in out["regions"] if r["key"] == "chest")
        assert chest["direction"] == "improved"

    def test_an_unreadable_end_is_not_a_change(self):
        """A scan that could not read someone's back and a later one that
        could would otherwise manufacture progress out of better lighting."""
        out = build_scan_compare(
            [
                self.scan("2026-06-20", {"back": "uncertain"}),
                self.scan("2026-08-29", {"back": "prominent"}),
            ],
            AXIS,
        )
        back = next(r for r in out["regions"] if r["key"] == "back")
        assert back["direction"] is None
        assert "Back" in out["unread"]

    def test_posture_improves_downward(self):
        """Development runs up, posture flags run down. Sharing one ordering
        would report a worsening slouch as progress."""
        out = build_scan_compare(
            [
                self.scan("2026-06-20", {}, {"rounded_shoulders": "likely"}),
                self.scan("2026-08-29", {}, {"rounded_shoulders": "possible"}),
            ],
            AXIS,
        )
        entry = next(p for p in out["posture"] if p["key"] == "rounded_shoulders")
        assert entry["direction"] == "improved"

    def test_one_scan_is_a_reading_not_a_comparison(self):
        out = build_scan_compare([self.scan("2026-08-29", {"chest": "balanced"})], AXIS)
        assert out["available"] is False
        assert "second one" in out["reason"]

    def test_no_scans_is_a_normal_state(self):
        out = build_scan_compare([], AXIS)
        assert out["available"] is False
        assert out["scan_count"] == 0
