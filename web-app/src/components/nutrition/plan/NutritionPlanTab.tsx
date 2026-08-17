import { useCallback, useEffect, useState } from "react";
import {
  MdLunchDining,
  MdCheck,
  MdChatBubbleOutline,
  MdChevronRight,
  MdRestaurant,
} from "react-icons/md";
import CreateNutritionPlanModal from "./CreateNutritionPlanModal";
import EditMealAnchorModal, { SlotIcon, sumAnchorMacros } from "./EditMealAnchorModal";
import {
  FlexibleMeal,
  MealAnchor,
  NutritionPlan,
  endNutritionPlan,
  frequencyLabel,
  getActiveNutritionPlan,
  goalLabel,
  pauseNutritionPlan,
  resumeNutritionPlan,
  updateNutritionPlan,
} from "../../../api/nutritionPlan";

interface Props {
  onAskCoach?: (prompt: string) => void;
}

const MACRO_TILES = [
  { key: "protein", label: "Protein", color: "#FF6B35", unit: "g" },
  { key: "carbs", label: "Carbs", color: "#F5C542", unit: "g" },
  { key: "fats", label: "Fat", color: "#C4B5FD", unit: "g" },
  { key: "fiber", label: "Fiber", color: "#4ADE80", unit: "g" },
];

const fieldClass =
  "w-full px-3 py-2 rounded-lg bg-[#0B0C10] border border-[#2A2D35] text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#FF6B35]/40";

export default function NutritionPlanTab({ onAskCoach }: Props) {
  const [plan, setPlan] = useState<NutritionPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingTargets, setEditingTargets] = useState(false);
  const [cal, setCal] = useState("");
  const [protein, setProtein] = useState("");
  const [carbs, setCarbs] = useState("");
  const [fats, setFats] = useState("");
  const [fiber, setFiber] = useState("");
  const [addingFlex, setAddingFlex] = useState(false);
  const [editingAnchor, setEditingAnchor] = useState<MealAnchor | null>(null);
  const [editingAnchorIndex, setEditingAnchorIndex] = useState<number | null>(null);
  const [anchorEditorOpen, setAnchorEditorOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newFlex, setNewFlex] = useState<FlexibleMeal>({
    name: "Dinner",
    frequency: "most_days",
    calorie_min: 650,
    calorie_max: 900,
    protein_min: 25,
    protein_max: 40,
  });

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
    } catch (err) {
      console.error("Error loading nutrition plan:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const savePatch = async (patch: Partial<NutritionPlan>) => {
    if (!plan) return;
    try {
      const updated = await updateNutritionPlan(plan.id, patch);
      setPlan(updated);
      setError(null);
    } catch {
      setError("Could not save that change.");
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

  const openEditAnchor = (anchor: MealAnchor, index: number) => {
    setEditingAnchor(anchor);
    setEditingAnchorIndex(index);
    setAnchorEditorOpen(true);
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

  const addFlexMeal = async () => {
    if (!plan || !newFlex.name.trim()) return;
    await savePatch({ flexible_meals: [...(plan.flexible_meals || []), newFlex] });
    setAddingFlex(false);
  };

  const removeFlex = (id?: string, index?: number) => {
    if (!plan) return;
    if (!confirm("Remove this flexible meal?")) return;
    savePatch({
      flexible_meals: plan.flexible_meals.filter((m, i) => (id ? m.id !== id : i !== index)),
    });
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

      <div>
        <h2 className="text-[28px] font-bold text-white leading-tight">{goalLabel(plan.goal)}</h2>
        {plan.goal_detail ? (
          <p className="text-sm text-[#8E8E93] leading-relaxed mt-1">{plan.goal_detail}</p>
        ) : null}
      </div>

      <div className="rounded-2xl bg-[#1C1C1E] border border-[#2A2D35] p-5">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[15px] font-bold text-white">Daily target</p>
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
            <p className="text-[32px] font-bold text-white">
              {plan.targets.calories?.toLocaleString() ?? "—"} kcal
            </p>
            {range ? <p className="text-sm text-[#8E8E93] mt-0.5 mb-3">{range}</p> : null}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2">
              {MACRO_TILES.map((tile) => {
                const value = macroValues[tile.key];
                return (
                  <div
                    key={tile.key}
                    className="rounded-xl bg-[#0B0C10] border border-[#2A2D35] p-2.5 space-y-1"
                  >
                    <div
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: tile.color }}
                    />
                    <p className="text-[15px] font-bold text-white">
                      {value ?? "—"}
                      {value != null ? tile.unit : ""}
                    </p>
                    <p className="text-[11px] font-semibold text-[#636366]">{tile.label}</p>
                    <div className="h-0.5 rounded-full bg-[#2A2D35] overflow-hidden mt-1">
                      <div
                        className="h-full w-[70%] rounded-full"
                        style={{ backgroundColor: tile.color }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      <p className="text-[11px] font-extrabold text-[#636366] tracking-wider pt-2">MEAL STRUCTURE</p>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-base font-bold text-white">Meal Anchors</p>
          <button type="button" onClick={openNewAnchor} className="text-[13px] font-bold text-[#FF6B35]">
            + Add anchor
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
          <button
            type="button"
            onClick={() => setAddingFlex((v) => !v)}
            className="text-[13px] font-bold text-[#FF6B35]"
          >
            {addingFlex ? "Cancel" : "+ Add meal"}
          </button>
        </div>

        {(plan.flexible_meals || []).map((meal, i) => (
          <button
            key={meal.id || `${meal.name}-${i}`}
            type="button"
            onClick={() => removeFlex(meal.id, i)}
            className="w-full flex items-start gap-2.5 rounded-[14px] bg-[#1C1C1E] border border-[#2A2D35] p-4 text-left"
            title="Click to remove"
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

        {addingFlex ? (
          <div className="space-y-2">
            <input
              className={fieldClass}
              value={newFlex.name}
              onChange={(e) => setNewFlex((d) => ({ ...d, name: e.target.value }))}
              placeholder="Dinner"
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                type="number"
                className={fieldClass}
                value={newFlex.calorie_min ?? ""}
                onChange={(e) =>
                  setNewFlex((d) => ({ ...d, calorie_min: Number(e.target.value) || null }))
                }
                placeholder="Cal min"
              />
              <input
                type="number"
                className={fieldClass}
                value={newFlex.calorie_max ?? ""}
                onChange={(e) =>
                  setNewFlex((d) => ({ ...d, calorie_max: Number(e.target.value) || null }))
                }
                placeholder="Cal max"
              />
            </div>
            <button
              type="button"
              onClick={addFlexMeal}
              className="w-full py-2.5 rounded-xl bg-[#FF6B35] text-white font-bold"
            >
              Save meal
            </button>
          </div>
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
    </div>
  );
}
