/** User-selectable models for AI chat and nutrition plan generation. */

export type AiModelId = "gpt-4o" | "gpt-5.6-sol";

export const AI_MODEL_OPTIONS: { id: AiModelId; label: string; short: string }[] = [
  { id: "gpt-4o", label: "GPT-4o", short: "4o" },
  { id: "gpt-5.6-sol", label: "GPT-5.6 Sol", short: "Sol" },
];

export const DEFAULT_AI_MODEL: AiModelId = "gpt-4o";

export const AI_MODEL_STORAGE_KEY = "gymai_ai_model";

export function isAiModelId(value: unknown): value is AiModelId {
  return value === "gpt-4o" || value === "gpt-5.6-sol";
}

export function normalizeAiModel(value: unknown): AiModelId {
  return isAiModelId(value) ? value : DEFAULT_AI_MODEL;
}
