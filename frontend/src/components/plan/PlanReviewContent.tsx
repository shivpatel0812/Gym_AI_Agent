import { MacroSummary } from "./ProgramOverview";
import { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { PlanChange, PlanMode, PlanModeOption, TrainingPlan } from "../../api/trainingPlan";
import { colors, spacing, borderRadius } from "../../theme";

const DAY_ORDER = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

const DAY_SHORT: Record<string, string> = {
  monday: "Mon",
  tuesday: "Tue",
  wednesday: "Wed",
  thursday: "Thu",
  friday: "Fri",
  saturday: "Sat",
  sunday: "Sun",
};

const PLACEHOLDER_VALUES = new Set(["n/a", "na", "none", "null", "-", "undefined"]);
const isMeaningful = (value?: string | null) =>
  !!value && !PLACEHOLDER_VALUES.has(value.trim().toLowerCase());

interface Props {
  plan: TrainingPlan;
  modes?: PlanModeOption[];
  /** When provided, shows Edit controls that call this with a coach prompt. */
  onEditRequest?: (prompt: string) => void;
  showFootnote?: boolean;
}


/**
 * What accepting this plan would replace.
 *
 * A proposal rendered on its own answers "is this a good plan?" when the
 * question actually being asked is "should this replace what you have?" Those
 * differ exactly where it matters: a two-day proposal reads as a reasonable
 * two-day program right up until you notice it deletes three days you train.
 * Removals lead, because they are the part that cannot be undone by accepting.
 */
function PlanDiffSummary({ plan }: { plan: TrainingPlan }) {
  const diff = plan.diff;
  if (!diff || diff.is_first_plan) return null;

  const hasDetail =
    diff.removed_days.length ||
    diff.added_days.length ||
    diff.days.length ||
    diff.schedule_changes.length;
  if (!hasDetail) return null;

  return (
    <View style={[styles.card, diff.is_destructive && styles.destructiveCard]}>
      <View style={styles.cardHeader}>
        <MaterialCommunityIcons
          name={diff.is_destructive ? "alert-outline" : "swap-horizontal"}
          size={18}
          color={diff.is_destructive ? colors.warning : colors.accentPrimary}
        />
        <Text style={styles.cardTitle}>
          {diff.is_destructive ? "This replaces part of your plan" : "What changes"}
        </Text>
      </View>

      <Text style={styles.cardBody}>{diff.summary}</Text>

      {diff.removed_days.length ? (
        <View style={styles.diffBlock}>
          <Text style={styles.diffLabelDanger}>DAYS THAT WOULD BE REMOVED</Text>
          {diff.removed_days.map((day) => (
            <Text key={day} style={styles.diffRemoved}>
              {day} — you would no longer have this workout
            </Text>
          ))}
        </View>
      ) : null}

      {diff.added_days.length ? (
        <View style={styles.diffBlock}>
          <Text style={styles.diffLabel}>NEW DAYS</Text>
          {diff.added_days.map((day) => (
            <Text key={day} style={styles.diffAdded}>{day}</Text>
          ))}
        </View>
      ) : null}

      {diff.days.map((day) => (
        <View key={day.day_name} style={styles.diffBlock}>
          <Text style={styles.diffLabel}>{day.day_name.toUpperCase()}</Text>
          {day.removed.map((name) => (
            <Text key={`r-${name}`} style={styles.diffRemoved}>− {name}</Text>
          ))}
          {day.added.map((name) => (
            <Text key={`a-${name}`} style={styles.diffAdded}>+ {name}</Text>
          ))}
          {day.retargeted.map((change) => (
            <Text key={`t-${change.exercise_name}`} style={styles.diffChanged}>
              {change.exercise_name}: {change.from} → {change.to}
            </Text>
          ))}
          {day.reordered && !day.added.length && !day.removed.length ? (
            <Text style={styles.diffChanged}>Exercise order changed</Text>
          ) : null}
        </View>
      ))}

      {plan.carried_forward_days?.length ? (
        <Text style={styles.diffNote}>
          Kept from your current plan because this conversation did not mention them:{" "}
          {plan.carried_forward_days.join(", ")}.
        </Text>
      ) : null}

      {plan.dropped_exercises?.length ? (
        <View style={styles.diffBlock}>
          <Text style={styles.diffLabelDanger}>COULD NOT BE ADDED</Text>
          {plan.dropped_exercises.map((item, i) => (
            <Text key={`${item.exercise_name}-${i}`} style={styles.diffRemoved}>
              {item.exercise_name} ({item.day_name}) — {item.reason}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

export default function PlanReviewContent({
  plan,
  modes = [],
  onEditRequest,
  showFootnote = true,
}: Props) {
  const [expandedDays, setExpandedDays] = useState<Record<string, boolean>>({});

  const modeLabel =
    modes.find((m) => m.id === plan.plan_mode)?.label ||
    modeFallbackLabel(plan.plan_mode);

  const scheduleEntries = DAY_ORDER.map((day) => {
    const assignment = plan.weekly_schedule?.[day];
    if (!assignment || assignment.toLowerCase() === "rest") return null;
    const planDay = plan.days.find((d) => d.day_name === assignment);
    const detail = [assignment, planDay?.day_type || planDay?.day_goal]
      .filter(Boolean)
      .join(" · ");
    return { day, short: DAY_SHORT[day], detail };
  }).filter(Boolean) as { day: string; short: string; detail: string }[];

  const isDayExpanded = (name: string) => expandedDays[name] !== false;

  const toggleDay = (name: string) => {
    setExpandedDays((prev) => ({ ...prev, [name]: !isDayExpanded(name) }));
  };

  const changeText = (change: PlanChange) => {
    const subject = isMeaningful(change.exercise_name)
      ? change.exercise_name!
      : change.day_name || "Plan structure";
    const reason = isMeaningful(change.reason) ? change.reason! : null;
    if (reason && !reason.toLowerCase().includes(subject.toLowerCase())) {
      return `${subject} — ${reason}`;
    }
    return reason || subject || change.action;
  };

  return (
    <View>
      <Text style={styles.planName}>{plan.plan_name}</Text>
      <MacroSummary value={plan.nutrition_companion} />

      <View style={styles.pillRow}>
        {plan.duration_weeks ? (
          <View style={styles.pill}>
            <MaterialCommunityIcons name="calendar-month-outline" size={14} color={colors.accentPrimary} />
            <Text style={styles.pillText}>{plan.duration_weeks} weeks</Text>
          </View>
        ) : null}
        {modeLabel ? (
          <View style={styles.pill}>
            <MaterialCommunityIcons name="auto-fix" size={14} color={colors.accentPrimary} />
            <Text style={styles.pillText}>{modeLabel}</Text>
          </View>
        ) : null}
      </View>

      <PlanDiffSummary plan={plan} />

      {plan.primary_goal ? (
        <Text style={styles.planDescription}>{plan.primary_goal}</Text>
      ) : null}

      {plan.primary_goal ? (
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <MaterialCommunityIcons name="target" size={18} color={colors.accentPrimary} />
            <Text style={styles.cardTitle}>Main Goal</Text>
          </View>
          <Text style={styles.cardBody}>{plan.primary_goal}</Text>
        </View>
      ) : null}

      <View style={styles.sectionHeader}>
        <View style={styles.sectionHeaderLeft}>
          <MaterialCommunityIcons name="calendar-week" size={18} color={colors.accentPrimary} />
          <Text style={styles.sectionTitle}>Weekly Schedule</Text>
        </View>
        {onEditRequest ? (
          <TouchableOpacity
            style={styles.editButton}
            onPress={() =>
              onEditRequest(
                `I'd like to edit the weekly schedule for my plan "${plan.plan_name}". `
              )
            }
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <MaterialCommunityIcons name="pencil-outline" size={14} color={colors.accentPrimary} />
            <Text style={styles.editButtonText}>Edit</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <View style={styles.scheduleGrid}>
        {scheduleEntries.map((entry) => (
          <View key={entry.day} style={styles.scheduleCell}>
            <Text style={styles.scheduleDayLabel}>{entry.short}:</Text>
            <View style={styles.scheduleChip}>
              <Text style={styles.scheduleChipText} numberOfLines={1}>
                {entry.detail}
              </Text>
            </View>
          </View>
        ))}
      </View>

      <Text style={[styles.sectionTitle, styles.workoutDaysTitle]}>Workout Days</Text>

      {plan.days.map((day) => {
        const expanded = isDayExpanded(day.day_name);
        const title = [day.day_name, day.day_type].filter(Boolean).join(" · ");
        return (
          <View key={day.day_name} style={styles.dayCard}>
            <View style={styles.dayAccent} />
            <View style={styles.dayHeader}>
              <TouchableOpacity
                style={styles.dayHeaderMain}
                onPress={() => toggleDay(day.day_name)}
                activeOpacity={0.7}
              >
                <MaterialCommunityIcons name="dumbbell" size={18} color={colors.accentPrimary} />
                <Text style={styles.dayTitle} numberOfLines={1}>
                  {title}
                </Text>
              </TouchableOpacity>
              {onEditRequest ? (
                <TouchableOpacity
                  style={styles.editDayButton}
                  onPress={() =>
                    onEditRequest(
                      `I'd like to edit the "${day.day_name}" day in my plan "${plan.plan_name}". `
                    )
                  }
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                >
                  <Text style={styles.editDayText}>Edit Day</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity
                onPress={() => toggleDay(day.day_name)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <MaterialCommunityIcons
                  name={expanded ? "chevron-up" : "chevron-down"}
                  size={20}
                  color={colors.textMuted}
                />
              </TouchableOpacity>
            </View>

            {expanded
              ? day.exercises.map((ex) => (
                  <View key={`${day.day_name}-${ex.order}`} style={styles.exerciseRow}>
                    <Text style={styles.exerciseText}>
                      {ex.order}. {ex.exercise_name}
                      {ex.target_rep_range
                        ? ` — ${ex.target_rep_range[0]}-${ex.target_rep_range[1]} reps`
                        : ""}
                      {ex.priority === "high" ? "  ★" : ""}
                    </Text>
                    <MaterialCommunityIcons
                      name="drag-horizontal-variant"
                      size={18}
                      color={colors.textMuted}
                    />
                  </View>
                ))
              : null}
          </View>
        );
      })}

      {plan.changes?.length ? (
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <MaterialCommunityIcons name="auto-fix" size={18} color={colors.accentPrimary} />
            <Text style={styles.cardTitle}>Changes From Your Split</Text>
          </View>
          {plan.changes.map((change, i) => (
            <View key={i} style={styles.changeRow}>
              <MaterialCommunityIcons
                name="check-circle"
                size={18}
                color={colors.accentPrimary}
              />
              <Text style={styles.changeText}>{changeText(change)}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {plan.strategy?.length ? (
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <MaterialCommunityIcons name="lightbulb-outline" size={18} color={colors.accentPrimary} />
            <Text style={styles.cardTitle}>Strategy</Text>
          </View>
          {plan.strategy.map((item, i) => (
            <View key={i} style={styles.changeRow}>
              <MaterialCommunityIcons
                name="check-circle"
                size={18}
                color={colors.accentPrimary}
              />
              <Text style={styles.changeText}>{item}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {showFootnote ? (
        <Text style={styles.footnote}>
          Your Current Split is not changed. This plan only affects how workouts and
          recommendations are targeted while it is active.
        </Text>
      ) : null}
    </View>
  );
}

function modeFallbackLabel(mode?: PlanMode) {
  switch (mode) {
    case "follow_split":
      return "Follow My Split";
    case "adapt_split":
      return "Adapt My Split";
    case "build_for_me":
      return "Build For Me";
    default:
      return mode;
  }
}

const styles = StyleSheet.create({
  planName: {
    fontSize: 26,
    fontWeight: "700",
    color: colors.textPrimary,
    letterSpacing: -0.3,
  },
  pillRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(156, 192, 232,0.12)",
    borderWidth: 1,
    borderColor: "rgba(156, 192, 232,0.28)",
  },
  pillText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.accentPrimary,
  },
  planDescription: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 21,
    marginTop: spacing.md,
  },

  destructiveCard: { borderColor: colors.warning },
  diffBlock: { marginTop: 12 },
  diffLabel: {
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.8,
    color: colors.textMuted,
    marginBottom: 4,
  },
  diffLabelDanger: {
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.8,
    color: colors.warning,
    marginBottom: 4,
  },
  diffRemoved: { fontSize: 12, lineHeight: 18, color: colors.warning },
  diffAdded: { fontSize: 12, lineHeight: 18, color: colors.accentPrimary },
  diffChanged: { fontSize: 12, lineHeight: 18, color: colors.textSecondary },
  diffNote: {
    fontSize: 11,
    lineHeight: 16,
    color: colors.textSecondary,
    marginTop: 12,
    fontStyle: "italic",
  },
  card: {
    marginTop: spacing.lg,
    backgroundColor: "#1C1C1E",
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  cardBody: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 20,
  },

  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.xl,
    marginBottom: spacing.md,
  },
  sectionHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  editButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  editButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.accentPrimary,
  },

  scheduleGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  scheduleCell: {
    width: "48%",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  scheduleDayLabel: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.accentPrimary,
    width: 36,
  },
  scheduleChip: {
    flex: 1,
    backgroundColor: "#1C1C1E",
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  scheduleChipText: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.textPrimary,
  },

  workoutDaysTitle: {
    marginTop: spacing.xl,
    marginBottom: spacing.md,
  },
  dayCard: {
    backgroundColor: "#1C1C1E",
    borderRadius: borderRadius.lg,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
    position: "relative",
  },
  dayAccent: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
    backgroundColor: colors.accentPrimary,
  },
  dayHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingLeft: spacing.lg + 4,
  },
  dayHeaderMain: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minWidth: 0,
  },
  dayTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  editDayButton: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  editDayText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.accentPrimary,
  },
  exerciseRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: spacing.lg,
    paddingLeft: spacing.lg + 4,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.sm,
  },
  exerciseText: {
    flex: 1,
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 20,
  },

  changeRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  changeText: {
    flex: 1,
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 20,
  },

  footnote: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: spacing.lg,
    lineHeight: 17,
    fontStyle: "italic",
  },
});
