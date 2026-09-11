import type { FoodFit } from "../../types";

export const BAND_COLORS: Record<FoodFit["band"], { fg: string; bg: string }> = {
  excellent: { fg: "#5EEAD4", bg: "rgba(94,234,212,0.12)" },
  good: { fg: "#FF6B35", bg: "rgba(255,107,53,0.12)" },
  fair: { fg: "#F5C542", bg: "rgba(245,197,66,0.12)" },
  poor: { fg: "#E4896B", bg: "rgba(228,137,107,0.12)" },
  trivial: { fg: "#7C8CA0", bg: "rgba(124,140,160,0.10)" },
};

export const BAND_LABELS: Record<FoodFit["band"], string> = {
  excellent: "Excellent fit",
  good: "Good fit",
  fair: "Fair fit",
  poor: "Poor fit",
  trivial: "Too small to score",
};

export function FitBadge({ fit, compact }: { fit?: FoodFit | null; compact?: boolean }) {
  if (!fit || fit.score === null) return null;
  const tone = BAND_COLORS[fit.band] || BAND_COLORS.trivial;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-bold"
      style={{ backgroundColor: tone.bg, color: tone.fg }}
    >
      {fit.score}
      {compact ? null : <span className="opacity-80 font-semibold">fit</span>}
    </span>
  );
}

export function FitReason({ fit }: { fit?: FoodFit | null }) {
  if (!fit?.reason || fit.band === "trivial") return null;
  return <p className="mt-0.5 text-[11px] text-[#7C8CA0]">{fit.reason}</p>;
}

export function DayFitSummary({
  score,
  band,
}: {
  score?: number | null;
  band?: FoodFit["band"] | null;
}) {
  if (score == null || !band) return null;
  const tone = BAND_COLORS[band] || BAND_COLORS.trivial;
  return (
    <div
      className="inline-flex items-baseline gap-1.5 self-start rounded-lg px-2.5 py-1.5"
      style={{ backgroundColor: tone.bg }}
    >
      <span className="text-xl font-extrabold" style={{ color: tone.fg }}>
        {score}
      </span>
      <span className="text-[11px] font-medium text-[#7C8CA0]">goal fit today</span>
    </div>
  );
}
