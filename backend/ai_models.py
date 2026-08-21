"""
Shared OpenAI model allowlist and Chat Completions kwargs helpers.

GPT-5.6 Sol needs different params than GPT-4o (max_completion_tokens, no
custom temperature). Function tools on Chat Completions only work when
reasoning_effort is explicitly "none".
"""

from typing import Any, Dict, Optional

ALLOWED_MODELS = ("gpt-4o", "gpt-5.6-sol")
DEFAULT_MODEL = "gpt-4o"

_ALIASES = {
    "gpt-4o": "gpt-4o",
    "4o": "gpt-4o",
    "standard": "gpt-4o",
    "gpt-5.6-sol": "gpt-5.6-sol",
    "gpt-5.6": "gpt-5.6-sol",
    "sol": "gpt-5.6-sol",
    "best": "gpt-5.6-sol",
}


def resolve_model(requested: Optional[str], default: str = DEFAULT_MODEL) -> str:
    """Map a client model string to an allowlisted id, else default."""
    if not requested or not str(requested).strip():
        return default if default in ALLOWED_MODELS else DEFAULT_MODEL
    raw = str(requested).strip()
    resolved = _ALIASES.get(raw.lower()) or (raw if raw in ALLOWED_MODELS else None)
    if resolved in ALLOWED_MODELS:
        return resolved
    return default if default in ALLOWED_MODELS else DEFAULT_MODEL


def is_gpt5_family(model: str) -> bool:
    return model.startswith("gpt-5") or model.startswith(("o1", "o3", "o4"))


def completion_kwargs(
    model: str,
    *,
    max_tokens: int,
    temperature: float = 0.7,
    use_tools: bool = False,
) -> Dict[str, Any]:
    """
    Build model-specific Chat Completions kwargs (excluding messages/stream).

    For GPT-5.6 + tools, reasoning_effort must be "none" or the API rejects
    the request. Nutrition / JSON-only calls omit tools and keep default
    medium reasoning for better plan quality.
    """
    kwargs: Dict[str, Any] = {"model": model}
    if is_gpt5_family(model):
        kwargs["max_completion_tokens"] = max_tokens
        if use_tools:
            kwargs["reasoning_effort"] = "none"
    else:
        kwargs["max_tokens"] = max_tokens
        kwargs["temperature"] = temperature
    return kwargs
