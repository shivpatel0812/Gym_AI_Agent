import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
  StatusBar,
  Modal,
  SafeAreaView,
  Keyboard,
} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import apiClient from "../api/client";
import { auth } from "../firebase";
import { useFocusEffect, useNavigation, useRoute } from "@react-navigation/native";
import { borderRadius, colors, spacing, typography, weight } from "../theme";
import Ring from "./nutrition/Ring";
import { DayFitSummary, FitBadge, FitReason } from "./nutrition/FitBadge";
import LogFoodForm, { PlanMealPick } from "./nutrition/LogFoodForm";
import MealReminderRow from "./nutrition/MealReminderRow";
import MealTimingCard from "./nutrition/MealTimingCard";
import { MealDragHandle, useMealDrag } from "./nutrition/MealDrag";
import NutritionPlanTab from "./nutrition/plan/NutritionPlanTab";
import NutritionSuggestionsTab from "./nutrition/plan/NutritionSuggestionsTab";
import SavedFoodsTab from "./nutrition/SavedFoodsTab";
import {
  getActiveNutritionPlan,
  getPendingSuggestions,
  mealAnchorKind,
  daysLabel,
  NutritionPlan,
} from "../api/nutritionPlan";
import { displayMealLabel, normalizeMealLabel } from "../lib/recentMeals";
import {
  foodClockLabel,
  isMoved,
  moveFoodToMeal,
  replaceFoodAt,
} from "../lib/mealTiming";
import { planItemAppliesToday, todayWeekdayKey } from "../lib/mealSlots";
import {
  DEFAULT_TARGETS,
  FoodItem,
  HydrationEntry,
  MEALS,
  MacroEntry,
  NutritionTargets,
  toDateKey,
} from "./nutrition/types";

const targetsStorageKey = () => `nutrition-targets:${auth.currentUser?.uid || "signed-out"}`;

async function loadCachedTargets(): Promise<NutritionTargets> {
  try {
    const raw = await AsyncStorage.getItem(targetsStorageKey());
    if (!raw) return { ...DEFAULT_TARGETS };
    return { ...DEFAULT_TARGETS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_TARGETS };
  }
}

interface MealRow {
  food: FoodItem;
  entryId: string;
  indexInEntry: number;
}

function FoodRowEditor({
  food,
  onSave,
  onCancel,
}: {
  food: FoodItem;
  onSave: (next: FoodItem) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(food.name);
  const [amount, setAmount] = useState(food.amount || "");
  const [calories, setCalories] = useState(String(food.calories ?? ""));
  const [protein, setProtein] = useState(String(food.protein ?? ""));
  const [carbs, setCarbs] = useState(String(food.carbs ?? ""));
  const [fats, setFats] = useState(String(food.fats ?? ""));
  const [fiber, setFiber] = useState(String(food.fiber ?? ""));
  const parsedCalories = parseFloat(calories);
  const parsedProtein = parseFloat(protein);
  const canSave =
    name.trim().length > 0 &&
    Number.isFinite(parsedCalories) &&
    parsedCalories >= 0 &&
    Number.isFinite(parsedProtein) &&
    parsedProtein >= 0;

  const input = (val: string, set: (v: string) => void, keyboard = "decimal-pad") => (
    <TextInput
      value={val}
      onChangeText={set}
      keyboardType={keyboard as any}
      placeholderTextColor="#55647A"
      style={styles.editInput}
    />
  );

  return (
    <View style={styles.editor}>
      <View style={{ flexDirection: "row", gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Food</Text>
          {input(name, setName, "default")}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Amount</Text>
          <TextInput
            value={amount}
            onChangeText={setAmount}
            placeholder="e.g. 200g"
            placeholderTextColor="#55647A"
            style={styles.editInput}
          />
        </View>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 12 }}>
        {(
          [
            ["Calories", calories, setCalories],
            ["Protein", protein, setProtein],
            ["Carbs", carbs, setCarbs],
            ["Fat", fats, setFats],
            ["Fiber", fiber, setFiber],
          ] as const
        ).map(([lab, val, set]) => (
          <View key={lab} style={{ width: "30%", flexGrow: 1 }}>
            <Text style={styles.label}>{lab}</Text>
            {input(val, set)}
          </View>
        ))}
      </View>
      <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
        <TouchableOpacity onPress={onCancel} style={{ padding: 8 }}>
          <Text style={{ color: "#7C8CA0", fontWeight: "600" }}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          disabled={!canSave}
          onPress={() => {
            const nextCarbs = parseFloat(carbs);
            const nextFats = parseFloat(fats);
            const nextFiber = parseFloat(fiber);
            onSave({
              ...food,
              // Hand-entered macros are no longer "per-unit x quantity", so the
              // scaling metadata must not survive the edit -- a stale quantity
              // would make the saved-foods library divide these values again.
              quantity: undefined,
              unit_amount: undefined,
              name: name.trim(),
              amount: amount.trim() || undefined,
              calories: Math.round(parsedCalories),
              protein: Math.round(parsedProtein * 10) / 10,
              carbs:
                Number.isFinite(nextCarbs) && nextCarbs >= 0
                  ? Math.round(nextCarbs * 10) / 10
                  : 0,
              fats:
                Number.isFinite(nextFats) && nextFats >= 0
                  ? Math.round(nextFats * 10) / 10
                  : 0,
              fiber:
                Number.isFinite(nextFiber) && nextFiber >= 0
                  ? Math.round(nextFiber * 10) / 10
                  : 0,
            });
          }}
          style={[styles.saveBtn, !canSave && { opacity: 0.4 }]}
        >
          <Text style={{ color: colors.onAccent, fontWeight: "600", fontSize: 14 }}>Save</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function Nutrition() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const askNutritionCoach = (prompt: string) => {
    navigation.navigate("AIHub", { coachMode: "nutrition", prompt });
  };
  const [hubTab, setHubTab] = useState<"today" | "plan" | "updates" | "foods">("today");
  const [pendingUpdates, setPendingUpdates] = useState(0);
  const [activePlan, setActivePlan] = useState<NutritionPlan | null>(null);
  const [entries, setEntries] = useState<MacroEntry[]>([]);
  const [hydrationEntries, setHydrationEntries] = useState<HydrationEntry[]>([]);
  const [selectedDate, setSelectedDate] = useState(() => toDateKey(new Date()));
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [loggingMeal, setLoggingMeal] = useState<string | null>(null);
  const [collapsedMeals, setCollapsedMeals] = useState<Record<string, boolean>>({});
  const [waterDraft, setWaterDraft] = useState("0");
  const [editingFood, setEditingFood] = useState<{
    entryId: string;
    indexInEntry: number;
  } | null>(null);
  const [targets, setTargets] = useState<NutritionTargets>({ ...DEFAULT_TARGETS });
  const [targetDraft, setTargetDraft] = useState<NutritionTargets>({ ...DEFAULT_TARGETS });
  const [showTargets, setShowTargets] = useState(false);
  const [savingTargets, setSavingTargets] = useState(false);
  const [targetSaveError, setTargetSaveError] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  /** Row whose meal is being picked from a list — the no-drag path. */
  const [movePickerRow, setMovePickerRow] = useState<MealRow | null>(null);
  /** Bumped after a move so the timing card refetches what just changed. */
  const [timingKey, setTimingKey] = useState(0);
  const targetsOpenRef = useRef(showTargets);
  targetsOpenRef.current = showTargets;
  const targetRequestRef = useRef(0);

  useEffect(() => {
    const tab = route.params?.tab;
    if (tab === "foods" || tab === "plan" || tab === "today" || tab === "updates" || tab === "suggestions") {
      setHubTab(tab === "suggestions" ? "updates" : tab);
    }
  }, [route.params?.tab]);

  useEffect(() => {
    let cancelled = false;
    getPendingSuggestions()
      .then((pending) => {
        if (!cancelled) setPendingUpdates(pending.pending_count || 0);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [hubTab]);

  const fetchAll = useCallback(async () => {
    try {
      const [macrosRes, hydrationRes] = await Promise.all([
        apiClient.get("/api/macros"),
        apiClient.get("/api/hydration"),
      ]);
      setEntries(Array.isArray(macrosRes.data) ? macrosRes.data : []);
      setHydrationEntries(Array.isArray(hydrationRes.data) ? hydrationRes.data : []);
    } catch (error) {
      console.error("Error fetching nutrition data:", error);
    }
    try {
      const request = ++targetRequestRef.current;
      const targetsRes = await apiClient.get("/api/user-profile/nutrition-targets");
      if (request !== targetRequestRef.current) return;
      const loaded = { ...DEFAULT_TARGETS, ...(targetsRes.data || {}) };
      setTargets(loaded);
      if (!targetsOpenRef.current) setTargetDraft(loaded);
      await AsyncStorage.setItem(targetsStorageKey(), JSON.stringify(loaded)).catch(() => undefined);
    } catch (error) {
      console.error("Error fetching nutrition targets:", error);
    }
    try {
      setActivePlan(await getActiveNutritionPlan());
    } catch {
      // Keep the last successfully loaded plan during a temporary outage.
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cached = await loadCachedTargets();
      if (!cancelled && targetRequestRef.current === 0 && !targetsOpenRef.current) {
        setTargets(cached);
        setTargetDraft(cached);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchAll]);

  useFocusEffect(useCallback(() => {
    if (hubTab === "today") void fetchAll();
  }, [hubTab, fetchAll]));

  const dayTabs = useMemo(() => {
    const tabs: { key: string; label: string }[] = [];
    for (let i = 0; i < 5; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = toDateKey(d);
      const label =
        i === 0
          ? "Today"
          : i === 1
          ? "Yesterday"
          : d.toLocaleDateString("en-US", { weekday: "short" });
      tabs.push({ key, label });
    }
    return tabs;
  }, []);

  const dayEntries = useMemo(
    () => entries.filter((e) => e.date === selectedDate),
    [entries, selectedDate]
  );

  const dayRows = useMemo(() => {
    const rows: MealRow[] = [];
    for (const entry of dayEntries) {
      (entry.food_items || []).forEach((food, idx) => {
        rows.push({ food, entryId: entry.id!, indexInEntry: idx });
      });
    }
    return rows;
  }, [dayEntries]);

  /**
   * Day-level goal fit, calorie-weighted across every item.
   *
   * Recomputed here rather than read off one entry: a day can hold several
   * macro entries, and each carries a fit score for its own items only.
   * Weighting by calories keeps a 600 kcal dinner from counting the same as a
   * 60 kcal apple.
   */
  const dayFit = useMemo(() => {
    let weighted = 0;
    let weight = 0;
    for (const row of dayRows) {
      const score = row.food.fit?.score;
      if (score == null) continue;
      const calories = row.food.calories || 0;
      weighted += score * calories;
      weight += calories;
    }
    if (weight <= 0) return null;
    const score = Math.round(weighted / weight);
    const band =
      score >= 80 ? "excellent" : score >= 65 ? "good" : score >= 45 ? "fair" : "poor";
    return { score, band } as const;
  }, [dayRows]);

  const totals = useMemo(() => {
    let calories = 0;
    let protein = 0;
    let carbs = 0;
    let fats = 0;
    let fiber = 0;
    for (const entry of dayEntries) {
      if (entry.food_items && entry.food_items.length > 0) {
        for (const f of entry.food_items) {
          calories += f.calories || 0;
          protein += f.protein || 0;
          carbs += f.carbs || 0;
          fats += f.fats || 0;
          fiber += f.fiber || 0;
        }
      } else {
        calories += entry.total_calories || 0;
        protein += entry.total_protein || 0;
        carbs += entry.total_carbs || 0;
        fats += entry.total_fats || 0;
        fiber += entry.total_fiber || 0;
      }
    }
    return {
      calories: Math.round(calories),
      protein: Math.round(protein),
      carbs: Math.round(carbs),
      fats: Math.round(fats),
      fiber: Math.round(fiber),
    };
  }, [dayEntries]);

  const hydrationForDay = useMemo(
    () => hydrationEntries.find((h) => h.date === selectedDate),
    [hydrationEntries, selectedDate]
  );
  const glasses = Math.round(hydrationForDay?.amount_cups || 0);

  useEffect(() => {
    setWaterDraft(String(glasses));
  }, [glasses, selectedDate]);

  const mealGroups = useMemo(() => {
    const groups: Record<string, MealRow[]> = {};
    for (const row of dayRows) {
      const meal = row.food.meal || "Other";
      if (!groups[meal]) groups[meal] = [];
      groups[meal].push(row);
    }
    return groups;
  }, [dayRows]);

  const addFood = async (food: FoodItem) => {
    await addFoods([food]);
  };

  const addFoods = async (foods: FoodItem[]) => {
    if (!foods.length) return;
    try {
      const existing = dayEntries[0];
      if (existing?.id) {
        await apiClient.put(`/api/macros/${existing.id}`, {
          date: selectedDate,
          food_items: [...(existing.food_items || []), ...foods],
        });
      } else {
        await apiClient.post("/api/macros", {
          date: selectedDate,
          food_items: foods,
        });
      }
      fetchAll();
      Keyboard.dismiss();
      setLoggingMeal(null);
    } catch (error) {
      console.error("Error adding food:", error);
    }
  };

  const planMealsForLogging = useMemo((): PlanMealPick[] => {
    if (!activePlan?.meal_anchors?.length) return [];
    const [y, m, d] = selectedDate.split("-").map(Number);
    const weekday = todayWeekdayKey(new Date(y, m - 1, d, 12));
    return (activePlan.meal_anchors || [])
      .filter((a) => a.id)
      .map((a) => ({
        id: String(a.id),
        label: a.label || "Plan meal",
        kind: mealAnchorKind(a),
        foods: a.foods || [],
        schedule: daysLabel(a.days, a.frequency),
        appliesToday: planItemAppliesToday(a, weekday),
        slot: normalizeMealLabel(a.slot),
      }))
      .sort((a, b) => {
        if (a.appliesToday !== b.appliesToday) return a.appliesToday ? -1 : 1;
        const slotCmp = (a.slot || "").localeCompare(b.slot || "");
        if (slotCmp) return slotCmp;
        return a.label.localeCompare(b.label);
      });
  }, [activePlan, selectedDate]);

  const removeFood = async (row: MealRow) => {
    try {
      const entry = dayEntries.find((e) => e.id === row.entryId);
      if (!entry?.id) return;
      const newItems = (entry.food_items || []).filter((_, i) => i !== row.indexInEntry);
      if (newItems.length === 0 && dayEntries.length > 0) {
        await apiClient.delete(`/api/macros/${entry.id}`);
      } else {
        await apiClient.put(`/api/macros/${entry.id}`, {
          date: entry.date,
          food_items: newItems,
        });
      }
      fetchAll();
    } catch (error) {
      console.error("Error removing food:", error);
    }
  };

  const updateFood = async (row: MealRow, next: FoodItem) => {
    try {
      const entry = dayEntries.find((e) => e.id === row.entryId);
      if (!entry?.id) return;
      const newItems = [...(entry.food_items || [])];
      newItems[row.indexInEntry] = next;
      await apiClient.put(`/api/macros/${entry.id}`, {
        date: entry.date,
        food_items: newItems,
      });
      setEditingFood(null);
      fetchAll();
    } catch (error) {
      console.error("Error updating food:", error);
    }
  };

  /**
   * Re-file one logged food under a different meal.
   *
   * The macros PUT rewrites a whole day, so this rebuilds the entry's list
   * with a single row swapped rather than sending the moved item on its own.
   * `moveFoodToMeal` decides what the move records; see lib/mealTiming.ts.
   */
  const moveFood = async (row: MealRow, targetMeal: string) => {
    setMovePickerRow(null);
    const next = moveFoodToMeal(row.food, targetMeal);
    if (next === row.food) return;
    const entry = dayEntries.find((e) => e.id === row.entryId);
    if (!entry?.id) return;
    setMoveError(null);
    try {
      await apiClient.put(`/api/macros/${entry.id}`, {
        date: entry.date,
        food_items: replaceFoodAt(entry.food_items || [], row.indexInEntry, next),
      });
      setTimingKey((key) => key + 1);
      await fetchAll();
    } catch (error) {
      console.error("Error moving food:", error);
      setMoveError(
        `"${row.food.name}" could not be moved. Check your connection and try again.`
      );
    }
  };

  const {
    controller: dragController,
    dragging,
    layer: dragLayer,
  } = useMealDrag<MealRow>({
    meals: MEALS,
    onDrop: (row, mealId) => void moveFood(row, mealId),
    onTapHandle: (row) => setMovePickerRow(row),
  });

  const setWater = async (count: number) => {
    try {
      if (hydrationForDay?.id) {
        await apiClient.put(`/api/hydration/${hydrationForDay.id}`, {
          date: selectedDate,
          amount_cups: count,
        });
      } else {
        await apiClient.post("/api/hydration", {
          date: selectedDate,
          amount_cups: count,
        });
      }
      fetchAll();
    } catch (error) {
      console.error("Error updating hydration:", error);
    }
  };

  const openLogFood = (meal?: string) => {
    const firstEmpty = MEALS.find((m) => !(mealGroups[m.id] || []).length)?.id;
    const target = meal || firstEmpty || MEALS[0].id;
    setLoggingMeal(target);
  };

  const closeLogFood = () => {
    Keyboard.dismiss();
    setLoggingMeal(null);
  };

  const commitWater = (value: number) => {
    const next = Math.max(0, Math.round(value));
    setWaterDraft(String(next));
    if (next !== glasses) setWater(next);
  };

  const saveTargets = async () => {
    const next: NutritionTargets = {
      calories: Math.max(0, Number(targetDraft.calories) || 0),
      protein: Math.max(0, Number(targetDraft.protein) || 0),
      carbs: Math.max(0, Number(targetDraft.carbs) || 0),
      fats: Math.max(0, Number(targetDraft.fats) || 0),
      fiber: Math.max(0, Number(targetDraft.fiber) || 0),
      water: Math.max(0, Number(targetDraft.water) || 0),
    };
    setSavingTargets(true);
    ++targetRequestRef.current;
    setTargetSaveError(null);
    try {
      const res = await apiClient.put("/api/user-profile/nutrition-targets", next);
      const saved = { ...DEFAULT_TARGETS, ...(res.data || next) };
      setTargets(saved);
      setTargetDraft(saved);
      await AsyncStorage.setItem(targetsStorageKey(), JSON.stringify(saved)).catch(() => undefined);
      setShowTargets(false);
      getActiveNutritionPlan().then(setActivePlan).catch(() => undefined);
    } catch (error) {
      console.error("Error saving nutrition targets:", error);
      setTargetSaveError("Targets were not saved. Your changes are still here; check your connection and try again.");
    } finally {
      setSavingTargets(false);
    }
  };

  const calorieTarget = Math.max(targets.calories, 1);
  const pct = Math.min(Math.round((totals.calories / calorieTarget) * 100), 999);
  const remaining = Math.max(targets.calories - totals.calories, 0);
  const over = Math.max(totals.calories - targets.calories, 0);

  useEffect(() => {
    setLoggingMeal(null);
    setEditingFood(null);
    setMovePickerRow(null);
    setMoveError(null);
  }, [selectedDate]);

  const selectedDateObj = new Date(selectedDate + "T00:00:00");
  const dateLabel = selectedDateObj.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
  const customDateLabel = selectedDateObj.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  const isCustomDate = !dayTabs.some((tab) => tab.key === selectedDate);

  const macroRings = [
    { label: "Protein", value: totals.protein, target: targets.protein, color: "#E4B896" },
    { label: "Carbs", value: totals.carbs, target: targets.carbs, color: "#F5C542" },
    { label: "Fat", value: totals.fats, target: targets.fats, color: "#C4B5FD" },
    { label: "Fiber", value: totals.fiber, target: targets.fiber, color: "#4ADE80" },
  ];

  const mealsToShow = [
    ...MEALS.filter((m) => (mealGroups[m.id] || []).length > 0),
    ...(mealGroups["Other"]?.length
      ? [{ id: "Other", label: "Other", icon: "🍽️" }]
      : []),
  ];
  const emptyMeals = MEALS.filter((m) => !(mealGroups[m.id] || []).length);

  return (
    <View style={styles.container}>
      <View style={styles.hubHeader}>
        <View style={styles.hubTabs}>
          {(["today", "plan", "updates", "foods"] as const).map((tab) => {
            const active = hubTab === tab;
            const label =
              tab === "today"
                ? "Today"
                : tab === "plan"
                  ? "Plan"
                  : tab === "updates"
                    ? "Updates"
                    : "Foods";
            return (
              <TouchableOpacity key={tab} style={styles.hubTab} onPress={() => setHubTab(tab)}>
                <View style={styles.hubTabLabelRow}>
                  <Text style={[styles.hubTabText, active && styles.hubTabTextOn]}>{label}</Text>
                  {tab === "updates" && pendingUpdates > 0 ? (
                    <View style={styles.hubBadge}>
                      <Text style={styles.hubBadgeText}>
                        {pendingUpdates > 9 ? "9+" : pendingUpdates}
                      </Text>
                    </View>
                  ) : null}
                </View>
                {active ? <View style={styles.hubUnderline} /> : null}
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {hubTab === "plan" ? (
        <NutritionPlanTab
          onAskCoach={askNutritionCoach}
          onOpenSuggestions={() => setHubTab("updates")}
        />
      ) : hubTab === "updates" ? (
        <NutritionSuggestionsTab
          onAskCoach={askNutritionCoach}
          onOpenPlan={() => setHubTab("plan")}
          onPendingCountChange={setPendingUpdates}
        />
      ) : hubTab === "foods" ? (
        <SavedFoodsTab />
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
          automaticallyAdjustKeyboardInsets={Platform.OS === "ios"}
        >
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>Nutrition</Text>
              <Text style={styles.dateSub}>{dateLabel}</Text>
            </View>
            <TouchableOpacity
              onPress={() => {
                setTargetDraft(targets);
                setShowTargets((open) => !open);
              }}
              style={[styles.targetsBtn, showTargets && styles.targetsBtnOn]}
            >
              <Text style={[styles.targetsBtnText, showTargets && { color: colors.onAccent }]}>
                Targets
              </Text>
            </TouchableOpacity>
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.dayTabs}
            contentContainerStyle={{ alignItems: "flex-end", gap: 20, paddingRight: 8 }}
          >
            {dayTabs.map((tab) => {
              const isActive = selectedDate === tab.key;
              return (
                <TouchableOpacity key={tab.key} onPress={() => setSelectedDate(tab.key)}>
                  <Text style={[styles.dayTab, isActive && styles.dayTabOn]}>{tab.label}</Text>
                  {isActive && <View style={styles.dayUnderline} />}
                </TouchableOpacity>
              );
            })}
            {isCustomDate && (
              <TouchableOpacity onPress={() => setShowDatePicker(true)}>
                <Text style={[styles.dayTab, styles.dayTabOn]}>{customDateLabel}</Text>
                <View style={styles.dayUnderline} />
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={() => setShowDatePicker(true)} style={styles.calBtn}>
              <MaterialCommunityIcons name="calendar" size={18} color="#7C8CA0" />
            </TouchableOpacity>
          </ScrollView>
          {showDatePicker && (
            <DateTimePicker
              value={selectedDateObj}
              mode="date"
              display="default"
              onChange={(_, date) => {
                if (Platform.OS !== "ios") setShowDatePicker(false);
                if (date) setSelectedDate(toDateKey(date));
              }}
            />
          )}
          {Platform.OS === "ios" && showDatePicker && (
            <TouchableOpacity onPress={() => setShowDatePicker(false)} style={{ alignSelf: "flex-end" }}>
              <Text style={{ color: "#9CC0E8", fontWeight: "600", marginBottom: 8 }}>Done</Text>
            </TouchableOpacity>
          )}

          <MealReminderRow />

          {showTargets && (
            <View style={styles.targetsCard}>
              <Text style={styles.targetsTitle}>Daily targets</Text>
              <Text style={{ color: colors.textSecondary }}>Changes apply to Home, Nutrition, and your current nutrition plan.</Text>
              {targetSaveError ? <Text accessibilityRole="alert" style={{ color: colors.danger }}>{targetSaveError}</Text> : null}
              <Text style={styles.mutedXs}>
                These are your goals for every day. Rings and remaining calories use them.
              </Text>
              <View style={styles.targetGrid}>
                {(
                  [
                    ["calories", "Calories", "kcal"],
                    ["protein", "Protein", "g"],
                    ["carbs", "Carbs", "g"],
                    ["fats", "Fat", "g"],
                    ["fiber", "Fiber", "g"],
                    ["water", "Water", "cups"],
                  ] as const
                ).map(([key, label, unit]) => (
                  <View key={key} style={styles.targetField}>
                    <Text style={styles.label}>{label}</Text>
                    <View>
                      <TextInput
                        keyboardType="numeric"
                        value={String(targetDraft[key])}
                        onChangeText={(v) =>
                          setTargetDraft((prev) => ({
                            ...prev,
                            [key]: v === "" ? 0 : Number(v),
                          }))
                        }
                        style={styles.targetInput}
                      />
                      <Text style={styles.unit}>{unit}</Text>
                    </View>
                  </View>
                ))}
              </View>
              <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
                <TouchableOpacity
                  onPress={() => {
                    setTargetDraft(targets);
                    setShowTargets(false);
                  }}
                  style={{ padding: 8 }}
                >
                  <Text style={{ color: "#7C8CA0", fontWeight: "600" }}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={saveTargets}
                  disabled={savingTargets}
                  style={styles.saveBtn}
                >
                  <Text style={{ color: colors.onAccent, fontWeight: "600" }}>
                    {savingTargets ? "Saving..." : "Save targets"}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          <View style={styles.overview}>
            <View style={{ alignItems: "center" }}>
              <Ring
                size={200}
                stroke={12}
                progress={totals.calories / calorieTarget}
                color="#9CC0E8"
              >
                <Text style={styles.consumedLabel}>Consumed</Text>
                <Text style={styles.kcalBig}>{totals.calories.toLocaleString()}</Text>
                <Text style={styles.mutedXs}>kcal</Text>
                <Text style={styles.pct}>{pct}%</Text>
                <Text style={styles.remain}>
                  {over > 0
                    ? `${over.toLocaleString()} over`
                    : `${remaining.toLocaleString()} left`}
                  {" · "}
                  {targets.calories.toLocaleString()} target
                </Text>
              </Ring>
              <View style={{ marginTop: 10 }}>
                <DayFitSummary score={dayFit?.score} band={dayFit?.band} />
              </View>
            </View>

            <View style={styles.macroGrid}>
              {macroRings.map((m) => (
                <View key={m.label} style={styles.macroItem}>
                  <Ring
                    size={88}
                    stroke={7}
                    progress={m.value / Math.max(m.target, 1)}
                    color={m.color}
                  >
                    <Text style={styles.macroNum}>{m.value}</Text>
                  </Ring>
                  <Text style={[styles.macroName, { color: m.color }]}>{m.label}</Text>
                  <Text style={styles.mutedXs}>
                    {m.value} / {m.target}g
                  </Text>
                  <View style={styles.barTrack}>
                    <View
                      style={[
                        styles.barFill,
                        {
                          width: `${Math.min((m.value / Math.max(m.target, 1)) * 100, 100)}%`,
                          backgroundColor: m.color,
                        },
                      ]}
                    />
                  </View>
                </View>
              ))}
            </View>

            <View style={{ marginTop: 8 }}>
              <Text style={styles.label}>Water</Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                <View style={styles.waterStepper}>
                  <TouchableOpacity
                    onPress={() => commitWater(glasses - 1)}
                    disabled={glasses <= 0}
                    style={[styles.waterBtn, glasses <= 0 && { opacity: 0.3 }]}
                  >
                    <MaterialCommunityIcons name="chevron-down" size={22} color="#7C8CA0" />
                  </TouchableOpacity>
                  <TextInput
                    keyboardType="numeric"
                    value={waterDraft}
                    onChangeText={setWaterDraft}
                    onEndEditing={() => {
                      const parsed = parseFloat(waterDraft);
                      commitWater(Number.isFinite(parsed) ? parsed : glasses);
                    }}
                    style={styles.waterInput}
                  />
                  <TouchableOpacity
                    onPress={() => commitWater(glasses + 1)}
                    style={styles.waterBtn}
                  >
                    <MaterialCommunityIcons name="chevron-up" size={22} color="#7C8CA0" />
                  </TouchableOpacity>
                </View>
                <Text style={{ color: "#7C8CA0", fontSize: 14 }}>
                  <Text style={{ color: "#fff", fontWeight: "600" }}>{glasses}</Text>
                  {" / "}
                  {targets.water} cups
                </Text>
              </View>
              <View style={[styles.barTrack, { width: "100%", height: 8, marginTop: 12 }]}>
                <View
                  style={[
                    styles.barFill,
                    {
                      width: `${Math.min((glasses / Math.max(targets.water, 1)) * 100, 100)}%`,
                      backgroundColor: "#8B95A1",
                      height: 8,
                    },
                  ]}
                />
              </View>
              <Text style={[styles.mutedXs, { marginTop: 6 }]}>
                Target {targets.water} cups
                {glasses >= targets.water ? " · Hit" : ""}
              </Text>
            </View>
          </View>

          <View style={styles.mealsHead}>
            <Text style={styles.mealsLabel}>Meals</Text>
            <Text style={styles.mealsHint}>Drag ⠿ to move a food</Text>
          </View>
          {moveError ? (
            <Text accessibilityRole="alert" style={styles.moveError}>
              {moveError}
            </Text>
          ) : null}
          {mealsToShow.map((meal) => {
            const rows = mealGroups[meal.id] || [];
            const mealTotals = rows.reduce(
              (acc, r) => ({
                calories: acc.calories + (r.food.calories || 0),
                protein: acc.protein + (r.food.protein || 0),
                carbs: acc.carbs + (r.food.carbs || 0),
                fats: acc.fats + (r.food.fats || 0),
                fiber: acc.fiber + (r.food.fiber || 0),
              }),
              { calories: 0, protein: 0, carbs: 0, fats: 0, fiber: 0 }
            );
            const isCollapsed = collapsedMeals[meal.id] ?? false;
            return (
              <View key={meal.id} style={styles.mealCard}>
                <TouchableOpacity
                  onPress={() =>
                    setCollapsedMeals((prev) => ({ ...prev, [meal.id]: !isCollapsed }))
                  }
                  style={styles.mealHead}
                >
                  <View style={styles.mealIcon}>
                    <Text style={{ fontSize: 18 }}>{meal.icon}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.mealName}>{meal.label}</Text>
                    <Text style={{ fontSize: 13, marginTop: 2 }}>
                      <Text style={{ color: "#9CC0E8", fontWeight: "600" }}>
                        {Math.round(mealTotals.calories)} kcal
                      </Text>
                      <Text style={{ color: "#E4B896" }}>
                        {" "}P {Math.round(mealTotals.protein)}g
                      </Text>
                      <Text style={{ color: "#F5C542" }}>
                        {" "}C {Math.round(mealTotals.carbs)}g
                      </Text>
                      <Text style={{ color: "#C4B5FD" }}>
                        {" "}F {Math.round(mealTotals.fats)}g
                      </Text>
                      <Text style={{ color: "#4ADE80" }}>
                        {" "}Fi {Math.round(mealTotals.fiber)}g
                      </Text>
                    </Text>
                  </View>
                  <Text style={{ color: "#55647A", transform: [{ rotate: isCollapsed ? "180deg" : "0deg" }] }}>
                    ▲
                  </Text>
                </TouchableOpacity>

                {!isCollapsed && (
                  <>
                    {rows.length > 0 && (
                      <View style={styles.foodTable}>
                        <View style={styles.foodHeader}>
                          <Text style={[styles.foodHeaderText, { flex: 1 }]}>Food</Text>
                          <Text style={[styles.foodHeaderText, { width: 40, textAlign: "right" }]}>Kcal</Text>
                          <Text style={[styles.foodHeaderText, { width: 36, textAlign: "right" }]}>P</Text>
                          <Text style={[styles.foodHeaderText, { width: 36, textAlign: "right" }]}>C</Text>
                          <Text style={[styles.foodHeaderText, { width: 36, textAlign: "right" }]}>F</Text>
                        </View>
                        {rows.map((row, i) => {
                          const isEditing =
                            editingFood?.entryId === row.entryId &&
                            editingFood?.indexInEntry === row.indexInEntry;
                          return (
                            <View key={`${row.entryId}-${row.indexInEntry}-${i}`}>
                              {isEditing ? (
                                <FoodRowEditor
                                  food={row.food}
                                  onSave={(next) => updateFood(row, next)}
                                  onCancel={() => setEditingFood(null)}
                                />
                              ) : (
                                <View style={styles.foodRow}>
                                  <View style={{ flex: 1, minWidth: 0 }}>
                                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                                      <MealDragHandle
                                        item={row}
                                        from={meal.id}
                                        label={row.food.name}
                                        controller={dragController}
                                      />
                                      <TouchableOpacity
                                        onPress={() => removeFood(row)}
                                        hitSlop={10}
                                        accessibilityRole="button"
                                        accessibilityLabel={`Remove ${row.food.name}`}
                                      >
                                        <MaterialCommunityIcons name="close" size={14} color="#55647A" />
                                      </TouchableOpacity>
                                      <TouchableOpacity
                                        onPress={() =>
                                          setEditingFood({
                                            entryId: row.entryId,
                                            indexInEntry: row.indexInEntry,
                                          })
                                        }
                                        hitSlop={10}
                                        accessibilityRole="button"
                                        accessibilityLabel={`Edit ${row.food.name}`}
                                      >
                                        <MaterialCommunityIcons name="pencil" size={14} color="#55647A" />
                                      </TouchableOpacity>
                                      <View style={{ flex: 1 }}>
                                        <View style={styles.foodNameRow}>
                                          <Text style={styles.foodName} numberOfLines={1}>
                                            {row.food.name}
                                          </Text>
                                          <FitBadge fit={row.food.fit} compact />
                                          {isMoved(row.food) ? (
                                            <MaterialCommunityIcons
                                              name="swap-horizontal"
                                              size={12}
                                              color="#55647A"
                                              accessibilityLabel={`Moved from ${displayMealLabel(
                                                row.food.moved_from || ""
                                              )}`}
                                            />
                                          ) : null}
                                        </View>
                                        {(() => {
                                          // Amount and clock share one line; the
                                          // clock is absent whenever the log time
                                          // is not evidence of when this was eaten.
                                          const clock = foodClockLabel(row.food, selectedDate);
                                          const meta = [row.food.amount, clock]
                                            .filter(Boolean)
                                            .join(" · ");
                                          return meta ? (
                                            <Text style={styles.mutedXs}>{meta}</Text>
                                          ) : null;
                                        })()}
                                        <FitReason fit={row.food.fit} />
                                      </View>
                                    </View>
                                  </View>
                                  <Text style={styles.foodKcal}>{Math.round(row.food.calories)}</Text>
                                  <Text style={[styles.foodMacro, { color: "#E4B896" }]}>
                                    {Math.round(row.food.protein)}g
                                  </Text>
                                  <Text style={[styles.foodMacro, { color: "#F5C542" }]}>
                                    {Math.round(row.food.carbs || 0)}g
                                  </Text>
                                  <Text style={[styles.foodMacro, { color: "#C4B5FD" }]}>
                                    {Math.round(row.food.fats || 0)}g
                                  </Text>
                                </View>
                              )}
                            </View>
                          );
                        })}
                        <View style={styles.totalRow}>
                          <Text style={styles.totalLabel}>Total</Text>
                          <Text style={[styles.foodKcal, { color: "#9CC0E8", fontWeight: "700" }]}>
                            {Math.round(mealTotals.calories)}
                          </Text>
                          <Text style={[styles.foodMacro, { color: "#E4B896", fontWeight: "700" }]}>
                            {Math.round(mealTotals.protein)}g
                          </Text>
                          <Text style={[styles.foodMacro, { color: "#F5C542", fontWeight: "700" }]}>
                            {Math.round(mealTotals.carbs)}g
                          </Text>
                          <Text style={[styles.foodMacro, { color: "#C4B5FD", fontWeight: "700" }]}>
                            {Math.round(mealTotals.fats)}g
                          </Text>
                        </View>
                      </View>
                    )}
                    {meal.id !== "Other" && (
                      <View style={styles.addWrap}>
                        <TouchableOpacity
                          style={styles.addDashed}
                          onPress={() => openLogFood(meal.id)}
                        >
                          <MaterialCommunityIcons name="plus" size={16} color="#7C8CA0" />
                          <Text style={{ color: "#7C8CA0", fontWeight: "500" }}>Add food</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </>
                )}
              </View>
            );
          })}

          {emptyMeals.length > 0 && (
            <View style={{ gap: 12 }}>
              {emptyMeals.map((meal) => (
                <TouchableOpacity
                  key={meal.id}
                  onPress={() => openLogFood(meal.id)}
                  style={styles.emptyMeal}
                >
                  <View style={styles.mealIcon}>
                    <Text style={{ fontSize: 16 }}>{meal.icon}</Text>
                  </View>
                  <View>
                    <Text style={{ color: "#fff", fontWeight: "600", fontSize: 14 }}>
                      {meal.label}
                    </Text>
                    <Text style={{ color: "#55647A", fontSize: 12 }}>+ Add food</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          )}

          <View style={{ marginTop: 8 }}>
            <MealTimingCard refreshKey={timingKey} />
          </View>
        </ScrollView>
      )}

      {hubTab === "today" ? dragLayer : null}

      {hubTab === "today" && !loggingMeal && !dragging ? (
        <TouchableOpacity style={styles.fab} onPress={() => openLogFood()}>
          <MaterialCommunityIcons name="plus" size={20} color="#fff" />
          <Text style={styles.fabText}>Log Food</Text>
        </TouchableOpacity>
      ) : null}

      <Modal
        visible={movePickerRow !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setMovePickerRow(null)}
      >
        <TouchableOpacity
          style={styles.pickerScrim}
          activeOpacity={1}
          onPress={() => setMovePickerRow(null)}
          accessibilityRole="button"
          accessibilityLabel="Cancel move"
        >
          <View style={styles.pickerCard}>
            <Text style={styles.pickerTitle} numberOfLines={1}>
              Move {movePickerRow?.food.name}
            </Text>
            <Text style={styles.pickerSub}>Pick the meal it belongs to.</Text>
            {MEALS.map((meal) => {
              const current =
                normalizeMealLabel(movePickerRow?.food.meal) ===
                normalizeMealLabel(meal.id);
              return (
                <TouchableOpacity
                  key={meal.id}
                  style={[styles.pickerRow, current && styles.pickerRowOn]}
                  disabled={current}
                  onPress={() => {
                    if (movePickerRow) void moveFood(movePickerRow, meal.id);
                  }}
                >
                  <Text style={{ fontSize: 16 }}>{meal.icon}</Text>
                  <Text style={[styles.pickerRowText, current && styles.pickerRowTextOn]}>
                    {meal.label}
                  </Text>
                  {current ? <Text style={styles.pickerHere}>Here now</Text> : null}
                </TouchableOpacity>
              );
            })}
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal
        visible={loggingMeal !== null}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={closeLogFood}
      >
        <SafeAreaView style={styles.logModal}>
          <View style={styles.logModalHeader}>
            <TouchableOpacity
              onPress={closeLogFood}
              style={styles.logModalClose}
              accessibilityRole="button"
              accessibilityLabel="Close food logger"
            >
              <MaterialCommunityIcons name="close" size={22} color="#fff" />
            </TouchableOpacity>
            <View>
              <Text style={styles.logModalTitle}>Log food</Text>
              <Text style={styles.logModalSubtitle}>
                {MEALS.find((meal) => meal.id === loggingMeal)?.label || "Choose a meal"}
              </Text>
            </View>
          </View>
          <ScrollView
            style={styles.logModalScroll}
            contentContainerStyle={styles.logModalContent}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
            automaticallyAdjustKeyboardInsets={Platform.OS === "ios"}
          >
            {loggingMeal ? (
              <LogFoodForm
                meal={loggingMeal}
                onAdd={addFood}
                onAddMany={addFoods}
                planMeals={planMealsForLogging}
                onMealChange={setLoggingMeal}
                onCancel={closeLogFood}
                compact
              />
            ) : null}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  hubHeader: {
    paddingTop: Platform.OS === "ios" ? 54 : StatusBar.currentHeight ? StatusBar.currentHeight + 8 : 8,
    backgroundColor: colors.background,
  },
  hubTabs: {
    flexDirection: "row",
    gap: 24,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  hubTab: { paddingVertical: 12, position: "relative" },
  hubTabLabelRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  hubTabText: { fontSize: 14, fontWeight: "600", color: colors.textSecondary },
  hubTabTextOn: { color: "#fff" },
  hubBadge: {
    minWidth: 18,
    height: 18,
    paddingHorizontal: 5,
    borderRadius: 9,
    backgroundColor: colors.ai,
    alignItems: "center",
    justifyContent: "center",
  },
  hubBadgeText: { color: "#070708", fontSize: 10, fontWeight: "800" },
  hubUnderline: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: colors.accentPrimary,
    borderRadius: 999,
  },
  scroll: {
    paddingHorizontal: spacing.lg,
    paddingBottom: 100,
  },
  header: {
    paddingTop: spacing.md,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 16,
  },
  title: { fontSize: 32, fontWeight: "700", color: "#fff" },
  dateSub: { color: "#7C8CA0", fontSize: 14, marginTop: 4 },
  targetsBtn: {
    marginTop: 4,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.cardBackground,
  },
  targetsBtnOn: { backgroundColor: "#9CC0E8", borderColor: "#9CC0E8" },
  targetsBtnText: { color: "#7C8CA0", fontSize: 14, fontWeight: "600" },
  dayTabs: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    marginBottom: 16,
    flexGrow: 0,
  },
  dayTab: { color: "#7C8CA0", fontSize: 14, fontWeight: "600", paddingBottom: 12 },
  dayTabOn: { color: "#fff" },
  dayUnderline: {
    height: 2,
    backgroundColor: "#9CC0E8",
    borderRadius: 999,
    marginTop: -2,
  },
  calBtn: { paddingBottom: 10, width: 32, alignItems: "center" },
  targetsCard: {
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
  },
  targetsTitle: { color: "#fff", fontWeight: "700", fontSize: 14, marginBottom: 4 },
  mutedXs: { color: "#7C8CA0", fontSize: 12 },
  targetGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 12 },
  targetField: { width: "47%" },
  label: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.4,
    color: "#55647A",
    textTransform: "uppercase",
    marginBottom: 6,
  },
  targetInput: {
    height: 44,
    paddingHorizontal: 12,
    paddingRight: 48,
    borderRadius: 12,
    backgroundColor: "#05080F",
    borderWidth: 1,
    borderColor: colors.border,
    color: "#fff",
    fontSize: 14,
  },
  unit: { position: "absolute", right: 12, top: 14, color: "#55647A", fontSize: 12 },
  saveBtn: {
    backgroundColor: "#9CC0E8",
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  overview: {
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: 24,
    marginBottom: 24,
    gap: 24,
  },
  consumedLabel: {
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 1.6,
    color: "#7C8CA0",
    textTransform: "uppercase",
  },
  kcalBig: { color: "#fff", fontSize: 34, fontWeight: "700", lineHeight: 38 },
  pct: { color: "#9CC0E8", fontSize: 14, fontWeight: "700", marginTop: 6 },
  remain: { color: "#7C8CA0", fontSize: 11, textAlign: "center", paddingHorizontal: 12, marginTop: 2 },
  macroGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-around", gap: 12 },
  macroItem: { width: "45%", alignItems: "center", marginBottom: 8 },
  macroNum: { color: "#fff", fontSize: 20, fontWeight: "700" },
  macroName: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.4,
    textTransform: "uppercase",
    marginTop: 10,
  },
  barTrack: {
    width: 64,
    height: 4,
    borderRadius: 999,
    backgroundColor: "#1E2A38",
    marginTop: 6,
    overflow: "hidden",
  },
  barFill: { height: 4, borderRadius: 999 },
  waterStepper: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#05080F",
    overflow: "hidden",
  },
  waterBtn: { width: 40, height: 44, alignItems: "center", justifyContent: "center" },
  waterInput: {
    width: 56,
    height: 44,
    textAlign: "center",
    color: "#8B95A1",
    fontSize: 18,
    fontWeight: "700",
  },
  mealsLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.6,
    color: "#55647A",
    textTransform: "uppercase",
    marginBottom: 16,
  },
  mealCard: {
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    overflow: "hidden",
    marginBottom: 16,
  },
  mealHead: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 16 },
  mealIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#1C1C1E",
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  mealName: { color: "#fff", fontSize: 16, fontWeight: "700" },
  foodTable: { borderTopWidth: 1, borderTopColor: colors.border },
  foodHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 6,
    backgroundColor: "rgba(15,17,23,0.6)",
  },
  foodHeaderText: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.2,
    color: "#55647A",
    textTransform: "uppercase",
  },
  foodRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 6,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(42,45,53,0.6)",
  },
  foodNameRow: { flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0 },
  foodName: { color: "#fff", fontSize: 14, fontWeight: "500", flexShrink: 1 },
  foodKcal: { color: "#fff", fontSize: 13, fontWeight: "600", width: 40, textAlign: "right" },
  foodMacro: { fontSize: 13, fontWeight: "600", width: 36, textAlign: "right" },
  totalRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "rgba(15,17,23,0.6)",
    gap: 6,
  },
  totalLabel: {
    flex: 1,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.2,
    color: "#55647A",
    textTransform: "uppercase",
  },
  addWrap: { padding: 16, borderTopWidth: 1, borderTopColor: colors.border },
  addDashed: {
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "#3A3A3C",
    borderRadius: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  emptyMeal: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 16,
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.border,
  },
  logModal: {
    flex: 1,
    backgroundColor: colors.background,
  },
  logModalHeader: {
    minHeight: 68,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.background,
  },
  logModalTitle: { color: "#fff", fontSize: 20, fontWeight: "800" },
  logModalSubtitle: { color: "#7C8CA0", fontSize: 13, marginTop: 2 },
  logModalClose: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 21,
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.border,
  },
  logModalScroll: { flex: 1 },
  logModalContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: 16,
    paddingBottom: 32,
  },
  editor: {
    padding: 16,
    backgroundColor: "rgba(15,17,23,0.4)",
  },
  editInput: {
    height: 40,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: "#05080F",
    borderWidth: 1,
    borderColor: colors.border,
    color: "#fff",
    fontSize: 14,
  },
  fab: {
    position: "absolute",
    bottom: 16,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 999,
    backgroundColor: "#9CC0E8",
  },
  fabText: { color: colors.onAccent, fontWeight: "700", fontSize: 16 },
  mealsHead: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  mealsHint: { color: colors.textFaintCool, fontSize: typography.caption },
  moveError: { color: colors.danger, fontSize: typography.caption, marginTop: 4 },
  pickerScrim: {
    flex: 1,
    backgroundColor: "rgba(5, 8, 15, 0.72)",
    justifyContent: "center",
    padding: spacing.xl,
  },
  pickerCard: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.borderCool,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  pickerTitle: {
    color: colors.textPrimary,
    fontSize: typography.title,
    fontWeight: weight.bold,
  },
  pickerSub: {
    color: colors.textMutedCool,
    fontSize: typography.caption,
    marginBottom: spacing.sm,
  },
  pickerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 48,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
    backgroundColor: colors.surfaceSunken,
  },
  pickerRowOn: { opacity: 0.5 },
  pickerRowText: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: typography.body,
    fontWeight: weight.medium,
  },
  pickerRowTextOn: { color: colors.textMutedCool },
  pickerHere: { color: colors.textFaintCool, fontSize: typography.micro },
});
