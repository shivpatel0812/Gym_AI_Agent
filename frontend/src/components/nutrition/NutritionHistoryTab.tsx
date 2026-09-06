import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import apiClient from "../../api/client";
import {
  borderRadius,
  colors,
  macro,
  series as chartSeries,
  spacing,
  typography,
  weight,
} from "../../theme";
import ScrubbableLineChart from "../plan/ScrubbableLineChart";
import { type ChartPoint, formatShortDate, parseDate } from "../plan/chartUtils";

/**
 * Nutrition history — one composite day score over time.
 *
 * The line is not calories alone. Each day is scored against the plan
 * (protein first, then calories, then carbs/fats/fiber when targets exist).
 * Without a plan it falls back to protein density so the chart still works.
 */

type DailyRow = {
  date: string;
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
  fiber: number;
  score: number | null;
  band: string | null;
  score_source?: string;
  score_reason?: string;
  score_parts?: Record<string, number>;
};

type Targets = {
  calories?: number | null;
  protein?: number | null;
  carbs?: number | null;
  fats?: number | null;
  fiber?: number | null;
};

const RANGES = [
  { label: "2W", days: 14 },
  { label: "1M", days: 30 },
  { label: "3M", days: 90 },
] as const;

const MACRO_ROWS: { key: keyof DailyRow; label: string; color: string; unit: string }[] = [
  { key: "calories", label: "Calories", color: macro.calories, unit: "kcal" },
  { key: "protein", label: "Protein", color: macro.protein, unit: "g" },
  { key: "carbs", label: "Carbs", color: macro.carbs, unit: "g" },
  { key: "fats", label: "Fats", color: macro.fats, unit: "g" },
  { key: "fiber", label: "Fiber", color: macro.fiber, unit: "g" },
];

export default function NutritionHistoryTab() {
  const [days, setDays] = useState(30);
  const [series, setSeries] = useState<DailyRow[]>([]);
  const [targets, setTargets] = useState<Targets>({});
  const [scoring, setScoring] = useState<"plan" | "density">("density");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scrub, setScrub] = useState<ChartPoint | null>(null);

  const load = useCallback(async (horizon: number) => {
    setLoading(true);
    setError(null);
    setScrub(null);
    try {
      const res = await apiClient.get("/api/macros/daily", {
        params: { days: horizon },
      });
      setSeries(Array.isArray(res.data?.series) ? res.data.series : []);
      setTargets(res.data?.targets || {});
      setScoring(res.data?.scoring === "plan" ? "plan" : "density");
    } catch {
      setError("Could not load nutrition history.");
      setSeries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load(days);
    }, [days, load])
  );

  const points: ChartPoint[] = useMemo(
    () =>
      series
        .filter((row) => row.score != null)
        .map((row) => ({
          key: row.date,
          date: row.date,
          t: parseDate(row.date),
          value: row.score,
          scrubText: `${Math.round(row.score!)} · ${formatShortDate(row.date)}`,
          label: formatShortDate(row.date),
        })),
    [series]
  );

  const activeRow = useMemo(() => {
    if (!series.length) return null;
    if (scrub?.date) {
      return series.find((r) => r.date === scrub.date) ?? series[series.length - 1];
    }
    return series[series.length - 1];
  }, [series, scrub]);

  const avg =
    points.length > 0
      ? Math.round(
          points.reduce((sum, p) => sum + (p.value ?? 0), 0) / points.length
        )
      : null;

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.title}>History</Text>
      <Text style={styles.sub}>
        {scoring === "plan"
          ? "One score per day — protein, calories, carbs, fats, and fiber against your plan. Protein counts most."
          : "One score per day from protein density until you have a nutrition plan to score against."}
      </Text>

      <View style={styles.chipRow}>
        {RANGES.map((range) => {
          const on = range.days === days;
          return (
            <TouchableOpacity
              key={range.label}
              onPress={() => setDays(range.days)}
              style={[styles.chip, on && styles.chipOn]}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
            >
              <Text style={[styles.chipText, on && styles.chipTextOn]}>
                {range.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {loading && !series.length ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.accentPrimary} />
          <Text style={styles.muted}>Loading last {days} days…</Text>
        </View>
      ) : error ? (
        <View style={styles.errorCard}>
          <Text style={styles.errorText} accessibilityRole="alert">
            {error}
          </Text>
          <TouchableOpacity onPress={() => void load(days)} hitSlop={10}>
            <Text style={styles.retry}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : !points.length ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>
            No food logged in this range. Log a few days on Today and the line
            starts here.
          </Text>
        </View>
      ) : (
        <View style={styles.card}>
          <View style={styles.readout}>
            <Text style={styles.readoutValue}>
              {activeRow?.score != null ? Math.round(activeRow.score) : "—"}
            </Text>
            <Text style={styles.readoutLabel}>
              {activeRow?.band ? `${activeRow.band} · ` : ""}
              {activeRow?.date ? formatShortDate(activeRow.date) : "Day score"}
              {avg != null ? ` · avg ${avg}` : ""}
            </Text>
            {activeRow?.score_reason ? (
              <Text style={styles.readoutReason}>{activeRow.score_reason}</Text>
            ) : null}
          </View>

          <ScrubbableLineChart
            points={points}
            height={168}
            accent={chartSeries.mark}
            onScrub={setScrub}
          />

          {activeRow ? (
            <View style={styles.macroGrid}>
              <Text style={styles.macroHead}>THAT DAY</Text>
              {MACRO_ROWS.map((row) => {
                const value = activeRow[row.key];
                if (typeof value !== "number") return null;
                const target = targets[row.key as keyof Targets];
                return (
                  <View key={row.key} style={styles.macroRow}>
                    <View style={styles.macroLeft}>
                      <View style={[styles.swatch, { backgroundColor: row.color }]} />
                      <Text style={styles.macroLabel}>{row.label}</Text>
                    </View>
                    <Text style={styles.macroValue}>
                      {row.key === "calories" ? Math.round(value) : value.toFixed(0)}
                      {row.unit === "kcal" ? "" : row.unit}
                      {target != null && Number(target) > 0
                        ? ` / ${Math.round(Number(target))}`
                        : ""}
                    </Text>
                  </View>
                );
              })}
            </View>
          ) : null}

          <Text style={styles.footnote}>
            {scoring === "plan"
              ? "Score = how close the day landed to your targets. Protein 40 · calories 30 · carbs 15 · fats 10 · fiber 5 (missing targets drop out)."
              : "No calorie/protein targets on the plan — scoring protein per calorie until a plan is active."}{" "}
            {series.length} day{series.length === 1 ? "" : "s"} logged.
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing["2xl"],
  },
  title: {
    color: colors.textPrimary,
    fontSize: typography.display,
    fontWeight: weight.heavy,
  },
  sub: {
    color: colors.textMutedCool,
    fontSize: typography.caption,
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
    lineHeight: 18,
  },
  chipRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 36,
    justifyContent: "center",
    borderRadius: 999,
    backgroundColor: colors.cardBackground,
  },
  chipOn: { backgroundColor: colors.accentPrimary },
  chipText: {
    color: colors.textMutedCool,
    fontSize: typography.caption,
    fontWeight: weight.bold,
  },
  chipTextOn: { color: colors.onAccent },
  centered: {
    paddingVertical: spacing["2xl"],
    alignItems: "center",
    gap: spacing.sm,
  },
  muted: { color: colors.textMutedCool, fontSize: typography.caption },
  errorCard: {
    backgroundColor: colors.cardBackground,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  errorText: { color: colors.attention, fontSize: typography.body },
  retry: {
    color: colors.accentPrimary,
    fontSize: typography.caption,
    fontWeight: weight.bold,
  },
  empty: {
    backgroundColor: colors.cardBackground,
    borderRadius: borderRadius.lg,
    padding: spacing.xl,
  },
  emptyText: {
    color: colors.textFaintCool,
    fontSize: typography.caption,
    lineHeight: 18,
    textAlign: "center",
  },
  card: {
    backgroundColor: colors.cardBackground,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
  },
  readout: { marginBottom: spacing.md },
  readoutValue: {
    color: colors.textPrimary,
    fontSize: typography.display,
    fontWeight: weight.heavy,
  },
  readoutLabel: {
    color: colors.textMutedCool,
    fontSize: typography.caption,
    marginTop: spacing.xs,
  },
  readoutReason: {
    color: colors.textPrimary,
    fontSize: typography.caption,
    marginTop: spacing.xs,
    fontWeight: weight.medium,
  },
  macroGrid: {
    marginTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
  macroHead: {
    color: colors.textFaintCool,
    fontSize: typography.micro,
    fontWeight: weight.bold,
    letterSpacing: 1.2,
    marginBottom: spacing.xs,
  },
  macroRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.xs,
  },
  macroLeft: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  swatch: { width: 8, height: 8, borderRadius: 2 },
  macroLabel: {
    color: colors.textPrimary,
    fontSize: typography.caption,
    fontWeight: weight.medium,
  },
  macroValue: {
    color: colors.textMutedCool,
    fontSize: typography.caption,
    fontVariant: ["tabular-nums"],
  },
  footnote: {
    color: colors.textFaintCool,
    fontSize: typography.micro,
    marginTop: spacing.md,
    lineHeight: 15,
  },
});
