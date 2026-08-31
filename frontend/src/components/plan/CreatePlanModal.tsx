import { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import {
  PlanMode,
  PlanModeOption,
  TrainingPlan,
  getPlanModes,
  proposePlan,
  activatePlan,
  deletePlan,
} from "../../api/trainingPlan";
import { listConversations } from "../../api/conversations";
import apiClient from "../../api/client";
import PlanReviewContent from "./PlanReviewContent";
import { colors, spacing, borderRadius } from "../../theme";

interface Props {
  visible: boolean;
  onClose: () => void;
  onCreated: () => void;
  /** Pre-selects the conversation the goal was discussed in. */
  conversationId?: string | null;
  /** Hands the user back to Coach with a prompt to refine the draft. */
  onAdjustWithCoach?: (prompt: string) => void;
}

type Step = "setup" | "generating" | "review";

const FALLBACK_MODES: PlanModeOption[] = [
  {
    id: "follow_split",
    label: "Follow My Split",
    description:
      "Keep my workouts and exercises. Adjust order, goals, rep ranges and intensity only.",
  },
  {
    id: "adapt_split",
    label: "Adapt My Split",
    description:
      "Use my split as the foundation, but add, swap or reorganise where it helps the goal.",
  },
  {
    id: "build_for_me",
    label: "Build For Me",
    description:
      "Design the best program for my goal, using my history, equipment and schedule.",
  },
];

export default function CreatePlanModal({
  visible,
  onClose,
  onCreated,
  conversationId,
  onAdjustWithCoach,
}: Props) {
  const [step, setStep] = useState<Step>("setup");
  const [modes, setModes] = useState<PlanModeOption[]>(FALLBACK_MODES);
  const [mode, setMode] = useState<PlanMode>("adapt_split");
  // Whether the user actually opened the selector and chose. Sending the
  // default as though it were a choice overrode what they told the coach —
  // "keep my current structure" still produced an adapt-mode plan.
  const [modeChosen, setModeChosen] = useState(false);
  const [goalText, setGoalText] = useState("");
  const [selectedConversation, setSelectedConversation] = useState<string | null>(null);
  const [conversationTitle, setConversationTitle] = useState<string | null>(null);
  const [draft, setDraft] = useState<TrainingPlan | null>(null);
  const [hasSplit, setHasSplit] = useState(true);
  const [splits, setSplits] = useState<{ id: string; name: string }[]>([]);
  const [splitId, setSplitId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setStep("setup");
    setDraft(null);
    setGoalText("");
    setSelectedConversation(conversationId ?? null);

    getPlanModes()
      .then((m) => m.length && setModes(m))
      .catch(() => {});

    // Without a split there is nothing to "follow" or "adapt", so those modes
    // would produce a near-empty plan
    apiClient
      .get("/api/splits")
      .then((res) => {
        const list = Array.isArray(res.data) ? res.data : [];
        setSplits(list.map((s: any) => ({ id: s.id, name: s.name })));
        setHasSplit(list.length > 0);
        // Not a user choice — with no split there is nothing to follow.
        if (list.length === 0) setMode("build_for_me");
        else setSplitId(list[list.length - 1].id);
      })
      .catch(() => setHasSplit(true));

    if (!conversationId) {
      listConversations()
        .then((list) => {
          if (list.length) {
            setSelectedConversation(list[0].id);
            setConversationTitle(list[0].title);
          }
        })
        .catch(() => {});
    }
  }, [visible, conversationId]);

  const generate = async () => {
    if (!selectedConversation && !goalText.trim()) {
      Alert.alert(
        "Describe your goal",
        "Talk to your coach about a goal first, or type it here."
      );
      return;
    }
    setStep("generating");
    try {
      const { plan } = await proposePlan({
        conversationId: selectedConversation,
        splitId: mode === "build_for_me" ? null : splitId,
        planMode: modeChosen ? mode : null,
        goalStatement: goalText.trim() || undefined,
      });
      setDraft(plan);
      setStep("review");
    } catch (error: any) {
      console.error("Plan generation failed:", error);
      setStep("setup");
      Alert.alert(
        "Could not create plan",
        error?.response?.data?.detail || "Something went wrong. Please try again."
      );
    }
  };

  const confirm = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      await activatePlan(draft.id);
      onCreated();
    } catch (error) {
      console.error("Activation failed:", error);
      Alert.alert("Error", "Could not activate the plan.");
    } finally {
      setBusy(false);
    }
  };

  const discard = async () => {
    if (draft) {
      try {
        await deletePlan(draft.id);
      } catch (error) {
        console.error("Could not discard draft:", error);
      }
    }
    setDraft(null);
    setStep("setup");
  };

  const handleAdjustWithCoach = (prompt?: string) => {
    const message =
      prompt ||
      (draft
        ? `I want to adjust the draft plan "${draft.plan_name}". `
        : "I want to adjust this plan. ");
    if (onAdjustWithCoach) {
      onAdjustWithCoach(message);
      onClose();
      return;
    }
    Alert.alert(
      "Adjust with Coach",
      "Close this and ask your coach what you'd like to change, then generate again.",
      [
        { text: "Keep Reviewing", style: "cancel" },
        { text: "Discard & Close", style: "destructive", onPress: () => discard().then(onClose) },
      ]
    );
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, step === "review" && styles.sheetReview]}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>
              {step === "review" ? "Review Plan" : "Create Plan"}
            </Text>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={onClose}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <MaterialCommunityIcons name="close" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {step === "generating" ? (
            <View style={styles.generating}>
              <ActivityIndicator size="large" color={colors.accentPrimary} />
              <Text style={styles.generatingText}>Designing your program...</Text>
              <Text style={styles.generatingHint}>
                Using your goal, split, history and schedule
              </Text>
            </View>
          ) : step === "review" && draft ? (
            <>
              <ScrollView
                style={styles.body}
                contentContainerStyle={styles.bodyContent}
                showsVerticalScrollIndicator={false}
              >
                <PlanReviewContent
                  plan={draft}
                  modes={modes}
                  onEditRequest={handleAdjustWithCoach}
                />
              </ScrollView>

              <View style={styles.actions}>
                <TouchableOpacity
                  style={styles.adjustButton}
                  onPress={() => handleAdjustWithCoach()}
                  disabled={busy}
                >
                  <MaterialCommunityIcons
                    name="chat-processing-outline"
                    size={18}
                    color={colors.accentPrimary}
                  />
                  <Text style={styles.adjustButtonText}>Adjust with Coach</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.primaryButton}
                  onPress={confirm}
                  disabled={busy}
                >
                  {busy ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <>
                      <MaterialCommunityIcons name="check-circle" size={18} color="#fff" />
                      <Text style={styles.primaryButtonText}>Use This Plan</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <>
              <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
                <Text style={styles.subheading}>How much can the coach change?</Text>
                {!hasSplit ? (
                  <Text style={styles.warningNote}>
                    You don't have a workout split yet, so there's nothing to follow or adapt.
                    "Build For Me" will design a full program.
                  </Text>
                ) : null}
                {modes.map((option) => {
                  const selected = option.id === mode;
                  const disabled = !hasSplit && option.id !== "build_for_me";
                  return (
                    <TouchableOpacity
                      key={option.id}
                      style={[
                        styles.modeCard,
                        selected && styles.modeCardSelected,
                        disabled && styles.modeCardDisabled,
                      ]}
                      disabled={disabled}
                      onPress={() => {
                        setMode(option.id);
                        setModeChosen(true);
                      }}
                    >
                      <View style={styles.modeHeader}>
                        <MaterialCommunityIcons
                          name={selected ? "radiobox-marked" : "radiobox-blank"}
                          size={20}
                          color={selected ? colors.accentPrimary : colors.textMuted}
                        />
                        <Text
                          style={[styles.modeLabel, selected && styles.modeLabelSelected]}
                        >
                          {option.label}
                        </Text>
                      </View>
                      <Text style={styles.modeDescription}>{option.description}</Text>
                    </TouchableOpacity>
                  );
                })}

                {hasSplit && mode !== "build_for_me" && splits.length > 0 ? (
                  <>
                    <Text style={styles.subheading}>Base it on which split?</Text>
                    <View style={styles.splitRow}>
                      {splits.map((s) => {
                        const active = s.id === splitId;
                        return (
                          <TouchableOpacity
                            key={s.id}
                            style={[styles.splitChip, active && styles.splitChipActive]}
                            onPress={() => setSplitId(s.id)}
                          >
                            <Text
                              style={[
                                styles.splitChipText,
                                active && styles.splitChipTextActive,
                              ]}
                              numberOfLines={1}
                            >
                              {s.name}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </>
                ) : null}

                <Text style={styles.subheading}>
                  Goal{selectedConversation ? "" : " (required)"}
                </Text>
                {selectedConversation ? (
                  <Text style={styles.sourceNote}>
                    Using your recent coach conversation
                    {conversationTitle ? ` — "${conversationTitle}"` : ""}.
                  </Text>
                ) : (
                  <Text style={styles.sourceNote}>
                    No coach conversation found — describe your goal below.
                  </Text>
                )}
                <TextInput
                  style={styles.input}
                  value={goalText}
                  onChangeText={setGoalText}
                  placeholder={
                    selectedConversation
                      ? "Optional: add or refine the goal in your own words"
                      : "Describe what you want to achieve"
                  }
                  placeholderTextColor={colors.textMuted}
                  multiline
                  maxLength={400}
                />
              </ScrollView>

              <View style={styles.actions}>
                <TouchableOpacity style={styles.secondaryButton} onPress={onClose}>
                  <Text style={styles.secondaryButtonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.primaryButton} onPress={generate}>
                  <Text style={styles.primaryButtonText}>Generate Plan</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.75)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: borderRadius.xl,
    borderTopRightRadius: borderRadius.xl,
    maxHeight: "92%",
    paddingBottom: spacing.lg,
  },
  sheetReview: {
    maxHeight: "96%",
    height: "96%",
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  sheetTitle: { fontSize: 22, fontWeight: "700", color: colors.textPrimary },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#1C1C1E",
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  body: { flex: 1 },
  bodyContent: { padding: spacing.lg, paddingBottom: spacing["2xl"] },

  generating: {
    padding: spacing["3xl"],
    alignItems: "center",
    gap: spacing.md,
  },
  generatingText: { color: colors.textPrimary, fontSize: 16, fontWeight: "600" },
  generatingHint: { color: colors.textMuted, fontSize: 13, textAlign: "center" },

  subheading: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.textMuted,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    letterSpacing: 0.4,
  },
  modeCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    backgroundColor: colors.surface,
  },
  modeCardSelected: { borderColor: colors.accentPrimary },
  modeCardDisabled: { opacity: 0.4 },
  warningNote: {
    fontSize: 13,
    color: colors.warning,
    marginBottom: spacing.sm,
    lineHeight: 18,
  },
  modeHeader: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  modeLabel: { fontSize: 15, fontWeight: "600", color: colors.textSecondary },
  modeLabelSelected: { color: colors.textPrimary },
  modeDescription: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: spacing.xs,
    lineHeight: 18,
  },
  splitRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  splitChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    maxWidth: "100%",
  },
  splitChipActive: { borderColor: colors.accentPrimary },
  splitChipText: { color: colors.textSecondary, fontSize: 13, fontWeight: "600" },
  splitChipTextActive: { color: colors.textPrimary },
  sourceNote: { fontSize: 13, color: colors.textSecondary, marginBottom: spacing.sm },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    backgroundColor: colors.background,
    color: colors.textPrimary,
    padding: spacing.md,
    minHeight: 80,
    textAlignVertical: "top",
    fontSize: 14,
  },

  actions: {
    flexDirection: "row",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  secondaryButton: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
  },
  secondaryButtonText: { color: colors.textSecondary, fontWeight: "600", fontSize: 15 },
  adjustButton: {
    flex: 1,
    flexDirection: "row",
    gap: 6,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderRadius: borderRadius.md,
    borderWidth: 1.5,
    borderColor: colors.accentPrimary,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  adjustButtonText: {
    color: colors.accentPrimary,
    fontWeight: "700",
    fontSize: 13,
  },
  primaryButton: {
    flex: 1.15,
    flexDirection: "row",
    gap: 6,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderRadius: borderRadius.md,
    backgroundColor: colors.accentPrimary,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonText: { color: colors.onAccent, fontWeight: "700", fontSize: 14 },
});
