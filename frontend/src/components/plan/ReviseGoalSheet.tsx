import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import {
  setExerciseGoal,
  type ExerciseRole,
  type ProjectedExercise,
} from "../../api/trainingPlan";
import { borderRadius, colors, spacing } from "../../theme";

/**
 * Plan Mode, re-entered for a single lift.
 *
 * The spec asks for this to be guided rather than freeform: "Because it's a
 * guided flow, answers map directly to plan fields — no inference required."
 * Previously "Revise goal" dropped a sentence into the coach chat and hoped
 * the model turned it into the right structured change; a user flipping one
 * lift from building to maintaining had to argue for it in prose. These
 * answers are the plan fields, so they apply directly.
 */

const ROLES: { value: ExerciseRole; label: string; blurb: string }[] = [
  {
    value: "building",
    label: "Building",
    blurb: "Actively progressing — gets a goal, a target date and a progress bar.",
  },
  {
    value: "maintaining",
    label: "Maintaining",
    blurb: "Held on purpose. No goal shown, and a stall here is not a failure.",
  },
  {
    value: "support",
    label: "Support work",
    blurb: "Accessory. Just a rep range, no roadmap.",
  },
];

const GOALS = [
  { value: "strength", label: "Strength" },
  { value: "hypertrophy", label: "Size" },
  { value: "fat_loss", label: "Conditioning" },
  { value: "general", label: "General" },
];

const REP_RANGES: [number, number][] = [
  [3, 5],
  [4, 6],
  [6, 8],
  [8, 12],
  [10, 15],
  [12, 20],
];

function currentRole(exercise: ProjectedExercise): ExerciseRole {
  if (exercise.priority === "supporting") return "support";
  if (exercise.priority === "high") return "building";
  return "maintaining";
}

export default function ReviseGoalSheet({
  exercise,
  visible,
  onClose,
  onSaved,
}: {
  exercise: ProjectedExercise | null;
  visible: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [role, setRole] = useState<ExerciseRole | null>(null);
  const [goal, setGoal] = useState<string | null>(null);
  const [range, setRange] = useState<[number, number] | null>(null);
  const [saving, setSaving] = useState(false);

  if (!exercise) return null;

  const activeRole = role ?? currentRole(exercise);
  const activeGoal = goal ?? exercise.goal ?? null;
  const activeRange = range ?? exercise.target_rep_range ?? null;
  const dirty = role !== null || goal !== null || range !== null;

  const reset = () => {
    setRole(null);
    setGoal(null);
    setRange(null);
  };

  const close = () => {
    reset();
    onClose();
  };

  const save = async () => {
    setSaving(true);
    try {
      await setExerciseGoal({
        dayName: exercise.day_name,
        exerciseId: exercise.exercise_id,
        exerciseName: exercise.exercise_name,
        role: role ?? undefined,
        goal: goal ?? undefined,
        targetRepRange: range ?? undefined,
      });
      reset();
      onSaved();
      onClose();
    } catch (error: any) {
      console.error("Could not revise goal:", error);
      Alert.alert(
        "Could not save",
        error?.response?.data?.detail || "Please try again."
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={close}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.eyebrow}>PLAN MODE · ONE EXERCISE</Text>
              <Text style={styles.title}>{exercise.exercise_name}</Text>
            </View>
            <TouchableOpacity onPress={close} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <MaterialCommunityIcons name="close" size={22} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.body}>
            <Text style={styles.question}>What is this lift for right now?</Text>
            {ROLES.map((option) => {
              const selected = activeRole === option.value;
              return (
                <TouchableOpacity
                  key={option.value}
                  style={[styles.option, selected && styles.optionSelected]}
                  onPress={() => setRole(option.value)}
                >
                  <View style={styles.optionHead}>
                    <MaterialCommunityIcons
                      name={selected ? "radiobox-marked" : "radiobox-blank"}
                      size={18}
                      color={selected ? colors.accentPrimary : colors.textMuted}
                    />
                    <Text style={[styles.optionLabel, selected && styles.optionLabelSelected]}>
                      {option.label}
                    </Text>
                  </View>
                  <Text style={styles.optionBlurb}>{option.blurb}</Text>
                </TouchableOpacity>
              );
            })}

            {activeRole !== "support" ? (
              <>
                <Text style={styles.question}>What should it train?</Text>
                <View style={styles.chipRow}>
                  {GOALS.map((option) => {
                    const selected = activeGoal === option.value;
                    return (
                      <TouchableOpacity
                        key={option.value}
                        style={[styles.chip, selected && styles.chipSelected]}
                        onPress={() => setGoal(option.value)}
                      >
                        <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                          {option.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </>
            ) : null}

            <Text style={styles.question}>Rep range</Text>
            <View style={styles.chipRow}>
              {REP_RANGES.map((option) => {
                const selected =
                  activeRange?.[0] === option[0] && activeRange?.[1] === option[1];
                return (
                  <TouchableOpacity
                    key={option.join("-")}
                    style={[styles.chip, selected && styles.chipSelected]}
                    onPress={() => setRange(option)}
                  >
                    <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                      {option[0]}–{option[1]}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={styles.footnote}>
              This changes only {exercise.exercise_name} on {exercise.day_name}. The rest of
              your plan is untouched.
            </Text>
          </ScrollView>

          <View style={styles.actions}>
            <TouchableOpacity onPress={close} style={styles.cancel}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={save}
              style={[styles.save, (!dirty || saving) && styles.saveDisabled]}
              disabled={!dirty || saving}
            >
              {saving ? (
                <ActivityIndicator size="small" color={colors.onAccent} />
              ) : (
                <Text style={styles.saveText}>Save</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  sheet: {
    maxHeight: "88%",
    backgroundColor: colors.cardBackground,
    borderTopLeftRadius: borderRadius.lg,
    borderTopRightRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  eyebrow: { fontSize: 9, fontWeight: "900", letterSpacing: 1, color: colors.accentPrimary },
  title: { fontSize: 19, fontWeight: "800", color: colors.textPrimary, marginTop: 3 },
  body: { padding: spacing.lg, gap: 10 },
  question: { fontSize: 13, fontWeight: "800", color: colors.textPrimary, marginTop: 8 },
  option: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    padding: 13,
    gap: 5,
  },
  optionSelected: { borderColor: colors.accentPrimary },
  optionHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  optionLabel: { fontSize: 14, fontWeight: "700", color: colors.textSecondary },
  optionLabelSelected: { color: colors.textPrimary },
  optionBlurb: { fontSize: 11, lineHeight: 16, color: colors.textSecondary },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 99,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipSelected: { borderColor: colors.accentPrimary, backgroundColor: "rgba(156,192,232,.12)" },
  chipText: { fontSize: 12, fontWeight: "700", color: colors.textSecondary },
  chipTextSelected: { color: colors.accentPrimary },
  footnote: { fontSize: 11, lineHeight: 16, color: colors.textMuted, marginTop: 12 },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  cancel: { paddingHorizontal: 16, paddingVertical: 11 },
  cancelText: { fontSize: 13, fontWeight: "700", color: colors.textSecondary },
  save: {
    paddingHorizontal: 22,
    paddingVertical: 11,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.accentPrimary,
    minWidth: 84,
    alignItems: "center",
  },
  saveDisabled: { opacity: 0.45 },
  saveText: { fontSize: 13, fontWeight: "800", color: colors.onAccent },
});
