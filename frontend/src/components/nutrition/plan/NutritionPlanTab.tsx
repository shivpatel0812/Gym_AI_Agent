import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import CreateNutritionPlanModal from "./CreateNutritionPlanModal";
import PlanReviewCard from "./PlanReviewCard";
import PlanCheckinCard from "./PlanCheckinCard";
import EditMealAnchorModal, { slotIcon } from "./EditMealAnchorModal";
import EditGoToItemModal from "./EditGoToItemModal";
import EditFlexibleMealModal from "./EditFlexibleMealModal";
import DayMap, { SlotIdea } from "./DayMap";
import AddBlueprintModal, { BlueprintAddResult } from "./AddBlueprintModal";
import PlanSuggestions from "./PlanSuggestions";
import {
  AnchorVerdict,
  BlueprintExtra,
  DayBand,
  FastFoodPlace,
  FlexibleMeal,
  GoToItem,
  MealAnchor,
  NutritionPlan,
  NutritionPlanEdit,
  NutritionSuggestionSet,
  PacingOption,
  PlanCheckin,
  PlanReview,
  PrimaryMealSlot,
  applySuggestions,
  dismissSuggestions,
  endNutritionPlan,
  getPendingSuggestions,
  getActiveNutritionPlan,
  getPlanCheckin,
  getPlanReview,
  goalLabel,
  proposeCheckinEdits,
  stagePacingOption,
  HEALTH_FOCUS_DISCLAIMER,
  healthFocusLabels,
  pauseNutritionPlan,
  resumeNutritionPlan,
  slotLabel,
  suggestFastFoodOrders,
  suggestSlotFills,
  updateNutritionPlan,
} from "../../../api/nutritionPlan";
import { buildDayMap } from "../../../lib/dayMap";
import { LoggedMealPattern } from "../../../lib/recentMeals";
import { groupEditsBySlot, pendingTargetIds } from "../../../lib/planSuggestionSlots";
import { AI_MODEL_STORAGE_KEY, normalizeAiModel } from "../../../lib/aiModels";
import apiClient from "../../../api/client";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { colors, spacing, borderRadius } from "../../../theme";

interface Props {
  onAskCoach?: (prompt: string) => void;
}

export default function NutritionPlanTab({ onAskCoach }: Props) {
  const [plan, setPlan] = useState<NutritionPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingFlex, setEditingFlex] = useState<FlexibleMeal | null>(null);
  const [editingFlexIndex, setEditingFlexIndex] = useState<number | null>(null);
  const [flexEditorOpen, setFlexEditorOpen] = useState(false);
  const [editingAnchor, setEditingAnchor] = useState<MealAnchor | null>(null);
  const [editingAnchorIndex, setEditingAnchorIndex] = useState<number | null>(null);
  const [anchorEditorOpen, setAnchorEditorOpen] = useState(false);
  const [editingGoTo, setEditingGoTo] = useState<GoToItem | null>(null);
  const [editingGoToIndex, setEditingGoToIndex] = useState<number | null>(null);
  const [goToEditorOpen, setGoToEditorOpen] = useState(false);
  const [addBand, setAddBand] = useState<DayBand | null>(null);
  const [editingExtra, setEditingExtra] = useState<BlueprintExtra | null>(null);
  const [suggestingSlot, setSuggestingSlot] = useState<string | null>(null);
  const [ideasBySlot, setIdeasBySlot] = useState<Record<string, SlotIdea[]>>({});
  const [preloadedSlots, setPreloadedSlots] = useState<Record<string, boolean>>({});
  const [suggestingPlaceId, setSuggestingPlaceId] = useState<string | null>(null);
  const [orderSuggestions, setOrderSuggestions] = useState<
    Record<
      string,
      {
        orders: Array<{
          name: string;
          items?: string[];
          calories?: number;
          protein?: number;
          why?: string;
        }>;
        tip?: string | null;
      }
    >
  >({});
  const [macroLogs, setMacroLogs] = useState<any[]>([]);
  const [suggestions, setSuggestions] = useState<NutritionSuggestionSet | null>(null);
  const [planChangedSince, setPlanChangedSince] = useState(false);
  const [suggestionsBusy, setSuggestionsBusy] = useState(false);
  const [review, setReview] = useState<PlanReview | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [checkin, setCheckin] = useState<PlanCheckin | null>(null);
  const [checkinLoading, setCheckinLoading] = useState(false);
  const [proposingEdits, setProposingEdits] = useState(false);
  const [stagingPacingId, setStagingPacingId] = useState<string | null>(null);
  /**
   * Per-slot AI output that is about the plan rather than a new meal: guidance,
   * advisory verdicts on the user's own anchors, and logged meals grouped into
   * one rotating option. Kept separate from ideasBySlot, which is a list of
   * meals to add.
   */
  const [slotAi, setSlotAi] = useState<
    Record<
      string,
      {
        guidance?: string | null;
        verdicts?: AnchorVerdict[];
        optionsAnchor?: SlotIdea | null;
      }
    >
  >({});

  const loadSuggestions = useCallback(async () => {
    try {
      const pending = await getPendingSuggestions();
      setSuggestions(pending.suggestion);
      setPlanChangedSince(pending.plan_changed_since);
    } catch {
      // Suggestions are additive — a failure here must not hide the plan.
      setSuggestions(null);
    }
  }, []);

  const loadReview = useCallback(async (planId: string, refresh = false) => {
    setReviewLoading(true);
    try {
      setReview(await getPlanReview(planId, { refresh }));
    } catch {
      // The review is commentary — never block the plan page on it.
      setReview(null);
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
        setCheckin(
          await getPlanCheckin(planId, {
            refresh,
            currentWeightLb: opts?.currentWeightLb,
          })
        );
      } catch {
        setCheckin(null);
      } finally {
        setCheckinLoading(false);
      }
    },
    []
  );

  const runProposeCheckinEdits = useCallback(async () => {
    if (!plan) return;
    setProposingEdits(true);
    try {
      const { suggestion, message } = await proposeCheckinEdits(plan.id);
      if (suggestion) {
        setSuggestions(suggestion);
        setPlanChangedSince(false);
      } else {
        Alert.alert("Nothing to change", message || "Your plan already matches how you eat.");
      }
    } catch {
      Alert.alert("Error", "Could not work out plan changes from your logs.");
    } finally {
      setProposingEdits(false);
    }
  }, [plan]);

  const runStagePacing = useCallback(
    async (option: PacingOption) => {
      if (!plan) return;
      setStagingPacingId(option.id);
      try {
        const { suggestion } = await stagePacingOption(plan.id, option.id);
        if (suggestion) {
          setSuggestions(suggestion);
          setPlanChangedSince(false);
        } else {
          Alert.alert("Could not stage", "That pacing option is no longer available. Refresh and try again.");
        }
      } catch {
        Alert.alert("Error", "Could not stage this pacing change.");
      } finally {
        setStagingPacingId(null);
      }
    },
    [plan]
  );

  const load = useCallback(async () => {
    try {
      const [active, macrosRes] = await Promise.all([
        getActiveNutritionPlan(),
        apiClient.get("/api/macros").catch(() => ({ data: [] })),
      ]);
      setPlan(active);
      setMacroLogs(Array.isArray(macrosRes.data) ? macrosRes.data : []);
      if (active) {
        loadSuggestions();
        loadReview(active.id);
        loadCheckin(active.id);
      }
    } catch (error) {
      console.error("Error loading nutrition plan:", error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const acceptSuggestions = async (editIds?: string[]) => {
    if (!suggestions) return;
    setSuggestionsBusy(true);
    try {
      const result = await applySuggestions(suggestions.id, editIds);
      // The response carries the merged plan, so no second round trip
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

  /** Accept-with-changes: open the normal editor prefilled from the suggestion. */
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

  /**
   * Tapping day cells fires one PATCH per tap. Responses can land out of
   * order, and an older one carries the older day set — applying it would
   * silently undo the taps that came after it. Only the newest save writes
   * state back.
   */
  const saveSeq = useRef(0);

  const savePatch = async (patch: Partial<NutritionPlan>) => {
    if (!plan) return false;
    const seq = ++saveSeq.current;
    try {
      const updated = await updateNutritionPlan(plan.id, patch);
      if (seq !== saveSeq.current) return true;
      const preferAnchors = patch.meal_anchors ?? plan.meal_anchors ?? [];
      const preferById = new Map(
        preferAnchors.filter((a) => a.id).map((a) => [a.id as string, a])
      );
      const mergeAnchorKind = (a: MealAnchor): MealAnchor => {
        const local = a.id ? preferById.get(a.id) : undefined;
        const src = local || a;
        const kind =
          (src.kind as MealAnchor["kind"]) ||
          (src.uncertain ? "uncertain" : src.varies ? "potential" : "individual");
        return {
          ...a,
          ...(local || {}),
          kind,
          varies: kind === "potential",
          uncertain: kind === "uncertain",
          place: local?.place ?? a.place,
          days: local?.days ?? a.days,
          source: local?.source ?? a.source,
        };
      };
      let mealAnchors = updated.meal_anchors ?? patch.meal_anchors ?? plan.meal_anchors;
      if (mealAnchors?.length) {
        mealAnchors = mealAnchors.map(mergeAnchorKind);
      }
      let goTos = updated.go_to_items ?? patch.go_to_items ?? plan.go_to_items;
      if (patch.go_to_items?.length && goTos?.length) {
        const byId = new Map(
          patch.go_to_items.filter((g) => g.id).map((g) => [g.id as string, g])
        );
        goTos = goTos.map((g) => {
          const local = g.id ? byId.get(g.id) : undefined;
          if (!local) return g;
          return {
            ...g,
            ...local,
            days: local.days ?? g.days ?? [],
          };
        });
      }
      setPlan({
        ...updated,
        go_to_items: goTos,
        meal_anchors: mealAnchors,
        flexible_meals: updated.flexible_meals ?? patch.flexible_meals ?? plan.flexible_meals,
        blueprint_extras:
          updated.blueprint_extras ?? patch.blueprint_extras ?? plan.blueprint_extras,
        slot_profiles: updated.slot_profiles ?? patch.slot_profiles ?? plan.slot_profiles,
        fast_food_places:
          updated.fast_food_places ?? patch.fast_food_places ?? plan.fast_food_places,
      });
      return true;
    } catch (error: any) {
      // A newer save is already in flight — let it own the outcome instead of
      // reloading the plan out from under it.
      if (seq !== saveSeq.current) return true;
      // The server explains limits ("a plan holds up to 24 meal anchors") —
      // showing that beats a generic failure the user cannot act on.
      const detail = error?.response?.data?.detail;
      Alert.alert(
        "Error",
        typeof detail === "string" && detail ? detail : "Could not save that change."
      );
      return false;
    }
  };


  const openNewAnchor = () => {
    setEditingAnchor({
      slot: "breakfast",
      label: "",
      foods: [],
      frequency: "daily",
    });
    setEditingAnchorIndex(null);
    setAnchorEditorOpen(true);
  };

  const openNewAnchorForBand = (
    slot: PrimaryMealSlot | DayBand,
    kind: "individual" | "potential" | "uncertain" = "individual"
  ) => {
    const resolved: PrimaryMealSlot =
      slot === "Morning"
        ? "breakfast"
        : slot === "Midday"
          ? "lunch"
          : slot === "Evening"
            ? "dinner"
            : slot === "Late"
              ? "snack"
              : (slot as PrimaryMealSlot);
    const defaults =
      kind === "potential"
        ? { label: `${slotLabel(resolved)} options`, varies: true, uncertain: false, kind: "potential" as const }
        : kind === "uncertain"
          ? { label: `Uncertain ${slotLabel(resolved).toLowerCase()}`, varies: false, uncertain: true, kind: "uncertain" as const }
          : { label: slotLabel(resolved), varies: false, uncertain: false, kind: "individual" as const };
    setEditingAnchor({
      slot: resolved,
      foods: [],
      frequency: "daily",
      days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
      ...defaults,
    });
    setEditingAnchorIndex(null);
    setAnchorEditorOpen(true);
  };

  const openEditAnchor = (anchor: MealAnchor, index: number) => {
    setEditingAnchor(anchor);
    setEditingAnchorIndex(index);
    setAnchorEditorOpen(true);
  };

  const findAnchorIndex = (slot: { sourceId?: string; sourceIndex?: number }) => {
    if (!plan) return -1;
    if (slot.sourceId) {
      const byId = plan.meal_anchors.findIndex((a) => a.id === slot.sourceId);
      if (byId >= 0) return byId;
    }
    return typeof slot.sourceIndex === "number" ? slot.sourceIndex : -1;
  };

  const findFlexIndex = (slot: { sourceId?: string; sourceIndex?: number }) => {
    if (!plan) return -1;
    if (slot.sourceId) {
      const byId = (plan.flexible_meals || []).findIndex((m) => m.id === slot.sourceId);
      if (byId >= 0) return byId;
    }
    return typeof slot.sourceIndex === "number" ? slot.sourceIndex : -1;
  };

  const findExtraIndex = (slot: { sourceId?: string; sourceIndex?: number }) => {
    if (!plan) return -1;
    if (slot.sourceId) {
      const byId = (plan.blueprint_extras || []).findIndex((e) => e.id === slot.sourceId);
      if (byId >= 0) return byId;
    }
    return typeof slot.sourceIndex === "number" ? slot.sourceIndex : -1;
  };

  const handlePressBlueprintSlot = (slot: import("../../../lib/dayMap").DayMapSlot) => {
    if (!plan) return;
    if (slot.kind === "anchor") {
      const idx = findAnchorIndex(slot);
      if (idx >= 0 && plan.meal_anchors[idx]) openEditAnchor(plan.meal_anchors[idx], idx);
      return;
    }
    if (slot.kind === "flexible") {
      const idx = findFlexIndex(slot);
      if (idx >= 0 && plan.flexible_meals[idx]) openEditFlex(plan.flexible_meals[idx], idx);
      return;
    }
    if (slot.kind === "one_time") {
      const idx = findExtraIndex(slot);
      const extra = idx >= 0 ? plan.blueprint_extras?.[idx] : null;
      if (!extra) return;
      setEditingExtra(extra);
      setAddBand((extra.band as DayBand) || slot.band);
      return;
    }
    if (slot.kind === "suggest" || slot.kind === "goto") {
      const items = plan.go_to_items || [];
      const idx =
        items.findIndex((g) => g.id && g.id === slot.sourceId) >= 0
          ? items.findIndex((g) => g.id === slot.sourceId)
          : typeof slot.sourceIndex === "number"
            ? slot.sourceIndex
            : -1;
      if (idx >= 0 && items[idx]) openEditGoTo(items[idx], idx);
    }
  };

  const toggleBlueprintDay = async (
    slot: import("../../../lib/dayMap").DayMapSlot,
    dayId: string
  ) => {
    if (!plan) return;
    const day = String(dayId).slice(0, 3).toLowerCase();
    const normDays = (days?: string[] | null) =>
      (days || [])
        .map((d) => String(d).slice(0, 3).toLowerCase())
        .filter((d) => ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].includes(d));

    if (slot.kind === "anchor") {
      const idx = findAnchorIndex(slot);
      if (idx < 0 || !plan.meal_anchors[idx]) return;
      const anchor = plan.meal_anchors[idx];
      // Prefer the grid's days (includes daily/weekdays materialization) over raw storage.
      const current = normDays(slot.days?.length ? slot.days : anchor.days);
      const has = current.includes(day);
      const nextDays = has ? current.filter((d) => d !== day) : [...current, day];
      const anchors = [...plan.meal_anchors];
      anchors[idx] = {
        ...anchor,
        days: nextDays as any,
        frequency: nextDays.length === 7 ? "daily" : "most_days",
      };
      setPlan((prev) => (prev ? { ...prev, meal_anchors: anchors } : prev));
      const ok = await savePatch({ meal_anchors: anchors });
      if (!ok) await load();
      return;
    }
    if (slot.kind === "goto" || slot.kind === "suggest") {
      const items = [...(plan.go_to_items || [])];
      const idx =
        items.findIndex((g) => g.id && g.id === slot.sourceId) >= 0
          ? items.findIndex((g) => g.id === slot.sourceId)
          : typeof slot.sourceIndex === "number"
            ? slot.sourceIndex
            : -1;
      if (idx < 0 || !items[idx]) return;
      const item = items[idx];
      const current = normDays(slot.days?.length ? slot.days : item.days);
      const has = current.includes(day);
      const nextDays = has ? current.filter((d) => d !== day) : [...current, day];
      items[idx] = { ...item, days: nextDays as any };
      setPlan((prev) => (prev ? { ...prev, go_to_items: items } : prev));
      const ok = await savePatch({ go_to_items: items });
      if (!ok) await load();
    }
  };

  const saveAnchor = async (next: MealAnchor) => {
    if (!plan) return;
    const kind =
      next.kind ||
      (next.uncertain ? "uncertain" : next.varies ? "potential" : "individual");
    const normalized: MealAnchor = {
      ...next,
      kind,
      varies: kind === "potential",
      uncertain: kind === "uncertain",
    };
    const anchors = [...(plan.meal_anchors || [])];
    if (editingAnchorIndex != null && editingAnchorIndex >= 0) {
      anchors[editingAnchorIndex] = normalized;
    } else if (normalized.id) {
      const idx = anchors.findIndex((a) => a.id === normalized.id);
      if (idx >= 0) anchors[idx] = normalized;
      else anchors.push(normalized);
    } else {
      anchors.push(normalized);
    }
    // Optimistic UI so color updates even if the response is slow / stale.
    setPlan((prev) => (prev ? { ...prev, meal_anchors: anchors } : prev));
    const ok = await savePatch({ meal_anchors: anchors });
    if (!ok) {
      // Reload so we don't leave a lying optimistic state.
      await load();
    }
    setAnchorEditorOpen(false);
    setEditingAnchor(null);
    setEditingAnchorIndex(null);
  };

  const removeAnchor = (id?: string, index?: number) => {
    if (!plan) return;
    Alert.alert("Remove this regular food?", "", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          await savePatch({
            meal_anchors: plan.meal_anchors.filter((a, i) => (id ? a.id !== id : i !== index)),
          });
          setAnchorEditorOpen(false);
          setEditingAnchor(null);
          setEditingAnchorIndex(null);
        },
      },
    ]);
  };

  const openNewFlex = () => {
    setEditingFlex(null);
    setEditingFlexIndex(null);
    setFlexEditorOpen(true);
  };

  const openEditFlex = (meal: FlexibleMeal, index: number) => {
    setEditingFlex(meal);
    setEditingFlexIndex(index);
    setFlexEditorOpen(true);
  };

  const saveFlex = async (next: FlexibleMeal) => {
    if (!plan) return;
    const meals = [...(plan.flexible_meals || [])];
    if (editingFlexIndex != null && editingFlexIndex >= 0) {
      meals[editingFlexIndex] = next;
    } else if (next.id) {
      const idx = meals.findIndex((m) => m.id === next.id);
      if (idx >= 0) meals[idx] = next;
      else meals.push(next);
    } else {
      meals.push(next);
    }
    const ok = await savePatch({ flexible_meals: meals });
    if (!ok) return;
    setFlexEditorOpen(false);
    setEditingFlex(null);
    setEditingFlexIndex(null);
  };

  const removeFlex = (id?: string, index?: number) => {
    if (!plan) return;
    Alert.alert("Remove this flexible meal?", "", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          await savePatch({
            flexible_meals: plan.flexible_meals.filter((m, i) => (id ? m.id !== id : i !== index)),
          });
          setFlexEditorOpen(false);
          setEditingFlex(null);
          setEditingFlexIndex(null);
        },
      },
    ]);
  };

  const openNewGoTo = (slot?: PrimaryMealSlot | string) => {
    setEditingGoTo(slot ? { slot, name: "" } : null);
    setEditingGoToIndex(null);
    setGoToEditorOpen(true);
  };

  const openEditGoTo = (goTo: GoToItem, index: number) => {
    setEditingGoTo(goTo);
    setEditingGoToIndex(index);
    setGoToEditorOpen(true);
  };

  const saveGoTo = async (next: GoToItem) => {
    if (!plan) return;
    const normalized: GoToItem = {
      ...next,
      days: (next.days || []).map((d) => String(d).slice(0, 3).toLowerCase()),
    };
    const items = [...(plan.go_to_items || [])];
    if (editingGoToIndex != null && editingGoToIndex >= 0) {
      items[editingGoToIndex] = normalized;
    } else if (normalized.id) {
      const idx = items.findIndex((g) => g.id === normalized.id);
      if (idx >= 0) items[idx] = normalized;
      else items.push(normalized);
    } else {
      items.push(normalized);
    }
    setPlan((prev) => (prev ? { ...prev, go_to_items: items } : prev));
    const ok = await savePatch({ go_to_items: items });
    if (!ok) {
      await load();
      return;
    }
    setGoToEditorOpen(false);
    setEditingGoTo(null);
    setEditingGoToIndex(null);
  };

  const removeGoTo = (id?: string, index?: number) => {
    if (!plan) return;
    Alert.alert("Remove this go-to item?", "", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          await savePatch({
            go_to_items: (plan.go_to_items || []).filter((g, i) => (id ? g.id !== id : i !== index)),
          });
          setGoToEditorOpen(false);
          setEditingGoTo(null);
          setEditingGoToIndex(null);
        },
      },
    ]);
  };

  const handleBlueprintAdd = async (result: BlueprintAddResult) => {
    if (!plan) return;
    const editingId = editingExtra?.id || result.id;
    const wasEditing = !!editingExtra;
    setAddBand(null);
    setEditingExtra(null);

    if (wasEditing || editingId) {
      const extras = [...(plan.blueprint_extras || [])];
      const next: BlueprintExtra = {
        id: editingId,
        band: result.band,
        slot: result.slot,
        label: result.label,
        foods: result.foods,
        calories: result.calories,
        protein: result.protein,
        calorie_min: result.calorie_min,
        calorie_max: result.calorie_max,
        protein_min: result.protein_min,
        protein_max: result.protein_max,
        notes: result.notes,
      };
      const idx = extras.findIndex((e) => e.id && e.id === next.id);
      if (idx >= 0) extras[idx] = { ...extras[idx], ...next };
      else extras.push(next);
      await savePatch({ blueprint_extras: extras });
      return;
    }

    if (result.persistence === "anchor") {
      // Open full meal-anchor editor so they can pick specific foods.
      const foods = (result.foods || []).map((f) => ({
        name: f.name,
        calories: result.calories,
        protein: result.protein,
      }));
      setEditingAnchor({
        slot: result.slot,
        label: result.label,
        foods,
        frequency: "daily",
        notes: result.notes,
      });
      setEditingAnchorIndex(null);
      setAnchorEditorOpen(true);
      return;
    }

    if (result.persistence === "flexible") {
      setEditingFlex({
        name: result.label,
        frequency: "most_days",
        calorie_min: result.calorie_min ?? result.calories,
        calorie_max: result.calorie_max ?? result.calories,
        protein_min: result.protein_min ?? result.protein,
        protein_max: result.protein_max ?? result.protein,
        notes: result.notes,
      });
      setEditingFlexIndex(null);
      setFlexEditorOpen(true);
      return;
    }

    const next: BlueprintExtra = {
      band: result.band,
      slot: result.slot,
      label: result.label,
      foods: result.foods,
      calories: result.calories,
      protein: result.protein,
      calorie_min: result.calorie_min,
      calorie_max: result.calorie_max,
      protein_min: result.protein_min,
      protein_max: result.protein_max,
      notes: result.notes,
    };
    await savePatch({
      blueprint_extras: [...(plan.blueprint_extras || []), next],
    });
  };

  const removeBlueprintExtra = (id?: string) => {
    if (!plan || !id) return;
    Alert.alert("Remove this one-time meal?", "", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          await savePatch({
            blueprint_extras: (plan.blueprint_extras || []).filter((e) => e.id !== id),
          });
          setEditingExtra(null);
          setAddBand(null);
        },
      },
    ]);
  };

  const mapIdea = (idea: {
    label: string;
    foods?: Array<{
      name?: string;
      calories?: number | null;
      protein?: number | null;
      carbs?: number | null;
      fats?: number | null;
    }>;
    days?: string[];
    notes?: string;
  }, fallbackNotes?: string | null): SlotIdea => ({
    label: idea.label,
    foods: (idea.foods || []).map((f) => ({
      name: f.name,
      calories: f.calories ?? undefined,
      protein: f.protein ?? undefined,
      carbs: f.carbs ?? undefined,
      fats: f.fats ?? undefined,
    })),
    days: idea.days,
    notes: idea.notes || fallbackNotes || undefined,
  });

  const runSuggestSlot = async (
    slot: PrimaryMealSlot,
    mode: "preload" | "more" = "more"
  ) => {
    if (!plan) return;
    if (mode === "preload" && (preloadedSlots[slot] || suggestingSlot === slot)) return;
    if (mode === "more" && suggestingSlot) return;

    setSuggestingSlot(slot);
    if (mode === "preload") {
      setPreloadedSlots((prev) => ({ ...prev, [slot]: true }));
    }
    try {
      const stance =
        (plan.slot_profiles || []).find((p) => p.slot === slot)?.stance || "anchors";
      const existing = ideasBySlot[slot] || [];
      const suggestion = await suggestSlotFills(
        plan.id,
        slot,
        String(stance),
        normalizeAiModel(await AsyncStorage.getItem(AI_MODEL_STORAGE_KEY)),
        {
          count: mode === "preload" ? 1 : 2,
          excludeLabels: existing.map((i) => i.label),
        }
      );
      // Guidance, verdicts and the rotating-options meal describe the slot the
      // user already has, so they replace rather than accumulate.
      setSlotAi((prev) => ({
        ...prev,
        [slot]: {
          guidance: suggestion.guidance || prev[slot]?.guidance || null,
          verdicts: suggestion.anchor_verdicts?.length
            ? suggestion.anchor_verdicts
            : prev[slot]?.verdicts || [],
          optionsAnchor: suggestion.options_anchor
            ? mapIdea(suggestion.options_anchor, suggestion.options_anchor.notes)
            : prev[slot]?.optionsAnchor || null,
        },
      }));

      const mapped = (suggestion.ideas || [])
        .map((idea) => mapIdea(idea, suggestion.notes))
        .slice(0, mode === "preload" ? 1 : 2);
      if (mapped.length) {
        setIdeasBySlot((prev) => {
          const cur = prev[slot] || [];
          const seen = new Set(cur.map((i) => i.label.toLowerCase()));
          const fresh = mapped.filter((i) => !seen.has(i.label.toLowerCase()));
          return { ...prev, [slot]: [...cur, ...fresh].slice(0, 6) };
        });
      } else if (mode === "more") {
        Alert.alert("No more ideas", suggestion.notes || "Try again in a moment.");
      }
    } catch {
      if (mode === "preload") {
        // Allow a retry next time this slot is focused.
        setPreloadedSlots((prev) => ({ ...prev, [slot]: false }));
      } else {
        Alert.alert("Error", "Could not get AI suggestions.");
      }
    } finally {
      setSuggestingSlot(null);
    }
  };

  const addIdeaAsAnchor = (idea: SlotIdea, slot: PrimaryMealSlot) => {
    setEditingAnchor({
      slot,
      label: idea.label,
      foods: (idea.foods as any) || [{ name: idea.label }],
      frequency: "most_days",
      days: (idea.days as any) || ["mon", "tue", "wed", "thu", "fri"],
      notes: idea.notes || null,
      source: "ai_slot",
    });
    setEditingAnchorIndex(null);
    setAnchorEditorOpen(true);
  };

  /**
   * Save several meals the user already eats as one "potential" meal.
   *
   * Four separate dinner anchors would each reserve a dinner's worth of
   * calories; one option meal with four choices reserves one, which is what
   * actually happens when they pick between them.
   */
  const addOptionsAnchor = (idea: SlotIdea, slot: PrimaryMealSlot) => {
    setEditingAnchor({
      slot,
      label: idea.label || `${slotLabel(slot)} options`,
      kind: "potential",
      foods: (idea.foods as any) || [],
      frequency: "daily",
      days: (idea.days as any) || ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
      notes: idea.notes || null,
      source: "logged",
    });
    setEditingAnchorIndex(null);
    setAnchorEditorOpen(true);
  };

  const addLoggedMealAsAnchor = (pattern: LoggedMealPattern, slot: PrimaryMealSlot) => {
    const days =
      pattern.days?.length >= 2
        ? (pattern.days as any)
        : ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
    setEditingAnchor({
      slot,
      label: pattern.name,
      foods: [
        {
          name: pattern.name,
          amount: pattern.amount || null,
          calories: pattern.calories || null,
          protein: pattern.protein || null,
          carbs: pattern.carbs ?? null,
          fats: pattern.fats ?? null,
          fiber: pattern.fiber ?? null,
        },
      ],
      frequency: pattern.count >= 4 ? "most_days" : "few_times_week",
      days,
      kind: "individual",
      varies: false,
      uncertain: false,
      notes: pattern.count > 1 ? `Logged ${pattern.count}× in the last month` : null,
      source: "logged",
    });
    setEditingAnchorIndex(null);
    setAnchorEditorOpen(true);
  };

  const addFastFoodPlace = async (slot: PrimaryMealSlot, name: string) => {
    if (!plan) return;
    const places = [...(plan.fast_food_places || [])];
    const existing = places.find((p) => p.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      const slots = Array.from(new Set([...(existing.slots || []), slot]));
      const idx = places.findIndex((p) => p.id === existing.id || p.name === existing.name);
      places[idx] = { ...existing, slots };
    } else {
      places.push({ name, slots: [slot] });
    }
    await savePatch({ fast_food_places: places });
  };

  const runSuggestOrders = async (place: FastFoodPlace, slot: PrimaryMealSlot) => {
    if (!plan) return;
    const key = `${place.id || place.name}-${slot}`;
    setSuggestingPlaceId(place.id || place.name);
    try {
      const mapped = buildDayMap(plan);
      const remainingCal = Math.max(
        200,
        Number(plan.targets?.calories || 2200) - (mapped.stack.anchors || 0)
      );
      const remainingPro = Math.max(
        15,
        Number(plan.targets?.protein || 160) - (mapped.proteinPlanned || 0)
      );
      const suggestion = await suggestFastFoodOrders(
        plan.id,
        place.name,
        slot,
        { calories: remainingCal, protein: remainingPro },
        normalizeAiModel(await AsyncStorage.getItem(AI_MODEL_STORAGE_KEY))
      );
      setOrderSuggestions((prev) => ({
        ...prev,
        [key]: { orders: suggestion.orders || [], tip: suggestion.tip },
      }));
    } catch {
      Alert.alert("Error", "Could not suggest orders.");
    } finally {
      setSuggestingPlaceId(null);
    }
  };

  const logSuggestedOrder = async (
    order: { name: string; items?: string[]; calories?: number; protein?: number },
    slot: PrimaryMealSlot
  ) => {
    try {
      const date = new Date().toISOString().slice(0, 10);
      const meal =
        slot === "breakfast"
          ? "Breakfast"
          : slot === "lunch"
            ? "Lunch"
            : slot === "dinner"
              ? "Dinner"
              : "Snacks";
      const items = (order.items?.length ? order.items : [order.name]).map((name, i) => ({
        name,
        meal,
        calories: i === 0 ? order.calories ?? null : null,
        protein: i === 0 ? order.protein ?? null : null,
      }));
      // Put macros on the whole order as one food if multiple items lack macros
      const food_items =
        items.length > 1
          ? [
              {
                name: `${order.name}: ${(order.items || []).join(", ")}`,
                meal,
                calories: order.calories ?? null,
                protein: order.protein ?? null,
              },
            ]
          : items;
      const res = await apiClient.get("/api/macros");
      const entries = Array.isArray(res.data) ? res.data : [];
      const existing = entries.find((e: any) => e.date === date);
      if (existing) {
        await apiClient.put(`/api/macros/${existing.id}`, {
          ...existing,
          food_items: [...(existing.food_items || []), ...food_items],
        });
      } else {
        await apiClient.post("/api/macros", { date, food_items });
      }
      Alert.alert("Logged", `${order.name} added to today's ${meal}.`);
    } catch {
      Alert.alert("Error", "Could not log that order.");
    }
  };

  const confirmStatus = (title: string, message: string, action: () => Promise<void>) => {
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel" },
      {
        text: title,
        style: title === "End Plan" ? "destructive" : "default",
        onPress: async () => {
          try {
            await action();
            await load();
          } catch {
            Alert.alert("Error", `Could not ${title.toLowerCase()}.`);
          }
        },
      },
    ]);
  };

  const dayMap = useMemo(() => {
    if (!plan) return null;
    return buildDayMap(plan, {
      pendingTargetIds: pendingTargetIds(suggestions?.edits),
    });
  }, [plan, suggestions]);

  const { bySlot: coachEditsBySlot, general: generalCoachEdits } = useMemo(
    () => groupEditsBySlot(suggestions?.edits),
    [suggestions]
  );

  const coachEditCounts = useMemo(() => {
    const counts: Partial<Record<PrimaryMealSlot, number>> = {};
    (Object.keys(coachEditsBySlot) as PrimaryMealSlot[]).forEach((slot) => {
      const n = (coachEditsBySlot[slot] || []).filter((e) => e.status === "pending").length;
      if (n) counts[slot] = n;
    });
    return counts;
  }, [coachEditsBySlot]);

  const mealPendingCount = useMemo(
    () => Object.values(coachEditCounts).reduce((sum, n) => sum + (n || 0), 0),
    [coachEditCounts]
  );

  // Verdicts arrive per slot but render per meal row, so they are flattened to
  // a lookup by anchor id.
  const anchorVerdicts = useMemo(() => {
    const byAnchor: Record<string, AnchorVerdict> = {};
    Object.values(slotAi).forEach((entry) => {
      (entry.verdicts || []).forEach((v) => {
        if (v.anchor_id) byAnchor[String(v.anchor_id)] = v;
      });
    });
    return byAnchor;
  }, [slotAi]);

  const slotGuidance = useMemo(() => {
    const out: Partial<Record<PrimaryMealSlot, string | null>> = {};
    (Object.keys(slotAi) as PrimaryMealSlot[]).forEach((slot) => {
      out[slot] = slotAi[slot]?.guidance || null;
    });
    return out;
  }, [slotAi]);

  const optionsAnchors = useMemo(() => {
    const out: Partial<Record<PrimaryMealSlot, SlotIdea | null>> = {};
    (Object.keys(slotAi) as PrimaryMealSlot[]).forEach((slot) => {
      out[slot] = slotAi[slot]?.optionsAnchor || null;
    });
    return out;
  }, [slotAi]);

  // Top banner: plan-wide edits (targets/strategy) in full. Meal edits are
  // reviewed under breakfast / lunch / dinner on the DayMap — only a summary
  // + Accept all sits up top when those exist.
  const topSuggestionSet = useMemo(() => {
    if (!suggestions) return null;
    const mealScoped = (suggestions.edits || []).filter((e) => {
      if (e.status !== "pending" && e.status !== "stale") return false;
      return !generalCoachEdits.some((g) => g.id === e.id);
    });
    if (!generalCoachEdits.length && !mealScoped.length) return null;
    if (!generalCoachEdits.length) {
      return {
        ...suggestions,
        edits: [],
        summary:
          mealPendingCount > 0
            ? `${mealPendingCount} meal update${mealPendingCount === 1 ? "" : "s"} under breakfast / lunch / dinner below`
            : suggestions.summary,
      } as NutritionSuggestionSet;
    }
    return {
      ...suggestions,
      edits: generalCoachEdits,
      summary: suggestions.summary,
    } as NutritionSuggestionSet;
  }, [suggestions, generalCoachEdits, mealPendingCount]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.accentPrimary} />
      </View>
    );
  }

  if (!plan) {
    return (
      <View style={styles.container}>
        <View style={styles.empty}>
          <MaterialCommunityIcons name="food-apple-outline" size={36} color={colors.accentPrimary} />
          <Text style={styles.emptyTitle}>No nutrition plan</Text>
          <Text style={styles.emptyBody}>
            Answer a few questions about how you actually eat. We'll save regular foods and
            flexible meals so Today can guide you around them — not a new menu every day.
          </Text>
          <TouchableOpacity style={styles.primary} onPress={() => setCreateOpen(true)}>
            <Text style={styles.primaryText}>Create Nutrition Plan</Text>
          </TouchableOpacity>
          {onAskCoach ? (
            <TouchableOpacity
              style={styles.secondary}
              onPress={() => onAskCoach("I want a nutrition plan that supports my training. ")}
            >
              <Text style={styles.secondaryText}>Design with Coach</Text>
            </TouchableOpacity>
          ) : null}
        </View>
        <CreateNutritionPlanModal
          visible={createOpen}
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false);
            load();
          }}
        />
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
        <View style={styles.statusRow}>
          <View style={[styles.badge, plan.status === "paused" ? styles.badgePaused : styles.badgeActive]}>
            <Text
              style={[
                styles.badgeText,
                { color: plan.status === "paused" ? "#F59E0B" : "#4ADE80" },
              ]}
            >
              {plan.status === "paused" ? "PAUSED" : "ACTIVE"}
            </Text>
          </View>
          <TouchableOpacity onPress={() => setCreateOpen(true)}>
            <Text style={styles.link}>New plan</Text>
          </TouchableOpacity>
        </View>

        {healthFocusLabels(plan.health_focuses).length ? (
          <View style={styles.focusBanner}>
            <Text style={styles.focusBannerTitle}>
              Built around {healthFocusLabels(plan.health_focuses).join(" · ").toLowerCase()}
            </Text>
            <Text style={styles.focusBannerBody}>{HEALTH_FOCUS_DISCLAIMER}</Text>
          </View>
        ) : null}

        {plan.carryover_note ? (
          <View style={styles.carryover}>
            <Text style={styles.carryoverText}>{plan.carryover_note}</Text>
            <TouchableOpacity onPress={() => savePatch({ carryover_note: "" })}>
              <Text style={styles.carryoverDismiss}>Got it</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {topSuggestionSet ? (
          <PlanSuggestions
            set={topSuggestionSet}
            planChangedSince={planChangedSince}
            busy={suggestionsBusy}
            showAcceptAll={
              mealPendingCount > 0 ||
              generalCoachEdits.some((e) => e.status === "pending")
            }
            onAccept={acceptSuggestions}
            onDismiss={rejectSuggestions}
            onEdit={editSuggestion}
          />
        ) : null}

        <PlanReviewCard
          review={review}
          loading={reviewLoading}
          onRefresh={() => loadReview(plan.id, true)}
          onAskCoach={onAskCoach}
        />

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

        {dayMap ? (
          <DayMap
            map={dayMap}
            onAddAnchor={openNewAnchorForBand}
            onAddGoTo={(slot) => openNewGoTo(slot)}
            onPressSlot={handlePressBlueprintSlot}
            onToggleDay={toggleBlueprintDay}
            onSuggestSlot={(slot) => runSuggestSlot(slot, "more")}
            onPreloadSlot={(slot) => runSuggestSlot(slot, "preload")}
            suggestingSlot={suggestingSlot}
            slotIdeas={ideasBySlot}
            onAddIdea={addIdeaAsAnchor}
            anchorVerdicts={anchorVerdicts}
            slotGuidance={slotGuidance}
            optionsAnchors={optionsAnchors}
            onAddOptionsAnchor={addOptionsAnchor}
            macroLogs={macroLogs}
            onAddLoggedMeal={addLoggedMealAsAnchor}
            onAddPlace={addFastFoodPlace}
            onSuggestOrders={runSuggestOrders}
            suggestingPlaceId={suggestingPlaceId}
            orderSuggestions={orderSuggestions}
            onLogOrder={logSuggestedOrder}
            coachEditsBySlot={coachEditsBySlot}
            coachEditCounts={coachEditCounts}
            suggestionsBusy={suggestionsBusy}
            onAcceptCoachEdit={(editId) => acceptSuggestions([editId])}
            onDismissCoachEdit={(editId) => rejectSuggestions([editId])}
            onEditCoachEdit={editSuggestion}
          />
        ) : (
          <>
            <Text style={styles.title}>{goalLabel(plan.goal)}</Text>
            {plan.goal_detail ? <Text style={styles.subtitle}>{plan.goal_detail}</Text> : null}
          </>
        )}

        {onAskCoach ? (
          <TouchableOpacity
            style={styles.coachBtn}
            onPress={() =>
              onAskCoach(`I want to adjust my nutrition plan (${goalLabel(plan.goal)}). `)
            }
          >
            <MaterialCommunityIcons name="chat-processing-outline" size={18} color={colors.accentPrimary} />
            <Text style={styles.coachBtnText}>Adjust with Coach</Text>
          </TouchableOpacity>
        ) : null}

        <View style={styles.footerActions}>
          {plan.status === "paused" ? (
            <TouchableOpacity
              onPress={() =>
                confirmStatus("Resume Plan", "Use this plan for Today guidance again?", () =>
                  resumeNutritionPlan(plan.id)
                )
              }
            >
              <Text style={styles.footerLink}>Resume plan</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              onPress={() =>
                confirmStatus("Pause Plan", "Today will stop using this plan until you resume.", () =>
                  pauseNutritionPlan(plan.id)
                )
              }
            >
              <Text style={styles.footerLink}>Pause plan</Text>
            </TouchableOpacity>
          )}
          <Text style={styles.footerDivider}>|</Text>
          <TouchableOpacity
            onPress={() =>
              confirmStatus("End Plan", "This plan will no longer drive Today guidance.", () =>
                endNutritionPlan(plan.id)
              )
            }
          >
            <Text style={[styles.footerLink, styles.footerDanger]}>End plan</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      <CreateNutritionPlanModal
        visible={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          setCreateOpen(false);
          load();
        }}
      />

      <EditMealAnchorModal
        visible={anchorEditorOpen}
        anchor={editingAnchor}
        onClose={() => {
          setAnchorEditorOpen(false);
          setEditingAnchor(null);
          setEditingAnchorIndex(null);
        }}
        onSave={saveAnchor}
        onDelete={
          editingAnchorIndex != null
            ? () => removeAnchor(editingAnchor?.id, editingAnchorIndex)
            : undefined
        }
      />

      <EditFlexibleMealModal
        visible={flexEditorOpen}
        meal={editingFlex}
        onClose={() => {
          setFlexEditorOpen(false);
          setEditingFlex(null);
          setEditingFlexIndex(null);
        }}
        onSave={saveFlex}
        onDelete={
          editingFlexIndex != null
            ? () => removeFlex(editingFlex?.id, editingFlexIndex)
            : undefined
        }
      />

      <EditGoToItemModal
        visible={goToEditorOpen}
        item={editingGoTo}
        onClose={() => {
          setGoToEditorOpen(false);
          setEditingGoTo(null);
          setEditingGoToIndex(null);
        }}
        onSave={saveGoTo}
        onDelete={
          editingGoToIndex != null
            ? () => removeGoTo(editingGoTo?.id, editingGoToIndex)
            : undefined
        }
      />

      <AddBlueprintModal
        visible={!!addBand}
        band={addBand}
        editing={editingExtra}
        onClose={() => {
          setAddBand(null);
          setEditingExtra(null);
        }}
        onSave={handleBlueprintAdd}
        onDelete={
          editingExtra?.id ? () => removeBlueprintExtra(editingExtra.id) : undefined
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  scroll: { padding: spacing.lg, paddingBottom: spacing["3xl"] },
  empty: {
    margin: spacing.lg,
    backgroundColor: "#1C1C1E",
    borderRadius: borderRadius.xl,
    padding: spacing.xl,
    borderWidth: 1.5,
    borderColor: colors.accentPrimary,
    gap: spacing.sm,
  },
  emptyTitle: { fontSize: 18, fontWeight: "700", color: colors.textPrimary, marginTop: spacing.sm },
  emptyBody: { fontSize: 14, color: colors.textSecondary, lineHeight: 20, marginBottom: spacing.md },
  statusRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.sm,
  },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  badgeActive: { backgroundColor: "rgba(74,222,128,0.15)" },
  badgePaused: { backgroundColor: "rgba(245,158,11,0.15)" },
  badgeText: { fontSize: 11, fontWeight: "800", letterSpacing: 0.5 },
  title: { fontSize: 28, fontWeight: "700", color: colors.textPrimary, marginBottom: 4 },
  subtitle: { fontSize: 14, color: colors.textSecondary, lineHeight: 20, marginBottom: spacing.md },
  link: { color: colors.accentPrimary, fontWeight: "700", fontSize: 14 },
  addLink: { color: colors.accentPrimary, fontWeight: "700", fontSize: 13 },
  targetsStrip: {
    backgroundColor: colors.cardBackground,
    borderRadius: 16,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
  },
  targetHero: { marginTop: 4, marginBottom: spacing.sm },
  card: {
    backgroundColor: colors.cardBackground,
    borderRadius: 16,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
  },
  cardHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.sm,
  },
  cardTitle: { fontSize: 15, fontWeight: "700", color: colors.textPrimary },
  kcalValue: { fontSize: 36, fontWeight: "700", color: colors.textPrimary },
  kcalUnit: { fontSize: 13, fontWeight: "600", color: colors.textMuted, marginTop: 2 },
  kcalRange: { fontSize: 13, color: colors.textSecondary, marginTop: 4 },
  macroStrip: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: spacing.sm,
  },
  macroChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.background,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: colors.border,
  },
  macroDot: { width: 6, height: 6, borderRadius: 3 },
  macroValue: { fontSize: 13, fontWeight: "700", color: colors.textPrimary },
  macroLabel: { fontSize: 11, color: colors.textMuted, fontWeight: "600" },
  focusBanner: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    gap: 3,
  },
  focusBannerTitle: { fontSize: 13, fontWeight: "700", color: colors.textPrimary },
  focusBannerBody: { fontSize: 12, color: colors.textMuted, lineHeight: 17 },
  carryover: {
    borderWidth: 1,
    borderColor: "rgba(94,234,212,0.35)",
    backgroundColor: "rgba(94,234,212,0.10)",
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    gap: 6,
  },
  carryoverText: { fontSize: 13, color: "#5EEAD4", lineHeight: 19, fontWeight: "600" },
  carryoverDismiss: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.textMuted,
    alignSelf: "flex-end",
  },
  strategyIntro: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
    marginBottom: spacing.md,
  },
  strategyPeek: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.cardBackground,
    borderRadius: 14,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
  },
  strategyPeekTitle: { fontSize: 15, fontWeight: "700", color: colors.textPrimary },
  strategyPeekBody: { fontSize: 12, color: colors.textMuted, marginTop: 3 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "800",
    color: colors.textMuted,
    letterSpacing: 0.8,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  sectionBlock: { marginBottom: spacing.md, gap: 8 },
  sectionHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  sectionTitle: { fontSize: 16, fontWeight: "700", color: colors.textPrimary },
  sectionHint: { fontSize: 12, color: colors.textMuted, marginBottom: 6, lineHeight: 16 },
  listCard: {
    backgroundColor: colors.cardBackground,
    borderRadius: 14,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  slotIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: "rgba(156, 192, 232,0.12)",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  slotIconFlex: { backgroundColor: "rgba(196,181,253,0.14)" },
  slotIconSuggest: { backgroundColor: "rgba(94,234,212,0.12)" },
  listTitle: { fontSize: 15, fontWeight: "700", color: colors.textPrimary },
  listMeta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  listBody: { fontSize: 13, color: colors.textSecondary, marginTop: 4, lineHeight: 18 },
  listNote: { fontSize: 12, color: colors.textMuted, marginTop: 6, lineHeight: 16 },
  pillRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  pill: {
    backgroundColor: colors.background,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pillText: { fontSize: 12, color: colors.textSecondary, fontWeight: "600" },
  priorityRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginTop: 10 },
  priorityText: { flex: 1, fontSize: 14, color: colors.textSecondary, lineHeight: 20 },
  prefStyle: { fontSize: 13, color: colors.textMuted, marginTop: 4, marginBottom: 8 },
  tagRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tag: {
    backgroundColor: colors.background,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tagText: { fontSize: 13, color: colors.textPrimary, fontWeight: "600" },
  coachBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(156, 192, 232,0.45)",
  },
  coachBtnText: { color: colors.accentPrimary, fontWeight: "700", fontSize: 14 },
  footerActions: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 16,
    marginTop: spacing.xl,
    marginBottom: spacing.lg,
  },
  footerLink: { color: colors.accentPrimary, fontWeight: "700", fontSize: 14 },
  footerDanger: { color: colors.danger },
  footerDivider: { color: colors.textMuted, fontSize: 14 },
  editGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  editField: { width: "47%" },
  label: { fontSize: 11, fontWeight: "700", color: colors.textMuted, marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    color: colors.textPrimary,
    padding: spacing.sm,
    backgroundColor: colors.background,
  },
  emptyHint: { fontSize: 13, color: colors.textMuted, paddingVertical: 8 },
  primary: {
    backgroundColor: colors.accentPrimary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    alignItems: "center",
  },
  primaryText: { color: colors.onAccent, fontWeight: "700" },
  secondary: {
    marginTop: spacing.sm,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.accentPrimary,
  },
  secondaryText: { color: colors.accentPrimary, fontWeight: "700" },
});
