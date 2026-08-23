import { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { PacingOption, PlanCheckin } from "../../../api/nutritionPlan";
import { colors, spacing, borderRadius } from "../../../theme";

interface Props {
  checkin: PlanCheckin | null;
  loading?: boolean;
  /** Re-read the last two weeks; pass a weigh-in when the user typed one. */
  onRefresh?: (opts?: { currentWeightLb?: number }) => void;
  /** Stage meal + recommended pacing edits from the findings. */
  onProposeEdits?: () => void;
  proposing?: boolean;
  /** Stage one pacing option for Accept. */
  onStagePacing?: (option: PacingOption) => void;
  stagingPacingId?: string | null;
  onAskCoach?: (prompt: string) => void;
}

const ACCENT = "#A78BFA";

const VERDICT_LABEL: Record<string, string> = {
  on_track: "On track",
  stall: "Stalled",
  too_fast: "Moving too fast",
  under_eating: "Under-eating",
  overshooting: "Overshooting",
  unknown: "Need more data",
};

/**
 * How the plan has actually been going, versus how it looks on paper.
 *
 * Progress + pacing options live here. Choosing an option only *stages* it —
 * the plan does not change until the user Accepts on the suggestion row.
 */
export default function PlanCheckinCard({
  checkin,
  loading,
  onRefresh,
  onProposeEdits,
  proposing,
  onStagePacing,
  stagingPacingId,
  onAskCoach,
}: Props) {
  const [expanded, setExpanded] = useState(true);
  const [weightDraft, setWeightDraft] = useState("");

  const runRefresh = () => {
    const n = parseFloat(weightDraft);
    onRefresh?.(
      Number.isFinite(n) && n > 0 ? { currentWeightLb: n } : undefined
    );
  };

  if (loading && !checkin) {
    return (
      <View style={styles.card}>
        <View style={styles.head}>
          <MaterialCommunityIcons name="history" size={16} color={ACCENT} />
          <Text style={styles.title}>Last 2 weeks</Text>
        </View>
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color={ACCENT} />
          <Text style={styles.loadingText}>Reading what you actually ate…</Text>
        </View>
      </View>
    );
  }

  if (!checkin) {
    if (!onRefresh) return null;
    return (
      <View style={styles.card}>
        <View style={styles.head}>
          <MaterialCommunityIcons name="history" size={16} color={ACCENT} />
          <Text style={styles.title}>Check how it is going</Text>
        </View>
        <Text style={styles.summary}>
          Compare the last two weeks of your logs against this plan. Add a weigh-in
          if you have one — that is what unlocks stall detection.
        </Text>
        <View style={styles.weighRow}>
          <TextInput
            style={styles.weighInput}
            placeholder="Weight (lb)"
            placeholderTextColor={colors.textMuted}
            keyboardType="decimal-pad"
            value={weightDraft}
            onChangeText={setWeightDraft}
          />
          <TouchableOpacity style={styles.weighBtn} onPress={runRefresh}>
            <Text style={styles.weighBtnText}>Check in</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const facts = checkin.facts;
  const progress = checkin.progress;
  const options = checkin.pacing_options || [];
  const stats = [
    facts?.days_logged != null ? `${facts.days_logged} days logged` : null,
    facts?.avg_calories ? `${facts.avg_calories} kcal avg` : null,
    progress?.weight_delta_lb != null
      ? `${progress.weight_delta_lb > 0 ? "+" : ""}${progress.weight_delta_lb} lb`
      : null,
  ].filter(Boolean);

  return (
    <View style={styles.card}>
      <TouchableOpacity style={styles.head} onPress={() => setExpanded((v) => !v)}>
        <MaterialCommunityIcons name="history" size={16} color={ACCENT} />
        <Text style={styles.title}>Last 2 weeks</Text>
        <View style={styles.headSpacer} />
        {onRefresh ? (
          <TouchableOpacity onPress={runRefresh} disabled={loading} hitSlop={8}>
            {loading ? (
              <ActivityIndicator size="small" color={colors.textMuted} />
            ) : (
              <MaterialCommunityIcons name="refresh" size={16} color={colors.textMuted} />
            )}
          </TouchableOpacity>
        ) : null}
        <MaterialCommunityIcons
          name={expanded ? "chevron-up" : "chevron-down"}
          size={18}
          color={colors.textMuted}
        />
      </TouchableOpacity>

      <Text style={styles.summary}>{checkin.summary}</Text>
      {stats.length ? <Text style={styles.stats}>{stats.join("  ·  ")}</Text> : null}

      {progress?.verdict ? (
        <View style={styles.verdictChip}>
          <Text style={styles.verdictLabel}>
            {VERDICT_LABEL[progress.verdict] || progress.verdict}
          </Text>
          {progress.reason ? (
            <Text style={styles.verdictReason}>{progress.reason}</Text>
          ) : null}
        </View>
      ) : null}

      {expanded ? (
        <>
          <View style={styles.weighRow}>
            <TextInput
              style={styles.weighInput}
              placeholder="Log weigh-in (lb)"
              placeholderTextColor={colors.textMuted}
              keyboardType="decimal-pad"
              value={weightDraft}
              onChangeText={setWeightDraft}
            />
            <TouchableOpacity style={styles.weighBtn} onPress={runRefresh} disabled={loading}>
              <Text style={styles.weighBtnText}>Save</Text>
            </TouchableOpacity>
          </View>

          {checkin.pacing?.label ? (
            <Text style={styles.pacingCurrent}>
              Current pacing: {checkin.pacing.label}
              {checkin.pacing.weekly_step
                ? ` · ${checkin.pacing.weekly_step > 0 ? "+" : ""}${checkin.pacing.weekly_step} kcal/wk`
                : ""}
            </Text>
          ) : null}

          {options.length ? (
            <View style={styles.block}>
              <Text style={styles.blockLabel}>PACING OPTIONS</Text>
              {options.map((opt) => {
                const busy = stagingPacingId === opt.id;
                return (
                  <View
                    key={opt.id}
                    style={[styles.optionCard, opt.recommended && styles.optionRecommended]}
                  >
                    <View style={styles.optionHead}>
                      <Text style={styles.optionTitle}>{opt.title}</Text>
                      {opt.recommended ? (
                        <Text style={styles.optionBadge}>Recommended</Text>
                      ) : null}
                    </View>
                    <Text style={styles.optionWhy}>{opt.why}</Text>
                    <Text style={styles.optionHow}>{opt.how}</Text>
                    {onStagePacing ? (
                      <TouchableOpacity
                        style={styles.optionBtn}
                        onPress={() => onStagePacing(opt)}
                        disabled={!!stagingPacingId}
                      >
                        {busy ? (
                          <ActivityIndicator size="small" color={ACCENT} />
                        ) : (
                          <Text style={styles.optionBtnText}>Review this change</Text>
                        )}
                      </TouchableOpacity>
                    ) : null}
                  </View>
                );
              })}
            </View>
          ) : null}

          {checkin.continue?.length ? (
            <View style={styles.block}>
              <Text style={styles.blockLabel}>KEEP DOING</Text>
              {checkin.continue.map((line, i) => (
                <View key={`c-${i}`} style={styles.workingRow}>
                  <MaterialCommunityIcons name="check" size={13} color="#4ADE80" />
                  <Text style={styles.workingText}>{line}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {checkin.improve?.length ? (
            <View style={styles.block}>
              <Text style={styles.blockLabel}>WORTH CHANGING</Text>
              {checkin.improve.map((item, i) => (
                <View key={`i-${i}`} style={styles.improvement}>
                  <Text style={styles.improvementTitle}>{item.title}</Text>
                  {item.why ? <Text style={styles.improvementBody}>{item.why}</Text> : null}
                  {item.how ? (
                    <Text style={[styles.improvementBody, styles.improvementHow]}>{item.how}</Text>
                  ) : null}
                  {onAskCoach ? (
                    <TouchableOpacity
                      onPress={() =>
                        onAskCoach(
                          `Looking at my last two weeks — ${item.title}. ${
                            item.how || ""
                          } Can you help me fix that in my plan?`
                        )
                      }
                    >
                      <Text style={styles.ask}>Ask the coach about this</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              ))}
            </View>
          ) : null}

          {onProposeEdits && checkin.can_propose_edits ? (
            <TouchableOpacity
              style={styles.proposeBtn}
              onPress={onProposeEdits}
              disabled={proposing}
              activeOpacity={0.85}
            >
              {proposing ? (
                <ActivityIndicator size="small" color={ACCENT} />
              ) : (
                <MaterialCommunityIcons name="auto-fix" size={15} color={ACCENT} />
              )}
              <Text style={styles.proposeText}>
                {proposing ? "Working out the changes…" : "Turn this into plan changes"}
              </Text>
            </TouchableOpacity>
          ) : null}

          <Text style={styles.foot}>
            Suggestions only — nothing changes your plan until you Accept.
          </Text>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: "rgba(167,139,250,0.28)",
    backgroundColor: "rgba(167,139,250,0.06)",
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  head: { flexDirection: "row", alignItems: "center", gap: 6 },
  headSpacer: { flex: 1 },
  title: {
    fontSize: 11,
    fontWeight: "800",
    color: ACCENT,
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  summary: { fontSize: 14, color: colors.textPrimary, lineHeight: 20, fontWeight: "600" },
  stats: { fontSize: 11, color: colors.textMuted, fontWeight: "700" },
  loadingRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  loadingText: { fontSize: 13, color: colors.textMuted },
  weighRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  weighInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: "rgba(167,139,250,0.35)",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: "600",
  },
  weighBtn: {
    borderRadius: 999,
    backgroundColor: "rgba(167,139,250,0.2)",
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  weighBtnText: { color: ACCENT, fontWeight: "800", fontSize: 12 },
  verdictChip: {
    borderLeftWidth: 2,
    borderLeftColor: ACCENT,
    paddingLeft: spacing.sm,
    gap: 2,
  },
  verdictLabel: { fontSize: 12, fontWeight: "800", color: ACCENT, textTransform: "uppercase" },
  verdictReason: { fontSize: 12, color: colors.textSecondary, lineHeight: 17 },
  pacingCurrent: { fontSize: 11, color: colors.textMuted, fontWeight: "700" },
  block: { gap: 6 },
  blockLabel: {
    fontSize: 10,
    fontWeight: "800",
    color: colors.textMuted,
    letterSpacing: 0.6,
    marginTop: 2,
  },
  optionCard: {
    borderWidth: 1,
    borderColor: "rgba(167,139,250,0.25)",
    borderRadius: 12,
    padding: 10,
    gap: 4,
  },
  optionRecommended: {
    borderColor: "rgba(167,139,250,0.55)",
    backgroundColor: "rgba(167,139,250,0.08)",
  },
  optionHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  optionTitle: { flex: 1, fontSize: 13, fontWeight: "800", color: colors.textPrimary },
  optionBadge: { fontSize: 9, fontWeight: "800", color: ACCENT, textTransform: "uppercase" },
  optionWhy: { fontSize: 12, color: colors.textSecondary, lineHeight: 16 },
  optionHow: { fontSize: 12, color: colors.textMuted, lineHeight: 16 },
  optionBtn: {
    marginTop: 4,
    alignSelf: "flex-start",
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(167,139,250,0.5)",
  },
  optionBtnText: { fontSize: 12, fontWeight: "800", color: ACCENT },
  workingRow: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  workingText: { flex: 1, fontSize: 13, color: colors.textSecondary, lineHeight: 18 },
  improvement: {
    borderLeftWidth: 2,
    borderLeftColor: "rgba(167,139,250,0.45)",
    paddingLeft: spacing.sm,
    gap: 2,
    marginTop: 2,
  },
  improvementTitle: { fontSize: 13, fontWeight: "700", color: colors.textPrimary },
  improvementBody: { fontSize: 12, color: colors.textSecondary, lineHeight: 17 },
  improvementHow: { color: colors.textMuted },
  ask: { fontSize: 12, fontWeight: "700", color: ACCENT, marginTop: 3 },
  proposeBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: "rgba(167,139,250,0.5)",
    borderRadius: 999,
    paddingVertical: 10,
    marginTop: 2,
  },
  proposeText: { fontSize: 13, fontWeight: "800", color: ACCENT },
  foot: { fontSize: 11, color: colors.textMuted, lineHeight: 15 },
});
