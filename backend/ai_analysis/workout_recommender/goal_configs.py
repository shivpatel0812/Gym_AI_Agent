"""
Per-goal configuration for the deterministic progression engine.
Frozen dataclasses ensure immutability and testability.
"""

from dataclasses import dataclass
from typing import Optional, Tuple


@dataclass(frozen=True)
class RepRangeConfig:
    """Defines a rep range with low and high bounds."""
    low: int
    high: int

    @property
    def midpoint(self) -> int:
        return (self.low + self.high) // 2


@dataclass(frozen=True)
class IncrementConfig:
    """Weight increments per equipment type (in lbs)."""
    barbell: float = 5.0
    dumbbell: float = 5.0
    cable: float = 5.0
    machine: float = 5.0


@dataclass(frozen=True)
class GoalConfig:
    """Complete configuration for a training goal."""
    name: str
    compound_rep_range: RepRangeConfig
    isolation_rep_range: RepRangeConfig
    increments: IncrementConfig
    consecutive_failures_to_hold: int
    double_increment_on_easy: bool
    track_strength_drops: bool
    celebrate_maintenance: bool


# === Goal Configurations ===

STRENGTH = GoalConfig(
    name="strength",
    compound_rep_range=RepRangeConfig(low=3, high=6),
    isolation_rep_range=RepRangeConfig(low=6, high=10),
    increments=IncrementConfig(barbell=5.0, dumbbell=5.0, cable=5.0, machine=5.0),
    consecutive_failures_to_hold=2,
    double_increment_on_easy=True,
    track_strength_drops=False,
    celebrate_maintenance=False,
)

HYPERTROPHY = GoalConfig(
    name="hypertrophy",
    compound_rep_range=RepRangeConfig(low=6, high=10),
    isolation_rep_range=RepRangeConfig(low=10, high=15),
    increments=IncrementConfig(barbell=5.0, dumbbell=5.0, cable=5.0, machine=5.0),
    consecutive_failures_to_hold=2,
    double_increment_on_easy=True,
    track_strength_drops=False,
    celebrate_maintenance=False,
)

FAT_LOSS = GoalConfig(
    name="fat_loss",
    compound_rep_range=RepRangeConfig(low=8, high=12),
    isolation_rep_range=RepRangeConfig(low=12, high=15),
    increments=IncrementConfig(barbell=5.0, dumbbell=5.0, cable=5.0, machine=5.0),
    consecutive_failures_to_hold=2,
    double_increment_on_easy=False,
    track_strength_drops=True,
    celebrate_maintenance=True,
)

GENERAL = GoalConfig(
    name="general",
    compound_rep_range=RepRangeConfig(low=8, high=12),
    isolation_rep_range=RepRangeConfig(low=8, high=12),
    increments=IncrementConfig(barbell=5.0, dumbbell=5.0, cable=5.0, machine=5.0),
    consecutive_failures_to_hold=3,
    double_increment_on_easy=False,
    track_strength_drops=False,
    celebrate_maintenance=False,
)

# === Lookup Maps ===

GOAL_CONFIGS = {
    "strength": STRENGTH,
    "hypertrophy": HYPERTROPHY,
    "fat_loss": FAT_LOSS,
    "general": GENERAL,
}

GOAL_ALIAS_MAP = {
    "Get Stronger": "strength",
    "Build Muscle": "hypertrophy",
    "Lose Fat": "fat_loss",
    "General Fitness": "general",
    # Lowercase aliases
    "get stronger": "strength",
    "build muscle": "hypertrophy",
    "lose fat": "fat_loss",
    "general fitness": "general",
    # Direct names
    "strength": "strength",
    "hypertrophy": "hypertrophy",
    "fat_loss": "fat_loss",
    "general": "general",
}

DEFAULT_GOAL = "hypertrophy"


def resolve_goal_key(user_goal: str) -> str:
    """
    Resolve a user-facing goal string to a canonical config key.
    Falls back to DEFAULT_GOAL if unrecognized.
    """
    if not user_goal:
        return DEFAULT_GOAL
    return GOAL_ALIAS_MAP.get(user_goal, GOAL_ALIAS_MAP.get(user_goal.strip(), DEFAULT_GOAL))


def get_goal_config(user_goal: str) -> GoalConfig:
    """
    Get the GoalConfig for a user-facing goal string.
    Falls back to hypertrophy if unrecognized.
    """
    key = resolve_goal_key(user_goal)
    return GOAL_CONFIGS[key]


def is_known_goal(goal: str) -> bool:
    """Whether a goal string maps to a real config rather than the fallback."""
    if not goal:
        return False
    return goal in GOAL_ALIAS_MAP or goal.strip() in GOAL_ALIAS_MAP


def resolve_goal_config(user_goal: str, focus_goal: Optional[str] = None) -> GoalConfig:
    """
    Resolve the config for one exercise, letting a per-exercise focus win.

    A focus lets one lift train differently from the rest of the program — a
    strength emphasis on bench while everything else stays hypertrophy.

    An unrecognized focus_goal is ignored rather than silently falling back to
    the default, which would otherwise override the user's real goal.
    """
    if focus_goal and is_known_goal(focus_goal):
        return get_goal_config(focus_goal)
    return get_goal_config(user_goal)
