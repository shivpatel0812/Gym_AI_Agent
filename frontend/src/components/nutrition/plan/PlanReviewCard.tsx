import { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { PlanReview } from "../../../api/nutritionPlan";
import { colors, spacing, borderRadius } from "../../../theme";

interface Props {
  review: PlanReview | null;
  loading?: boolean;
  onRefresh?: () => void;
  /** Hands one improvement to the chat coach as a starting question. */
  onAskCoach?: (prompt: string) => void;
}

/**
 * The coach's read on the plan the user built.
 *
 * Deliberately not another list of meal ideas — this is the layer that says
 * "your anchors are right, and here is what would make them work harder".
 * Nothing here changes the plan; every improvement is something the user
 * chooses to act on, which is why each one carries a why and a how.
 */
export default function PlanReviewCard({ review, loading, onRefresh, onAskCoach }: Props) {
  // Collapsed by default — this is advisory, not an Accept queue.
  const [expanded, setExpanded] = useState(false);

  if (loading && !review) {
    return (
      <View style={styles.card}>
        <View style={styles.head}>
          <MaterialCommunityIcons name="clipboard-check-outline" size={16} color="#5EEAD4" />
          <Text style={styles.title}>Coach review</Text>
        </View>
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color="#5EEAD4" />
          <Text style={styles.loadingText}>Reading your plan…</Text>
        </View>
      </View>
    );
  }

  if (!review) return null;

  return (
    <View style={styles.card}>
      <TouchableOpacity style={styles.head} onPress={() => setExpanded((v) => !v)}>
        <MaterialCommunityIcons name="clipboard-check-outline" size={16} color="#5EEAD4" />
        <Text style={styles.title}>Coach review</Text>
        <View style={styles.headSpacer} />
        {onRefresh ? (
          <TouchableOpacity onPress={onRefresh} disabled={loading} hitSlop={8}>
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

      <Text style={styles.verdict} numberOfLines={expanded ? undefined : 2}>
        {review.verdict}
      </Text>

      {expanded ? (
        <>
          {review.working?.length ? (
            <View style={styles.block}>
              {review.working.map((line, i) => (
                <View key={`w-${i}`} style={styles.workingRow}>
                  <MaterialCommunityIcons name="check" size={13} color="#4ADE80" />
                  <Text style={styles.workingText}>{line}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {review.improvements?.length ? (
            <View style={styles.block}>
              <Text style={styles.blockLabel}>WOULD HELP MORE</Text>
              {review.improvements.map((item, i) => (
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
                          `About my nutrition plan — you suggested: ${item.title}. ${
                            item.how || ""
                          } Can you help me set that up?`
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

          <Text style={styles.foot}>
            Suggestions only — nothing here changes your plan until you do.
          </Text>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: "rgba(94,234,212,0.25)",
    backgroundColor: "rgba(94,234,212,0.06)",
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
    color: "#5EEAD4",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  verdict: { fontSize: 14, color: colors.textPrimary, lineHeight: 20, fontWeight: "600" },
  loadingRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  loadingText: { fontSize: 13, color: colors.textMuted },
  block: { gap: 6 },
  blockLabel: {
    fontSize: 10,
    fontWeight: "800",
    color: colors.textMuted,
    letterSpacing: 0.6,
    marginTop: 2,
  },
  workingRow: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  workingText: { flex: 1, fontSize: 13, color: colors.textSecondary, lineHeight: 18 },
  improvement: {
    borderLeftWidth: 2,
    borderLeftColor: "rgba(94,234,212,0.4)",
    paddingLeft: spacing.sm,
    gap: 2,
    marginTop: 2,
  },
  improvementTitle: { fontSize: 13, fontWeight: "700", color: colors.textPrimary },
  improvementBody: { fontSize: 12, color: colors.textSecondary, lineHeight: 17 },
  improvementHow: { color: colors.textMuted },
  ask: { fontSize: 12, fontWeight: "700", color: "#5EEAD4", marginTop: 3 },
  foot: { fontSize: 11, color: colors.textMuted, lineHeight: 15 },
});
