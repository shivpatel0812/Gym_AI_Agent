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
  spacing,
  typography,
  weight,
} from "../../theme";
import ScrubbableLineChart from "../plan/ScrubbableLineChart";
import { type ChartPoint, formatShortDate, parseDate } from "../plan/chartUtils";

/**
 * Nutrition history — one chart of daily totals.
 *
 * Lives under the Nutrition hub as a sibling of Today. Not Progress Hub: that
 * screen scores goal adherence weekly; this one is the raw day line.
 */

type DailyRow = {
  date: string;
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
  fiber: number;
};

type Metric = "calories" | "protein";

const RANGES = [
  { label: "2W", days: 14 },
  { label: "1M", days: 30 },
  { label: "3M", days: 90 },
] as const;

const METRICS: { key: Metric; label: string; unit: string; color: string }[] = [
  { key: "calories", label: "Calories", unit: "kcal", color: macro.calories },
  { key: "protein", label: "Protein", unit: "g", color: macro.protein },
];

export default function NutritionHistoryTab() {
  const [days, setDays] = useState(30);
  const [metric, setMetric] = useState<Metric>("calories");
  const [series, setSeries] = useState<DailyRow[]>([]);
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

  const meta = METRICS.find((m) => m.key === metric) ?? METRICS[0];

  const points: ChartPoint[] = useMemo(
    () =>
      series.map((row) => ({
        key: row.date,
        date: row.date,
        t: parseDate(row.date),
        value: row[metric],
        scrubText: `${Math.round(row[metric])}${meta.unit === "kcal" ? "" : meta.unit} · ${formatShortDate(row.date)}`,
        label: formatShortDate(row.date),
      })),
    [series, metric, meta.unit]
  );

  const latest = series.length ? series[series.length - 1] : null;
  const active = scrub?.value != null
    ? scrub
    : points.length
      ? points[points.length - 1]
      : null;

  const avg =
    series.length > 0
      ? Math.round(
          series.reduce((sum, row) => sum + row[metric], 0) / series.length
        )
      : null;

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.title}>History</Text>
      <Text style={styles.sub}>Daily totals for days you logged food.</Text>

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

      <View style={styles.chipRow}>
        {METRICS.map((m) => {
          const on = m.key === metric;
          return (
            <TouchableOpacity
              key={m.key}
              onPress={() => {
                setMetric(m.key);
                setScrub(null);
              }}
              style={[styles.chip, on && styles.chipOn]}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
            >
              <Text style={[styles.chipText, on && styles.chipTextOn]}>
                {m.label}
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
              {active?.value != null ? Math.round(active.value) : "—"}
              <Text style={styles.readoutUnit}>
                {meta.unit === "kcal" ? "" : ` ${meta.unit}`}
              </Text>
            </Text>
            <Text style={styles.readoutLabel}>
              {active?.date ? formatShortDate(active.date) : meta.label}
              {avg != null ? ` · avg ${avg}` : ""}
            </Text>
          </View>

          <ScrubbableLineChart
            points={points}
            height={168}
            accent={meta.color}
            unit={meta.unit === "kcal" ? undefined : meta.unit}
            onScrub={setScrub}
          />

          {latest ? (
            <Text style={styles.footnote}>
              {series.length} day{series.length === 1 ? "" : "s"} logged · last{" "}
              {formatShortDate(latest.date)}
            </Text>
          ) : null}
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
  readoutUnit: {
    color: colors.textMutedCool,
    fontSize: typography.title,
    fontWeight: weight.medium,
  },
  readoutLabel: {
    color: colors.textMutedCool,
    fontSize: typography.caption,
    marginTop: spacing.xs,
  },
  footnote: {
    color: colors.textFaintCool,
    fontSize: typography.micro,
    marginTop: spacing.md,
  },
});
