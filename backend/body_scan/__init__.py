"""AI Body Scan — guided progress photos → qualitative coaching emphasis."""

from .schemas import CONSENT_VERSION
from .store import BodyScanStore
from .vision import analyze_scan_photos
from .goal_parse import parse_goal_text
from .synthesizer import (
    synthesize,
    explain_synthesis,
    summarize_training_history,
    diff_scans,
    classify_exercise,
)

__all__ = [
    "CONSENT_VERSION",
    "BodyScanStore",
    "analyze_scan_photos",
    "parse_goal_text",
    "synthesize",
    "explain_synthesis",
    "summarize_training_history",
    "diff_scans",
    "classify_exercise",
]
