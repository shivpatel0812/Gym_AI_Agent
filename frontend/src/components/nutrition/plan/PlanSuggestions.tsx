import { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import {
  NutritionPlanEdit,
  NutritionSuggestionSet,
} from "../../../api/nutritionPlan";
import { colors, spacing, borderRadius } from "../../../theme";

interface Props {
  set: NutritionSuggestionSet;
  /** The plan moved since these were proposed, so some may no longer apply. */
  planChangedSince?: boolean;
  busy?: boolean;
  /** When meal edits live under DayMap, still offer Accept all from this banner. */
  showAcceptAll?: boolean;
  onAccept: (editIds?: string[]) => void;
  onDismiss: (editIds?: string[]) => void;
  /** Opens the matching editor prefilled, so a suggestion can be tweaked first. */
  onEdit?: (edit: NutritionPlanEdit) => void;
}

const MACRO_UNITS: Record<string, string> = {
  calories: " kcal",
  protein: "g protein",
  carbs: "g carbs",
  fats: "g fat",
  fiber: "g fiber",
};

/**
 * A one-line "what changes" for a suggestion.
 *
 * Deliberately not a JSON dump: the user should be able to read the diff for
 * the one meal it touches and decide, without parsing the whole plan.
 */
function describe(edit: NutritionPlanEdit): string | null {
  if (edit.op === "update_targets") {
    const before = edit.before || {};
    const parts = Object.entries(edit.payload || {}).map(([key, value]) => {
      const unit = MACRO_UNITS[key] ?? "";
      const was = (before as any)[key];
      return was != null && was !== value ? `${was} → ${value}${unit}` : `${value}${unit}`;
    });
    return parts.join(" · ") || null;
  }

  if (edit.op.startsWith("remove_")) {
    const foods = (edit.before?.foods || []).map((f: any) => f?.name).filter(Boolean);
    return foods.length ? foods.join(" + ") : null;
  }

  const foods = (edit.payload?.foods || []).map((f: any) => f?.name).filter(Boolean);
  if (foods.length) return foods.join(" + ");
  if (typeof edit.payload?.strategy === "string") return edit.payload.strategy;
  if (Array.isArray(edit.payload?.food_priorities)) {
    return edit.payload.food_priorities.join(", ");
  }
  return null;
}

function SuggestionRow({
  edit,
  busy,
  onAccept,
  onDismiss,
  onEdit,
}: {
  edit: NutritionPlanEdit;
  busy?: boolean;
  onAccept: () => void;
  onDismiss: () => void;
  onEdit?: () => void;
}) {
  const detail = describe(edit);
  const stale = edit.status === "stale";

  return (
    <View style={styles.row}>
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle}>{edit.title}</Text>
        {detail ? <Text style={styles.rowDetail}>{detail}</Text> : null}
        {edit.rationale ? <Text style={styles.rowRationale}>{edit.rationale}</Text> : null}
        {stale ? (
          <Text style={styles.rowStale}>
            This no longer matches your plan — dismiss it and ask again.
          </Text>
        ) : null}
      </View>

      <View style={styles.rowActions}>
        {onEdit && !stale ? (
          <TouchableOpacity onPress={onEdit} disabled={busy} hitSlop={8} style={styles.iconButton}>
            <MaterialCommunityIcons name="pencil-outline" size={16} color={colors.textSecondary} />
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity onPress={onDismiss} disabled={busy} hitSlop={8} style={styles.iconButton}>
          <MaterialCommunityIcons name="close" size={16} color={colors.textSecondary} />
        </TouchableOpacity>
        {!stale ? (
          <TouchableOpacity onPress={onAccept} disabled={busy} style={styles.acceptButton}>
            <Text style={styles.acceptButtonText}>Accept</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

/**
 * Coach-proposed edits, reviewed where the plan actually lives.
 *
 * Chat never writes the plan: it stages these, and nothing changes until the
 * user accepts an individual suggestion or the whole set.
 */
export default function PlanSuggestions({
  set,
  planChangedSince,
  busy,
  showAcceptAll,
  onAccept,
  onDismiss,
  onEdit,
}: Props) {
  const [expanded, setExpanded] = useState(true);
  // Stale rows stay visible so the user can see what was dropped and why,
  // but only genuinely pending ones can still be accepted.
  const visible = (set.edits || []).filter(
    (e) => e.status === "pending" || e.status === "stale"
  );
  const acceptable = visible.filter((e) => e.status === "pending");
  // Meal-scoped edits may live under breakfast/lunch/dinner — this banner can
  // still show Accept all even when the row list is empty.
  const canAcceptAll = showAcceptAll ?? acceptable.length > 0;

  if (!visible.length && !set.summary) return null;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <MaterialCommunityIcons name="auto-fix" size={18} color={colors.ai} />
        <View style={styles.headerBody}>
          <Text style={styles.headerTitle}>
            {visible.length
              ? `Coach suggested ${visible.length} ${visible.length === 1 ? "update" : "updates"}`
              : "Coach suggested plan updates"}
          </Text>
          <Text style={styles.headerSummary}>{set.summary}</Text>
          {planChangedSince ? (
            <Text style={styles.rowStale}>
              You've edited the plan since these were suggested.
            </Text>
          ) : null}
        </View>
        {visible.length ? (
          <TouchableOpacity onPress={() => setExpanded((v) => !v)} hitSlop={8}>
            <Text style={styles.headerToggle}>{expanded ? "Hide" : "Review"}</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {expanded && visible.length ? (
        <>
          {visible.map((edit) => (
            <SuggestionRow
              key={edit.id}
              edit={edit}
              busy={busy}
              onAccept={() => onAccept([edit.id])}
              onDismiss={() => onDismiss([edit.id])}
              onEdit={onEdit ? () => onEdit(edit) : undefined}
            />
          ))}
        </>
      ) : null}

      <View style={styles.footer}>
        {canAcceptAll ? (
          <TouchableOpacity
            style={styles.acceptAll}
            onPress={() => onAccept()}
            disabled={busy}
          >
            {busy ? (
              <ActivityIndicator size="small" color="#070708" />
            ) : (
              <Text style={styles.acceptAllText}>Accept all</Text>
            )}
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity
          style={[styles.dismissAll, !canAcceptAll && styles.dismissAllWide]}
          onPress={() => onDismiss()}
          disabled={busy}
        >
          <Text style={styles.dismissAllText}>Dismiss all</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "rgba(94,234,212,0.06)",
    borderWidth: 1,
    borderColor: "rgba(94,234,212,0.4)",
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
    gap: spacing.md,
  },
  header: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  headerBody: { flex: 1 },
  headerTitle: { color: colors.textPrimary, fontSize: 14, fontWeight: "700" },
  headerSummary: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  headerToggle: { color: colors.ai, fontSize: 12, fontWeight: "700" },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
  },
  rowBody: { flex: 1 },
  rowTitle: { color: colors.textPrimary, fontSize: 13, fontWeight: "700" },
  rowDetail: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  rowRationale: { color: colors.ai, fontSize: 12, marginTop: 4 },
  rowStale: { color: colors.warning, fontSize: 12, marginTop: 4 },
  rowActions: { flexDirection: "row", alignItems: "center", gap: 4 },
  iconButton: { padding: 6 },
  acceptButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: borderRadius.md,
    backgroundColor: colors.ai,
  },
  acceptButtonText: { color: "#070708", fontSize: 12, fontWeight: "700" },
  footer: { flexDirection: "row", gap: spacing.sm },
  acceptAll: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: borderRadius.lg,
    backgroundColor: colors.ai,
    alignItems: "center",
  },
  acceptAllText: { color: "#070708", fontSize: 14, fontWeight: "700" },
  dismissAll: {
    paddingHorizontal: spacing.lg,
    paddingVertical: 12,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
  },
  dismissAllWide: { flex: 1 },
  dismissAllText: { color: colors.textSecondary, fontSize: 14, fontWeight: "700" },
});
