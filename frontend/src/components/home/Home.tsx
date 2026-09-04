import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  StatusBar,
  Alert,
} from "react-native";
import Slider from "@react-native-community/slider";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import apiClient from "../../api/client";
import { colors, spacing } from "../../theme";
import { todayKey } from "../wellness/types";
import { LevelSlider } from "../wellness/ui";
import LogFoodForm, { PlanMealPick } from "../nutrition/LogFoodForm";
import { DEFAULT_TARGETS, FoodItem } from "../nutrition/types";
import { TodaysWorkout } from "../workouts/types";
import { getActiveNutritionPlan, mealAnchorKind, daysLabel } from "../../api/nutritionPlan";
import type { NutritionPlan } from "../../api/nutritionPlan";
import { normalizeMealLabel } from "../../lib/recentMeals";
import { foodQuantity, scaleFoodItem } from "../../lib/foodQuantity";
import { planItemAppliesToday, todayWeekdayKey } from "../../lib/mealSlots";
import QuickLogBars from "./QuickLogBars";
import TodayFoodLog from "./TodayFoodLog";
import {
  consumePendingMealLog,
  subscribeMealLogOpen,
} from "../../notifications/pendingMealLog";
import {
  loadMealReminderSettings,
  syncMealReminders,
} from "../../notifications/mealReminder";

type SheetKind = "sleep" | "stress" | "wellness" | "food" | "routine" | null;

type Routine = {
  id?: string;
  name: string;
  description?: string;
  icon?: string;
  sort_order?: number;
  completed_dates?: string[];
};

const ROUTINE_ICONS: { name: keyof typeof MaterialCommunityIcons.glyphMap; label: string }[] = [
  { name: "book-open-page-variant", label: "Study" },
  { name: "dog", label: "Dog" },
  { name: "briefcase-outline", label: "Work" },
  { name: "car-outline", label: "Commute" },
  { name: "walk", label: "Walk" },
  { name: "run", label: "Run" },
  { name: "bike", label: "Bike" },
  { name: "dumbbell", label: "Gym" },
  { name: "food-apple-outline", label: "Meal" },
  { name: "cup-water", label: "Water" },
  { name: "laptop", label: "Desk" },
  { name: "home-outline", label: "Home" },
  { name: "heart-outline", label: "Health" },
  { name: "phone-outline", label: "Call" },
  { name: "music", label: "Music" },
  { name: "sleep", label: "Rest" },
];

function todayEntry<T extends { date?: string }>(rows: T[]): T | undefined {
  const key = todayKey();
  return rows.find((row) => String(row.date || "").slice(0, 10) === key);
}

function greetingForHour(hour: number) {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function Sheet({
  visible,
  title,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={styles.sheet}>
            <View style={styles.handle} />
            <Text style={styles.sheetTitle}>{title}</Text>
            {children}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

export default function Home() {
  const navigation = useNavigation<any>();
  const date = todayKey();
  const [sleepHours, setSleepHours] = useState<number | null>(null);
  const [sleepQuality, setSleepQuality] = useState<number | null>(null);
  const [sleepId, setSleepId] = useState<string | null>(null);
  const [stressLevel, setStressLevel] = useState<number | null>(null);
  const [stressId, setStressId] = useState<string | null>(null);
  const [surveyId, setSurveyId] = useState<string | null>(null);
  const [bodyId, setBodyId] = useState<string | null>(null);
  const [draftBody, setDraftBody] = useState("");
  const [todayWorkout, setTodayWorkout] = useState<TodaysWorkout | null>(null);
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [plan, setPlan] = useState<NutritionPlan | null>(null);
  const [macroRows, setMacroRows] = useState<any[]>([]);
  const [sleepRows, setSleepRows] = useState<any[]>([]);
  const [stressRows, setStressRows] = useState<any[]>([]);
  const [waterCups, setWaterCups] = useState(0);
  const [waterId, setWaterId] = useState<string | null>(null);
  const [waterTarget, setWaterTarget] = useState(DEFAULT_TARGETS.water);
  const [logMeal, setLogMeal] = useState("Lunch");
  const [logUncertain, setLogUncertain] = useState(false);
  const [loggingId, setLoggingId] = useState<string | null>(null);
  const [lockScroll, setLockScroll] = useState(false);
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [saving, setSaving] = useState(false);

  const [draftSleep, setDraftSleep] = useState(7.5);
  const [draftStress, setDraftStress] = useState(5);
  const [draftStressNote, setDraftStressNote] = useState("");
  const [draftFatigue, setDraftFatigue] = useState(5);
  const [draftAches, setDraftAches] = useState(5);
  const [draftEnergy, setDraftEnergy] = useState(5);
  const [draftMood, setDraftMood] = useState(5);
  const [draftSleepQuality, setDraftSleepQuality] = useState(5);

  const [editingRoutine, setEditingRoutine] = useState<Routine | null>(null);
  const [routineName, setRoutineName] = useState("");
  const [routineDesc, setRoutineDesc] = useState("");
  const [routineIcon, setRoutineIcon] = useState<string>("briefcase-outline");
  const macrosWriteChain = useRef(Promise.resolve());
  const todayMacroIdRef = useRef<string | null>(null);
  const todayFoodsPendingRef = useRef<FoodItem[] | null>(null);

  const enqueueMacroWrite = (task: () => Promise<void>) => {
    const next = macrosWriteChain.current.then(task, task);
    macrosWriteChain.current = next.catch(() => undefined);
    return next;
  };

  const patchTodayMacroRow = (prev: any[], nextFoods: FoodItem[], opts?: { id?: string }) => {
    const existing = todayEntry(prev);
    const totals = {
      total_calories: nextFoods.reduce((s, f) => s + (Number(f.calories) || 0), 0),
      total_protein: nextFoods.reduce((s, f) => s + (Number(f.protein) || 0), 0),
    };
    if (existing) {
      return prev.map((row) =>
        row === existing ||
        (existing.id && row.id === existing.id) ||
        String(row.date || "").slice(0, 10) === date
          ? {
              ...row,
              ...(opts?.id ? { id: opts.id } : null),
              food_items: nextFoods,
              ...totals,
            }
          : row
      );
    }
    return [
      {
        id: opts?.id || `local-${date}`,
        date,
        food_items: nextFoods,
        ...totals,
      },
      ...prev,
    ];
  };

  const flushTodayMacros = () =>
    enqueueMacroWrite(async () => {
      const foods = todayFoodsPendingRef.current;
      if (foods === null) return;
      const toWrite = foods;
      let id = todayMacroIdRef.current;
      try {
        if (!toWrite.length) {
          if (id) {
            await apiClient.delete(`/api/macros/${id}`);
            todayMacroIdRef.current = null;
          }
          return;
        }
        if (id) {
          await apiClient.put(`/api/macros/${id}`, { date, food_items: toWrite });
          return;
        }
        const res = await apiClient.post("/api/macros", { date, food_items: toWrite });
        const newId = res.data?.id ? String(res.data.id) : null;
        if (!newId) return;
        todayMacroIdRef.current = newId;
        setMacroRows((prev) => {
          const existing = todayEntry(prev);
          if (!existing) {
            // Cleared while create was in flight — drop the doc we just made.
            apiClient.delete(`/api/macros/${newId}`).catch(() => undefined);
            todayMacroIdRef.current = null;
            return prev;
          }
          return prev.map((row) =>
            row === existing ||
            row.id === existing.id ||
            String(row.date || "").slice(0, 10) === date
              ? { ...row, id: newId }
              : row
          );
        });
      } catch (error) {
        console.error("Error saving macros:", error);
        throw error;
      }
    });

  const load = useCallback(async () => {
    try {
      const [
        sleepRes,
        stressRes,
        surveyRes,
        bodyRes,
        routineRes,
        planRes,
        macrosRes,
        nutritionPlan,
        hydrationRes,
        targetsRes,
      ] = await Promise.all([
        apiClient.get("/api/sleep"),
        apiClient.get("/api/stress"),
        apiClient.get("/api/wellness-survey"),
        apiClient.get("/api/body-feelings"),
        apiClient.get("/api/daily-routines"),
        apiClient.get("/api/workout-plan/today").catch(() => ({ data: null })),
        apiClient.get("/api/macros").catch(() => ({ data: [] })),
        getActiveNutritionPlan().catch(() => null),
        apiClient.get("/api/hydration").catch(() => ({ data: [] })),
        apiClient.get("/api/user-profile/nutrition-targets").catch(() => ({ data: null })),
      ]);
      const sleeps = Array.isArray(sleepRes.data) ? sleepRes.data : [];
      const stresses = Array.isArray(stressRes.data) ? stressRes.data : [];
      const surveys = Array.isArray(surveyRes.data) ? surveyRes.data : [];
      const sleep = todayEntry(sleeps);
      const stress = todayEntry(stresses);
      const survey = todayEntry(surveys);
      const body = todayEntry(Array.isArray(bodyRes.data) ? bodyRes.data : []);
      const hydration = todayEntry(Array.isArray(hydrationRes.data) ? hydrationRes.data : []);
      setSleepRows(sleeps);
      setStressRows(stresses);
      setWaterCups(Math.max(0, Math.round(Number(hydration?.amount_cups) || 0)));
      setWaterId(hydration?.id || null);
      setWaterTarget(
        Math.max(
          1,
          Math.round(Number(targetsRes.data?.water) || DEFAULT_TARGETS.water)
        )
      );
      setSleepHours(sleep?.hours_slept != null ? Number(sleep.hours_slept) : null);
      setSleepId(sleep?.id || null);
      setSleepQuality(sleep?.quality != null ? Number(sleep.quality) : null);
      setDraftSleep(sleep?.hours_slept != null ? Number(sleep.hours_slept) : 7.5);
      setDraftSleepQuality(sleep?.quality != null ? Number(sleep.quality) : 5);
      setStressLevel(stress?.level != null ? Number(stress.level) : null);
      setStressId(stress?.id || null);
      setDraftStress(stress?.level != null ? Number(stress.level) : 5);
      setDraftStressNote(stress?.description || "");
      setSurveyId(survey?.id || null);
      setBodyId(body?.id || null);
      setDraftBody(body?.description || "");
      if (survey) {
        setDraftFatigue(survey.fatigue ?? 5);
        setDraftAches(survey.body_aches ?? 5);
        setDraftEnergy(survey.energy ?? 5);
        setDraftMood(survey.mood ?? 5);
      }
      setRoutines(Array.isArray(routineRes.data) ? routineRes.data : []);
      setTodayWorkout(planRes.data || null);
      setMacroRows(Array.isArray(macrosRes.data) ? macrosRes.data : []);
      const todayMacro = todayEntry(Array.isArray(macrosRes.data) ? macrosRes.data : []);
      todayMacroIdRef.current =
        todayMacro?.id && !String(todayMacro.id).startsWith("local-")
          ? String(todayMacro.id)
          : null;
      todayFoodsPendingRef.current = null;
      setPlan(nutritionPlan);
      void (async () => {
        try {
          const mealSettings = await loadMealReminderSettings();
          if (!mealSettings.enabled) return;
          const foods = (todayMacro?.food_items || []) as FoodItem[];
          await syncMealReminders(mealSettings, nutritionPlan, { [date]: foods });
        } catch {
          // Non-fatal.
        }
      })();
    } catch (error) {
      console.error("Error loading home:", error);
    }
  }, [date]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const openSleep = () => {
    setDraftSleep(sleepHours ?? 7.5);
    setDraftSleepQuality(sleepQuality ?? 5);
    setSheet("sleep");
  };
  const openStress = () => {
    setDraftStress(stressLevel ?? 5);
    setSheet("stress");
  };
  const openWellness = () => setSheet("wellness");
  const openFood = (mealLabel?: string, uncertain = false) => {
    setLogMeal(mealLabel || "Lunch");
    setLogUncertain(uncertain);
    setSheet("food");
  };

  useEffect(() => {
    return subscribeMealLogOpen((pending) => {
      consumePendingMealLog();
      openFood(pending.mealId);
      try {
        (navigation as any).navigate("Home");
      } catch {
        // Already on Home or nested differently.
      }
    });
  }, [navigation]);

  const openNewRoutine = () => {
    setEditingRoutine(null);
    setRoutineName("");
    setRoutineDesc("");
    setRoutineIcon("briefcase-outline");
    setSheet("routine");
  };
  const openEditRoutine = (routine: Routine) => {
    setEditingRoutine(routine);
    setRoutineName(routine.name);
    setRoutineDesc(routine.description || "");
    setRoutineIcon(routine.icon || "briefcase-outline");
    setSheet("routine");
  };

  const saveSleep = async () => {
    setSaving(true);
    try {
      const payload = { date, hours_slept: draftSleep, quality: draftSleepQuality };
      if (sleepId) await apiClient.put(`/api/sleep/${sleepId}`, payload);
      else {
        const res = await apiClient.post("/api/sleep", payload);
        setSleepId(res.data?.id || null);
      }
      setSheet(null);
      await load();
    } catch (error) {
      console.error("Error saving sleep:", error);
    } finally {
      setSaving(false);
    }
  };

  const saveStress = async () => {
    setSaving(true);
    try {
      const payload = {
        date,
        level: draftStress,
        description: draftStressNote.trim() || undefined,
      };
      if (stressId) await apiClient.put(`/api/stress/${stressId}`, payload);
      else {
        const res = await apiClient.post("/api/stress", payload);
        setStressId(res.data?.id || null);
      }
      setSheet(null);
      await load();
    } catch (error) {
      console.error("Error saving stress:", error);
    } finally {
      setSaving(false);
    }
  };

  const saveWellness = async () => {
    setSaving(true);
    try {
      const payload = {
        date,
        fatigue: draftFatigue,
        body_aches: draftAches,
        energy: draftEnergy,
        mood: draftMood,
      };
      if (surveyId) await apiClient.put(`/api/wellness-survey/${surveyId}`, payload);
      else {
        const res = await apiClient.post("/api/wellness-survey", payload);
        setSurveyId(res.data?.id || null);
      }
      if (draftBody.trim()) {
        const bodyPayload = { date, description: draftBody.trim() };
        if (bodyId) await apiClient.put(`/api/body-feelings/${bodyId}`, bodyPayload);
        else {
          const res = await apiClient.post("/api/body-feelings", bodyPayload);
          setBodyId(res.data?.id || null);
        }
      }
      setSheet(null);
      await load();
    } catch (error) {
      console.error("Error saving wellness:", error);
    } finally {
      setSaving(false);
    }
  };

  const persistSleepHours = async (hours: number) => {
    try {
      const payload = { date, hours_slept: hours, quality: sleepQuality ?? 5 };
      if (sleepId) await apiClient.put(`/api/sleep/${sleepId}`, payload);
      else {
        const res = await apiClient.post("/api/sleep", payload);
        setSleepId(res.data?.id || null);
      }
      setSleepHours(hours);
      setDraftSleep(hours);
      setSleepRows((prev) => {
        const rest = prev.filter((row) => String(row.date || "").slice(0, 10) !== date);
        return [...rest, { date, hours_slept: hours, quality: sleepQuality ?? 5, id: sleepId }];
      });
    } catch (error) {
      console.error("Error saving sleep:", error);
    }
  };

  const persistStressLevel = async (level: number) => {
    try {
      const payload = {
        date,
        level,
        description: draftStressNote.trim() || undefined,
      };
      if (stressId) await apiClient.put(`/api/stress/${stressId}`, payload);
      else {
        const res = await apiClient.post("/api/stress", payload);
        setStressId(res.data?.id || null);
      }
      setStressLevel(level);
      setDraftStress(level);
      setStressRows((prev) => {
        const rest = prev.filter((row) => String(row.date || "").slice(0, 10) !== date);
        return [...rest, { date, level, id: stressId }];
      });
    } catch (error) {
      console.error("Error saving stress:", error);
    }
  };

  const persistWaterCups = async (cups: number) => {
    const next = Math.max(0, Math.round(cups));
    setWaterCups(next);
    try {
      const payload = { date, amount_cups: next };
      if (waterId) await apiClient.put(`/api/hydration/${waterId}`, payload);
      else {
        const res = await apiClient.post("/api/hydration", payload);
        setWaterId(res.data?.id || null);
      }
    } catch (error) {
      console.error("Error saving hydration:", error);
    }
  };

  const addFoods = async (foods: FoodItem[], closeSheet = true) => {
    if (!foods.length) return;
    const tag = foods[0]?.usual_id || foods[0]?.anchor_id || null;
    if (tag) setLoggingId(tag);

    let snapshot: any[] = [];
    let skipped = false;
    setMacroRows((prev) => {
      snapshot = prev;
      const existing = todayEntry(prev);
      if (existing?.id && !String(existing.id).startsWith("local-")) {
        todayMacroIdRef.current = String(existing.id);
      }
      const current = existing?.food_items || [];
      // Ignore double-taps before the optimistic re-render lands.
      const toAdd = foods.filter((f) => {
        const t = f.usual_id || f.anchor_id;
        if (!t) return true;
        return !current.some((x: FoodItem) => x.usual_id === t || x.anchor_id === t);
      });
      if (!toAdd.length) {
        skipped = true;
        return prev;
      }
      const nextFoods = [...current, ...toAdd];
      todayFoodsPendingRef.current = nextFoods;
      return patchTodayMacroRow(prev, nextFoods);
    });
    if (closeSheet) setSheet(null);
    setLoggingId(null);
    if (skipped) return;

    try {
      await flushTodayMacros();
      void (async () => {
        try {
          const mealSettings = await loadMealReminderSettings();
          if (!mealSettings.enabled) return;
          const foods = todayFoodsPendingRef.current || [];
          await syncMealReminders(mealSettings, plan, { [date]: foods });
        } catch {
          // Non-fatal.
        }
      })();
    } catch {
      setMacroRows(snapshot);
      const existing = todayEntry(snapshot);
      todayFoodsPendingRef.current = existing?.food_items || [];
      todayMacroIdRef.current =
        existing?.id && !String(existing.id).startsWith("local-")
          ? String(existing.id)
          : todayMacroIdRef.current;
    }
  };

  const addFood = async (food: FoodItem) => addFoods([food]);

  /** Append foods even when a tagged row already exists (another meal serving). */
  const repeatFoods = async (foods: FoodItem[]) => {
    if (!foods.length) return;
    const tag = foods[0]?.usual_id || foods[0]?.anchor_id || null;
    if (tag) setLoggingId(tag);

    let snapshot: any[] = [];
    setMacroRows((prev) => {
      snapshot = prev;
      const existing = todayEntry(prev);
      if (existing?.id && !String(existing.id).startsWith("local-")) {
        todayMacroIdRef.current = String(existing.id);
      }
      const current = existing?.food_items || [];
      const nextFoods = [...current, ...foods];
      todayFoodsPendingRef.current = nextFoods;
      return patchTodayMacroRow(prev, nextFoods);
    });
    setLoggingId(null);

    try {
      await flushTodayMacros();
    } catch {
      setMacroRows(snapshot);
      const existing = todayEntry(snapshot);
      todayFoodsPendingRef.current = existing?.food_items || [];
      todayMacroIdRef.current =
        existing?.id && !String(existing.id).startsWith("local-")
          ? String(existing.id)
          : todayMacroIdRef.current;
    }
  };

  /**
   * Change how many units of a tagged item are logged. `base` is the PER-UNIT
   * food; the row is always rebuilt as base x qty so repeated taps cannot drift.
   * Dropping to zero removes the row, matching removeByTag.
   */
  const bumpFoodQuantity = async (tag: string, delta: number, base: FoodItem) => {
    setLoggingId(tag);

    let snapshot: any[] = [];
    let changed = false;
    setMacroRows((prev) => {
      snapshot = prev;
      const existing = todayEntry(prev);
      if (existing?.id && !String(existing.id).startsWith("local-")) {
        todayMacroIdRef.current = String(existing.id);
      }
      const current: FoodItem[] = existing?.food_items || [];
      const name = String(base.name || "").trim().toLowerCase();
      let idx = current.findIndex(
        (f) => (f.usual_id && f.usual_id === tag) || (f.anchor_id && f.anchor_id === tag)
      );
      // The same food may already be on the log untagged (added via the form).
      // Bump that row rather than appending a duplicate beside it.
      if (idx === -1 && name) {
        idx = current.findIndex(
          (f) =>
            !f.usual_id &&
            !f.anchor_id &&
            String(f.name || "").trim().toLowerCase() === name
        );
      }

      let nextFoods: FoodItem[];
      if (idx === -1) {
        if (delta <= 0) return prev;
        nextFoods = [...current, scaleFoodItem(base, 1)];
      } else {
        const nextQty = foodQuantity(current[idx]) + delta;
        if (nextQty <= 0) {
          nextFoods = current.filter((_, i) => i !== idx);
        } else {
          nextFoods = current.map((f, i) =>
            i === idx
              ? {
                  ...scaleFoodItem(base, nextQty),
                  // Prefer the meal from this log action so go-tos can be retargeted.
                  meal: base.meal ?? f.meal,
                }
              : f
          );
        }
      }

      changed = true;
      todayFoodsPendingRef.current = nextFoods;
      if (!nextFoods.length && existing) {
        return prev.filter(
          (row) =>
            row !== existing &&
            row.id !== existing.id &&
            String(row.date || "").slice(0, 10) !== date
        );
      }
      return patchTodayMacroRow(prev, nextFoods);
    });
    setLoggingId(null);
    if (!changed) return;

    try {
      await flushTodayMacros();
    } catch {
      setMacroRows(snapshot);
      const existing = todayEntry(snapshot);
      todayFoodsPendingRef.current = existing?.food_items || [];
      todayMacroIdRef.current =
        existing?.id && !String(existing.id).startsWith("local-")
          ? String(existing.id)
          : todayMacroIdRef.current;
    }
  };

  const removeByTag = async (tag: string) => {
    setLoggingId(tag);

    let snapshot: any[] = [];
    setMacroRows((prev) => {
      snapshot = prev;
      const existing = todayEntry(prev);
      if (!existing) return prev;
      if (existing.id && !String(existing.id).startsWith("local-")) {
        todayMacroIdRef.current = String(existing.id);
      }
      const nextFoods = (existing.food_items || []).filter(
        (item: FoodItem) => item.usual_id !== tag && item.anchor_id !== tag
      );
      todayFoodsPendingRef.current = nextFoods;
      if (!nextFoods.length) {
        return prev.filter(
          (row) =>
            row !== existing &&
            row.id !== existing.id &&
            String(row.date || "").slice(0, 10) !== date
        );
      }
      return patchTodayMacroRow(prev, nextFoods);
    });
    setLoggingId(null);

    try {
      await flushTodayMacros();
    } catch {
      setMacroRows(snapshot);
      const existing = todayEntry(snapshot);
      todayFoodsPendingRef.current = existing?.food_items || [];
      todayMacroIdRef.current =
        existing?.id && !String(existing.id).startsWith("local-")
          ? String(existing.id)
          : todayMacroIdRef.current;
    }
  };

  const allPlanMeals = useMemo((): PlanMealPick[] => {
    const weekday = todayWeekdayKey();
    return (plan?.meal_anchors || [])
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
  }, [plan]);

  const saveRoutine = async () => {
    if (!routineName.trim()) return;
    setSaving(true);
    try {
      const payload = {
        name: routineName.trim(),
        description: routineDesc.trim() || undefined,
        icon: routineIcon,
        sort_order: editingRoutine?.sort_order ?? routines.length,
        completed_dates: editingRoutine?.completed_dates || [],
      };
      if (editingRoutine?.id) await apiClient.put(`/api/daily-routines/${editingRoutine.id}`, payload);
      else await apiClient.post("/api/daily-routines", payload);
      setSheet(null);
      await load();
    } catch (error) {
      console.error("Error saving routine:", error);
    } finally {
      setSaving(false);
    }
  };

  const toggleRoutine = async (routine: Routine) => {
    if (!routine.id) return;
    try {
      await apiClient.post(`/api/daily-routines/${routine.id}/toggle`, { date });
      await load();
    } catch (error) {
      console.error("Error toggling routine:", error);
    }
  };

  const deleteRoutine = () => {
    if (!editingRoutine?.id) return;
    Alert.alert("Delete routine?", editingRoutine.name, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await apiClient.delete(`/api/daily-routines/${editingRoutine.id}`);
            setSheet(null);
            await load();
          } catch (error) {
            console.error("Error deleting routine:", error);
          }
        },
      },
    ]);
  };

  const doneCount = routines.filter((r) => (r.completed_dates || []).includes(date)).length;
  const progress = routines.length ? doneCount / routines.length : 0;
  const now = new Date();
  const dateLabel = now.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const showWorkout = todayWorkout?.status === "workout_day" && !todayWorkout.already_logged;
  const todayFoods: FoodItem[] = todayEntry(macroRows)?.food_items || [];

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      scrollEnabled={!lockScroll}
    >
      <View style={styles.header}>
        <Text style={styles.greeting}>{greetingForHour(now.getHours())}</Text>
        <Text style={styles.dateLine}>{dateLabel}</Text>
      </View>

      <QuickLogBars
        sleepHours={sleepHours}
        sleepQuality={sleepQuality}
        stressLevel={stressLevel}
        energy={surveyId ? draftEnergy : null}
        aches={surveyId ? draftAches : null}
        waterCups={waterCups}
        waterTarget={waterTarget}
        sleepRows={sleepRows}
        stressRows={stressRows}
        onSaveSleep={persistSleepHours}
        onSaveStress={persistStressLevel}
        onSaveWater={persistWaterCups}
        onOpenWellness={openWellness}
        onOpenSleep={openSleep}
        onOpenStress={openStress}
        onLockScroll={setLockScroll}
      />

      <TodayFoodLog
        plan={plan}
        todayFoods={todayFoods}
        loggingId={loggingId}
        onLogMeal={(meal, uncertain) => openFood(meal, uncertain)}
        onLogFoods={(foods) => addFoods(foods, false)}
        onRepeatFoods={repeatFoods}
        onRemoveTag={removeByTag}
        onBumpFood={bumpFoodQuantity}
      />

      <View style={styles.routinesHead}>
        <Text style={styles.sectionLabel}>Routines</Text>
        <View style={styles.routinesHeadRight}>
          <Text style={styles.frac}>
            {doneCount}/{routines.length || 0}
          </Text>
          <TouchableOpacity style={styles.plusBtn} onPress={openNewRoutine}>
            <MaterialCommunityIcons name="plus" size={18} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>

      {routines.length === 0 ? (
        <TouchableOpacity style={styles.emptyRoutines} onPress={openNewRoutine}>
          <Text style={styles.emptyText}>Add a routine like commute, study, or dog walk</Text>
        </TouchableOpacity>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.routineRow}>
          {routines.map((routine) => {
            const done = (routine.completed_dates || []).includes(date);
            const icon = (routine.icon || "checkbox-marked-circle-outline") as keyof typeof MaterialCommunityIcons.glyphMap;
            return (
              <TouchableOpacity
                key={routine.id}
                style={[styles.routineChip, done && styles.routineChipOn]}
                onPress={() => toggleRoutine(routine)}
                onLongPress={() => openEditRoutine(routine)}
              >
                <TouchableOpacity style={styles.editDot} onPress={() => openEditRoutine(routine)} hitSlop={8}>
                  <MaterialCommunityIcons name="pencil-outline" size={12} color="#7C8CA0" />
                </TouchableOpacity>
                <MaterialCommunityIcons name={icon} size={26} color={done ? "#9CC0E8" : "#7C8CA0"} />
                <Text style={styles.routineName} numberOfLines={1}>
                  {routine.name}
                </Text>
                {routine.description ? (
                  <Text style={styles.routineDesc} numberOfLines={1}>
                    {routine.description}
                  </Text>
                ) : null}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
      </View>

      {showWorkout ? (
        <View style={styles.workoutCard}>
          <Text style={styles.todayLabel}>Today's workout</Text>
          <View style={styles.workoutRow}>
            <View style={styles.workoutIcon}>
              <MaterialCommunityIcons name="dumbbell" size={20} color="#9CC0E8" />
            </View>
            <View>
              <Text style={styles.workoutTitle}>{todayWorkout?.day_name || "Workout"}</Text>
              <Text style={styles.cardLabel}>{todayWorkout?.exercises?.length || 0} exercises</Text>
            </View>
          </View>
          <TouchableOpacity style={styles.startBtn} onPress={() => navigation.navigate("Workouts")}>
            <Text style={styles.startBtnText}>Start workout</Text>
          </TouchableOpacity>
        </View>
      ) : todayWorkout?.status === "rest_day" ? (
        <View style={styles.activityCard}>
          <Text style={styles.todayLabel}>Today's workout</Text>
          <Text style={styles.cardValue}>Rest day</Text>
        </View>
      ) : null}

      <Sheet visible={sheet === "sleep"} title="Sleep" onClose={() => setSheet(null)}>
        <View style={styles.blockHead}>
          <Text style={styles.muted}>Hours slept</Text>
          <Text style={styles.purpleVal}>{draftSleep} hrs</Text>
        </View>
        <Slider
          minimumValue={4}
          maximumValue={12}
          step={0.5}
          value={draftSleep}
          onValueChange={setDraftSleep}
          minimumTrackTintColor="#A78BFA"
          maximumTrackTintColor="#1E2A38"
          thumbTintColor="#A78BFA"
        />
        <LevelSlider
          label="Estimated sleep quality"
          value={draftSleepQuality}
          onChange={setDraftSleepQuality}
          minLabel="Poor"
          maxLabel="Excellent"
        />
        <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.5 }]} disabled={saving} onPress={saveSleep}>
          <Text style={styles.saveText}>{saving ? "Saving..." : "Save"}</Text>
        </TouchableOpacity>
      </Sheet>

      <Sheet visible={sheet === "stress"} title="Stress" onClose={() => setSheet(null)}>
        <LevelSlider
          label="Stress level"
          value={draftStress}
          onChange={setDraftStress}
          minLabel="Low"
          maxLabel="High"
          reverse
        />
        <Text style={styles.fieldLabel}>What's going on?</Text>
        <TextInput
          value={draftStressNote}
          onChangeText={setDraftStressNote}
          placeholder="What's causing the stress?"
          placeholderTextColor="#55647A"
          style={[styles.input, { height: 88, textAlignVertical: "top" }]}
          multiline
        />
        <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.5 }]} disabled={saving} onPress={saveStress}>
          <Text style={styles.saveText}>{saving ? "Saving..." : "Save"}</Text>
        </TouchableOpacity>
      </Sheet>

      <Sheet visible={sheet === "wellness"} title="Wellness" onClose={() => setSheet(null)}>
        <ScrollView style={{ maxHeight: 420 }} keyboardShouldPersistTaps="handled">
          <LevelSlider label="Mood" value={draftMood} onChange={setDraftMood} minLabel="Low" maxLabel="High" />
          <LevelSlider label="Energy" value={draftEnergy} onChange={setDraftEnergy} minLabel="Low" maxLabel="High" />
          <LevelSlider
            label="Soreness"
            value={draftAches}
            onChange={setDraftAches}
            minLabel="None"
            maxLabel="Severe"
            reverse
          />
          <Text style={styles.fieldLabel}>How does your body feel?</Text>
          <TextInput
            value={draftBody}
            onChangeText={setDraftBody}
            placeholder="How does your body feel today?"
            placeholderTextColor="#55647A"
            style={[styles.input, { height: 88, textAlignVertical: "top" }]}
            multiline
          />
        </ScrollView>
        <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.5 }]} disabled={saving} onPress={saveWellness}>
          <Text style={styles.saveText}>{saving ? "Saving..." : "Save"}</Text>
        </TouchableOpacity>
      </Sheet>

      <Sheet visible={sheet === "food"} title="Log food" onClose={() => setSheet(null)}>
        <ScrollView style={{ maxHeight: 480 }} keyboardShouldPersistTaps="handled">
          <LogFoodForm
            meal={logMeal}
            compact
            defaultUncertain={logUncertain}
            planMeals={allPlanMeals}
            onMealChange={setLogMeal}
            onAdd={addFood}
            onAddMany={(foods) => addFoods(foods)}
            onCancel={() => setSheet(null)}
          />
        </ScrollView>
      </Sheet>

      <Sheet visible={sheet === "routine"} title={editingRoutine ? "Edit routine" : "Add routine"} onClose={() => setSheet(null)}>
        <Text style={styles.fieldLabel}>Name</Text>
        <TextInput
          value={routineName}
          onChangeText={setRoutineName}
          placeholder="Commute"
          placeholderTextColor="#55647A"
          style={styles.input}
        />
        <Text style={styles.fieldLabel}>What is it?</Text>
        <TextInput
          value={routineDesc}
          onChangeText={setRoutineDesc}
          placeholder="Commute time, morning walk, study block…"
          placeholderTextColor="#55647A"
          style={[styles.input, { height: 80, textAlignVertical: "top" }]}
          multiline
        />
        <Text style={styles.fieldLabel}>Icon</Text>
        <View style={styles.iconGrid}>
          {ROUTINE_ICONS.map((item) => {
            const on = routineIcon === item.name;
            return (
              <TouchableOpacity
                key={item.name}
                onPress={() => setRoutineIcon(item.name)}
                style={[styles.iconPick, on && styles.iconPickOn]}
              >
                <MaterialCommunityIcons name={item.name} size={20} color={on ? "#9CC0E8" : "#fff"} />
              </TouchableOpacity>
            );
          })}
        </View>
        <TouchableOpacity
          style={[styles.saveBtn, (!routineName.trim() || saving) && { opacity: 0.5 }]}
          disabled={!routineName.trim() || saving}
          onPress={saveRoutine}
        >
          <Text style={styles.saveText}>{saving ? "Saving..." : editingRoutine ? "Save changes" : "Add routine"}</Text>
        </TouchableOpacity>
        {editingRoutine ? (
          <TouchableOpacity style={styles.deleteBtn} onPress={deleteRoutine}>
            <Text style={styles.deleteText}>Delete</Text>
          </TouchableOpacity>
        ) : null}
      </Sheet>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: {
    paddingHorizontal: spacing.lg,
    paddingBottom: 40,
    paddingTop: Platform.OS === "ios" ? 60 : StatusBar.currentHeight ? StatusBar.currentHeight + 16 : 16,
  },
  header: { marginBottom: 22 },
  greeting: { color: "#fff", fontSize: 32, fontWeight: "800" },
  dateLine: { color: "#7C8CA0", fontSize: 16, marginTop: 4 },
  sectionLabel: {
    color: "#7C8CA0",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.4,
    textTransform: "uppercase",
    marginBottom: 10,
  },
  quickRow: { flexDirection: "row", gap: 10, marginBottom: 10 },
  halfCard: {
    flex: 1,
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: 14,
    minHeight: 108,
  },
  cardLabel: { color: "#7C8CA0", fontSize: 13, marginTop: 8 },
  cardValue: { color: "#fff", fontSize: 18, fontWeight: "700", marginTop: 4 },
  bodyPreview: { color: "#7C8CA0", fontSize: 12, marginTop: 4 },
  tap: { color: "#9CC0E8", fontSize: 13, fontWeight: "600", marginTop: 8 },
  wellnessCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
  },
  wellnessIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "#2A1A24",
    alignItems: "center",
    justifyContent: "center",
  },
  remainingLine: {
    color: "#7C8CA0",
    fontSize: 12,
    fontWeight: "600",
    marginBottom: 10,
  },
  seeAll: { color: "#F5C542", fontSize: 12, fontWeight: "700" },
  uncertainHomeBox: {
    marginBottom: 14,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(245,197,66,0.3)",
    backgroundColor: "rgba(245,197,66,0.06)",
    gap: 8,
  },
  uncertainHomeHint: { color: "#7C8CA0", fontSize: 12, lineHeight: 16 },
  weekChipRow: { gap: 8, paddingRight: 4 },
  weekChip: {
    width: 120,
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(245,197,66,0.28)",
    backgroundColor: "#12151C",
    gap: 4,
  },
  weekChipAdd: { alignItems: "center", justifyContent: "center", minHeight: 72 },
  weekChipName: { color: "#fff", fontSize: 12, fontWeight: "700" },
  weekChipMeta: { color: "#7C8CA0", fontSize: 10 },
  weekListRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#1E2A38",
  },
  slotPick: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#1E2A38",
  },
  slotPickOn: {
    borderColor: "#F5C542",
    backgroundColor: "rgba(245,197,66,0.14)",
  },
  slotPickText: { color: "#7C8CA0", fontSize: 12, fontWeight: "700" },
  slotPickTextOn: { color: "#F5C542" },
  routinesHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  routinesHeadRight: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 },
  frac: { color: "#7C8CA0", fontSize: 13, fontWeight: "600" },
  plusBtn: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: "#1E2A38",
    alignItems: "center",
    justifyContent: "center",
  },
  emptyRoutines: {
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: "dashed",
    borderRadius: 16,
    padding: 16,
    marginBottom: 10,
  },
  emptyText: { color: "#7C8CA0", fontSize: 13 },
  routineRow: { gap: 10, paddingRight: 8, marginBottom: 12 },
  routineChip: {
    width: 92,
    minHeight: 96,
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  routineChipOn: { borderColor: "#9CC0E8" },
  usualScroll: { gap: 14, paddingRight: 8, marginBottom: 10 },
  usualGroup: { gap: 6 },
  usualGroupHead: { flexDirection: "row", alignItems: "center", gap: 5, paddingLeft: 2 },
  nowDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: "#4ADE80" },
  usualTime: {
    color: "#55647A",
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 0.9,
    textTransform: "uppercase",
  },
  usualTimeNow: { color: "#4ADE80" },
  usualGroupRow: { flexDirection: "row", gap: 8 },
  usualChip: {
    width: 84,
    height: 76,
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingHorizontal: 9,
    paddingVertical: 9,
  },
  usualChipOn: { backgroundColor: "#10231A", borderColor: "#4ADE80" },
  usualIcon: {
    width: 26,
    height: 26,
    borderRadius: 9,
    backgroundColor: "#1E2A38",
    alignItems: "center",
    justifyContent: "center",
  },
  usualIconOn: { backgroundColor: "#4ADE80" },
  usualCheck: {
    position: "absolute",
    top: 7,
    right: 7,
    width: 15,
    height: 15,
    borderRadius: 8,
    backgroundColor: "#4ADE80",
    alignItems: "center",
    justifyContent: "center",
  },
  usualName: { color: "#fff", fontSize: 11, fontWeight: "700", lineHeight: 14, marginTop: 6 },
  usualNameOn: { color: "#DCFCE7" },
  editDot: { position: "absolute", top: 6, right: 6 },
  routineName: { color: "#fff", fontSize: 12, fontWeight: "600", marginTop: 8, textAlign: "center" },
  routineDesc: { color: "#7C8CA0", fontSize: 10, marginTop: 2, textAlign: "center" },
  progressTrack: {
    height: 4,
    borderRadius: 999,
    backgroundColor: "#1E2A38",
    marginBottom: 18,
    overflow: "hidden",
  },
  progressFill: { height: 4, backgroundColor: "#5A5F6A", borderRadius: 999 },
  activityCard: {
    flexDirection: "row",
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
  },
  workoutCard: {
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: "#9CC0E8",
    borderRadius: 16,
    padding: 16,
  },
  todayLabel: {
    color: "#9CC0E8",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginBottom: 10,
  },
  workoutRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 14 },
  workoutIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "#2A1A14",
    alignItems: "center",
    justifyContent: "center",
  },
  workoutTitle: { color: "#fff", fontSize: 18, fontWeight: "700" },
  startBtn: {
    backgroundColor: "#9CC0E8",
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
  },
  startBtnText: { color: colors.onAccent, fontWeight: "700", fontSize: 16 },
  modalRoot: { flex: 1, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(0,0,0,0.55)" },
  sheet: {
    backgroundColor: "#0E1621",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingBottom: Platform.OS === "ios" ? 28 : 16,
    paddingTop: 8,
    maxHeight: "88%",
  },
  handle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 999,
    backgroundColor: "#3A3A3C",
    marginBottom: 14,
  },
  sheetTitle: { color: "#fff", fontSize: 20, fontWeight: "700", marginBottom: 16 },
  blockHead: { flexDirection: "row", justifyContent: "space-between", marginBottom: 8 },
  muted: { color: "#7C8CA0" },
  purpleVal: { color: "#A78BFA", fontWeight: "700" },
  saveBtn: {
    backgroundColor: "#9CC0E8",
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 16,
  },
  saveText: { color: colors.onAccent, fontWeight: "700", fontSize: 16 },
  segRow: { flexDirection: "row", gap: 8 },
  seg: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: "#05080F",
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
  },
  segText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  fieldLabel: { color: "#7C8CA0", fontSize: 12, fontWeight: "600", marginBottom: 6, marginTop: 8 },
  input: {
    borderRadius: 12,
    backgroundColor: "#05080F",
    borderWidth: 1,
    borderColor: colors.border,
    color: "#fff",
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 15,
  },
  iconGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  iconPick: {
    width: 40,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#05080F",
  },
  iconPickOn: { borderColor: "#9CC0E8" },
  deleteBtn: { alignItems: "center", paddingVertical: 14 },
  deleteText: { color: "#EF4444", fontWeight: "600" },
});
