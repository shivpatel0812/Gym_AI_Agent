/**
 * When this user actually eats.
 *
 * Every figure here is withheld until it is evidence: a slot with fewer than
 * three timed days shows its range and no "typical" time, a day filled in
 * after the fact contributes nothing, and a user who has only just started
 * logging gets a sentence saying so rather than a clock built from one meal.
 *
 * Reads `GET /api/macros/meal-timing`; the rules live in
 * `backend/nutrition/meal_timing.py`.
 */

import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import {
  borderRadius,
  colors,
  spacing,
  typography,
  weight,
} from "../../theme";
import { getMealTiming, type MealTimingSummary } from "../../api/mealTiming";
import { displayMealLabel } from "../../lib/recentMeals";
import { formatDuration } from "../../lib/mealTiming";

const CONSISTENCY_COPY: Record<string, { label: string; color: string }> = {
  consistent: { label: "Same time daily", color: colors.success },
  variable: { label: "Varies", color: colors.textMutedCool },
  scattered: { label: "All over", color: colors.attention },
  unknown: { label: "Not enough days", color: colors.textFaintCool },
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
      // Silence here would leave the card looking permanently empty.
      setError("Meal timing could not load. Pull down to refresh.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  if (loading && !summary) {
    return (
      <View style={[styles.card, styles.centered]}>
        <ActivityIndicator size="small" color={colors.accentPrimary} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.card}>
        <Header />
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      </View>
    );
  }

  const slots = summary?.slots ?? [];
  if (!slots.length) {
    return (
      <View style={styles.card}>
        <Header />
        <Text style={styles.empty}>
          No meal times yet. Times record as you log — a day filled in
          afterwards is left out, since the log time says nothing about when you
          ate.
        </Text>
      </View>
    );
  }

  const window = formatDuration(summary?.average_window_minutes);

  return (
    <View style={styles.card}>
      <Header days={summary?.days_with_timing} />

      {slots.map((slot) => {
        const consistency = CONSISTENCY_COPY[slot.consistency] || CONSISTENCY_COPY.unknown;
        const spread = formatDuration(slot.spread_minutes);
        return (
          <View key={slot.slot} style={styles.row}>
            <View style={styles.rowMain}>
              <Text style={styles.slot}>{displayMealLabel(slot.slot)}</Text>
              <Text style={styles.detail} numberOfLines={1}>
                {slot.days_logged} {slot.days_logged === 1 ? "day" : "days"}
                {slot.earliest_time && slot.latest_time && slot.spread_minutes > 0
                  ? ` · ${slot.earliest_time}–${slot.latest_time}`
                  : ""}
              </Text>
            </View>
            <View style={styles.rowRight}>
              {slot.typical_time ? (
                <Text style={styles.time}>{slot.typical_time}</Text>
              ) : (
                <Text style={styles.timeUnknown}>
                  {slot.earliest_time || "—"}
                </Text>
              )}
              <Text style={[styles.consistency, { color: consistency.color }]}>
                {slot.typical_time && spread && slot.spread_minutes > 0
                  ? `${consistency.label} · ±${spread}`
                  : consistency.label}
              </Text>
            </View>
          </View>
        );
      })}

      {window ? (
        <View style={styles.footer}>
          <MaterialCommunityIcons
            name="clock-outline"
            size={13}
            color={colors.textMutedCool}
          />
          <Text style={styles.footerText}>
            Typical eating window {window}, first bite to last.
          </Text>
        </View>
      ) : null}

      {(summary?.corrections ?? [])
        .filter((c) => c.count > 1)
        .slice(0, 2)
        .map((correction) => (
          <View
            key={`${correction.from_slot}-${correction.to_slot}`}
            style={styles.footer}
          >
            <MaterialCommunityIcons
              name="swap-horizontal"
              size={13}
              color={colors.attention}
            />
            <Text style={styles.footerText}>
              You moved {correction.count} logs out of{" "}
              {displayMealLabel(correction.from_slot)} into{" "}
              {displayMealLabel(correction.to_slot)}
              {correction.foods.length ? ` (${correction.foods.join(", ")})` : ""}.
            </Text>
          </View>
        ))}
    </View>
  );
}

function Header({ days }: { days?: number }) {
  return (
    <View style={styles.head}>
      <Text style={styles.title}>Meal timing</Text>
      <Text style={styles.sub}>
        {days ? `${days} ${days === 1 ? "day" : "days"} timed` : "Last 30 days"}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.cardBackground,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  centered: { alignItems: "center", justifyContent: "center", minHeight: 96 },
  head: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginBottom: spacing.xs,
  },
  title: {
    color: colors.textPrimary,
    fontSize: typography.title,
    fontWeight: weight.bold,
  },
  sub: { color: colors.textFaintCool, fontSize: typography.caption },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  rowMain: { flex: 1, minWidth: 0, gap: 2 },
  rowRight: { alignItems: "flex-end", gap: 2 },
  slot: {
    color: colors.textPrimary,
    fontSize: typography.body,
    fontWeight: weight.medium,
  },
  detail: { color: colors.textFaintCool, fontSize: typography.caption },
  time: {
    color: colors.accentPrimary,
    fontSize: typography.title,
    fontWeight: weight.bold,
  },
  timeUnknown: {
    color: colors.textMutedCool,
    fontSize: typography.body,
    fontWeight: weight.medium,
  },
  consistency: { fontSize: typography.micro, fontWeight: weight.medium },
  footer: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    paddingTop: spacing.sm,
  },
  footerText: {
    flex: 1,
    color: colors.textMutedCool,
    fontSize: typography.caption,
    lineHeight: 17,
  },
  empty: {
    color: colors.textMutedCool,
    fontSize: typography.caption,
    lineHeight: 18,
  },
  error: { color: colors.danger, fontSize: typography.caption },
});
