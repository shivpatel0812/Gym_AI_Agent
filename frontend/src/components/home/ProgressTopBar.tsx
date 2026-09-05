import { useCallback, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import {
  borderRadius,
  colors,
  series,
  spacing,
  typography,
  weight,
} from "../../theme";
import Sparkline from "./Sparkline";
import { getProgressSummary } from "../../api/progress";
import type { ProgressState, ProgressSummary } from "../../api/progress";

/**
 * The Home entry point into the progress hub.
 *
 * Deliberately quiet. It shows the level, what it is doing, and a line — not a
 * verdict. The states carry an icon and a word as well as a colour, so the bar
 * still reads on a bright screen and to a colour-blind user, and "Holding"
 * wears neutral ink because one light week is not a warning.
 *
 * It stays tappable in every state, including the cold-start one: a new user
 * with no index still gets to see what the hub will eventually tell them.
 */

const STATE_STYLE: Record<
  ProgressState,
  { color: string; icon: keyof typeof MaterialCommunityIcons.glyphMap }
> = {
  building: { color: colors.success, icon: "trending-up" },
  holding: { color: colors.textMutedCool, icon: "trending-neutral" },
  stalled: { color: colors.warning, icon: "minus-circle-outline" },
  declining: { color: colors.attention, icon: "trending-down" },
  unknown: { color: colors.textFaintCool, icon: "progress-clock" },
};

/**
 * The index closes once a week, so the bar does not refetch on every tab
 * switch. Home is the app's most-visited screen and `/summary` builds the full
 * hub behind it; without this gate, hopping to Nutrition and back would cost
 * four Firestore range queries to redraw a number that cannot have changed.
 */
const CACHE_TTL_MS = 15 * 60 * 1000;
let cached: { at: number; data: ProgressSummary } | null = null;

export default function ProgressTopBar() {
  const navigation = useNavigation<any>();
  const [summary, setSummary] = useState<ProgressSummary | null>(cached?.data ?? null);
  const [failed, setFailed] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
        setSummary(cached.data);
        setFailed(false);
        return;
      }
      void (async () => {
        try {
          const data = await getProgressSummary(8);
          cached = { at: Date.now(), data };
          if (active) {
            setSummary(data);
            setFailed(false);
          }
        } catch {
          // Keep the last good reading on screen if there is one — a stale
          // number with no claim of freshness beats blanking the bar.
          if (active) setFailed(true);
        }
      })();
      return () => {
        active = false;
      };
    }, [])
  );

  const open = () => navigation.navigate("ProgressHub");

  const state = summary ? STATE_STYLE[summary.index.state] : STATE_STYLE.unknown;
  const level = summary?.index.level;
  const spark = (summary?.spark ?? []).map((p) => ({
    label: "",
    value: p.level,
  }));
  const hasLine = spark.some((p) => p.value != null);

  return (
    <TouchableOpacity
      onPress={open}
      activeOpacity={0.8}
      style={styles.bar}
      accessibilityRole="button"
      accessibilityLabel={
        level != null
          ? `Progress index ${level.toFixed(0)}, ${summary?.index.state_label}. Open progress hub.`
          : "Open progress hub"
      }
    >
      <View style={styles.left}>
        <Text style={styles.label}>PROGRESS</Text>
        <View style={styles.valueRow}>
          <Text style={styles.value}>
            {level != null ? level.toFixed(0) : "—"}
          </Text>
          <MaterialCommunityIcons name={state.icon} size={14} color={state.color} />
          <Text style={[styles.state, { color: state.color }]}>
            {failed && !summary
              ? "Unavailable"
              : summary?.index.state_label ?? "Loading…"}
          </Text>
        </View>
      </View>

      <View style={styles.sparkWrap}>
        {hasLine ? (
          <Sparkline points={spark} color={series.mark} height={34} />
        ) : (
          <Text style={styles.hint} numberOfLines={2}>
            {failed && !summary
              ? "Tap to retry"
              : summary?.index.reason ?? ""}
          </Text>
        )}
      </View>

      <MaterialCommunityIcons
        name="chevron-right"
        size={22}
        color={colors.textFaintCool}
      />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 64,
    backgroundColor: colors.cardBackground,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.lg,
  },
  left: { minWidth: 96 },
  label: {
    color: colors.textFaintCool,
    fontSize: typography.micro,
    fontWeight: weight.bold,
    letterSpacing: 1.2,
  },
  valueRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginTop: 2,
  },
  value: {
    color: colors.textPrimary,
    fontSize: typography.display,
    fontWeight: weight.heavy,
  },
  state: { fontSize: typography.micro, fontWeight: weight.bold },
  sparkWrap: { flex: 1, justifyContent: "center" },
  hint: {
    color: colors.textFaintCool,
    fontSize: typography.micro,
    lineHeight: 14,
  },
});
