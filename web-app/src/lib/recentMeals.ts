/** Meal slot normalization shared by nutrition logging and meal moves. */

export function normalizeMealLabel(meal?: string | null): string {
  const m = String(meal || "").trim().toLowerCase().replace(/_/g, "-");
  if (!m) return "";
  if (m.includes("breakfast")) return "breakfast";
  if (m.includes("lunch")) return "lunch";
  if (m.includes("dinner")) return "dinner";
  if (m.includes("pre") || m.includes("shake")) return "pre_workout";
  if (m.includes("snack")) return "snack";
  return m;
}

export function displayMealLabel(slot: string): string {
  const s = normalizeMealLabel(slot);
  if (s === "pre_workout") return "Pre-Workout";
  if (s === "snack") return "Snacks";
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "Meal";
}
