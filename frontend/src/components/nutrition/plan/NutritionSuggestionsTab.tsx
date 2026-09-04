/**
 * Nutrition "Updates" tab — coach-staged plan edits and check-ins.
 *
 * Separated from the Plan blueprint so Accept/Dismiss isn't buried under
 * motivational review copy and DayMap editing.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
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
import PlanSuggestions from "./PlanSuggestions";
import PlanReviewCard from "./PlanReviewCard";
import PlanCheckinCard from "./PlanCheckinCard";
import EditMealAnchorModal from "./EditMealAnchorModal";
import EditGoToItemModal from "./EditGoToItemModal";
import EditFlexibleMealModal from "./EditFlexibleMealModal";
import {
  FlexibleMeal,
  GoToItem,
  MealAnchor,
  NutritionPlan,
  NutritionPlanEdit,
  NutritionSuggestionSet,
  PacingOption,
  PlanCheckin,
  PlanReview,
  applySuggestions,
  dismissSuggestions,
  getActiveNutritionPlan,
  getPendingSuggestions,
  getPlanCheckin,
  getPlanReview,
  proposeCheckinEdits,
  stagePacingOption,
  updateNutritionPlan,
} from "../../../api/nutritionPlan";
import { AI_MODEL_STORAGE_KEY, normalizeAiModel } from "../../../lib/aiModels";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { colors, spacing, borderRadius } from "../../../theme";

interface Props {
  onAskCoach?: (prompt: string) => void;
  onOpenPlan?: () => void;
  /** Lets the hub show a badge on this tab. */
  onPendingCountChange?: (count: number) => void;
}

export default function NutritionSuggestionsTab({
  onAskCoach,
  onOpenPlan,
  onPendingCountChange,
}: Props) {
  const [plan, setPlan] = useState<NutritionPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [suggestions, setSuggestions] = useState<NutritionSuggestionSet | null>(null);
  const [planChangedSince, setPlanChangedSince] = useState(false);
  const [suggestionsBusy, setSuggestionsBusy] = useState(false);
  const [review, setReview] = useState<PlanReview | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [checkin, setCheckin] = useState<PlanCheckin | null>(null);
  const [checkinLoading, setCheckinLoading] = useState(false);
  const [proposingEdits, setProposingEdits] = useState(false);
  const [stagingPacingId, setStagingPacingId] = useState<string | null>(null);

  const [editingAnchor, setEditingAnchor] = useState<MealAnchor | null>(null);
  const [editingAnchorIndex, setEditingAnchorIndex] = useState<number | null>(null);
  const [anchorEditorOpen, setAnchorEditorOpen] = useState(false);
  const [editingGoTo, setEditingGoTo] = useState<GoToItem | null>(null);
  const [editingGoToIndex, setEditingGoToIndex] = useState<number | null>(null);
  const [goToEditorOpen, setGoToEditorOpen] = useState(false);
  const [editingFlex, setEditingFlex] = useState<FlexibleMeal | null>(null);
  const [editingFlexIndex, setEditingFlexIndex] = useState<number | null>(null);
  const [flexEditorOpen, setFlexEditorOpen] = useState(false);

  const pendingCount = useMemo(
    () =>
      (suggestions?.edits || []).filter((e) => e.status === "pending").length,
    [suggestions]
  );

  useEffect(() => {
    onPendingCountChange?.(pendingCount);
  }, [pendingCount, onPendingCountChange]);

  const loadSuggestions = useCallback(async () => {
    try {
      const pending = await getPendingSuggestions();
      setSuggestions(pending.suggestion);
      setPlanChangedSince(pending.plan_changed_since);
    } catch {
      setSuggestions(null);
    }
  }, []);

  const loadReview = useCallback(async (planId: string, refresh = false) => {
    setReviewLoading(true);
    try {
      const model = normalizeAiModel(
        await AsyncStorage.getItem(AI_MODEL_STORAGE_KEY)
      );
      const next = await getPlanReview(planId, { refresh, model });
      setReview(next);
    } catch {
      if (refresh) Alert.alert("Error", "Could not refresh the coach review.");
    } finally {
      setReviewLoading(false);
    }
  }, []);

  const loadCheckin = useCallback(
    async (
      planId: string,
      refresh = false,
      opts?: { currentWeightLb?: number }
    ) => {
      setCheckinLoading(true);
      try {
        const model = normalizeAiModel(
          await AsyncStorage.getItem(AI_MODEL_STORAGE_KEY)
        );
        const next = await getPlanCheckin(planId, {
          refresh,
          model,
          currentWeightLb: opts?.currentWeightLb,
        });
        setCheckin(next);
      } catch {
        if (refresh) Alert.alert("Error", "Could not refresh the check-in.");
      } finally {
        setCheckinLoading(false);
      }
    },
    []
  );

  const load = useCallback(async () => {
    try {
      const active = await getActiveNutritionPlan();
      setPlan(active);
      if (active) {
        await Promise.all([
          loadSuggestions(),
          loadReview(active.id),
          loadCheckin(active.id),
        ]);
      } else {
        setSuggestions(null);
        setReview(null);
        setCheckin(null);
      }
    } catch (error) {
      console.error("Error loading nutrition updates:", error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [loadSuggestions, loadReview, loadCheckin]);

  useEffect(() => {
    load();
  }, [load]);

  const acceptSuggestions = async (editIds?: string[]) => {
    if (!suggestions) return;
    setSuggestionsBusy(true);
    try {
      const result = await applySuggestions(suggestions.id, editIds);
      setPlan(result.plan);
      setSuggestions(result.suggestion);
      setPlanChangedSince(false);
      if (result.stale_edit_ids?.length) {
        Alert.alert(
          "Some updates were skipped",
          "They no longer matched your plan. Ask the coach again if you still want them."
        );
      }
    } catch {
      Alert.alert("Error", "Could not apply those suggestions.");
    } finally {
      setSuggestionsBusy(false);
    }
  };

  const rejectSuggestions = async (editIds?: string[]) => {
    if (!suggestions) return;
    setSuggestionsBusy(true);
    try {
      const result = await dismissSuggestions(suggestions.id, editIds);
      setSuggestions(result.suggestion);
    } catch {
      Alert.alert("Error", "Could not dismiss those suggestions.");
    } finally {
      setSuggestionsBusy(false);
    }
  };

  const editSuggestion = (edit: NutritionPlanEdit) => {
    if (edit.field === "meal_anchors" && edit.payload) {
      const index = (plan?.meal_anchors || []).findIndex((a) => a.id === edit.payload.id);
      setEditingAnchor(edit.payload as MealAnchor);
      setEditingAnchorIndex(index >= 0 ? index : null);
      setAnchorEditorOpen(true);
      return;
    }
    if (edit.field === "go_to_items" && edit.payload) {
      const index = (plan?.go_to_items || []).findIndex((g) => g.id === edit.payload.id);
      setEditingGoTo(edit.payload as GoToItem);
      setEditingGoToIndex(index >= 0 ? index : null);
      setGoToEditorOpen(true);
      return;
    }
    if (edit.field === "flexible_meals" && edit.payload) {
      const index = (plan?.flexible_meals || []).findIndex((m) => m.id === edit.payload.id);
      setEditingFlex(edit.payload as FlexibleMeal);
      setEditingFlexIndex(index >= 0 ? index : null);
      setFlexEditorOpen(true);
    }
  };

  const savePatch = async (patch: Partial<NutritionPlan>) => {
    if (!plan) return;
    try {
      const updated = await updateNutritionPlan(plan.id, patch);
      setPlan(updated);
      await loadSuggestions();
    } catch {
      Alert.alert("Error", "Could not save that change.");
    }
  };

  const runProposeCheckinEdits = async () => {
    if (!plan) return;
    setProposingEdits(true);
    try {
      const { suggestion, message } = await proposeCheckinEdits(plan.id);
      if (suggestion) {
        setSuggestions(suggestion);
        setPlanChangedSince(false);
      } else {
        Alert.alert("Nothing to stage", message || "No concrete plan edits came back from this check-in.");
      }
    } catch {
      Alert.alert("Error", "Could not propose edits from the check-in.");
    } finally {
      setProposingEdits(false);
    }
  };

  const runStagePacing = async (option: PacingOption) => {
    if (!plan) return;
    setStagingPacingId(option.id);
    try {
      const { suggestion } = await stagePacingOption(plan.id, option.id);
      if (suggestion) {
        setSuggestions(suggestion);
        setPlanChangedSince(false);
      } else {
        Alert.alert("Could not stage", "That pacing option is no longer available.");
      }
    } catch {
      Alert.alert("Error", "Could not stage this pacing change.");
    } finally {
      setStagingPacingId(null);
    }
  };

  const visibleEdits = (suggestions?.edits || []).filter(
    (e) => e.status === "pending" || e.status === "stale"
  );

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.accentPrimary} />
      </View>
    );
  }

  if (!plan) {
    return (
      <View style={styles.centered}>
        <MaterialCommunityIcons name="auto-fix" size={32} color={colors.ai} />
        <Text style={styles.emptyTitle}>No nutrition plan yet</Text>
        <Text style={styles.emptyBody}>
          Create a plan first — then coach updates will show up here to accept or dismiss.
        </Text>
        {onOpenPlan ? (
          <TouchableOpacity style={styles.primary} onPress={onOpenPlan}>
            <Text style={styles.primaryText}>Go to Plan</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scroll}
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
        <View style={styles.header}>
          <Text style={styles.title}>Updates</Text>
          <Text style={styles.subtitle}>
            Review concrete plan changes. Nothing applies until you accept.
          </Text>
        </View>

        {visibleEdits.length ? (
          <PlanSuggestions
            set={suggestions!}
            planChangedSince={planChangedSince}
            busy={suggestionsBusy}
            showAcceptAll
            onAccept={acceptSuggestions}
            onDismiss={rejectSuggestions}
            onEdit={editSuggestion}
          />
        ) : (
          <View style={styles.emptyCard}>
            <MaterialCommunityIcons name="check-circle-outline" size={22} color="#4ADE80" />
            <View style={{ flex: 1 }}>
              <Text style={styles.emptyCardTitle}>No pending updates</Text>
              <Text style={styles.emptyCardBody}>
                Ask the coach to adjust meals or targets — staged edits will land here.
              </Text>
            </View>
          </View>
        )}

        <PlanCheckinCard
          checkin={checkin}
          loading={checkinLoading}
          onRefresh={(opts) => loadCheckin(plan.id, true, opts)}
          onProposeEdits={runProposeCheckinEdits}
          proposing={proposingEdits}
          onStagePacing={runStagePacing}
          stagingPacingId={stagingPacingId}
          onAskCoach={onAskCoach}
        />

        <PlanReviewCard
          review={review}
          loading={reviewLoading}
          onRefresh={() => loadReview(plan.id, true)}
          onAskCoach={onAskCoach}
        />

        {onAskCoach ? (
          <TouchableOpacity
            style={styles.askCoach}
            onPress={() =>
              onAskCoach(
                "I want to adjust my nutrition plan with specific meal or target changes. "
              )
            }
          >
            <MaterialCommunityIcons name="chat-processing-outline" size={18} color={colors.ai} />
            <Text style={styles.askCoachText}>Ask coach for a change</Text>
          </TouchableOpacity>
        ) : null}
      </ScrollView>

      <EditMealAnchorModal
        visible={anchorEditorOpen}
        anchor={editingAnchor}
        onClose={() => setAnchorEditorOpen(false)}
        onSave={async (item) => {
          const list = [...(plan.meal_anchors || [])];
          if (editingAnchorIndex != null && editingAnchorIndex >= 0) {
            list[editingAnchorIndex] = item;
          } else {
            list.push(item);
          }
          await savePatch({ meal_anchors: list });
          setAnchorEditorOpen(false);
          // After tweaking, dismiss that suggestion if it was a pending edit
          // targeting this meal — the manual save already wrote the plan.
          const related = visibleEdits.filter(
            (e) => e.field === "meal_anchors" && e.payload?.id === item.id
          );
          if (related.length) {
            void rejectSuggestions(related.map((e) => e.id));
          }
        }}
        onDelete={
          editingAnchorIndex != null
            ? async () => {
                const list = (plan.meal_anchors || []).filter(
                  (_, i) => i !== editingAnchorIndex
                );
                await savePatch({ meal_anchors: list });
                setAnchorEditorOpen(false);
              }
            : undefined
        }
      />
      <EditGoToItemModal
        visible={goToEditorOpen}
        item={editingGoTo}
        onClose={() => setGoToEditorOpen(false)}
        onSave={async (item) => {
          const list = [...(plan.go_to_items || [])];
          if (editingGoToIndex != null && editingGoToIndex >= 0) {
            list[editingGoToIndex] = item;
          } else {
            list.push(item);
          }
          await savePatch({ go_to_items: list });
          setGoToEditorOpen(false);
        }}
        onDelete={
          editingGoToIndex != null
            ? async () => {
                const list = (plan.go_to_items || []).filter(
                  (_, i) => i !== editingGoToIndex
                );
                await savePatch({ go_to_items: list });
                setGoToEditorOpen(false);
              }
            : undefined
        }
      />
      <EditFlexibleMealModal
        visible={flexEditorOpen}
        meal={editingFlex}
        onClose={() => setFlexEditorOpen(false)}
        onSave={async (item) => {
          const list = [...(plan.flexible_meals || [])];
          if (editingFlexIndex != null && editingFlexIndex >= 0) {
            list[editingFlexIndex] = item;
          } else {
            list.push(item);
          }
          await savePatch({ flexible_meals: list });
          setFlexEditorOpen(false);
        }}
        onDelete={
          editingFlexIndex != null
            ? async () => {
                const list = (plan.flexible_meals || []).filter(
                  (_, i) => i !== editingFlexIndex
                );
                await savePatch({ flexible_meals: list });
                setFlexEditorOpen(false);
              }
            : undefined
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
    gap: spacing.md,
  },
  scroll: {
    padding: spacing.lg,
    paddingBottom: spacing["3xl"],
    gap: spacing.md,
  },
  header: { gap: 4, marginBottom: 4 },
  title: { color: "#fff", fontSize: 22, fontWeight: "800" },
  subtitle: { color: colors.textSecondary, fontSize: 13, lineHeight: 18 },
  emptyTitle: { color: "#fff", fontSize: 16, fontWeight: "800", textAlign: "center" },
  emptyBody: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    textAlign: "center",
  },
  emptyCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: spacing.lg,
    borderRadius: borderRadius.lg,
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.border,
  },
  emptyCardTitle: { color: "#fff", fontSize: 14, fontWeight: "700" },
  emptyCardBody: { color: colors.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 2 },
  primary: {
    marginTop: 8,
    backgroundColor: colors.accentPrimary,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 12,
  },
  primaryText: { color: colors.onAccent, fontWeight: "800", fontSize: 14 },
  askCoach: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(94,234,212,0.35)",
    backgroundColor: "rgba(94,234,212,0.06)",
  },
  askCoachText: { color: colors.ai, fontSize: 14, fontWeight: "800" },
});
