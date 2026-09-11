import { useCallback, useEffect, useState } from "react";
import { MdSchedule } from "react-icons/md";
import { getMealTiming, type MealTimingSummary } from "../../api/mealTiming";
import { displayMealLabel } from "../../lib/recentMeals";
import { formatDuration } from "../../lib/mealTiming";

const CONSISTENCY_COPY: Record<string, { label: string; color: string }> = {
  consistent: { label: "Same time daily", color: "#4ADE80" },
  variable: { label: "Varies", color: "#7C8CA0" },
  scattered: { label: "All over", color: "#E4896B" },
  unknown: { label: "Not enough days", color: "#55647A" },
};

/** Refetches whenever `refreshKey` changes — a move rewrites this data. */
export default function MealTimingCard({ refreshKey }: { refreshKey?: number }) {
  const [summary, setSummary] = useState<MealTimingSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setSummary(await getMealTiming(30));
    } catch {
      setError("Meal timing could not load. Refresh the page to try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  if (loading && !summary) {
    return (
      <div className="rounded-2xl border border-[#2A2D35] bg-[#161A22] p-5 text-sm text-[#8E8E93]">
        Loading meal timing…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-[#2A2D35] bg-[#161A22] p-5">
        <Header />
        <p className="mt-2 text-sm text-[#E4896B]" role="alert">
          {error}
        </p>
      </div>
    );
  }

  const slots = summary?.slots ?? [];
  if (!slots.length) {
    return (
      <div className="rounded-2xl border border-[#2A2D35] bg-[#161A22] p-5">
        <Header />
        <p className="mt-2 text-sm leading-6 text-[#8E8E93]">
          No meal times yet. Times record as you log — a day filled in afterwards is left out,
          since the log time says nothing about when you ate.
        </p>
      </div>
    );
  }

  const window = formatDuration(summary?.average_window_minutes);

  return (
    <div className="rounded-2xl border border-[#2A2D35] bg-[#161A22] p-5">
      <Header days={summary?.days_with_timing} />
      {window ? (
        <p className="mt-1 text-xs text-[#7C8CA0]">Typical eating window · {window}</p>
      ) : null}

      <div className="mt-4 space-y-3">
        {slots.map((slot) => {
          const consistency = CONSISTENCY_COPY[slot.consistency] || CONSISTENCY_COPY.unknown;
          const spread = formatDuration(slot.spread_minutes);
          return (
            <div key={slot.slot} className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-white">{displayMealLabel(slot.slot)}</p>
                <p className="truncate text-xs text-[#8E8E93]">
                  {slot.days_logged} {slot.days_logged === 1 ? "day" : "days"}
                  {slot.earliest_time && slot.latest_time && slot.spread_minutes > 0
                    ? ` · ${slot.earliest_time}–${slot.latest_time}`
                    : ""}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-sm font-bold text-white">
                  {slot.typical_time || slot.earliest_time || "—"}
                </p>
                <p className="text-[11px]" style={{ color: consistency.color }}>
                  {slot.typical_time && spread && slot.spread_minutes > 0
                    ? `${consistency.label} · ±${spread}`
                    : consistency.label}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {summary?.corrections?.length ? (
        <div className="mt-4 border-t border-[#2A2D35] pt-3">
          <p className="text-[10px] font-extrabold tracking-wider text-[#7C8CA0]">
            YOU KEEP MOVING
          </p>
          <ul className="mt-2 space-y-1 text-xs text-[#8E8E93]">
            {summary.corrections.slice(0, 4).map((c) => (
              <li key={`${c.from_slot}-${c.to_slot}`}>
                {displayMealLabel(c.from_slot)} → {displayMealLabel(c.to_slot)} · {c.count}×
                {c.foods?.length ? ` (${c.foods.slice(0, 2).join(", ")})` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function Header({ days }: { days?: number }) {
  return (
    <div className="flex items-center gap-2">
      <MdSchedule className="text-[#FF6B35]" size={18} />
      <p className="text-[11px] font-extrabold tracking-[0.14em] text-[#FF6B35]">MEAL TIMING</p>
      {days != null ? (
        <span className="text-[11px] text-[#7C8CA0]">{days} days with times</span>
      ) : null}
    </div>
  );
}
