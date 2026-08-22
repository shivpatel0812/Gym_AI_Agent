import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import apiClient from "../lib/api-client";
import { MacroEntry, FoodItem, HydrationEntry } from "../types";
import LogFoodForm, { MEALS } from "../components/nutrition/LogFoodModal";

/**
 * Meal rows on Today are fixed labels; plan anchors use slot ids. Map one to
 * the other so an anchor shows up under the row a user would look for it in.
 */
const MEAL_TO_SLOTS: Record<string, string[]> = {
  Breakfast: ["breakfast"],
  Lunch: ["lunch"],
  "Pre-Workout": ["shake"],
  Dinner: ["dinner"],
  Snacks: ["snack", "late_night", "other"],
};
import TodayGuidanceCard from "../components/nutrition/plan/TodayGuidanceCard";
import NutritionPlanTab from "../components/nutrition/plan/NutritionPlanTab";
import SavedFoodsTab from "../components/nutrition/SavedFoodsTab";
import {
  getActiveNutritionPlan,
  getTodayGuidance,
  MealAnchor,
  NutritionPlan,
  TodayGuidance,
} from "../api/nutritionPlan";
import { MdAdd, MdClose, MdEdit, MdKeyboardArrowUp, MdKeyboardArrowDown, MdCalendarToday } from "react-icons/md";

type NutritionTargets = {
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
  fiber: number;
  water: number;
};

const DEFAULT_TARGETS: NutritionTargets = {
  calories: 2200,
  protein: 175,
  carbs: 240,
  fats: 80,
  fiber: 30,
  water: 16,
};

const TARGETS_STORAGE_KEY = "nutrition-targets";

function loadCachedTargets(): NutritionTargets {
  try {
    const raw = localStorage.getItem(TARGETS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_TARGETS };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_TARGETS, ...parsed };
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

  const fieldClass =
    "w-full h-10 px-3 rounded-lg bg-[#0F1117] border border-[#2A2D35] text-white text-sm placeholder:text-[#636366] focus:outline-none focus:ring-1 focus:ring-[#FF6B35]/40";

  return (
    <div className="col-span-12 px-5 py-4 bg-[#0F1117]/40 space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#636366] mb-1.5">
            Food
          </p>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={fieldClass}
          />
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#636366] mb-1.5">
            Amount
          </p>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="e.g. 200g"
            className={fieldClass}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#636366] mb-1.5">
            Calories
          </p>
          <input
            type="number"
            min="0"
            value={calories}
            onChange={(e) => setCalories(e.target.value)}
            className={fieldClass}
          />
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#636366] mb-1.5">
            Protein
          </p>
          <input
            type="number"
            min="0"
            step="0.1"
            value={protein}
            onChange={(e) => setProtein(e.target.value)}
            className={fieldClass}
          />
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#636366] mb-1.5">
            Carbs
          </p>
          <input
            type="number"
            min="0"
            step="0.1"
            value={carbs}
            onChange={(e) => setCarbs(e.target.value)}
            className={fieldClass}
          />
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#636366] mb-1.5">
            Fat
          </p>
          <input
            type="number"
            min="0"
            step="0.1"
            value={fats}
            onChange={(e) => setFats(e.target.value)}
            className={fieldClass}
          />
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#636366] mb-1.5">
            Fiber
          </p>
          <input
            type="number"
            min="0"
            step="0.1"
            value={fiber}
            onChange={(e) => setFiber(e.target.value)}
            className={fieldClass}
          />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-3.5 py-2 rounded-lg text-sm font-semibold text-[#8E8E93] hover:text-white"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!canSave}
          onClick={() => {
            const nextCarbs = parseFloat(carbs);
            const nextFats = parseFloat(fats);
            const nextFiber = parseFloat(fiber);
            onSave({
              ...food,
              name: name.trim(),
              amount: amount.trim() || undefined,
              calories: Math.round(parsedCalories),
              protein: Math.round(parsedProtein * 10) / 10,
              carbs: Number.isFinite(nextCarbs) && nextCarbs >= 0 ? Math.round(nextCarbs * 10) / 10 : 0,
              fats: Number.isFinite(nextFats) && nextFats >= 0 ? Math.round(nextFats * 10) / 10 : 0,
              fiber: Number.isFinite(nextFiber) && nextFiber >= 0 ? Math.round(nextFiber * 10) / 10 : 0,
            });
          }}
          className="px-4 py-2 rounded-lg bg-[#FF6B35] text-white text-sm font-semibold hover:bg-[#E85A2A] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Save
        </button>
      </div>
    </div>
  );
}

function toDateKey(d: Date) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function Ring({
  size,
  stroke,
  progress,
  color,
  children,
}: {
  size: number;
  stroke: number;
  progress: number;
  color: string;
  children?: React.ReactNode;
}) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.min(Math.max(progress, 0), 1);
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg
        className="w-full h-full -rotate-90"
        viewBox={`0 0 ${size} ${size}`}
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#2A2D35"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped)}
          className="transition-[stroke-dashoffset] duration-700 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {children}
      </div>
    </div>
  );
}

export default function NutritionPage() {
  const navigate = useNavigate();
  // Chat deep-links here after staging plan suggestions: ?tab=plan&suggestions=1
  const [searchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const [hubTab, setHubTab] = useState<"today" | "plan" | "foods">(
    tabParam === "plan" || tabParam === "foods" ? tabParam : "today"
  );
  const focusSuggestions = searchParams.get("suggestions") === "1";
  const [guidance, setGuidance] = useState<TodayGuidance | null>(null);
  const [plan, setPlan] = useState<NutritionPlan | null>(null);
  const [loggingAnchor, setLoggingAnchor] = useState<string | null>(null);
  const [entries, setEntries] = useState<MacroEntry[]>([]);
  const [hydrationEntries, setHydrationEntries] = useState<HydrationEntry[]>([]);
  const [selectedDate, setSelectedDate] = useState(() => toDateKey(new Date()));
  const dateInputRef = useRef<HTMLInputElement>(null);
  const [loggingMeal, setLoggingMeal] = useState<string | null>(null);
  const [collapsedMeals, setCollapsedMeals] = useState<Record<string, boolean>>({});
  const [waterDraft, setWaterDraft] = useState("0");
  const [editingFood, setEditingFood] = useState<{
    entryId: string;
    indexInEntry: number;
  } | null>(null);
  const [targets, setTargets] = useState<NutritionTargets>(loadCachedTargets);
  const [targetDraft, setTargetDraft] = useState<NutritionTargets>(loadCachedTargets);
  const [showTargets, setShowTargets] = useState(false);
  const [savingTargets, setSavingTargets] = useState(false);

  useEffect(() => {
    if (tabParam === "plan" || tabParam === "foods" || tabParam === "today") {
      setHubTab(tabParam);
    }
  }, [tabParam]);

  const askNutritionCoach = (prompt: string) => {
    navigate(`/chatbot?mode=nutrition&prompt=${encodeURIComponent(prompt)}`);
  };

  const fetchAll = useCallback(async () => {
    try {
      const [macrosRes, hydrationRes] = await Promise.all([
        apiClient.get("/api/macros"),
        apiClient.get("/api/hydration"),
      ]);
      setEntries(macrosRes.data);
      setHydrationEntries(hydrationRes.data);
    } catch (error) {
      console.error("Error fetching nutrition data:", error);
    }
    try {
      const targetsRes = await apiClient.get("/api/user-profile/nutrition-targets");
      const loaded = { ...DEFAULT_TARGETS, ...(targetsRes.data || {}) };
      setTargets(loaded);
      setTargetDraft(loaded);
      localStorage.setItem(TARGETS_STORAGE_KEY, JSON.stringify(loaded));
    } catch (error) {
      console.error("Error fetching nutrition targets:", error);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Day tabs: Today, Yesterday, then 3 prior weekdays
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

  // All food rows for the day, with a back-reference for deletion
  const dayRows = useMemo(() => {
    const rows: MealRow[] = [];
    for (const entry of dayEntries) {
      (entry.food_items || []).forEach((food, idx) => {
        rows.push({ food, entryId: entry.id!, indexInEntry: idx });
      });
    }
    return rows;
  }, [dayEntries]);

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
    try {
      const existing = dayEntries[0];
      if (existing?.id) {
        await apiClient.put(`/api/macros/${existing.id}`, {
          date: selectedDate,
          food_items: [...(existing.food_items || []), food],
        });
      } else {
        await apiClient.post("/api/macros", {
          date: selectedDate,
          food_items: [food],
        });
      }
      fetchAll();
      setLoggingMeal(null);
    } catch (error) {
      console.error("Error adding food:", error);
    }
  };

  const removeFood = async (row: MealRow) => {
    try {
      const entry = dayEntries.find((e) => e.id === row.entryId);
      if (!entry?.id) return;
      const newItems = (entry.food_items || []).filter(
        (_, i) => i !== row.indexInEntry
      );
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
    setCollapsedMeals((prev) => ({ ...prev, [target]: false }));
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
    try {
      const res = await apiClient.put("/api/user-profile/nutrition-targets", next);
      const saved = { ...DEFAULT_TARGETS, ...(res.data || next) };
      setTargets(saved);
      setTargetDraft(saved);
      localStorage.setItem(TARGETS_STORAGE_KEY, JSON.stringify(saved));
      setShowTargets(false);
    } catch (error) {
      console.error("Error saving nutrition targets:", error);
      setTargets(next);
      localStorage.setItem(TARGETS_STORAGE_KEY, JSON.stringify(next));
      setShowTargets(false);
    } finally {
      setSavingTargets(false);
    }
  };

  const calorieTarget = Math.max(targets.calories, 1);
  const pct = Math.min(
    Math.round((totals.calories / calorieTarget) * 100),
    999
  );
  const remaining = Math.max(targets.calories - totals.calories, 0);
  const over = Math.max(totals.calories - targets.calories, 0);

  useEffect(() => {
    setLoggingMeal(null);
    setEditingFood(null);
  }, [selectedDate]);

  useEffect(() => {
    if (hubTab !== "today") return;
    getTodayGuidance(selectedDate)
      .then(setGuidance)
      .catch(() => setGuidance(null));
  }, [hubTab, selectedDate, totals.calories, totals.protein]);

  // Meal anchors power the one-tap "log my usual" shortcut.
  useEffect(() => {
    if (hubTab !== "today") return;
    getActiveNutritionPlan()
      .then(setPlan)
      .catch(() => setPlan(null));
  }, [hubTab]);

  /** Anchors whose slot maps to this meal row, e.g. Breakfast -> slot "breakfast". */
  const anchorsForMeal = useCallback(
    (mealId: string): MealAnchor[] => {
      const slots = MEAL_TO_SLOTS[mealId] || [];
      return (plan?.meal_anchors || []).filter(
        (a) =>
          a.foods?.length &&
          slots.includes(String(a.slot || "").toLowerCase())
      );
    },
    [plan]
  );

  /** Log every food on an anchor in one go, using the macros already stored. */
  const logAnchor = async (anchor: MealAnchor, mealId: string) => {
    const items: FoodItem[] = (anchor.foods || []).map((food) => ({
      name: food.name,
      amount: food.amount || "1 serving",
      calories: Math.round(Number(food.calories) || 0),
      protein: Number(food.protein) || 0,
      carbs: Number(food.carbs) || 0,
      fats: Number(food.fats) || 0,
      fiber: Number(food.fiber) || 0,
      meal: mealId,
    })) as FoodItem[];
    if (!items.length) return;

    setLoggingAnchor(anchor.id || anchor.label);
    try {
      const existing = dayEntries[0];
      if (existing?.id) {
        await apiClient.put(`/api/macros/${existing.id}`, {
          date: selectedDate,
          food_items: [...(existing.food_items || []), ...items],
        });
      } else {
        await apiClient.post("/api/macros", { date: selectedDate, food_items: items });
      }
      fetchAll();
      setLoggingMeal(null);
    } catch (error) {
      console.error("Error logging usual meal:", error);
    } finally {
      setLoggingAnchor(null);
    }
  };

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

  const openDatePicker = () => {
    const input = dateInputRef.current;
    if (!input) return;
    if (typeof input.showPicker === "function") {
      input.showPicker();
    } else {
      input.click();
    }
  };

  const macroRings = [
    {
      label: "Protein",
      value: totals.protein,
      target: targets.protein,
      color: "#5EEAD4",
    },
    {
      label: "Carbs",
      value: totals.carbs,
      target: targets.carbs,
      color: "#F5C542",
    },
    {
      label: "Fat",
      value: totals.fats,
      target: targets.fats,
      color: "#C4B5FD",
    },
    {
      label: "Fiber",
      value: totals.fiber,
      target: targets.fiber,
      color: "#4ADE80",
    },
  ];

  const mealsToShow = [
    ...MEALS.filter(
      (m) => (mealGroups[m.id] || []).length > 0 || loggingMeal === m.id
    ),
    ...(mealGroups["Other"]?.length
      ? [{ id: "Other", label: "Other", icon: "🍽️" }]
      : []),
  ];
  const emptyMeals = MEALS.filter(
    (m) => !(mealGroups[m.id] || []).length && loggingMeal !== m.id
  );

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1100px] mx-auto pb-28">
      {/* Today | Plan hub tabs */}
      <div className="mb-5 flex items-end gap-6 border-b border-[#2A2D35]">
        {(["today", "plan", "foods"] as const).map((tab) => {
          const active = hubTab === tab;
          return (
            <button
              key={tab}
              type="button"
              onClick={() => setHubTab(tab)}
              className={`relative pb-3 text-sm font-semibold transition-colors ${
                active ? "text-white" : "text-[#8E8E93] hover:text-white"
              }`}
            >
              {tab === "today" ? "Today" : tab === "plan" ? "Plan" : "Foods"}
              {active && (
                <span className="absolute left-0 right-0 -bottom-px h-0.5 bg-[#FF6B35] rounded-full" />
              )}
            </button>
          );
        })}
      </div>

      {hubTab === "plan" ? (
        <NutritionPlanTab
          onAskCoach={askNutritionCoach}
          focusSuggestions={focusSuggestions}
        />
      ) : hubTab === "foods" ? (
        <SavedFoodsTab />
      ) : (
        <>
      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl sm:text-[2rem] font-bold text-white tracking-tight">
            Nutrition
          </h1>
          <p className="text-sm text-[#8E8E93] mt-1">{dateLabel}</p>
        </div>
        <button
          type="button"
          onClick={() => {
            setTargetDraft(targets);
            setShowTargets((open) => !open);
          }}
          className={`mt-1 px-3.5 py-2 rounded-xl text-sm font-semibold border transition-colors ${
            showTargets
              ? "bg-[#FF6B35] border-[#FF6B35] text-white"
              : "bg-[#161A22] border-[#2A2D35] text-[#8E8E93] hover:text-white"
          }`}
        >
          Targets
        </button>
      </div>

      {/* Day tabs */}
      <div className="mb-6 flex items-end gap-6 border-b border-[#2A2D35] overflow-x-auto">
        {dayTabs.map((tab) => {
          const isActive = selectedDate === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setSelectedDate(tab.key)}
              className={`relative pb-3 text-sm font-semibold whitespace-nowrap transition-colors ${
                isActive ? "text-white" : "text-[#8E8E93] hover:text-white"
              }`}
            >
              {tab.label}
              {isActive && (
                <span className="absolute left-0 right-0 -bottom-px h-0.5 bg-[#FF6B35] rounded-full" />
              )}
            </button>
          );
        })}
        {isCustomDate && (
          <button
            type="button"
            onClick={openDatePicker}
            className="relative pb-3 text-sm font-semibold whitespace-nowrap text-white"
          >
            {customDateLabel}
            <span className="absolute left-0 right-0 -bottom-px h-0.5 bg-[#FF6B35] rounded-full" />
          </button>
        )}
        <div className="relative ml-auto pb-3 flex-shrink-0 w-8 h-8 flex items-center justify-center">
          <MdCalendarToday size={18} className="text-[#8E8E93] pointer-events-none" />
          <input
            ref={dateInputRef}
            type="date"
            value={selectedDate}
            onChange={(e) => {
              if (e.target.value) setSelectedDate(e.target.value);
            }}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            aria-label="Pick any date"
            title="Pick any date"
          />
        </div>
      </div>

      <TodayGuidanceCard guidance={guidance} />

      {showTargets && (
        <div className="rounded-2xl bg-[#161A22] border border-[#2A2D35] p-5 mb-6">
          <p className="text-sm font-bold text-white mb-1">Daily targets</p>
          <p className="text-xs text-[#8E8E93] mb-4">
            These are your goals for every day. Rings and remaining calories use them.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
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
              <div key={key}>
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#636366] mb-1.5">
                  {label}
                </p>
                <div className="relative">
                  <input
                    type="number"
                    min="0"
                    value={targetDraft[key]}
                    onChange={(e) =>
                      setTargetDraft((prev) => ({
                        ...prev,
                        [key]: e.target.value === "" ? 0 : Number(e.target.value),
                      }))
                    }
                    className="w-full h-11 px-3 pr-12 rounded-xl bg-[#0F1117] border border-[#2A2D35] text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#FF6B35]/40"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#636366]">
                    {unit}
                  </span>
                </div>
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button
              type="button"
              onClick={() => {
                setTargetDraft(targets);
                setShowTargets(false);
              }}
              className="px-3.5 py-2 rounded-lg text-sm font-semibold text-[#8E8E93] hover:text-white"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={saveTargets}
              disabled={savingTargets}
              className="px-4 py-2 rounded-lg bg-[#FF6B35] text-white text-sm font-semibold hover:bg-[#E85A2A] disabled:opacity-40"
            >
              {savingTargets ? "Saving..." : "Save targets"}
            </button>
          </div>
        </div>
      )}

      {/* Overview card */}
      <div className="rounded-2xl bg-[#161A22] border border-[#2A2D35] p-6 sm:p-8 mb-8">
        <div className="flex flex-col lg:flex-row lg:items-center gap-8">
          {/* Calorie ring + stats */}
          <div className="flex flex-col items-center flex-shrink-0">
            <Ring
              size={200}
              stroke={12}
              progress={totals.calories / calorieTarget}
              color="#FF6B35"
            >
              <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-[#8E8E93]">
                Consumed
              </p>
              <p className="text-[2.15rem] leading-none font-bold text-white">
                {totals.calories.toLocaleString()}
              </p>
              <p className="text-xs text-[#8E8E93] mt-0.5">kcal</p>
              <p className="text-sm font-bold text-[#FF6B35] mt-1.5">{pct}%</p>
              <p className="text-[11px] text-[#8E8E93] mt-0.5 text-center px-3 leading-tight">
                {over > 0
                  ? `${over.toLocaleString()} over`
                  : `${remaining.toLocaleString()} left`}
                {" · "}
                {targets.calories.toLocaleString()} target
              </p>
            </Ring>
          </div>

          <div className="hidden lg:block w-px self-stretch bg-[#2A2D35]" />

          {/* Macro rings + water */}
          <div className="flex-1 flex flex-col gap-8">
            <div className="grid grid-cols-2 sm:grid-cols-4 justify-items-center gap-4">
              {macroRings.map((m) => (
                <div key={m.label} className="flex flex-col items-center">
                  <Ring
                    size={96}
                    stroke={7}
                    progress={m.value / Math.max(m.target, 1)}
                    color={m.color}
                  >
                    <p className="text-xl font-bold text-white">{m.value}</p>
                  </Ring>
                  <p
                    className="text-[11px] font-bold uppercase tracking-[0.14em] mt-3"
                    style={{ color: m.color }}
                  >
                    {m.label}
                  </p>
                  <p className="text-xs text-[#8E8E93] mt-0.5">
                    {m.value} / {m.target}g
                  </p>
                  <div className="w-16 h-1 rounded-full bg-[#2A2D35] mt-1.5 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${Math.min((m.value / m.target) * 100, 100)}%`,
                        backgroundColor: m.color,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>

            {/* Water */}
            <div className="lg:self-end w-full max-w-xs">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#636366] mb-2.5">
                Water
              </p>
              <div className="flex items-center gap-3">
                <div className="flex items-center rounded-xl border border-[#2A2D35] bg-[#0F1117] overflow-hidden">
                  <button
                    type="button"
                    onClick={() => commitWater(glasses - 1)}
                    disabled={glasses <= 0}
                    className="w-10 h-11 flex items-center justify-center text-[#8E8E93] hover:text-white hover:bg-[#1C1C1E] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    aria-label="Decrease cups"
                  >
                    <MdKeyboardArrowDown size={22} />
                  </button>
                  <input
                    type="number"
                    min="0"
                    inputMode="numeric"
                    value={waterDraft}
                    onChange={(e) => setWaterDraft(e.target.value)}
                    onBlur={() => {
                      const parsed = parseFloat(waterDraft);
                      commitWater(Number.isFinite(parsed) ? parsed : glasses);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        (e.target as HTMLInputElement).blur();
                      }
                    }}
                    className="w-14 h-11 bg-transparent text-center text-lg font-bold text-[#38BDF8] [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none focus:outline-none"
                    aria-label="Total cups"
                  />
                  <button
                    type="button"
                    onClick={() => commitWater(glasses + 1)}
                    className="w-10 h-11 flex items-center justify-center text-[#8E8E93] hover:text-white hover:bg-[#1C1C1E] transition-colors"
                    aria-label="Increase cups"
                  >
                    <MdKeyboardArrowUp size={22} />
                  </button>
                </div>
                <p className="text-sm text-[#8E8E93]">
                  <span className="text-white font-semibold">{glasses}</span>
                  {" / "}
                  {targets.water} cups
                </p>
              </div>
              <div className="mt-3 h-2 rounded-full bg-[#2A2D35] overflow-hidden">
                <div
                  className="h-full rounded-full bg-[#38BDF8] transition-all duration-300"
                  style={{
                    width: `${Math.min((glasses / Math.max(targets.water, 1)) * 100, 100)}%`,
                  }}
                />
              </div>
              <p className="text-[11px] text-[#636366] mt-1.5">
                Target {targets.water} cups
                {glasses >= targets.water ? " · Hit" : ""}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Meals */}
      <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#636366] mb-4">
        Meals
      </p>
      <div className="space-y-5">
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
            <div
              key={meal.id}
              className="rounded-2xl bg-[#161A22] border border-[#2A2D35] overflow-hidden"
            >
              {/* Meal header */}
              <button
                onClick={() =>
                  setCollapsedMeals((prev) => ({
                    ...prev,
                    [meal.id]: !isCollapsed,
                  }))
                }
                className="w-full flex items-center gap-3.5 px-5 py-4 text-left"
              >
                <div className="w-10 h-10 rounded-full bg-[#1C1C1E] border border-[#2A2D35] flex items-center justify-center text-lg flex-shrink-0">
                  {meal.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-base font-bold text-white">{meal.label}</p>
                  <p className="text-sm mt-0.5">
                    <span className="text-[#FF6B35] font-semibold">
                      {Math.round(mealTotals.calories)} kcal
                    </span>{" "}
                    <span className="text-[#5EEAD4]">
                      P {Math.round(mealTotals.protein)}g
                    </span>{" "}
                    <span className="text-[#F5C542]">
                      C {Math.round(mealTotals.carbs)}g
                    </span>{" "}
                    <span className="text-[#C4B5FD]">
                      F {Math.round(mealTotals.fats)}g
                    </span>{" "}
                    <span className="text-[#4ADE80]">
                      Fi {Math.round(mealTotals.fiber)}g
                    </span>
                  </p>
                </div>
                <span
                  className={`text-[#636366] text-xs transition-transform ${
                    isCollapsed ? "rotate-180" : ""
                  }`}
                >
                  ▲
                </span>
              </button>

              {!isCollapsed && (
                <>
                  {rows.length > 0 && (
                  <div className="border-t border-[#2A2D35]">
                    <div className="grid grid-cols-12 gap-2 px-5 py-2.5 text-[10px] font-bold uppercase tracking-[0.12em] text-[#636366] bg-[#0F1117]/60">
                      <div className="col-span-7 sm:col-span-5">Food</div>
                      <div className="hidden sm:block sm:col-span-2 text-right">Amount</div>
                      <div className="col-span-2 text-right">Kcal</div>
                      <div className="col-span-1 text-right">P</div>
                      <div className="col-span-1 text-right">C</div>
                      <div className="col-span-1 text-right">F</div>
                    </div>
                    <div className="divide-y divide-[#2A2D35]/60">
                      {rows.map((row, i) => {
                        const isEditing =
                          editingFood?.entryId === row.entryId &&
                          editingFood?.indexInEntry === row.indexInEntry;
                        return (
                        <div key={`${row.entryId}-${row.indexInEntry}-${i}`}>
                        {isEditing ? (
                          <FoodRowEditor
                            food={row.food}
                            onSave={(next) => updateFood(row, next)}
                            onCancel={() => setEditingFood(null)}
                          />
                        ) : (
                        <div
                          className="group grid grid-cols-12 gap-2 px-5 py-3 items-center"
                        >
                          <div className="col-span-7 sm:col-span-5 flex items-center gap-2 min-w-0">
                            <button
                              onClick={() => removeFood(row)}
                              className="text-[#636366] hover:text-red-400 transition-colors flex-shrink-0"
                              title="Remove"
                            >
                              <MdClose size={14} />
                            </button>
                            <button
                              onClick={() =>
                                setEditingFood({
                                  entryId: row.entryId,
                                  indexInEntry: row.indexInEntry,
                                })
                              }
                              className="text-[#636366] hover:text-[#FF6B35] transition-colors flex-shrink-0"
                              title="Edit"
                            >
                              <MdEdit size={14} />
                            </button>
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-white truncate">
                                {row.food.name}
                              </p>
                              {row.food.amount && (
                                <p className="text-[11px] text-[#636366] sm:hidden truncate">
                                  {row.food.amount}
                                </p>
                              )}
                            </div>
                          </div>
                          <div className="hidden sm:block sm:col-span-2 text-right text-xs text-[#636366]">
                            {row.food.amount || "—"}
                          </div>
                          <div className="col-span-2 text-right text-sm font-semibold text-white">
                            {Math.round(row.food.calories)}
                          </div>
                          <div className="col-span-1 text-right text-sm font-semibold text-[#5EEAD4]">
                            {Math.round(row.food.protein)}g
                          </div>
                          <div className="col-span-1 text-right text-sm font-semibold text-[#F5C542]">
                            {Math.round(row.food.carbs || 0)}g
                          </div>
                          <div className="col-span-1 text-right text-sm font-semibold text-[#C4B5FD]">
                            {Math.round(row.food.fats || 0)}g
                          </div>
                        </div>
                        )}
                        </div>
                        );
                      })}
                    </div>

                    {/* Total row */}
                    <div className="grid grid-cols-12 gap-2 px-5 py-3 bg-[#0F1117]/60 border-t border-[#2A2D35]">
                      <div className="col-span-7 sm:col-span-5 text-[10px] font-bold uppercase tracking-[0.12em] text-[#636366] self-center">
                        Total
                      </div>
                      <div className="hidden sm:block sm:col-span-2" />
                      <div className="col-span-2 text-right text-sm font-bold text-[#FF6B35]">
                        {Math.round(mealTotals.calories)}
                      </div>
                      <div className="col-span-1 text-right text-sm font-bold text-[#5EEAD4]">
                        {Math.round(mealTotals.protein)}g
                      </div>
                      <div className="col-span-1 text-right text-sm font-bold text-[#F5C542]">
                        {Math.round(mealTotals.carbs)}g
                      </div>
                      <div className="col-span-1 text-right text-sm font-bold text-[#C4B5FD]">
                        {Math.round(mealTotals.fats)}g
                      </div>
                    </div>
                  </div>
                  )}

                  {/* Add food */}
                  {meal.id !== "Other" && (
                    <div className="px-5 py-4 border-t border-[#2A2D35]">
                      {loggingMeal === meal.id ? (
                        <LogFoodForm
                          key={meal.id}
                          meal={meal.id}
                          onAdd={addFood}
                          onCancel={() => setLoggingMeal(null)}
                        />
                      ) : (
                        <div className="space-y-2">
                          {anchorsForMeal(meal.id).map((anchor) => {
                            const key = anchor.id || anchor.label;
                            const kcal = Math.round(
                              (anchor.foods || []).reduce(
                                (sum, f) => sum + (Number(f.calories) || 0),
                                0
                              )
                            );
                            return (
                              <button
                                key={key}
                                onClick={() => logAnchor(anchor, meal.id)}
                                disabled={loggingAnchor === key}
                                className="w-full px-4 py-2.5 rounded-xl border border-[#5EEAD4]/40 bg-[#5EEAD4]/[0.07] text-left hover:bg-[#5EEAD4]/[0.12] disabled:opacity-50 transition-colors"
                              >
                                <span className="block text-sm font-semibold text-[#5EEAD4]">
                                  {loggingAnchor === key
                                    ? "Logging..."
                                    : `Log my usual ${anchor.label.toLowerCase()}`}
                                </span>
                                <span className="block text-xs text-[#8E8E93] mt-0.5">
                                  {(anchor.foods || []).map((f) => f.name).join(", ")}
                                  {kcal ? ` · ${kcal} kcal` : ""}
                                </span>
                              </button>
                            );
                          })}
                          <button
                            onClick={() => openLogFood(meal.id)}
                            className="w-full py-2.5 rounded-xl border border-dashed border-[#3A3A3C] text-[#8E8E93] hover:text-[#FF6B35] hover:border-[#FF6B35]/40 text-sm font-medium flex items-center justify-center gap-1.5 transition-colors"
                          >
                            <MdAdd size={16} /> Add food
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}

        {/* Empty meals — slim add rows */}
        {emptyMeals.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {emptyMeals.map((meal) => (
              <button
                key={meal.id}
                onClick={() => openLogFood(meal.id)}
                className="flex items-center gap-3 px-4 py-3.5 rounded-2xl bg-[#161A22] border border-dashed border-[#2A2D35] hover:border-[#FF6B35]/40 text-left transition-colors group"
              >
                <div className="w-9 h-9 rounded-full bg-[#1C1C1E] border border-[#2A2D35] flex items-center justify-center text-base flex-shrink-0">
                  {meal.icon}
                </div>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-white">
                    {meal.label}
                  </p>
                  <p className="text-xs text-[#636366] group-hover:text-[#FF6B35] transition-colors">
                    + Add food
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Floating Log Food button */}
      <button
        onClick={() => openLogFood()}
        className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 px-7 py-3.5 rounded-full bg-[#FF6B35] text-white font-bold shadow-orange hover:bg-[#E85A2A] transition-colors"
      >
        <MdAdd size={20} /> Log Food
      </button>
        </>
      )}
    </div>
  );
}
