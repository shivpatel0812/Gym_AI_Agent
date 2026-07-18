"""Tests for goal_configs.py — lookup, alias mapping, defaults."""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from ai_analysis.workout_recommender.goal_configs import (
    get_goal_config,
    resolve_goal_key,
    GOAL_CONFIGS,
    GOAL_ALIAS_MAP,
    DEFAULT_GOAL,
    STRENGTH,
    HYPERTROPHY,
    FAT_LOSS,
    GENERAL,
    GoalConfig,
    RepRangeConfig,
)


class TestGoalAliasMapping:
    def test_user_facing_aliases_resolve(self):
        assert resolve_goal_key("Get Stronger") == "strength"
        assert resolve_goal_key("Build Muscle") == "hypertrophy"
        assert resolve_goal_key("Lose Fat") == "fat_loss"
        assert resolve_goal_key("General Fitness") == "general"

    def test_direct_keys_resolve(self):
        assert resolve_goal_key("strength") == "strength"
        assert resolve_goal_key("hypertrophy") == "hypertrophy"
        assert resolve_goal_key("fat_loss") == "fat_loss"
        assert resolve_goal_key("general") == "general"

    def test_lowercase_aliases_resolve(self):
        assert resolve_goal_key("get stronger") == "strength"
        assert resolve_goal_key("build muscle") == "hypertrophy"
        assert resolve_goal_key("lose fat") == "fat_loss"
        assert resolve_goal_key("general fitness") == "general"

    def test_unknown_goal_falls_back_to_default(self):
        assert resolve_goal_key("something random") == DEFAULT_GOAL
        assert resolve_goal_key("") == DEFAULT_GOAL
        assert resolve_goal_key("power lifting") == DEFAULT_GOAL

    def test_none_goal_falls_back_to_default(self):
        assert resolve_goal_key(None) == DEFAULT_GOAL


class TestGoalConfigLookup:
    def test_get_goal_config_returns_correct_configs(self):
        assert get_goal_config("Build Muscle") is HYPERTROPHY
        assert get_goal_config("Get Stronger") is STRENGTH
        assert get_goal_config("Lose Fat") is FAT_LOSS
        assert get_goal_config("General Fitness") is GENERAL

    def test_get_goal_config_unknown_returns_hypertrophy(self):
        config = get_goal_config("unknown")
        assert config is HYPERTROPHY


class TestGoalConfigValues:
    def test_strength_rep_ranges(self):
        assert STRENGTH.compound_rep_range.low == 3
        assert STRENGTH.compound_rep_range.high == 6
        assert STRENGTH.isolation_rep_range.low == 6
        assert STRENGTH.isolation_rep_range.high == 10

    def test_hypertrophy_rep_ranges(self):
        assert HYPERTROPHY.compound_rep_range.low == 6
        assert HYPERTROPHY.compound_rep_range.high == 10
        assert HYPERTROPHY.isolation_rep_range.low == 10
        assert HYPERTROPHY.isolation_rep_range.high == 15

    def test_fat_loss_rep_ranges(self):
        assert FAT_LOSS.compound_rep_range.low == 8
        assert FAT_LOSS.compound_rep_range.high == 12
        assert FAT_LOSS.isolation_rep_range.low == 12
        assert FAT_LOSS.isolation_rep_range.high == 15

    def test_general_rep_ranges(self):
        assert GENERAL.compound_rep_range.low == 8
        assert GENERAL.compound_rep_range.high == 12
        assert GENERAL.isolation_rep_range.low == 8
        assert GENERAL.isolation_rep_range.high == 12

    def test_failure_thresholds(self):
        assert STRENGTH.consecutive_failures_to_hold == 2
        assert HYPERTROPHY.consecutive_failures_to_hold == 2
        assert FAT_LOSS.consecutive_failures_to_hold == 2
        assert GENERAL.consecutive_failures_to_hold == 3

    def test_double_increment_flags(self):
        assert STRENGTH.double_increment_on_easy is True
        assert HYPERTROPHY.double_increment_on_easy is True
        assert FAT_LOSS.double_increment_on_easy is False
        assert GENERAL.double_increment_on_easy is False

    def test_fat_loss_specific_flags(self):
        assert FAT_LOSS.track_strength_drops is True
        assert FAT_LOSS.celebrate_maintenance is True
        assert HYPERTROPHY.track_strength_drops is False
        assert HYPERTROPHY.celebrate_maintenance is False


class TestRepRangeConfig:
    def test_midpoint(self):
        r = RepRangeConfig(low=6, high=10)
        assert r.midpoint == 8

    def test_midpoint_odd_range(self):
        r = RepRangeConfig(low=3, high=6)
        assert r.midpoint == 4


class TestGoalConfigImmutability:
    def test_configs_are_frozen(self):
        import dataclasses
        assert dataclasses.is_dataclass(STRENGTH)
        try:
            STRENGTH.name = "modified"
            assert False, "Should have raised FrozenInstanceError"
        except (dataclasses.FrozenInstanceError, AttributeError):
            pass
