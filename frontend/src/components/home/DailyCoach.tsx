import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import apiClient from "../../api/client";
import { colors, spacing } from "../../theme";

export type CoachAction = "workout" | "nutrition" | "water" | "wellness" | "routine";
type Brief = {
  date: string; title: string; summary: string; yesterday: string; source: "ai" | "rules";
  generated_at: string; unavailable: string[]; based_on: string[];
  context_coverage?: { previous_week_start: string; previous_week_end: string; history_through?: string;
    sources: Record<string, { status: string; days_logged?: number }> };
  targets: Record<string, number | null>; totals: Record<string, number | null>;
  priorities: { id: string; title: string; detail: string; action: CoachAction }[];
};
const labels: Record<CoachAction, string> = { workout: "Open workout", nutrition: "Open nutrition", water: "View water log", wellness: "Check in", routine: "View routines" };

export default function DailyCoach({ date, revision, onAction }: {
  date: string; revision: number; onAction: (action: CoachAction) => void;
}) {
  const [brief, setBrief] = useState<Brief | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const generation = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const load = useCallback(async (refresh = false) => {
    const seq = ++generation.current;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true); setError(false);
    try {
      const res = await apiClient.get<Brief>("/api/daily-coach", { params: { refresh }, timeout: 45000, signal: controller.signal });
      if (seq !== generation.current) return;
      if (res.data.date !== date) throw new Error("Coach date does not match device date");
      setBrief(res.data);
    } catch {
      if (seq === generation.current) setError(true);
    } finally {
      if (seq === generation.current) setBusy(false);
    }
  }, [date]);
  useFocusEffect(useCallback(() => {
    // Wait for a burst of successful logs to settle before generating again.
    const timer = setTimeout(() => void load(), 800);
    return () => { clearTimeout(timer); generation.current++; abort.current?.abort(); };
  }, [load, revision]));
  const current = brief?.date === date ? brief : null;
  return <View style={styles.card} testID="daily-coach">
    <View style={styles.row}>
      <MaterialCommunityIcons name="auto-fix" size={20} color={colors.ai} />
      <Text style={styles.label}>YOUR DAILY COACH</Text>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Refresh daily coach" disabled={busy} onPress={() => void load(true)} style={styles.refresh}>
        {busy ? <ActivityIndicator size="small" color={colors.ai} /> : <MaterialCommunityIcons name="refresh" size={20} color={colors.ai} />}
      </TouchableOpacity>
    </View>
    {error ? <Text style={styles.error} accessibilityRole="alert">{current ? "This briefing may be out of date. Tap refresh to try again." : "Your coach couldn’t load. Tap refresh to try again."}</Text> : null}
    {!current && !error ? <Text style={styles.body}>Connecting yesterday’s logs with today’s meals, training and routines…</Text> : null}
    {current ? <>
      {expanded ? <Text style={styles.title}>{current.title}</Text> : null}
      <Text style={styles.body} numberOfLines={expanded ? undefined : 3}>{current.summary}</Text>
      {!expanded ? <Text style={styles.targetValue}>{(["calories", "protein", "water"] as const)
        .filter(key => current.targets[key] != null && current.targets[key]! > 0)
        .map(key => `${current.targets[key]} ${key === "calories" ? "kcal" : key === "protein" ? "g protein" : "cups water"}`)
        .join(" · ")}</Text> : null}
      {expanded ? <>
      <View style={styles.targets}>
        {(["calories", "protein", "water"] as const).map(key => {
          const target = current.targets[key];
          if (target == null || target <= 0) return null;
          const unit = key === "calories" ? "kcal" : key === "protein" ? "g protein" : "cups water";
          const logged = current.totals[key];
          return <View key={key} style={styles.target}>
            <Text style={styles.targetValue}>{target} {unit}</Text>
            <Text style={styles.meta}>{logged == null ? "No log yet" : `${logged} logged so far`}</Text>
          </View>;
        })}
      </View>
      <Text style={styles.section}>FROM YESTERDAY</Text>
      <Text style={styles.body}>{current.yesterday}</Text>
      <Text style={styles.section}>TODAY’S PRIORITIES</Text>
      {current.priorities.map((item, index) => <TouchableOpacity key={`${item.id}-${index}`} style={styles.priority}
        accessibilityRole="button" accessibilityLabel={`${item.title}. ${labels[item.action]}`} onPress={() => onAction(item.action)}>
        <Text style={styles.priorityTitle}>{item.title}</Text>
        <Text style={styles.body}>{item.detail}</Text>
        <Text style={styles.link}>{labels[item.action]} →</Text>
      </TouchableOpacity>)}
      </> : null}
      <TouchableOpacity accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded(v => !v)}>
        <Text style={styles.link}>{expanded ? "Show less" : "View today’s briefing →"}</Text>
      </TouchableOpacity>
      {expanded && current.context_coverage ? <View style={{ gap: 5 }}>
        <Text style={styles.section}>CONTEXT REVIEWED</Text>
        <Text style={styles.meta}>Previous 7 days: {current.context_coverage.previous_week_start} – {current.context_coverage.previous_week_end}</Text>
        {current.context_coverage.history_through ? <Text style={styles.meta}>Older history summarized through {current.context_coverage.history_through}</Text> : null}
        {Object.entries(current.context_coverage.sources).map(([name, coverage]) => <Text key={name} style={styles.meta}>
          {name.replace(/_/g, " ")}: {coverage.status === "unavailable" ? "could not load" : `${coverage.days_logged ?? 0} days logged last week`}
        </Text>)}
      </View> : null}
      {expanded ? <Text style={styles.meta}>Based on: {current.based_on.join(" · ")}.{current.unavailable.length ? ` Could not read: ${current.unavailable.map(s => s.replace(/_/g, " ")).join(", ")}.` : ""}</Text> : null}
      {expanded ? <Text style={styles.meta}>{current.source === "ai" ? "AI suggestions" : "Plan & log summary · AI briefing unavailable"} · Updated {new Date(current.generated_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</Text> : null}
    </> : null}
  </View>;
}
const styles = StyleSheet.create({
  card: { backgroundColor: colors.cardBackground, borderWidth: 1, borderColor: colors.borderCool, borderRadius: 18, padding: spacing.lg, gap: 12, marginBottom: spacing.lg },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  label: { color: colors.ai, fontSize: 11, fontWeight: "800", letterSpacing: 1, flex: 1 },
  refresh: { padding: 10 },
  title: { color: colors.textPrimary, fontSize: 21, fontWeight: "700" },
  body: { color: colors.textSecondary, fontSize: 14, lineHeight: 21 },
  section: { color: colors.textMutedCool, fontSize: 10, fontWeight: "800", letterSpacing: 1, marginTop: 6 },
  targets: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  target: { backgroundColor: colors.surface, padding: 10, borderRadius: 10, gap: 4 },
  targetValue: { color: colors.accentPrimary, fontSize: 12, fontWeight: "700" },
  priority: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12, gap: 5 },
  priorityTitle: { color: colors.textPrimary, fontSize: 15, fontWeight: "600" },
  link: { color: colors.accentPrimary, fontSize: 12, fontWeight: "600", paddingVertical: 7 },
  meta: { color: colors.textMutedCool, fontSize: 11, lineHeight: 17 },
  error: { color: colors.attention, fontSize: 13, lineHeight: 19 },
});
