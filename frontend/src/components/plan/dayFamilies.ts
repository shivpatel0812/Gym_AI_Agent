/**
 * Plan Hub pages by movement family, not by every A/B day name.
 *
 * A 5-day PPL stores Push A / Push B as separate plan days (heavy vs volume),
 * but the hub should show three tabs — Push, Pull, Legs — with both variants
 * on the same page. Grouping lives here so the screen and its tests share one
 * definition of "same family".
 */

export type DayLike = {
  day_name: string;
  focus?: string;
  day_goal?: string;
  day_type?: string;
};

export type DayFamily<T extends DayLike> = {
  /** Stable key used for paging ("push"). */
  key: string;
  /** Tab label ("Push"). */
  label: string;
  /** Plan days that belong to this family, in plan order. */
  days: T[];
};

const VARIANT_SUFFIX =
  /\s*[-\/]?\s*(?:heavy|volume|hypertrophy|strength|power|light|a|b|1|2)\s*$/i;

/**
 * Collapse "Push A", "Push B", "push-heavy" onto one family key.
 * Leaves unrelated names alone ("Abs", "Upper Body").
 */
export function dayFamilyKey(dayName: string): string {
  return String(dayName || "")
    .trim()
    .toLowerCase()
    .replace(/\s+(day|workout)\b/gi, " ")
    .replace(VARIANT_SUFFIX, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function dayFamilyLabel(key: string): string {
  if (!key) return "Day";
  return key.replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * What to print above a variant block once the family is already known.
 * "Push A" on the Push page → "A"; a lone "Legs" → null (no header needed).
 */
export function variantCaption(dayName: string, familyKey: string): string | null {
  const name = String(dayName || "").trim();
  const key = String(familyKey || "").trim().toLowerCase();
  if (!name || !key) return null;

  let rest = name;
  if (name.toLowerCase().startsWith(key)) {
    rest = name.slice(key.length).trim().replace(/^[\s\-–—:/]+/, "");
  }
  if (!rest || /^(day|workout)$/i.test(rest)) return null;
  return rest;
}

/** Group projection days into Push / Pull / Legs-style pages. */
export function groupDaysByFamily<T extends DayLike>(days: T[]): DayFamily<T>[] {
  const order: string[] = [];
  const buckets = new Map<string, T[]>();

  for (const day of days || []) {
    const key = dayFamilyKey(day.day_name) || day.day_name.toLowerCase();
    if (!buckets.has(key)) {
      order.push(key);
      buckets.set(key, []);
    }
    buckets.get(key)!.push(day);
  }

  return order.map((key) => ({
    key,
    label: dayFamilyLabel(key),
    days: buckets.get(key)!,
  }));
}
