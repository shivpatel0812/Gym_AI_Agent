import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import {
  borderRadius,
  colors,
  spacing,
  typography,
  weight,
} from "../../theme";
import {
  createGoal,
  deleteGoal,
  setGoalStatus,
} from "../../api/progress";
import type { Goal, GoalKind, Position } from "../../api/progress";

/**
 * Goals, and the coach's proposals waiting to become goals.
 *
 * `on_track` is tri-state and rendered as three different things, never as a
 * pass/fail: true, false, and "not enough yet to say". Collapsing null into
 * "behind" would tell someone two weeks into an eight-week goal that they are
 * failing, off two data points.
 *
 * A coach-proposed goal is shown as pending until the user accepts it. A goal
 * nobody agreed to is not their goal, and being measured against one they did
 * not choose is the thing to avoid.
 */

const KIND_OPTIONS: { kind: GoalKind; label: string; unit: string; hint: string }[] = [
  { kind: "exercise_e1rm", label: "A lift", unit: "lb", hint: "Estimated 1RM to reach" },
  { kind: "bodyweight", label: "Bodyweight", unit: "lb", hint: "Weight to reach" },
  { kind: "index_level", label: "Progress index", unit: "", hint: "Index level to reach" },
  { kind: "sessions_per_week", label: "Consistency", unit: "/wk", hint: "Sessions per week" },
];

function trackStyle(goal: Goal): {
  color: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  text: string;
} {
  if (goal.status === "achieved")
    return { color: colors.success, icon: "check-circle-outline", text: "Reached" };
  if (goal.on_track === true)
    return { color: colors.success, icon: "trending-up", text: "On pace" };
  if (goal.on_track === false)
    return { color: colors.attention, icon: "trending-down", text: "Behind pace" };
  return { color: colors.textMutedCool, icon: "progress-clock", text: "Too early to say" };
}

export default function GoalsSection({
  goals,
  positions,
  onChanged,
}: {
  goals: Goal[];
  positions: Position[];
  onChanged: () => void;
}) {
  const [composing, setComposing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [kind, setKind] = useState<GoalKind>("exercise_e1rm");
  const [exerciseId, setExerciseId] = useState<string | null>(
    positions[0]?.exercise_id ?? null
  );
  const [target, setTarget] = useState("");
  const [targetDate, setTargetDate] = useState("");

  const reset = () => {
    setKind("exercise_e1rm");
    setExerciseId(positions[0]?.exercise_id ?? null);
    setTarget("");
    setTargetDate("");
    setError(null);
  };

  const submit = useCallback(async () => {
    const value = Number(target);
    if (!Number.isFinite(value) || value <= 0) {
      setError("Enter a target number.");
      return;
    }
    if (kind === "exercise_e1rm" && !exerciseId) {
      setError("Pick a lift.");
      return;
    }
    if (targetDate && !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
      setError("Date must look like 2026-12-31.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await createGoal({
        kind,
        target_value: value,
        target_date: targetDate || null,
        exercise_id: kind === "exercise_e1rm" ? exerciseId : null,
      });
      setComposing(false);
      reset();
      onChanged();
    } catch {
      setError("Could not save that goal.");
    } finally {
      setBusy(false);
    }
  }, [kind, exerciseId, target, targetDate, onChanged]);

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      onChanged();
    } catch {
      setError("That didn't save.");
    } finally {
      setBusy(false);
    }
  };

  const proposed = goals.filter((g) => g.status === "proposed");
  const active = goals.filter((g) => g.status !== "proposed");
  const selectedUnit =
    KIND_OPTIONS.find((k) => k.kind === kind)?.unit ?? "";

  return (
    <>
      <View style={styles.head}>
        <Text style={styles.sectionLabel}>GOALS</Text>
        <TouchableOpacity
          onPress={() => setComposing(true)}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Add a goal"
          style={styles.addBtn}
        >
          <MaterialCommunityIcons name="plus" size={18} color={colors.accentPrimary} />
        </TouchableOpacity>
      </View>

      {error && !composing ? (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}

      {proposed.map((goal) => (
        <View key={goal.id} style={[styles.card, styles.proposedCard]}>
          <Text style={styles.proposedTag}>SUGGESTED BY YOUR COACH</Text>
          <Text style={styles.goalTitle}>{goalTitle(goal, positions)}</Text>
          <Text style={styles.goalMeta}>
            Target {goal.target_value}
            {goal.unit}
            {goal.target_date ? ` by ${goal.target_date}` : ""}
          </Text>
          <View style={styles.proposeRow}>
            <TouchableOpacity
              style={styles.acceptBtn}
              disabled={busy}
              onPress={() => act(() => setGoalStatus(goal.id, "active"))}
              accessibilityRole="button"
            >
              <Text style={styles.acceptText}>Accept</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.dismissBtn}
              disabled={busy}
              onPress={() => act(() => deleteGoal(goal.id))}
              accessibilityRole="button"
            >
              <Text style={styles.dismissText}>Dismiss</Text>
            </TouchableOpacity>
          </View>
        </View>
      ))}

      {active.length === 0 && proposed.length === 0 ? (
        <View style={styles.card}>
          <Text style={styles.empty}>
            No goals yet. Set one here, or ask the coach to suggest a target it
            thinks the plan can actually reach.
          </Text>
        </View>
      ) : null}

      {active.map((goal) => {
        const track = trackStyle(goal);
        const pct = Math.max(0, Math.min(100, goal.progress_pct ?? 0));
        return (
          <View key={goal.id} style={styles.card}>
            <View style={styles.goalHead}>
              <Text style={styles.goalTitle}>{goalTitle(goal, positions)}</Text>
              <TouchableOpacity
                onPress={() => act(() => deleteGoal(goal.id))}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="Remove goal"
              >
                <MaterialCommunityIcons
                  name="close"
                  size={16}
                  color={colors.textFaintCool}
                />
              </TouchableOpacity>
            </View>

            <Text style={styles.goalMeta}>
              {goal.current_value != null ? `${goal.current_value}${goal.unit}` : "—"}
              {" → "}
              {goal.target_value}
              {goal.unit}
              {goal.target_date ? ` by ${goal.target_date}` : ""}
            </Text>

            {/* The bar shows the share of the distance they set out to cover,
                measured from where they started rather than from zero. */}
            <View style={styles.track}>
              <View
                style={[styles.fill, { width: `${pct}%`, backgroundColor: track.color }]}
              />
            </View>

            <View style={styles.goalFoot}>
              <View style={styles.trackRow}>
                <MaterialCommunityIcons name={track.icon} size={13} color={track.color} />
                <Text style={[styles.trackText, { color: track.color }]}>
                  {track.text}
                </Text>
              </View>
              <Text style={styles.goalMeta}>
                {goal.progress_pct != null ? `${Math.round(goal.progress_pct)}%` : "—"}
                {goal.days_remaining != null && goal.days_remaining > 0
                  ? ` · ${goal.days_remaining}d left`
                  : ""}
              </Text>
            </View>
            {goal.note ? <Text style={styles.goalNote}>{goal.note}</Text> : null}
          </View>
        );
      })}

      <Modal
        visible={composing}
        transparent
        animationType="slide"
        onRequestClose={() => setComposing(false)}
      >
        <View style={styles.modalRoot}>
          <Pressable style={styles.backdrop} onPress={() => setComposing(false)} />
          <View style={styles.sheet}>
            <View style={styles.handle} />
            <Text style={styles.sheetTitle}>New goal</Text>

            <View style={styles.kindRow}>
              {KIND_OPTIONS.map((option) => {
                const on = option.kind === kind;
                return (
                  <TouchableOpacity
                    key={option.kind}
                    onPress={() => setKind(option.kind)}
                    style={[styles.kindChip, on && styles.kindChipOn]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                  >
                    <Text style={[styles.kindText, on && styles.kindTextOn]}>
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {kind === "exercise_e1rm" ? (
              positions.length ? (
                <View style={styles.kindRow}>
                  {positions.slice(0, 6).map((position) => {
                    const on = position.exercise_id === exerciseId;
                    return (
                      <TouchableOpacity
                        key={position.exercise_id}
                        onPress={() => setExerciseId(position.exercise_id)}
                        style={[styles.kindChip, on && styles.kindChipOn]}
                        accessibilityRole="button"
                        accessibilityState={{ selected: on }}
                      >
                        <Text style={[styles.kindText, on && styles.kindTextOn]}>
                          {position.name}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ) : (
                <Text style={styles.empty}>
                  No tracked lifts yet — log a couple of sessions first.
                </Text>
              )
            ) : null}

            <Text style={styles.fieldLabel}>
              {KIND_OPTIONS.find((k) => k.kind === kind)?.hint}
              {selectedUnit ? ` (${selectedUnit})` : ""}
            </Text>
            <TextInput
              style={styles.input}
              value={target}
              onChangeText={setTarget}
              keyboardType="numeric"
              placeholder="225"
              placeholderTextColor={colors.textFaintCool}
            />

            <Text style={styles.fieldLabel}>Target date (optional)</Text>
            <TextInput
              style={styles.input}
              value={targetDate}
              onChangeText={setTargetDate}
              placeholder="2026-12-31"
              placeholderTextColor={colors.textFaintCool}
              autoCapitalize="none"
            />
            <Text style={styles.hint}>
              Without a date there is no pace to be behind — the goal just tracks
              distance.
            </Text>

            {error ? (
              <Text style={styles.error} accessibilityRole="alert">
                {error}
              </Text>
            ) : null}

            <TouchableOpacity
              style={[styles.saveBtn, busy && styles.saveBtnBusy]}
              onPress={submit}
              disabled={busy}
              accessibilityRole="button"
            >
              {busy ? (
                <ActivityIndicator size="small" color={colors.onAccent} />
              ) : (
                <Text style={styles.saveText}>Set goal</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  );
}

function goalTitle(goal: Goal, positions: Position[]): string {
  if (goal.label) return goal.label;
  if (goal.kind === "exercise_e1rm") {
    const match = positions.find((p) => p.exercise_id === goal.exercise_id);
    return match ? `${match.name} 1RM` : "Lift 1RM";
  }
  return goal.kind_label;
}

const styles = StyleSheet.create({
  head: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionLabel: {
    color: colors.textMutedCool,
    fontSize: typography.micro,
    fontWeight: weight.bold,
    letterSpacing: 1.4,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  addBtn: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.lg,
  },
  card: {
    backgroundColor: colors.cardBackground,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  proposedCard: { borderWidth: 1, borderColor: colors.borderCoolStrong },
  proposedTag: {
    color: colors.ai,
    fontSize: typography.micro,
    fontWeight: weight.bold,
    letterSpacing: 1.2,
    marginBottom: spacing.xs,
  },
  goalHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  goalTitle: {
    color: colors.textPrimary,
    fontSize: typography.title,
    fontWeight: weight.bold,
    flex: 1,
  },
  goalMeta: { color: colors.textMutedCool, fontSize: typography.caption },
  goalNote: {
    color: colors.textFaintCool,
    fontSize: typography.micro,
    marginTop: spacing.xs,
  },
  track: {
    height: 6,
    borderRadius: 999,
    backgroundColor: colors.surfaceSunken,
    marginTop: spacing.sm,
    overflow: "hidden",
  },
  fill: { height: 6, borderRadius: 999 },
  goalFoot: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.sm,
  },
  trackRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  trackText: { fontSize: typography.caption, fontWeight: weight.bold },
  proposeRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  acceptBtn: {
    flex: 1,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: borderRadius.md,
    backgroundColor: colors.accentPrimary,
  },
  acceptText: {
    color: colors.onAccent,
    fontSize: typography.body,
    fontWeight: weight.bold,
  },
  dismissBtn: {
    flex: 1,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: borderRadius.md,
    backgroundColor: colors.surfaceSunken,
  },
  dismissText: { color: colors.textMutedCool, fontSize: typography.body },
  empty: {
    color: colors.textFaintCool,
    fontSize: typography.caption,
    lineHeight: 18,
  },
  error: {
    color: colors.attention,
    fontSize: typography.caption,
    marginBottom: spacing.sm,
  },

  modalRoot: { flex: 1, justifyContent: "flex-end" },
  // Matches the scrim used by Home's sheets.
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(0,0,0,0.6)" },
  sheet: {
    backgroundColor: colors.cardBackground,
    borderTopLeftRadius: borderRadius.xl,
    borderTopRightRadius: borderRadius.xl,
    padding: spacing.lg,
    paddingBottom: spacing["2xl"],
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 999,
    backgroundColor: colors.borderCoolStrong,
    alignSelf: "center",
    marginBottom: spacing.md,
  },
  sheetTitle: {
    color: colors.textPrimary,
    fontSize: typography.heading,
    fontWeight: weight.bold,
    marginBottom: spacing.md,
  },
  kindRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  kindChip: {
    paddingHorizontal: spacing.md,
    minHeight: 44,
    justifyContent: "center",
    borderRadius: 999,
    backgroundColor: colors.surfaceSunken,
  },
  kindChipOn: { backgroundColor: colors.accentPrimary },
  kindText: { color: colors.textMutedCool, fontSize: typography.caption },
  kindTextOn: { color: colors.onAccent, fontWeight: weight.bold },
  fieldLabel: {
    color: colors.textMutedCool,
    fontSize: typography.caption,
    marginBottom: spacing.xs,
  },
  input: {
    backgroundColor: colors.surfaceSunken,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    minHeight: 44,
    color: colors.textPrimary,
    fontSize: typography.body,
    marginBottom: spacing.md,
  },
  hint: {
    color: colors.textFaintCool,
    fontSize: typography.micro,
    marginBottom: spacing.md,
    lineHeight: 15,
  },
  saveBtn: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: borderRadius.md,
    backgroundColor: colors.accentPrimary,
  },
  saveBtnBusy: { opacity: 0.7 },
  saveText: {
    color: colors.onAccent,
    fontSize: typography.title,
    fontWeight: weight.bold,
  },
});
