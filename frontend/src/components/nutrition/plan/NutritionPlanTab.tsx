import { useCallback, useEffect, useMemo, useState } from "react";
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
import EditMealAnchorModal, { slotIcon, sumAnchorMacros } from "./EditMealAnchorModal";
import EditGoToItemModal from "./EditGoToItemModal";
import EditFlexibleMealModal from "./EditFlexibleMealModal";
import DayMap from "./DayMap";
import AddBlueprintModal, { BlueprintAddResult } from "./AddBlueprintModal";
import {
  BlueprintExtra,
  DayBand,
  FastFoodPlace,
  FlexibleMeal,
  GoToItem,
  MealAnchor,
  NutritionPlan,
  PrimaryMealSlot,
  SlotStance,
  endNutritionPlan,
  frequencyLabel,
  getActiveNutritionPlan,
  goalLabel,
  pauseNutritionPlan,
  resumeNutritionPlan,
  slotLabel,
  suggestFastFoodOrders,
  suggestSlotFills,
  updateNutritionPlan,
} from "../../../api/nutritionPlan";
import { buildDayMap } from "../../../lib/dayMap";
import { AI_MODEL_STORAGE_KEY, normalizeAiModel } from "../../../lib/aiModels";
import apiClient from "../../../api/client";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { colors, spacing, borderRadius } from "../../../theme";

interface Props {
  onAskCoach?: (prompt: string) => void;
}

const MACRO_TILES = [
  { key: "protein", label: "Protein", icon: "food-steak" as const, color: "#FF6B35", unit: "g" },
  { key: "carbs", label: "Carbs", icon: "barley" as const, color: "#F5C542", unit: "g" },
  { key: "fats", label: "Fat", icon: "water" as const, color: "#C4B5FD", unit: "g" },
  { key: "fiber", label: "Fiber", icon: "leaf" as const, color: "#4ADE80", unit: "g" },
];

export default function NutritionPlanTab({ onAskCoach }: Props) {
  const [plan, setPlan] = useState<NutritionPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingTargets, setEditingTargets] = useState(false);
  const [cal, setCal] = useState("");
  const [protein, setProtein] = useState("");
  const [carbs, setCarbs] = useState("");
  const [fats, setFats] = useState("");
  const [fiber, setFiber] = useState("");
  const [editingFlex, setEditingFlex] = useState<FlexibleMeal | null>(null);
  const [editingFlexIndex, setEditingFlexIndex] = useState<number | null>(null);
  const [flexEditorOpen, setFlexEditorOpen] = useState(false);
  const [editingAnchor, setEditingAnchor] = useState<MealAnchor | null>(null);
  const [editingAnchorIndex, setEditingAnchorIndex] = useState<number | null>(null);
  const [anchorEditorOpen, setAnchorEditorOpen] = useState(false);
  const [editingGoTo, setEditingGoTo] = useState<GoToItem | null>(null);
  const [editingGoToIndex, setEditingGoToIndex] = useState<number | null>(null);
  const [goToEditorOpen, setGoToEditorOpen] = useState(false);
  const [strategyOpen, setStrategyOpen] = useState(false);
  const [addBand, setAddBand] = useState<DayBand | null>(null);
  const [editingExtra, setEditingExtra] = useState<BlueprintExtra | null>(null);
  const [suggestingSlot, setSuggestingSlot] = useState<string | null>(null);
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

  const load = useCallback(async () => {
    try {
      const active = await getActiveNutritionPlan();
      setPlan(active);
      if (active?.targets) {
        setCal(String(active.targets.calories ?? ""));
        setProtein(String(active.targets.protein ?? ""));
        setCarbs(String(active.targets.carbs ?? ""));
        setFats(String(active.targets.fats ?? ""));
        setFiber(String(active.targets.fiber ?? ""));
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

  const savePatch = async (patch: Partial<NutritionPlan>) => {
    if (!plan) return false;
    try {
      const updated = await updateNutritionPlan(plan.id, patch);
      setPlan({
        ...updated,
        go_to_items: updated.go_to_items ?? patch.go_to_items ?? plan.go_to_items,
        meal_anchors: updated.meal_anchors ?? patch.meal_anchors ?? plan.meal_anchors,
        flexible_meals: updated.flexible_meals ?? patch.flexible_meals ?? plan.flexible_meals,
        blueprint_extras:
          updated.blueprint_extras ?? patch.blueprint_extras ?? plan.blueprint_extras,
        slot_profiles: updated.slot_profiles ?? patch.slot_profiles ?? plan.slot_profiles,
        fast_food_places:
          updated.fast_food_places ?? patch.fast_food_places ?? plan.fast_food_places,
      });
      return true;
    } catch {
      Alert.alert("Error", "Could not save that change.");
      return false;
    }
  };

  const saveTargets = async () => {
    await savePatch({
      targets: {
        ...plan?.targets,
        calories: Number(cal) || plan?.targets.calories,
        protein: Number(protein) || plan?.targets.protein,
        carbs: Number(carbs) || plan?.targets.carbs,
        fats: Number(fats) || plan?.targets.fats,
        fiber: Number(fiber) || plan?.targets.fiber,
      },
    });
    setEditingTargets(false);
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

  const openNewAnchorForBand = (slot: PrimaryMealSlot | DayBand) => {
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
    setEditingAnchor({
      slot: resolved,
      label: slotLabel(resolved),
      foods: [],
      frequency: "daily",
      days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
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
    if (slot.kind === "suggest") {
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

  const saveAnchor = async (next: MealAnchor) => {
    if (!plan) return;
    const anchors = [...(plan.meal_anchors || [])];
    if (editingAnchorIndex != null && editingAnchorIndex >= 0) {
      anchors[editingAnchorIndex] = next;
    } else if (next.id) {
      const idx = anchors.findIndex((a) => a.id === next.id);
      if (idx >= 0) anchors[idx] = next;
      else anchors.push(next);
    } else {
      anchors.push(next);
    }
    await savePatch({ meal_anchors: anchors });
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

  const openNewGoTo = () => {
    setEditingGoTo(null);
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
    const items = [...(plan.go_to_items || [])];
    if (editingGoToIndex != null && editingGoToIndex >= 0) {
      items[editingGoToIndex] = next;
    } else if (next.id) {
      const idx = items.findIndex((g) => g.id === next.id);
      if (idx >= 0) items[idx] = next;
      else items.push(next);
    } else {
      items.push(next);
    }
    const ok = await savePatch({ go_to_items: items });
    if (!ok) return;
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

  const setSlotStance = async (slot: PrimaryMealSlot, stance: SlotStance) => {
    if (!plan) return;
    const profiles = [...(plan.slot_profiles || [])];
    const idx = profiles.findIndex((p) => p.slot === slot);
    if (idx >= 0) profiles[idx] = { ...profiles[idx], stance };
    else profiles.push({ slot, stance, notes: null });
    // ensure all primary slots exist via backend normalize
    await savePatch({ slot_profiles: profiles });
  };

  const runSuggestSlot = async (slot: PrimaryMealSlot) => {
    if (!plan) return;
    setSuggestingSlot(slot);
    try {
      const stance =
        (plan.slot_profiles || []).find((p) => p.slot === slot)?.stance || "anchors";
      const suggestion = await suggestSlotFills(
        plan.id,
        slot,
        String(stance),
        normalizeAiModel(await AsyncStorage.getItem(AI_MODEL_STORAGE_KEY))
      );
      if (suggestion.ideas?.length) {
        Alert.alert(
          `Ideas for ${slotLabel(slot)}`,
          suggestion.ideas
            .map(
              (idea, i) =>
                `${i + 1}. ${idea.label}${
                  idea.foods?.length ? ` — ${idea.foods.map((f) => f.name).join(", ")}` : ""
                }`
            )
            .join("\n\n") + (suggestion.notes ? `\n\n${suggestion.notes}` : ""),
          [
            { text: "Close", style: "cancel" },
            {
              text: "Add first idea",
              onPress: () => {
                const idea = suggestion.ideas[0];
                setEditingAnchor({
                  slot,
                  label: idea.label,
                  foods: idea.foods || [{ name: idea.label }],
                  frequency: "most_days",
                  days: (idea.days as any) || ["mon", "tue", "wed", "thu", "fri"],
                  notes: idea.notes || null,
                });
                setEditingAnchorIndex(null);
                setAnchorEditorOpen(true);
              },
            },
          ]
        );
      } else {
        Alert.alert("No ideas yet", suggestion.notes || "Try again in a moment.");
      }
    } catch {
      Alert.alert("Error", "Could not get AI suggestions.");
    } finally {
      setSuggestingSlot(null);
    }
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

  const dayMap = useMemo(() => (plan ? buildDayMap(plan) : null), [plan]);

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

  const range =
    plan.targets.calories_min && plan.targets.calories_max
      ? `${plan.targets.calories_min}–${plan.targets.calories_max} kcal`
      : null;

  const macroValues: Record<string, number | null | undefined> = {
    protein: plan.targets.protein,
    carbs: plan.targets.carbs,
    fats: plan.targets.fats,
    fiber: plan.targets.fiber,
  };

  const preferenceTags = [
    ...(plan.preferences?.likes || []),
    ...(plan.preferences?.dislikes || []).map((d) => `No ${d}`),
  ];
  if (plan.preferences?.dietary_restrictions) {
    preferenceTags.push(plan.preferences.dietary_restrictions);
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

        <Text style={styles.title}>{goalLabel(plan.goal)}</Text>
        {plan.goal_detail ? <Text style={styles.subtitle}>{plan.goal_detail}</Text> : null}

        {dayMap ? (
          <DayMap
            map={dayMap}
            strategyExpanded={strategyOpen}
            onEditStrategy={() => setStrategyOpen((v) => !v)}
            onAddAnchor={openNewAnchorForBand}
            onPressSlot={handlePressBlueprintSlot}
            onStanceChange={setSlotStance}
            onSuggestSlot={runSuggestSlot}
            suggestingSlot={suggestingSlot}
            onAddPlace={addFastFoodPlace}
            onSuggestOrders={runSuggestOrders}
            suggestingPlaceId={suggestingPlaceId}
            orderSuggestions={orderSuggestions}
            onLogOrder={logSuggestedOrder}
          />
        ) : null}

        <View style={styles.targetsStrip}>
          <View style={styles.cardHead}>
            <Text style={styles.cardTitle}>Daily targets</Text>
            <TouchableOpacity onPress={() => (editingTargets ? saveTargets() : setEditingTargets(true))}>
              <Text style={styles.link}>{editingTargets ? "Save" : "Edit"}</Text>
            </TouchableOpacity>
          </View>

          {editingTargets ? (
            <View style={styles.editGrid}>
              {[
                ["Calories", cal, setCal],
                ["Protein", protein, setProtein],
                ["Carbs", carbs, setCarbs],
                ["Fat", fats, setFats],
                ["Fiber", fiber, setFiber],
              ].map(([label, val, set]) => (
                <View key={label as string} style={styles.editField}>
                  <Text style={styles.label}>{label as string}</Text>
                  <TextInput
                    style={styles.input}
                    keyboardType="numeric"
                    value={val as string}
                    onChangeText={set as (v: string) => void}
                  />
                </View>
              ))}
            </View>
          ) : (
            <>
              <View style={styles.targetHero}>
                <Text style={styles.kcalValue}>
                  {plan.targets.calories?.toLocaleString() ?? "—"}
                </Text>
                <Text style={styles.kcalUnit}>kcal / day</Text>
                {range ? <Text style={styles.kcalRange}>{range}</Text> : null}
              </View>
              <View style={styles.macroStrip}>
                {MACRO_TILES.map((tile) => {
                  const value = macroValues[tile.key];
                  return (
                    <View key={tile.key} style={styles.macroChip}>
                      <View style={[styles.macroDot, { backgroundColor: tile.color }]} />
                      <Text style={styles.macroValue}>
                        {value ?? "—"}
                        {value != null ? tile.unit : ""}
                      </Text>
                      <Text style={styles.macroLabel}>{tile.label}</Text>
                    </View>
                  );
                })}
              </View>
            </>
          )}
        </View>

        {strategyOpen ? (
          <>
            <Text style={styles.sectionLabel}>YOUR STRATEGY</Text>
            <Text style={styles.strategyIntro}>
              Anchors are meals you repeat. Flexible meals are less controlled. Go-tos fill gaps on the day map.
            </Text>

            <View style={styles.sectionBlock}>
              <View style={styles.sectionHead}>
                <Text style={styles.sectionTitle}>Meal Anchors</Text>
                <TouchableOpacity onPress={openNewAnchor}>
                  <Text style={styles.addLink}>+ Add</Text>
                </TouchableOpacity>
              </View>

              {(plan.meal_anchors || []).map((anchor, i) => {
                const macros = sumAnchorMacros(anchor.foods || []);
                const hasMacros =
                  macros.calories > 0 || macros.protein > 0 || macros.carbs > 0 || macros.fats > 0;
                return (
                  <TouchableOpacity
                    key={anchor.id || `${anchor.label}-${i}`}
                    style={styles.listCard}
                    onPress={() => openEditAnchor(anchor, i)}
                    onLongPress={() => removeAnchor(anchor.id, i)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.slotIconWrap}>
                      <MaterialCommunityIcons
                        name={slotIcon(anchor.slot)}
                        size={20}
                        color={colors.accentPrimary}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.listTitle}>{anchor.label}</Text>
                      <Text style={styles.listMeta}>{frequencyLabel(anchor.frequency)}</Text>
                      <Text style={styles.listBody}>
                        {(anchor.foods || []).map((f) => f.name).join(", ") || "No foods listed"}
                      </Text>
                      {hasMacros ? (
                        <View style={styles.pillRow}>
                          <View style={styles.pill}>
                            <Text style={styles.pillText}>{Math.round(macros.calories)} kcal</Text>
                          </View>
                          <View style={styles.pill}>
                            <Text style={styles.pillText}>{Math.round(macros.protein)}g protein</Text>
                          </View>
                        </View>
                      ) : null}
                    </View>
                    <MaterialCommunityIcons name="chevron-right" size={20} color={colors.textMuted} />
                  </TouchableOpacity>
                );
              })}

              {!plan.meal_anchors?.length ? (
                <Text style={styles.emptyHint}>No regular foods saved yet. Tap + Add to log macros.</Text>
              ) : null}
            </View>

            <View style={styles.sectionBlock}>
              <View style={styles.sectionHead}>
                <Text style={styles.sectionTitle}>Flexible Meals</Text>
                <TouchableOpacity onPress={openNewFlex}>
                  <Text style={styles.addLink}>+ Add</Text>
                </TouchableOpacity>
              </View>

              {(plan.flexible_meals || []).map((meal, i) => (
                <TouchableOpacity
                  key={meal.id || `${meal.name}-${i}`}
                  style={styles.listCard}
                  onPress={() => openEditFlex(meal, i)}
                  onLongPress={() => removeFlex(meal.id, i)}
                  activeOpacity={0.7}
                >
                  <View style={[styles.slotIconWrap, styles.slotIconFlex]}>
                    <MaterialCommunityIcons
                      name="silverware-fork-knife"
                      size={20}
                      color="#C4B5FD"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.listTitle}>{meal.name}</Text>
                    <Text style={styles.listMeta}>{frequencyLabel(meal.frequency)}</Text>
                    <Text style={styles.listBody}>
                      {meal.calorie_min || "?"}–{meal.calorie_max || "?"} kcal
                      {meal.protein_min || meal.protein_max
                        ? ` · ${meal.protein_min || "?"}–${meal.protein_max || "?"}g protein`
                        : ""}
                    </Text>
                    {meal.notes ? <Text style={styles.listNote}>{meal.notes}</Text> : null}
                  </View>
                  <MaterialCommunityIcons name="chevron-right" size={20} color={colors.textMuted} />
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.sectionBlock}>
              <View style={styles.sectionHead}>
                <Text style={styles.sectionTitle}>Go To</Text>
                <TouchableOpacity onPress={openNewGoTo}>
                  <Text style={styles.addLink}>+ Add</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.sectionHint}>
                Staples the day map can suggest when anchors + flexible meals leave a gap.
              </Text>

              {(plan.go_to_items || []).map((goTo, i) => {
                const hasMacros =
                  (Number(goTo.calories) || 0) > 0 ||
                  (Number(goTo.protein) || 0) > 0;
                return (
                  <TouchableOpacity
                    key={goTo.id || `${goTo.name}-${i}`}
                    style={styles.listCard}
                    onPress={() => openEditGoTo(goTo, i)}
                    onLongPress={() => removeGoTo(goTo.id, i)}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.slotIconWrap, styles.slotIconSuggest]}>
                      <MaterialCommunityIcons
                        name={slotIcon(goTo.slot || "other")}
                        size={20}
                        color={colors.ai}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.listTitle}>{goTo.name}</Text>
                      <Text style={styles.listMeta}>{slotLabel(goTo.slot)}</Text>
                      {goTo.amount ? <Text style={styles.listBody}>{goTo.amount}</Text> : null}
                      {hasMacros ? (
                        <View style={styles.pillRow}>
                          {(Number(goTo.calories) || 0) > 0 ? (
                            <View style={styles.pill}>
                              <Text style={styles.pillText}>{Math.round(Number(goTo.calories))} kcal</Text>
                            </View>
                          ) : null}
                          {(Number(goTo.protein) || 0) > 0 ? (
                            <View style={styles.pill}>
                              <Text style={styles.pillText}>{Math.round(Number(goTo.protein))}g protein</Text>
                            </View>
                          ) : null}
                        </View>
                      ) : null}
                    </View>
                    <MaterialCommunityIcons name="chevron-right" size={20} color={colors.textMuted} />
                  </TouchableOpacity>
                );
              })}

              {!plan.go_to_items?.length ? (
                <Text style={styles.emptyHint}>
                  No go-to items yet. Add shakes or snacks to fill day-map gaps.
                </Text>
              ) : null}
            </View>

            {(plan.food_priorities?.length || preferenceTags.length || plan.preferences) ? (
              <>
                <Text style={styles.sectionLabel}>GUIDANCE</Text>

                {plan.food_priorities?.length ? (
                  <View style={styles.card}>
                    <Text style={styles.cardTitle}>Food priorities</Text>
                    {plan.food_priorities.map((priority, i) => (
                      <View key={i} style={styles.priorityRow}>
                        <MaterialCommunityIcons name="check" size={16} color={colors.accentPrimary} />
                        <Text style={styles.priorityText}>{priority}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}

                {plan.preferences ? (
                  <View style={styles.card}>
                    <Text style={styles.cardTitle}>Preferences</Text>
                    <Text style={styles.prefStyle}>
                      {plan.preferences.guidance_style === "strict" ? "Stricter targets" : "Flexible guidance"}
                    </Text>
                    {preferenceTags.length ? (
                      <View style={styles.tagRow}>
                        {preferenceTags.map((tag) => (
                          <View key={tag} style={styles.tag}>
                            <Text style={styles.tagText}>{tag}</Text>
                          </View>
                        ))}
                      </View>
                    ) : null}
                  </View>
                ) : null}
              </>
            ) : null}
          </>
        ) : (
          <TouchableOpacity style={styles.strategyPeek} onPress={() => setStrategyOpen(true)}>
            <View style={{ flex: 1 }}>
              <Text style={styles.strategyPeekTitle}>Strategy under the map</Text>
              <Text style={styles.strategyPeekBody}>
                {(plan.meal_anchors || []).length} anchors · {(plan.flexible_meals || []).length} flexible ·{" "}
                {(plan.go_to_items || []).length} go-tos
              </Text>
            </View>
            <MaterialCommunityIcons name="chevron-down" size={22} color={colors.textMuted} />
          </TouchableOpacity>
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
    backgroundColor: "rgba(255,107,53,0.12)",
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
    borderColor: "rgba(255,107,53,0.45)",
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
  primaryText: { color: "#fff", fontWeight: "700" },
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
