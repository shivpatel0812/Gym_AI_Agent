import { useCallback, useEffect, useMemo, useState } from "react";
import {
  MdLunchDining,
  MdCheck,
  MdChatBubbleOutline,
  MdChevronRight,
  MdRestaurant,
} from "react-icons/md";
import CreateNutritionPlanModal from "./CreateNutritionPlanModal";
import EditMealAnchorModal, { SlotIcon, sumAnchorMacros } from "./EditMealAnchorModal";
import EditGoToItemModal from "./EditGoToItemModal";
import EditFlexibleMealModal from "./EditFlexibleMealModal";
import DayMap from "./DayMap";
import PlanSuggestions from "./PlanSuggestions";
import AddBlueprintModal, { BlueprintAddResult } from "./AddBlueprintModal";
import {
  BlueprintExtra,
  DayBand,
  FlexibleMeal,
  GoToItem,
  MealAnchor,
  NutritionPlan,
  NutritionPlanEdit,
  NutritionSuggestionSet,
  PrimaryMealSlot,
  applySuggestions,
  dismissSuggestions,
  endNutritionPlan,
  getPendingSuggestions,
  frequencyLabel,
  getActiveNutritionPlan,
  goalLabel,
  pauseNutritionPlan,
  resumeNutritionPlan,
  slotLabel,
  updateNutritionPlan,
} from "../../../api/nutritionPlan";
import { buildDayMap } from "../../../lib/dayMap";

interface Props {
  onAskCoach?: (prompt: string) => void;
  /** Arrived from a chat card — scroll the staged suggestions into view. */
  focusSuggestions?: boolean;
}

const MACRO_TILES = [
  { key: "protein", label: "Protein", color: "#FF6B35", unit: "g" },
  { key: "carbs", label: "Carbs", color: "#F5C542", unit: "g" },
  { key: "fats", label: "Fat", color: "#C4B5FD", unit: "g" },
  { key: "fiber", label: "Fiber", color: "#4ADE80", unit: "g" },
];

const fieldClass =
  "w-full px-3 py-2 rounded-lg bg-[#0B0C10] border border-[#2A2D35] text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#FF6B35]/40";

export default function NutritionPlanTab({ onAskCoach, focusSuggestions }: Props) {
  const [plan, setPlan] = useState<NutritionPlan | null>(null);
  const [loading, setLoading] = useState(true);
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
  const [error, setError] = useState<string | null>(null);
  const [strategyOpen, setStrategyOpen] = useState(false);
  const [addBand, setAddBand] = useState<DayBand | null>(null);
  const [editingExtra, setEditingExtra] = useState<BlueprintExtra | null>(null);
  const [suggestions, setSuggestions] = useState<NutritionSuggestionSet | null>(null);
  const [planChangedSince, setPlanChangedSince] = useState(false);
  const [suggestionsBusy, setSuggestionsBusy] = useState(false);

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

  const load = useCallback(async () => {
    try {
      const active = await getActiveNutritionPlan();
      setPlan(active);
      if (active) loadSuggestions();
      if (active?.targets) {
        setCal(String(active.targets.calories ?? ""));
        setProtein(String(active.targets.protein ?? ""));
        setCarbs(String(active.targets.carbs ?? ""));
        setFats(String(active.targets.fats ?? ""));
        setFiber(String(active.targets.fiber ?? ""));
      }
    } catch (err) {
      console.error("Error loading nutrition plan:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (focusSuggestions && suggestions) {
      document
        .querySelector('[data-testid="plan-suggestions"]')
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [focusSuggestions, suggestions]);

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
        setError("Some suggestions no longer matched your plan and were skipped.");
      } else {
        setError(null);
      }
    } catch {
      setError("Could not apply those suggestions.");
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
      setError("Could not dismiss those suggestions.");
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
      return;
    }
    if (edit.field === "targets" && edit.payload) {
      if (edit.payload.calories != null) setCal(String(edit.payload.calories));
      if (edit.payload.protein != null) setProtein(String(edit.payload.protein));
      if (edit.payload.carbs != null) setCarbs(String(edit.payload.carbs));
      if (edit.payload.fats != null) setFats(String(edit.payload.fats));
      if (edit.payload.fiber != null) setFiber(String(edit.payload.fiber));
      setEditingTargets(true);
    }
  };

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
      setError(null);
      return true;
    } catch {
      setError("Could not save that change.");
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
    if (slot.kind === "suggest" || slot.kind === "goto") {
      const items = plan.go_to_items || [];
      const idx = items.findIndex((g) => g.id && g.id === slot.sourceId);
      const resolved = idx >= 0 ? idx : typeof slot.sourceIndex === "number" ? slot.sourceIndex : -1;
      if (resolved >= 0 && items[resolved]) openEditGoTo(items[resolved], resolved);
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

  const removeAnchor = async (id?: string, index?: number) => {
    if (!plan) return;
    if (!confirm("Remove this regular food?")) return;
    await savePatch({
      meal_anchors: plan.meal_anchors.filter((a, i) => (id ? a.id !== id : i !== index)),
    });
    setAnchorEditorOpen(false);
    setEditingAnchor(null);
    setEditingAnchorIndex(null);
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

  const removeFlex = async (id?: string, index?: number) => {
    if (!plan) return;
    if (!confirm("Remove this flexible meal?")) return;
    await savePatch({
      flexible_meals: plan.flexible_meals.filter((m, i) => (id ? m.id !== id : i !== index)),
    });
    setFlexEditorOpen(false);
    setEditingFlex(null);
    setEditingFlexIndex(null);
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

  const removeGoTo = async (id?: string, index?: number) => {
    if (!plan) return;
    if (!confirm("Remove this go-to item?")) return;
    await savePatch({
      go_to_items: (plan.go_to_items || []).filter((g, i) => (id ? g.id !== id : i !== index)),
    });
    setGoToEditorOpen(false);
    setEditingGoTo(null);
    setEditingGoToIndex(null);
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

  const removeBlueprintExtra = async (id?: string) => {
    if (!plan || !id) return;
    if (!confirm("Remove this one-time meal?")) return;
    await savePatch({
      blueprint_extras: (plan.blueprint_extras || []).filter((e) => e.id !== id),
    });
    setEditingExtra(null);
    setAddBand(null);
  };

  const runStatus = async (title: string, message: string, action: () => Promise<void>) => {
    if (!confirm(`${title}\n\n${message}`)) return;
    try {
      await action();
      await load();
    } catch {
      setError(`Could not ${title.toLowerCase()}.`);
    }
  };

  const dayMap = useMemo(() => (plan ? buildDayMap(plan) : null), [plan]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-10 h-10 border-2 border-[#FF6B35] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!plan) {
    return (
      <div>
        <div className="rounded-2xl bg-[#1C1C1E] border-[1.5px] border-[#FF6B35] p-6 space-y-3">
          <MdLunchDining size={36} className="text-[#FF6B35]" />
          <h3 className="text-lg font-bold text-white">No nutrition plan</h3>
          <p className="text-sm text-[#8E8E93] leading-relaxed">
            Answer a few questions about how you actually eat. We'll save regular foods and flexible
            meals so Today can guide you around them — not a new menu every day.
          </p>
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="w-full py-3 rounded-xl bg-[#FF6B35] text-white font-bold hover:bg-[#E85A2A]"
          >
            Create Nutrition Plan
          </button>
          {onAskCoach ? (
            <button
              type="button"
              onClick={() => onAskCoach("I want a nutrition plan that supports my training. ")}
              className="w-full py-3 rounded-xl border border-[#FF6B35] text-[#FF6B35] font-bold"
            >
              Design with Coach
            </button>
          ) : null}
        </div>
        <CreateNutritionPlanModal
          visible={createOpen}
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false);
            load();
          }}
        />
      </div>
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
    <div className="space-y-4 pb-8">
      {error ? (
        <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-300">
          {error}
        </div>
      ) : null}

      <div className="flex items-center justify-between">
        <span
          className={`px-2.5 py-1 rounded-lg text-[11px] font-extrabold tracking-wide ${
            plan.status === "paused"
              ? "bg-[rgba(245,158,11,0.15)] text-[#F59E0B]"
              : "bg-[rgba(74,222,128,0.15)] text-[#4ADE80]"
          }`}
        >
          {plan.status === "paused" ? "PAUSED" : "ACTIVE"}
        </span>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="text-sm font-bold text-[#FF6B35]"
        >
          New plan
        </button>
      </div>

      {suggestions ? (
        <PlanSuggestions
          set={suggestions}
          planChangedSince={planChangedSince}
          busy={suggestionsBusy}
          onAccept={acceptSuggestions}
          onDismiss={rejectSuggestions}
          onEdit={editSuggestion}
        />
      ) : null}

      <div>
        <h2 className="text-[28px] font-bold text-white leading-tight">{goalLabel(plan.goal)}</h2>
        {plan.goal_detail ? (
          <p className="text-sm text-[#8E8E93] leading-relaxed mt-1">{plan.goal_detail}</p>
        ) : null}
      </div>

      {dayMap ? (
        <DayMap
          map={dayMap}
          strategyExpanded={strategyOpen}
          onEditStrategy={() => setStrategyOpen((v) => !v)}
          onAddAnchor={(slot) => {
            setEditingAnchor({
              slot,
              label: slotLabel(slot),
              foods: [],
              frequency: "daily",
              days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
            });
            setEditingAnchorIndex(null);
            setAnchorEditorOpen(true);
          }}
          onAddGoTo={(slot) => openNewGoTo(slot)}
          onPressSlot={handlePressBlueprintSlot}
          onStanceChange={async (slot, stance) => {
            if (!plan) return;
            const profiles = [...(plan.slot_profiles || [])];
            const idx = profiles.findIndex((p) => p.slot === slot);
            if (idx >= 0) profiles[idx] = { ...profiles[idx], stance };
            else profiles.push({ slot, stance, notes: null });
            await savePatch({ slot_profiles: profiles });
          }}
          onAddPlace={async (slot, name) => {
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
          }}
        />
      ) : null}

      <div className="rounded-2xl bg-[#161A22] border border-[#2A2D35] p-5">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[15px] font-bold text-white">Daily targets</p>
          <button
            type="button"
            onClick={() => (editingTargets ? saveTargets() : setEditingTargets(true))}
            className="text-sm font-bold text-[#FF6B35]"
          >
            {editingTargets ? "Save" : "Edit"}
          </button>
        </div>

        {editingTargets ? (
          <div className="grid grid-cols-2 gap-2 mt-2">
            {(
              [
                ["Calories", cal, setCal],
                ["Protein", protein, setProtein],
                ["Carbs", carbs, setCarbs],
                ["Fat", fats, setFats],
                ["Fiber", fiber, setFiber],
              ] as const
            ).map(([label, val, set]) => (
              <div key={label}>
                <p className="text-[11px] font-bold text-[#636366] mb-1">{label}</p>
                <input
                  type="number"
                  className={fieldClass}
                  value={val}
                  onChange={(e) => set(e.target.value)}
                />
              </div>
            ))}
          </div>
        ) : (
          <>
            <p className="text-4xl font-bold text-white">
              {plan.targets.calories?.toLocaleString() ?? "—"}
            </p>
            <p className="text-sm font-semibold text-[#636366] mt-1">kcal / day</p>
            {range ? <p className="text-sm text-[#8E8E93] mt-1">{range}</p> : null}
            <div className="flex flex-wrap gap-2 mt-3">
              {MACRO_TILES.map((tile) => {
                const value = macroValues[tile.key];
                return (
                  <div
                    key={tile.key}
                    className="inline-flex items-center gap-1.5 rounded-full bg-[#0B0C10] border border-[#2A2D35] px-3 py-1.5"
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ backgroundColor: tile.color }}
                    />
                    <span className="text-[13px] font-bold text-white">
                      {value ?? "—"}
                      {value != null ? tile.unit : ""}
                    </span>
                    <span className="text-[11px] font-semibold text-[#636366]">{tile.label}</span>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {!strategyOpen ? (
        <button
          type="button"
          onClick={() => setStrategyOpen(true)}
          className="w-full flex items-center gap-3 rounded-xl border border-[#2A2D35] bg-[#161A22] p-4 text-left"
        >
          <div className="flex-1">
            <p className="font-bold text-white">Strategy under the map</p>
            <p className="text-xs text-[#636366] mt-1">
              {(plan.meal_anchors || []).length} anchors · {(plan.flexible_meals || []).length} flexible ·{" "}
              {(plan.go_to_items || []).length} go-tos
            </p>
          </div>
          <MdChevronRight className="text-[#636366] rotate-90" size={22} />
        </button>
      ) : null}

      {strategyOpen ? (
      <>
      <p className="text-[11px] font-extrabold text-[#636366] tracking-wider pt-2">YOUR STRATEGY</p>
      <p className="text-sm text-[#8E8E93] -mt-2">
        Anchors are meals you repeat. Flexible meals are less controlled. Go-tos fill gaps on the day map.
      </p>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-base font-bold text-white">Meal Anchors</p>
          <button type="button" onClick={openNewAnchor} className="text-[13px] font-bold text-[#FF6B35]">
            + Add
          </button>
        </div>

        {(plan.meal_anchors || []).map((anchor, i) => {
          const macros = sumAnchorMacros(anchor.foods || []);
          const hasMacros =
            macros.calories > 0 || macros.protein > 0 || macros.carbs > 0 || macros.fats > 0;
          return (
            <button
              key={anchor.id || `${anchor.label}-${i}`}
              type="button"
              onClick={() => openEditAnchor(anchor, i)}
              className="w-full flex items-start gap-2.5 rounded-[14px] bg-[#1C1C1E] border border-[#2A2D35] p-4 text-left hover:border-[#FF6B35]/40"
            >
              <div className="w-9 h-9 rounded-[10px] bg-[rgba(255,107,53,0.12)] flex items-center justify-center mt-0.5 shrink-0">
                <SlotIcon slot={anchor.slot} size={20} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[15px] font-bold text-white">{anchor.label}</p>
                <p className="text-xs text-[#636366] mt-0.5">{frequencyLabel(anchor.frequency)}</p>
                <p className="text-[13px] text-[#8E8E93] mt-1 leading-snug">
                  {(anchor.foods || []).map((f) => f.name).join(", ") || "No foods listed"}
                </p>
                {hasMacros ? (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {[
                      `${Math.round(macros.calories)} kcal`,
                      `${Math.round(macros.protein)}g protein`,
                      `${Math.round(macros.carbs)}g carbs`,
                      `${Math.round(macros.fats)}g fat`,
                    ].map((t) => (
                      <span
                        key={t}
                        className="px-2.5 py-1 rounded-full border border-[#2A2D35] bg-[#0B0C10] text-xs font-semibold text-[#8E8E93]"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
              <MdChevronRight size={20} className="text-[#636366] mt-1 shrink-0" />
            </button>
          );
        })}

        {!plan.meal_anchors?.length ? (
          <p className="text-[13px] text-[#636366] py-2">
            No regular foods saved yet. Tap + Add anchor to log macros.
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-base font-bold text-white">Flexible Meals</p>
          <button type="button" onClick={openNewFlex} className="text-[13px] font-bold text-[#FF6B35]">
            + Add meal
          </button>
        </div>

        {(plan.flexible_meals || []).map((meal, i) => (
          <button
            key={meal.id || `${meal.name}-${i}`}
            type="button"
            onClick={() => openEditFlex(meal, i)}
            className="w-full flex items-start gap-2.5 rounded-[14px] bg-[#1C1C1E] border border-[#2A2D35] p-4 text-left hover:border-[#FF6B35]/40"
          >
            <div className="w-9 h-9 rounded-[10px] bg-[rgba(255,107,53,0.12)] flex items-center justify-center mt-0.5 shrink-0">
              <MdRestaurant size={20} className="text-[#FF6B35]" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[15px] font-bold text-white">{meal.name}</p>
              <p className="text-xs text-[#636366] mt-0.5">{frequencyLabel(meal.frequency)}</p>
              <p className="text-[13px] text-[#8E8E93] mt-1">
                {meal.calorie_min || "?"}–{meal.calorie_max || "?"} kcal
                {meal.protein_min || meal.protein_max
                  ? ` · ${meal.protein_min || "?"}–${meal.protein_max || "?"}g protein`
                  : ""}
              </p>
              <span className="inline-block mt-2 px-2 py-1 rounded-lg bg-[rgba(255,107,53,0.12)] text-[11px] font-semibold text-[#FF6B35]">
                {meal.user_controls_food ? "You mostly control this" : "Flexible / not fully controlled"}
              </span>
              {meal.notes ? (
                <p className="text-xs text-[#636366] mt-1.5 leading-snug">{meal.notes}</p>
              ) : null}
            </div>
            <MdChevronRight size={20} className="text-[#636366] mt-1 shrink-0" />
          </button>
        ))}

      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-base font-bold text-white">Go To</p>
          <button type="button" onClick={openNewGoTo} className="text-[13px] font-bold text-[#FF6B35]">
            + Add item
          </button>
        </div>
        <p className="text-xs text-[#636366] leading-snug">
          Staple foods you reach for often — searchable from your food database and one-tap on Home.
        </p>

        {(plan.go_to_items || []).map((goTo, i) => {
          const hasMacros =
            (Number(goTo.calories) || 0) > 0 ||
            (Number(goTo.protein) || 0) > 0 ||
            (Number(goTo.carbs) || 0) > 0 ||
            (Number(goTo.fats) || 0) > 0;
          return (
            <button
              key={goTo.id || `${goTo.name}-${i}`}
              type="button"
              onClick={() => openEditGoTo(goTo, i)}
              className="w-full flex items-start gap-2.5 rounded-[14px] bg-[#1C1C1E] border border-[#2A2D35] p-4 text-left hover:border-[#FF6B35]/40"
            >
              <div className="w-9 h-9 rounded-[10px] bg-[rgba(255,107,53,0.12)] flex items-center justify-center mt-0.5 shrink-0">
                <SlotIcon slot={goTo.slot || "other"} size={20} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[15px] font-bold text-white">{goTo.name}</p>
                <p className="text-xs text-[#636366] mt-0.5">{slotLabel(goTo.slot)}</p>
                {goTo.amount ? <p className="text-[13px] text-[#8E8E93] mt-1">{goTo.amount}</p> : null}
                {hasMacros ? (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {(Number(goTo.calories) || 0) > 0 ? (
                      <span className="px-2.5 py-1 rounded-full border border-[#2A2D35] bg-[#0B0C10] text-xs font-semibold text-[#8E8E93]">
                        {Math.round(Number(goTo.calories))} kcal
                      </span>
                    ) : null}
                    {(Number(goTo.protein) || 0) > 0 ? (
                      <span className="px-2.5 py-1 rounded-full border border-[#2A2D35] bg-[#0B0C10] text-xs font-semibold text-[#8E8E93]">
                        {Math.round(Number(goTo.protein))}g protein
                      </span>
                    ) : null}
                    {(Number(goTo.carbs) || 0) > 0 ? (
                      <span className="px-2.5 py-1 rounded-full border border-[#2A2D35] bg-[#0B0C10] text-xs font-semibold text-[#8E8E93]">
                        {Math.round(Number(goTo.carbs))}g carbs
                      </span>
                    ) : null}
                    {(Number(goTo.fats) || 0) > 0 ? (
                      <span className="px-2.5 py-1 rounded-full border border-[#2A2D35] bg-[#0B0C10] text-xs font-semibold text-[#8E8E93]">
                        {Math.round(Number(goTo.fats))}g fat
                      </span>
                    ) : null}
                  </div>
                ) : null}
                {goTo.notes ? (
                  <p className="text-xs text-[#636366] mt-1.5 leading-snug">{goTo.notes}</p>
                ) : null}
              </div>
              <MdChevronRight size={20} className="text-[#636366] mt-1 shrink-0" />
            </button>
          );
        })}

        {!plan.go_to_items?.length ? (
          <p className="text-[13px] text-[#636366] py-2">
            No go-to items yet. Add protein shakes, snacks, or other staples you log often.
          </p>
        ) : null}
      </div>

      {plan.food_priorities?.length || preferenceTags.length || plan.preferences ? (
        <>
          <p className="text-[11px] font-extrabold text-[#636366] tracking-wider pt-2">GUIDANCE</p>

          {plan.food_priorities?.length ? (
            <div className="rounded-2xl bg-[#1C1C1E] border border-[#2A2D35] p-5">
              <p className="text-[15px] font-bold text-white mb-1">Food priorities</p>
              {plan.food_priorities.map((priority, i) => (
                <div key={i} className="flex items-start gap-2.5 mt-2.5">
                  <MdCheck size={16} className="text-[#FF6B35] mt-0.5 shrink-0" />
                  <p className="text-sm text-[#8E8E93] leading-relaxed">{priority}</p>
                </div>
              ))}
            </div>
          ) : null}

          {plan.preferences ? (
            <div className="rounded-2xl bg-[#1C1C1E] border border-[#2A2D35] p-5">
              <p className="text-[15px] font-bold text-white">Preferences</p>
              <p className="text-[13px] text-[#636366] mt-1 mb-2">
                {plan.preferences.guidance_style === "strict"
                  ? "Stricter targets"
                  : "Flexible guidance"}
              </p>
              {preferenceTags.length ? (
                <div className="flex flex-wrap gap-2">
                  {preferenceTags.map((tag) => (
                    <span
                      key={tag}
                      className="px-3 py-1.5 rounded-full border border-[#2A2D35] bg-[#0B0C10] text-[13px] font-semibold text-white"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
      </>
      ) : null}

      {onAskCoach ? (
        <button
          type="button"
          onClick={() =>
            onAskCoach(`I want to adjust my nutrition plan (${goalLabel(plan.goal)}). `)
          }
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-[rgba(255,107,53,0.45)] text-[#FF6B35] font-bold"
        >
          <MdChatBubbleOutline size={18} />
          Adjust with Coach
        </button>
      ) : null}

      <div className="flex items-center justify-center gap-4 pt-4">
        {plan.status === "paused" ? (
          <button
            type="button"
            onClick={() =>
              runStatus("Resume Plan", "Use this plan for Today guidance again?", () =>
                resumeNutritionPlan(plan.id)
              )
            }
            className="text-sm font-bold text-[#FF6B35]"
          >
            Resume plan
          </button>
        ) : (
          <button
            type="button"
            onClick={() =>
              runStatus("Pause Plan", "Today will stop using this plan until you resume.", () =>
                pauseNutritionPlan(plan.id)
              )
            }
            className="text-sm font-bold text-[#FF6B35]"
          >
            Pause plan
          </button>
        )}
        <span className="text-[#636366]">|</span>
        <button
          type="button"
          onClick={() =>
            runStatus("End Plan", "This plan will no longer drive Today guidance.", () =>
              endNutritionPlan(plan.id)
            )
          }
          className="text-sm font-bold text-red-400"
        >
          End plan
        </button>
      </div>

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
          editingExtra?.id ? () => void removeBlueprintExtra(editingExtra.id) : undefined
        }
      />
    </div>
  );
}
