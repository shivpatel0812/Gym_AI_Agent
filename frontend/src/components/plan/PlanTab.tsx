import { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import CreatePlanModal from "./CreatePlanModal";
import PlanHub from "./PlanHub";
import ImportWorkoutModal from "./ImportWorkoutModal";
import {
  TrainingPlan,
  PlanProgress,
  getActivePlan,
  getPlanHistory,
  pausePlan,
  resumePlan,
  endPlan,
} from "../../api/trainingPlan";
import { colors, spacing, borderRadius } from "../../theme";

interface Props {
  /** Lets the Plan tab hand a question back to the Coach tab. */
  onAskCoach?: (prompt: string) => void;
  onOpenPlanMode?: (prompt: string) => void;
}

export default function PlanTab({ onAskCoach, onOpenPlanMode }: Props) {
  const [plan, setPlan] = useState<TrainingPlan | null>(null);
  const [progress, setProgress] = useState<PlanProgress | null>(null);
  const [history, setHistory] = useState<Partial<TrainingPlan>[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const [active, past] = await Promise.all([getActivePlan(), getPlanHistory()]);
      setPlan(active?.plan ?? null);
      setProgress(active?.progress ?? null);
      setHistory(past.filter((p) => p.status !== "active"));
    } catch (error) {
      console.error("Error loading plan:", error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const confirmAction = (title: string, message: string, action: () => Promise<void>) => {
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel" },
      {
        text: title,
        style: title === "End Plan" ? "destructive" : "default",
        onPress: async () => {
          try {
            await action();
            await load();
          } catch (error) {
            console.error(`${title} failed:`, error);
            Alert.alert("Error", `Could not ${title.toLowerCase()}.`);
          }
        },
      },
    ]);
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.accentPrimary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        stickyHeaderIndices={plan ? [1] : undefined}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
            tintColor={colors.accentPrimary}
          />
        }
      >
        {!plan ? (
          <View style={styles.emptyCard}>
            <MaterialCommunityIcons name="target" size={36} color={colors.accentPrimary} />
            <Text style={styles.emptyTitle}>No active plan</Text>
            <Text style={styles.emptyBody}>
              Talk to your AI Coach about a training goal, then create a plan from that
              conversation. Your workouts and recommendations will follow it automatically.
            </Text>
            <TouchableOpacity style={styles.primaryButton} onPress={() => setCreateOpen(true)}>
              <MaterialCommunityIcons name="auto-fix" size={18} color="#fff" />
              <Text style={styles.primaryButtonText}>Create Plan</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <View style={styles.statusRow}>
              <View
                style={[
                  styles.badge,
                  plan.status === "paused" ? styles.badgePaused : styles.badgeActive,
                ]}
              >
                <Text
                  style={[
                    styles.badgeText,
                    plan.status === "paused" ? styles.badgeTextPaused : styles.badgeTextActive,
                  ]}
                >
                  {plan.status === "paused" ? "PAUSED" : "ACTIVE"}
                </Text>
              </View>
              {progress?.current_week ? (
                <Text style={styles.weekText}>
                  Week {progress.current_week} of {progress.total_weeks}
                </Text>
              ) : null}
            </View>

            {/* Revising a lift must land in Plan Mode: that is the only chat
                mode allowed to stage a change against the plan, so sending it
                to ordinary coach chat produced advice the app could not act
                on. */}
            <PlanHub
              onEdit={onOpenPlanMode || onAskCoach}
              onImport={() => setImportOpen(true)}
            />

            <View style={styles.actionsCard}>
              <Text style={styles.actionsTitle}>Actions</Text>
              <ActionRow
                icon="chat-processing-outline"
                text="Ask Coach About Plan"
                onPress={() => onAskCoach?.(`About my active plan "${plan.plan_name}": `)}
              />
              <ActionRow
                icon="tune"
                text="Adjust Plan"
                onPress={() =>
                  onAskCoach?.(`I want to adjust my plan "${plan.plan_name}". `)
                }
              />
              {plan.status === "paused" ? (
                <ActionRow
                  icon="play-circle-outline"
                  text="Resume Plan"
                  onPress={() =>
                    confirmAction("Resume Plan", "Resume following this plan?", () =>
                      resumePlan(plan.id)
                    )
                  }
                />
              ) : (
                <ActionRow
                  icon="pause-circle-outline"
                  text="Pause Plan"
                  onPress={() =>
                    confirmAction(
                      "Pause Plan",
                      "Recommendations will fall back to your normal goal until you resume.",
                      () => pausePlan(plan.id)
                    )
                  }
                />
              )}
              <ActionRow
                icon="flag-checkered"
                text="End Plan"
                danger
                onPress={() =>
                  confirmAction(
                    "End Plan",
                    "This plan will move to your history. You can always create a new one.",
                    () => endPlan(plan.id)
                  )
                }
              />
              <ActionRow
                icon="plus-circle-outline"
                text="Create New Plan"
                onPress={() => setCreateOpen(true)}
              />
            </View>
          </>
        )}

        {history.length > 0 ? (
          <View style={styles.historyCard}>
            <Text style={styles.actionsTitle}>Past Plans</Text>
            {history.map((past) => (
              <View key={past.id} style={styles.historyRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.historyName}>{past.plan_name}</Text>
                  {past.primary_goal ? (
                    <Text style={styles.historyGoal} numberOfLines={1}>
                      {past.primary_goal}
                    </Text>
                  ) : null}
                </View>
                <Text style={styles.historyStatus}>{past.status}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>

      <CreatePlanModal
        visible={createOpen}
        onClose={() => setCreateOpen(false)}
        onAdjustWithCoach={(prompt) => {
          setCreateOpen(false);
          onAskCoach?.(prompt);
        }}
        onCreated={() => {
          setCreateOpen(false);
          load();
        }}
      />
      <ImportWorkoutModal
        visible={importOpen}
        planDays={plan?.days.map((day) => day.day_name) || []}
        onClose={() => setImportOpen(false)}
        onContinue={(prompt) => {
          setImportOpen(false);
          onOpenPlanMode?.(prompt);
        }}
      />
    </View>
  );
}

function ActionRow({
  icon,
  text,
  onPress,
  danger,
}: {
  icon: any;
  text: string;
  onPress: () => void;
  danger?: boolean;
}) {
  return (
    <TouchableOpacity style={styles.actionRow} onPress={onPress}>
      <MaterialCommunityIcons
        name={icon}
        size={20}
        color={danger ? colors.danger : colors.accentPrimary}
      />
      <Text style={[styles.actionText, danger && styles.actionTextDanger]}>{text}</Text>
      <MaterialCommunityIcons name="chevron-right" size={20} color={colors.textMuted} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background,
  },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.lg, paddingBottom: spacing["3xl"] },

  emptyCard: {
    backgroundColor: "#1C1C1E",
    borderRadius: borderRadius.xl,
    padding: spacing.xl,
    borderWidth: 1.5,
    borderColor: colors.accentPrimary,
    alignItems: "flex-start",
    gap: spacing.sm,
  },
  emptyTitle: { fontSize: 18, fontWeight: "700", color: colors.textPrimary, marginTop: spacing.sm },
  emptyBody: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 20,
    marginBottom: spacing.md,
  },
  primaryButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    backgroundColor: colors.accentPrimary,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: borderRadius.md,
    alignSelf: "stretch",
  },
  primaryButtonText: { color: colors.onAccent, fontWeight: "700", fontSize: 15 },

  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.md,
  },
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: borderRadius.sm,
  },
  badgeActive: { backgroundColor: "rgba(74,222,128,0.15)" },
  badgePaused: { backgroundColor: "rgba(245,158,11,0.15)" },
  badgeText: { fontSize: 11, fontWeight: "700", letterSpacing: 0.5 },
  badgeTextActive: { color: colors.success },
  badgeTextPaused: { color: colors.warning },
  weekText: { fontSize: 13, color: colors.textSecondary, fontWeight: "600" },

  actionsCard: {
    marginTop: spacing.xl,
    backgroundColor: "#1C1C1E",
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  actionsTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  actionText: { flex: 1, fontSize: 15, color: colors.textPrimary, fontWeight: "500" },
  actionTextDanger: { color: colors.danger },

  historyCard: {
    marginTop: spacing.lg,
    backgroundColor: "#1C1C1E",
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  historyRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  historyName: { fontSize: 14, color: colors.textPrimary, fontWeight: "600" },
  historyGoal: { fontSize: 12, color: colors.textMuted, marginTop: 1 },
  historyStatus: { fontSize: 11, color: colors.textMuted, textTransform: "uppercase" },
});
