/** YYYY-MM-DD on the browser's calendar, without converting through UTC. */
export function localDateKey(value: Date = new Date()): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * "Thu, Jan 2 2026" from a YYYY-MM-DD key.
 *
 * Parsed as local noon, not `new Date("2026-01-02")` — that is read as UTC
 * midnight and renders as the previous day for anyone west of Greenwich,
 * which is the whole point of this file.
 */
export function formatDateKey(key: string): string {
  const parts = String(key || "").slice(0, 10).split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return key;
  const [year, month, day] = parts;
  return new Date(year, month - 1, day, 12).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
