/** User-selectable models for AI chat and nutrition plan generation. */

export type AiModelId = "gpt-4o" | "gpt-5.6-sol";

export const AI_MODEL_OPTIONS: { id: AiModelId; label: string; short: string }[] = [
  { id: "gpt-4o", label: "GPT-4o", short: "4o" },
  { id: "gpt-5.6-sol", label: "GPT-5.6 Sol", short: "Sol" },
];

export const DEFAULT_AI_MODEL: AiModelId = "gpt-4o";

/**
 * First-pass model for meal-photo estimation.
 *
 * The cheap model handles the common case fine and degrades on mixed
 * multi-compartment meals. Rather than pay the strong model's price on every
 * apple and protein shake, the server re-runs the photo on the stronger model
 * when the first pass reports itself out of its depth — see `should_escalate`
 * in `backend/nutrition/photo_estimate.py`. So this stays cheap on purpose.
 */
export const DEFAULT_PHOTO_MODEL: AiModelId = "gpt-4o";

export const AI_MODEL_STORAGE_KEY = "gymai_ai_model";

export function isAiModelId(value: unknown): value is AiModelId {
  return value === "gpt-4o" || value === "gpt-5.6-sol";
}

export function normalizeAiModel(value: unknown): AiModelId {
  return isAiModelId(value) ? value : DEFAULT_AI_MODEL;
}

/** Like `normalizeAiModel`, but unset falls back to the photo default. */
export function normalizePhotoModel(value: unknown): AiModelId {
  return isAiModelId(value) ? value : DEFAULT_PHOTO_MODEL;
}
