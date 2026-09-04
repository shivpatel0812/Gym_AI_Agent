/**
 * The goal-fit badge on a logged food.
 *
 * Colour carries the band, but never alone — the score sits next to it, and
 * the reason is a real sentence rather than a tooltip. A user who cannot tell
 * the amber from the green still gets the whole message.
 *
 * Deliberately not red/green "good food / bad food". These are muted, and the
 * copy is always about fit against the plan, because the same dal is a good
 * fit on a bulk and a mediocre one on a cut.
 */

import { View, Text, StyleSheet } from "react-native";
import { colors, macro, typography, weight } from "../../theme";
import type { FoodFit } from "./types";

export const BAND_COLORS: Record<FoodFit["band"], { fg: string; bg: string }> = {
  excellent: { fg: colors.ai, bg: "rgba(94,234,212,0.12)" },
  good: { fg: colors.accentPrimary, bg: "rgba(156,192,232,0.12)" },
  fair: { fg: macro.carbs, bg: "rgba(245,197,66,0.12)" },
  poor: { fg: colors.attention, bg: "rgba(228,137,107,0.12)" },
  trivial: { fg: colors.textMutedCool, bg: "rgba(124,140,160,0.10)" },
};

/** Plain-language name for a band, for surfaces with room for words. */
export const BAND_LABELS: Record<FoodFit["band"], string> = {
  excellent: "Excellent fit",
  good: "Good fit",
  fair: "Fair fit",
  poor: "Poor fit",
  trivial: "Too small to score",
};

export function FitBadge({ fit, compact }: { fit?: FoodFit | null; compact?: boolean }) {
  // No plan target means no score. Showing a placeholder would imply the
  // number exists and is merely hidden.
  if (!fit || fit.score === null) return null;

  const tone = BAND_COLORS[fit.band] || BAND_COLORS.trivial;
  return (
    <View style={[s.badge, { backgroundColor: tone.bg }]}>
      <Text style={[s.score, { color: tone.fg }]}>{fit.score}</Text>
      {compact ? null : <Text style={[s.band, { color: tone.fg }]}>fit</Text>}
    </View>
  );
}

export function FitReason({ fit }: { fit?: FoodFit | null }) {
  if (!fit?.reason || fit.band === "trivial") return null;
  return <Text style={s.reason}>{fit.reason}</Text>;
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
    <View style={[s.dayPill, { backgroundColor: tone.bg }]}>
      <Text style={[s.dayScore, { color: tone.fg }]}>{score}</Text>
      <Text style={s.dayLabel}>goal fit today</Text>
    </View>
  );
}

const s = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  score: { fontSize: typography.micro, fontWeight: weight.heavy },
  band: { fontSize: typography.micro, fontWeight: weight.bold, opacity: 0.8 },
  reason: {
    color: colors.textMutedCool,
    fontSize: typography.caption,
    marginTop: 2,
  },
  dayPill: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    alignSelf: "flex-start",
  },
  dayScore: { fontSize: typography.title, fontWeight: weight.heavy },
  dayLabel: {
    color: colors.textMutedCool,
    fontSize: typography.caption,
    fontWeight: weight.medium,
  },
});
