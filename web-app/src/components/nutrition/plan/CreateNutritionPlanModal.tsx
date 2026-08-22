import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MdClose } from "react-icons/md";
import {
  FlexibleMeal,
  FREQUENCY_OPTIONS,
  GOAL_OPTIONS,
  MealAnchor,
  NutritionGoal,
  NutritionPlan,
  SLOT_OPTIONS,
  SuggestedGoal,
  activateNutritionPlan,
  deleteNutritionPlan,
  frequencyLabel,
  getSuggestedGoal,
  goalLabel,
  proposeNutritionPlan,
} from "../../../api/nutritionPlan";
import {
  AI_MODEL_OPTIONS,
  AiModelId,
  loadStoredAiModel,
  normalizeAiModel,
  persistAiModel,
} from "../../../lib/aiModels";

interface Props {
  visible: boolean;
  onClose: () => void;
  onCreated: () => void;
  conversationId?: string | null;
  model?: string | null;
}

type Step = "goal" | "habits" | "flexible" | "prefs" | "generating" | "review";

const emptyAnchor = (): MealAnchor => ({
  slot: "breakfast",
  label: "",
  foods: [],
  frequency: "daily",
});

const emptyFlex = (): FlexibleMeal => ({
  name: "Dinner",
  frequency: "most_days",
  calorie_min: 650,
  calorie_max: 900,
  protein_min: 25,
  protein_max: 40,
  user_controls_food: false,
  notes: "",
});

const fieldClass =
  "w-full px-3 py-2.5 rounded-lg bg-[#161A22] border border-[#2A2D35] text-white text-sm placeholder:text-[#636366] focus:outline-none focus:ring-1 focus:ring-[#FF6B35]/40";

export default function CreateNutritionPlanModal({
  visible,
  onClose,
  onCreated,
  conversationId,
  model: modelProp,
}: Props) {
  const [step, setStep] = useState<Step>("goal");
  const [goal, setGoal] = useState<NutritionGoal>("maintain");
  const [goalNotes, setGoalNotes] = useState("");
  const [typicalDay, setTypicalDay] = useState("");
  const [anchors, setAnchors] = useState<MealAnchor[]>([]);
  const [anchorDraft, setAnchorDraft] = useState(emptyAnchor());
  const [anchorFoodsText, setAnchorFoodsText] = useState("");
  const [flexible, setFlexible] = useState<FlexibleMeal[]>([]);
  const [flexDraft, setFlexDraft] = useState(emptyFlex());
  const [likes, setLikes] = useState("");
  const [dislikes, setDislikes] = useState("");
  const [restrictions, setRestrictions] = useState("");
  const [onHand, setOnHand] = useState("");
  const [mealCount, setMealCount] = useState("3");
  const [largerDinner, setLargerDinner] = useState(true);
  const [style, setStyle] = useState<"flexible" | "strict">("flexible");
  const [draft, setDraft] = useState<NutritionPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<SuggestedGoal | null>(null);
  const [goalTouched, setGoalTouched] = useState(false);
  const [aiModel, setAiModel] = useState<AiModelId>(() => loadStoredAiModel());
  // Ref mirror so the in-flight suggestion fetch can tell whether the user
  // already picked a goal before it resolved.
  const goalTouchedRef = useRef(false);

  const chooseGoal = (id: NutritionGoal) => {
    goalTouchedRef.current = true;
    setGoalTouched(true);
    setGoal(id);
  };

  const selectAiModel = (model: AiModelId) => {
    setAiModel(model);
    persistAiModel(model);
  };

  useEffect(() => {
    if (!visible) return;
    if (modelProp) {
      setAiModel(normalizeAiModel(modelProp));
      return;
    }
    setAiModel(loadStoredAiModel());
  }, [visible, modelProp]);

  useEffect(() => {
    if (!visible) return;
    setStep(conversationId ? "generating" : "goal");
    setDraft(null);
    setError(null);
    setGoal("maintain");
    setGoalNotes("");
    setTypicalDay("");
    setAnchors([]);
    setAnchorDraft(emptyAnchor());
    setAnchorFoodsText("");
    setFlexible([]);
    setFlexDraft(emptyFlex());
    setLikes("");
    setDislikes("");
    setRestrictions("");
    setOnHand("");
    setMealCount("3");
    setLargerDinner(true);
    setStyle("flexible");
    setSuggestion(null);
    setGoalTouched(false);
    goalTouchedRef.current = false;

    let cancelled = false;

    // Lead with the goal implied by the active training plan rather than
    // defaulting everyone to "maintain". A manual pick always wins.
    (async () => {
      const suggested = await getSuggestedGoal();
      if (cancelled || !suggested) return;
      setSuggestion(suggested);
      if (!goalTouchedRef.current) setGoal(suggested.goal);
    })();

    if (!conversationId) {
      return () => {
        cancelled = true;
      };
    }

    (async () => {
      const model = modelProp
        ? normalizeAiModel(modelProp)
        : loadStoredAiModel();
      try {
        const plan = await proposeNutritionPlan({
          conversation_id: conversationId,
          model,
        });
        if (cancelled) return;
        setDraft(plan);
        setStep("review");
      } catch (err: any) {
        if (cancelled) return;
        setStep("goal");
        setError(err?.response?.data?.detail || "Something went wrong. Please try again.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, conversationId, modelProp]);

  useEffect(() => {
    if (!visible) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "unset";
    };
  }, [visible]);

  const addAnchor = () => {
    const foods = anchorFoodsText
      .split(",")
      .map((n) => n.trim())
      .filter(Boolean)
      .map((name) => ({ name }));
    const label = anchorDraft.label.trim() || foods[0]?.name || slotLabel(anchorDraft.slot);
    if (!foods.length && !anchorDraft.label.trim()) {
      setError("Name the meal or list foods you eat often, like Greek yogurt, oatmeal.");
      return;
    }
    setError(null);
    setAnchors((prev) => [
      ...prev,
      { ...anchorDraft, label, foods: foods.length ? foods : [{ name: label }] },
    ]);
    setAnchorDraft(emptyAnchor());
    setAnchorFoodsText("");
  };

  const addFlexible = () => {
    if (!flexDraft.name.trim()) {
      setError("Name the meal, e.g. Dinner");
      return;
    }
    setError(null);
    setFlexible((prev) => [...prev, { ...flexDraft, name: flexDraft.name.trim() }]);
    setFlexDraft(emptyFlex());
  };

  const generate = async () => {
    setStep("generating");
    setError(null);
    try {
      const plan = await proposeNutritionPlan({
        goal,
        goal_notes: goalNotes.trim() || undefined,
        typical_day: typicalDay.trim() || undefined,
        meal_anchors: anchors,
        flexible_meals: flexible,
        conversation_id: conversationId || undefined,
        model: aiModel,
        preferences: {
          likes: splitList(likes),
          dislikes: splitList(dislikes),
          dietary_restrictions: restrictions.trim() || undefined,
          foods_on_hand: splitList(onHand),
          preferred_meal_count: Number(mealCount) || undefined,
          larger_dinner: largerDinner,
          guidance_style: style,
        },
      });
      setDraft(plan);
      setStep("review");
    } catch (err: any) {
      setStep("prefs");
      setError(err?.response?.data?.detail || "Something went wrong. Please try again.");
    }
  };

  const confirm = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      await activateNutritionPlan(draft.id);
      onCreated();
    } catch {
      setError("Could not activate the plan.");
    } finally {
      setBusy(false);
    }
  };

  const discard = async () => {
    if (draft) {
      try {
        await deleteNutritionPlan(draft.id);
      } catch {
        // Draft leftover is harmless
      }
    }
    onClose();
  };

  if (!visible) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-[#0B0C10] border border-[#2A2D35] w-full sm:max-w-2xl sm:rounded-2xl rounded-t-2xl max-h-[94vh] min-h-[70vh] flex flex-col shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-[#2A2D35]">
          <h2 className="text-xl font-bold text-white pr-3">
            {step === "review" ? "Review Nutrition Plan" : "Create Nutrition Plan"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-[#1C1C1E] flex items-center justify-center text-[#8E8E93] hover:text-white"
          >
            <MdClose size={20} />
          </button>
        </div>

        {error ? (
          <div className="mx-5 mt-4 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-300">
            {error}
          </div>
        ) : null}

        {step === "generating" ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 p-12">
            <div className="w-10 h-10 border-2 border-[#FF6B35] border-t-transparent rounded-full animate-spin" />
            <p className="text-white font-semibold">Building your nutrition strategy...</p>
            <p className="text-sm text-[#8E8E93] text-center">
              Using how you actually eat, not a generic meal plan
            </p>
          </div>
        ) : step === "review" && draft ? (
          <>
            <div className="flex-1 overflow-y-auto p-5 space-y-3">
              <p className="text-2xl font-bold text-white">{goalLabel(draft.goal)}</p>
              {draft.goal_detail ? (
                <p className="text-sm text-[#8E8E93] leading-relaxed">{draft.goal_detail}</p>
              ) : null}
              <p className="text-sm font-semibold text-[#FF6B35]">
                {draft.targets.calories} kcal · {draft.targets.protein}g protein
                {draft.targets.calories_min && draft.targets.calories_max
                  ? ` · range ${draft.targets.calories_min}–${draft.targets.calories_max}`
                  : ""}
              </p>
              {draft.strategy ? (
                <>
                  <p className="text-[13px] font-bold text-[#636366] uppercase tracking-wide pt-2">
                    Daily strategy
                  </p>
                  <p className="text-sm text-[#8E8E93] leading-relaxed">{draft.strategy}</p>
                </>
              ) : null}
              {draft.meal_anchors?.length ? (
                <>
                  <p className="text-[13px] font-bold text-[#636366] uppercase tracking-wide pt-2">
                    Meal anchors
                  </p>
                  {draft.meal_anchors.map((a) => (
                    <p key={a.id || a.label} className="text-sm text-[#8E8E93]">
                      {a.label} · {frequencyLabel(a.frequency)}
                      {a.foods?.length ? ` — ${a.foods.map((f) => f.name).join(", ")}` : ""}
                    </p>
                  ))}
                </>
              ) : null}
              {draft.flexible_meals?.length ? (
                <>
                  <p className="text-[13px] font-bold text-[#636366] uppercase tracking-wide pt-2">
                    Flexible meals
                  </p>
                  {draft.flexible_meals.map((m) => (
                    <p key={m.id || m.name} className="text-sm text-[#8E8E93]">
                      {m.name} · {frequencyLabel(m.frequency)}
                      {m.calorie_min || m.calorie_max
                        ? ` · ${m.calorie_min || "?"}–${m.calorie_max || "?"} kcal`
                        : ""}
                    </p>
                  ))}
                </>
              ) : null}
              {draft.food_priorities?.length ? (
                <>
                  <p className="text-[13px] font-bold text-[#636366] uppercase tracking-wide pt-2">
                    Food priorities
                  </p>
                  {draft.food_priorities.map((p, i) => (
                    <p key={i} className="text-sm text-[#8E8E93]">
                      {p}
                    </p>
                  ))}
                </>
              ) : null}
            </div>
            <div className="flex gap-3 p-5 border-t border-[#2A2D35]">
              <button
                type="button"
                onClick={discard}
                disabled={busy}
                className="flex-1 py-3 rounded-xl border border-[#2A2D35] text-[#8E8E93] font-semibold hover:text-white"
              >
                Discard
              </button>
              <button
                type="button"
                onClick={confirm}
                disabled={busy}
                className="flex-[1.3] py-3 rounded-xl bg-[#FF6B35] text-white font-bold hover:bg-[#E85A2A] disabled:opacity-50"
              >
                {busy ? "Saving..." : "Use This Plan"}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto p-5 space-y-3">
              {step === "goal" ? (
                <>
                  {suggestion?.from_training ? (
                    <div className="rounded-xl border border-[rgba(94,234,212,0.35)] bg-[rgba(94,234,212,0.07)] p-4 space-y-1">
                      <p className="text-[12px] font-bold text-[#5EEAD4] uppercase tracking-wide">
                        From your training plan
                      </p>
                      <p className="text-[15px] font-semibold text-white">
                        We'd suggest{" "}
                        <span className="text-[#5EEAD4]">{suggestion.label}</span>
                      </p>
                      <p className="text-[13px] text-[#8E8E93]">{suggestion.reason}</p>
                      {goalTouched && goal !== suggestion.goal ? (
                        <button
                          type="button"
                          onClick={() => chooseGoal(suggestion.goal)}
                          className="text-[13px] font-semibold text-[#5EEAD4] underline pt-1"
                        >
                          Use the suggestion
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                  <p className="text-[13px] font-bold text-[#636366] uppercase tracking-wide">
                    {suggestion?.from_training ? "Or pick a different goal" : "What's the goal?"}
                  </p>
                  {GOAL_OPTIONS.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => chooseGoal(option.id)}
                      className={`w-full text-left px-4 py-3 rounded-xl border ${
                        goal === option.id
                          ? "border-[#FF6B35] text-white"
                          : "border-[#2A2D35] text-[#8E8E93]"
                      } bg-[#161A22] font-semibold flex items-center justify-between`}
                    >
                      <span>{option.label}</span>
                      {suggestion?.from_training && suggestion.goal === option.id ? (
                        <span className="text-[11px] font-bold text-[#5EEAD4] uppercase tracking-wide">
                          Suggested
                        </span>
                      ) : null}
                    </button>
                  ))}
                  <p className="text-[13px] font-bold text-[#636366] uppercase tracking-wide pt-2">
                    Anything specific? (optional)
                  </p>
                  <textarea
                    className={`${fieldClass} min-h-[80px]`}
                    value={goalNotes}
                    onChange={(e) => setGoalNotes(e.target.value)}
                    placeholder="e.g. Build muscle while limiting extra fat gain"
                  />
                  <p className="text-[13px] font-bold text-[#636366] uppercase tracking-wide pt-2">
                    AI model
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {AI_MODEL_OPTIONS.map((opt) => {
                      const active = aiModel === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => selectAiModel(opt.id)}
                          className={`px-3 py-2 rounded-xl border text-sm font-bold ${
                            active
                              ? "border-[#FF6B35] bg-[rgba(255,107,53,0.18)] text-[#FF6B35]"
                              : "border-[#2A2D35] bg-[#161A22] text-[#8E8E93]"
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </>
              ) : null}

              {step === "habits" ? (
                <>
                  <p className="text-[13px] font-bold text-[#636366] uppercase tracking-wide">
                    What does a typical day look like?
                  </p>
                  <p className="text-sm text-[#8E8E93]">
                    We'll remember this so you don't have to re-explain breakfast every day.
                  </p>
                  <textarea
                    className={`${fieldClass} min-h-[90px]`}
                    value={typicalDay}
                    onChange={(e) => setTypicalDay(e.target.value)}
                    placeholder="I usually eat Greek yogurt and oatmeal every morning, and a protein shake sometime during the day."
                  />
                  <p className="text-[13px] font-bold text-[#636366] uppercase tracking-wide pt-2">
                    Meal anchors — foods you eat often
                  </p>
                  {anchors.map((a, i) => (
                    <div
                      key={`${a.label}-${i}`}
                      className="flex items-center justify-between gap-2 bg-[#1C1C1E] rounded-xl px-4 py-3"
                    >
                      <p className="text-sm text-white flex-1">
                        {a.label}: {a.foods.map((f) => f.name).join(", ")}
                      </p>
                      <button
                        type="button"
                        onClick={() => setAnchors((prev) => prev.filter((_, idx) => idx !== i))}
                        className="text-[#636366] hover:text-white"
                      >
                        <MdClose size={16} />
                      </button>
                    </div>
                  ))}
                  <div className="flex flex-wrap gap-2">
                    {SLOT_OPTIONS.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() =>
                          setAnchorDraft((d) => ({ ...d, slot: s.id, label: d.label || s.label }))
                        }
                        className={`px-3 py-1.5 rounded-full border text-xs font-semibold ${
                          anchorDraft.slot === s.id
                            ? "border-[#FF6B35] bg-[rgba(255,107,53,0.12)] text-[#FF6B35]"
                            : "border-[#2A2D35] text-[#8E8E93]"
                        }`}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                  <input
                    className={fieldClass}
                    value={anchorFoodsText}
                    onChange={(e) => setAnchorFoodsText(e.target.value)}
                    placeholder="Greek yogurt, oatmeal, berries"
                  />
                  <button
                    type="button"
                    onClick={addAnchor}
                    className="w-full py-3 rounded-xl border border-[#FF6B35] text-[#FF6B35] font-bold"
                  >
                    Add regular food
                  </button>
                </>
              ) : null}

              {step === "flexible" ? (
                <>
                  <p className="text-[13px] font-bold text-[#636366] uppercase tracking-wide">
                    Meals you don't fully control
                  </p>
                  <p className="text-sm text-[#8E8E93]">
                    Family dinner, work lunches, etc. Rough ranges are enough — we'll plan the rest
                    of the day around them.
                  </p>
                  {flexible.map((m, i) => (
                    <div
                      key={`${m.name}-${i}`}
                      className="flex items-center justify-between gap-2 bg-[#1C1C1E] rounded-xl px-4 py-3"
                    >
                      <p className="text-sm text-white flex-1">
                        {m.name} · {m.calorie_min || "?"}–{m.calorie_max || "?"} kcal
                      </p>
                      <button
                        type="button"
                        onClick={() => setFlexible((prev) => prev.filter((_, idx) => idx !== i))}
                        className="text-[#636366] hover:text-white"
                      >
                        <MdClose size={16} />
                      </button>
                    </div>
                  ))}
                  <input
                    className={fieldClass}
                    value={flexDraft.name}
                    onChange={(e) => setFlexDraft((d) => ({ ...d, name: e.target.value }))}
                    placeholder="Dinner"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <p className="text-[11px] font-bold uppercase text-[#636366] mb-1">Cal min</p>
                      <input
                        type="number"
                        className={fieldClass}
                        value={flexDraft.calorie_min ?? ""}
                        onChange={(e) =>
                          setFlexDraft((d) => ({
                            ...d,
                            calorie_min: Number(e.target.value) || null,
                          }))
                        }
                      />
                    </div>
                    <div>
                      <p className="text-[11px] font-bold uppercase text-[#636366] mb-1">Cal max</p>
                      <input
                        type="number"
                        className={fieldClass}
                        value={flexDraft.calorie_max ?? ""}
                        onChange={(e) =>
                          setFlexDraft((d) => ({
                            ...d,
                            calorie_max: Number(e.target.value) || null,
                          }))
                        }
                      />
                    </div>
                    <div>
                      <p className="text-[11px] font-bold uppercase text-[#636366] mb-1">
                        Protein min
                      </p>
                      <input
                        type="number"
                        className={fieldClass}
                        value={flexDraft.protein_min ?? ""}
                        onChange={(e) =>
                          setFlexDraft((d) => ({
                            ...d,
                            protein_min: Number(e.target.value) || null,
                          }))
                        }
                      />
                    </div>
                    <div>
                      <p className="text-[11px] font-bold uppercase text-[#636366] mb-1">
                        Protein max
                      </p>
                      <input
                        type="number"
                        className={fieldClass}
                        value={flexDraft.protein_max ?? ""}
                        onChange={(e) =>
                          setFlexDraft((d) => ({
                            ...d,
                            protein_max: Number(e.target.value) || null,
                          }))
                        }
                      />
                    </div>
                  </div>
                  <input
                    className={fieldClass}
                    value={flexDraft.notes || ""}
                    onChange={(e) => setFlexDraft((d) => ({ ...d, notes: e.target.value }))}
                    placeholder="I eat whatever my family is having"
                  />
                  <div className="flex flex-wrap gap-2">
                    {FREQUENCY_OPTIONS.map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setFlexDraft((d) => ({ ...d, frequency: f.id }))}
                        className={`px-3 py-1.5 rounded-full border text-xs font-semibold ${
                          flexDraft.frequency === f.id
                            ? "border-[#FF6B35] bg-[rgba(255,107,53,0.12)] text-[#FF6B35]"
                            : "border-[#2A2D35] text-[#8E8E93]"
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={addFlexible}
                    className="w-full py-3 rounded-xl border border-[#FF6B35] text-[#FF6B35] font-bold"
                  >
                    Add flexible meal
                  </button>
                  <button
                    type="button"
                    onClick={() => setStep("prefs")}
                    className="w-full text-center text-[#636366] text-sm pt-2"
                  >
                    Skip — I control most meals
                  </button>
                </>
              ) : null}

              {step === "prefs" ? (
                <>
                  <p className="text-[13px] font-bold text-[#636366] uppercase tracking-wide">
                    Preferences that actually matter
                  </p>
                  <input
                    className={fieldClass}
                    value={likes}
                    onChange={(e) => setLikes(e.target.value)}
                    placeholder="Foods you like (comma separated)"
                  />
                  <input
                    className={fieldClass}
                    value={dislikes}
                    onChange={(e) => setDislikes(e.target.value)}
                    placeholder="Foods you dislike"
                  />
                  <input
                    className={fieldClass}
                    value={restrictions}
                    onChange={(e) => setRestrictions(e.target.value)}
                    placeholder="Vegetarian, dairy-free, etc. (optional)"
                  />
                  <input
                    className={fieldClass}
                    value={onHand}
                    onChange={(e) => setOnHand(e.target.value)}
                    placeholder="Foods you usually have around"
                  />
                  <p className="text-[11px] font-bold uppercase text-[#636366]">
                    Meals you prefer per day
                  </p>
                  <input
                    type="number"
                    className={fieldClass}
                    value={mealCount}
                    onChange={(e) => setMealCount(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => setLargerDinner((v) => !v)}
                    className={`w-full text-left px-4 py-3 rounded-xl border font-semibold ${
                      largerDinner
                        ? "border-[#FF6B35] text-white"
                        : "border-[#2A2D35] text-[#8E8E93]"
                    } bg-[#161A22]`}
                  >
                    I prefer a larger dinner
                  </button>
                  <div className="grid grid-cols-2 gap-2">
                    {(["flexible", "strict"] as const).map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setStyle(s)}
                        className={`px-4 py-3 rounded-xl border font-semibold ${
                          style === s
                            ? "border-[#FF6B35] text-white"
                            : "border-[#2A2D35] text-[#8E8E93]"
                        } bg-[#161A22]`}
                      >
                        {s === "flexible" ? "Flexible guidance" : "Stricter targets"}
                      </button>
                    ))}
                  </div>
                </>
              ) : null}
            </div>

            <div className="flex gap-3 p-5 border-t border-[#2A2D35]">
              {step !== "goal" ? (
                <button
                  type="button"
                  onClick={() =>
                    setStep(
                      step === "habits" ? "goal" : step === "flexible" ? "habits" : "flexible"
                    )
                  }
                  className="flex-1 py-3 rounded-xl border border-[#2A2D35] text-[#8E8E93] font-semibold"
                >
                  Back
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 py-3 rounded-xl border border-[#2A2D35] text-[#8E8E93] font-semibold"
                >
                  Cancel
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  if (step === "goal") setStep("habits");
                  else if (step === "habits") setStep("flexible");
                  else if (step === "flexible") setStep("prefs");
                  else generate();
                }}
                className="flex-[1.3] py-3 rounded-xl bg-[#FF6B35] text-white font-bold hover:bg-[#E85A2A]"
              >
                {step === "prefs" ? "Generate Plan" : "Next"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}

function splitList(value: string) {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function slotLabel(slot: string) {
  return SLOT_OPTIONS.find((s) => s.id === slot)?.label || slot;
}
