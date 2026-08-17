import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  MdClose,
  MdSearch,
  MdAddCircle,
  MdWbSunny,
  MdRestaurant,
  MdLocalCafe,
  MdCookie,
  MdNightsStay,
  MdLunchDining,
} from "react-icons/md";
import apiClient from "../../../lib/api-client";
import foodDatabase, { FoodDbItem } from "../../../data/foodDatabase";
import {
  FREQUENCY_OPTIONS,
  MealAnchor,
  MealAnchorFood,
  MealSlot,
  SLOT_OPTIONS,
} from "../../../api/nutritionPlan";

interface Props {
  visible: boolean;
  anchor: MealAnchor | null;
  onClose: () => void;
  onSave: (anchor: MealAnchor) => void;
  onDelete?: () => void;
}

const fieldClass =
  "w-full px-3 py-2.5 rounded-lg bg-[#0B0C10] border border-[#2A2D35] text-white text-sm placeholder:text-[#636366] focus:outline-none focus:ring-1 focus:ring-[#FF6B35]/40";

function toFoodDbItem(raw: any): FoodDbItem {
  return {
    id: raw.id,
    name: String(raw.name || "").trim(),
    serving: String(raw.serving || "1 serving").trim(),
    grams: Number(raw.grams) > 0 ? Number(raw.grams) : 100,
    calories: Number(raw.calories) || 0,
    protein: Number(raw.protein) || 0,
    carbs: Number(raw.carbs) || 0,
    fats: Number(raw.fats) || 0,
    fiber: Number(raw.fiber) || 0,
    aliases: Array.isArray(raw.aliases) ? raw.aliases : [],
  };
}

function foodMatchesQuery(food: FoodDbItem, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  const blob = [food.name, food.serving, ...(food.aliases || [])].join(" ").toLowerCase();
  if (blob.includes(q)) return true;
  const tokens = q.split(/\s+/).filter((t) => t.length > 2 && !/^\d+$/.test(t));
  return tokens.length > 0 && tokens.every((t) => blob.includes(t));
}

function emptyFood(): MealAnchorFood {
  return { name: "", amount: "", calories: null, protein: null, carbs: null, fats: null, fiber: null };
}

export function sumAnchorMacros(foods: MealAnchorFood[] = []) {
  return foods.reduce(
    (acc, food) => ({
      calories: acc.calories + (Number(food.calories) || 0),
      protein: acc.protein + (Number(food.protein) || 0),
      carbs: acc.carbs + (Number(food.carbs) || 0),
      fats: acc.fats + (Number(food.fats) || 0),
      fiber: acc.fiber + (Number(food.fiber) || 0),
    }),
    { calories: 0, protein: 0, carbs: 0, fats: 0, fiber: 0 }
  );
}

export function SlotIcon({ slot, size = 20, className }: { slot?: string; size?: number; className?: string }) {
  const props = { size, className: className || "text-[#FF6B35]" };
  switch (slot) {
    case "breakfast":
      return <MdWbSunny {...props} />;
    case "lunch":
      return <MdWbSunny {...props} />;
    case "shake":
      return <MdLocalCafe {...props} />;
    case "snack":
      return <MdCookie {...props} />;
    case "dinner":
      return <MdRestaurant {...props} />;
    case "late_night":
      return <MdNightsStay {...props} />;
    default:
      return <MdLunchDining {...props} />;
  }
}

export default function EditMealAnchorModal({
  visible,
  anchor,
  onClose,
  onSave,
  onDelete,
}: Props) {
  const [label, setLabel] = useState("");
  const [slot, setSlot] = useState<MealSlot | string>("breakfast");
  const [frequency, setFrequency] = useState("daily");
  const [notes, setNotes] = useState("");
  const [foods, setFoods] = useState<MealAnchorFood[]>([]);
  const [query, setQuery] = useState("");
  const [savedFoods, setSavedFoods] = useState<FoodDbItem[]>([]);
  const [custom, setCustom] = useState(emptyFood());
  const [showCustom, setShowCustom] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setLabel(anchor?.label || "");
    setSlot(anchor?.slot || "breakfast");
    setFrequency(anchor?.frequency || "daily");
    setNotes(anchor?.notes || "");
    setFoods(anchor?.foods?.length ? anchor.foods.map((f) => ({ ...f })) : []);
    setQuery("");
    setCustom(emptyFood());
    setShowCustom(false);
  }, [visible, anchor]);

  useEffect(() => {
    if (!visible) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "unset";
    };
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    apiClient
      .get("/api/macros/foods")
      .then((res) => {
        if (cancelled) return;
        const items = Array.isArray(res.data) ? res.data.map(toFoodDbItem) : [];
        setSavedFoods(items.filter((f) => f.name));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [visible]);

  const catalog = useMemo(() => {
    const byName = new Map<string, FoodDbItem>();
    for (const food of foodDatabase) byName.set(food.name.toLowerCase(), food);
    for (const food of savedFoods) byName.set(food.name.toLowerCase(), food);
    return Array.from(byName.values());
  }, [savedFoods]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return catalog.filter((f) => foodMatchesQuery(f, q)).slice(0, 8);
  }, [query, catalog]);

  const totals = sumAnchorMacros(foods);

  const addFromDb = (item: FoodDbItem) => {
    setFoods((prev) => [
      ...prev,
      {
        name: item.name,
        amount: item.serving,
        calories: Math.round(item.calories),
        protein: Math.round(item.protein * 10) / 10,
        carbs: Math.round(item.carbs * 10) / 10,
        fats: Math.round(item.fats * 10) / 10,
        fiber: item.fiber != null ? Math.round(item.fiber * 10) / 10 : null,
      },
    ]);
    setQuery("");
    if (!label.trim()) setLabel(item.name);
  };

  const addCustom = () => {
    if (!custom.name.trim()) return;
    setFoods((prev) => [
      ...prev,
      {
        name: custom.name.trim(),
        amount: custom.amount || null,
        calories: Number(custom.calories) || null,
        protein: Number(custom.protein) || null,
        carbs: Number(custom.carbs) || null,
        fats: Number(custom.fats) || null,
        fiber: Number(custom.fiber) || null,
      },
    ]);
    setCustom(emptyFood());
    setShowCustom(false);
  };

  const updateFood = (index: number, patch: Partial<MealAnchorFood>) => {
    setFoods((prev) => prev.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  };

  const removeFood = (index: number) => {
    setFoods((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSave = () => {
    const nextLabel = label.trim() || foods[0]?.name || "Regular meal";
    if (!foods.length && !label.trim()) return;
    setSaving(true);
    onSave({
      id: anchor?.id,
      slot,
      label: nextLabel,
      frequency,
      notes: notes.trim() || null,
      foods: foods.length ? foods : [{ name: nextLabel }],
    });
    setSaving(false);
  };

  if (!visible) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/65 p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-[#161A22] border border-[#2A2D35] w-full sm:max-w-2xl sm:rounded-2xl rounded-t-2xl max-h-[92vh] flex flex-col shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-2">
          <h2 className="text-lg font-bold text-white">
            {anchor?.id ? "Edit meal anchor" : "Add meal anchor"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-[#0B0C10] flex items-center justify-center text-[#8E8E93] hover:text-white"
          >
            <MdClose size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          <p className="text-xs font-bold uppercase text-[#636366]">Label</p>
          <input
            className={fieldClass}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Breakfast"
          />

          <p className="text-xs font-bold uppercase text-[#636366] pt-1">Meal type</p>
          <div className="flex flex-wrap gap-2">
            {SLOT_OPTIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSlot(s.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-semibold ${
                  slot === s.id
                    ? "border-[#FF6B35] text-[#FF6B35]"
                    : "border-[#2A2D35] text-[#8E8E93] bg-[#0B0C10]"
                }`}
              >
                <SlotIcon
                  slot={s.id}
                  size={14}
                  className={slot === s.id ? "text-[#FF6B35]" : "text-[#636366]"}
                />
                {s.label}
              </button>
            ))}
          </div>

          <p className="text-xs font-bold uppercase text-[#636366] pt-1">How often</p>
          <div className="flex flex-wrap gap-2">
            {FREQUENCY_OPTIONS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFrequency(f.id)}
                className={`px-3 py-1.5 rounded-full border text-xs font-semibold ${
                  frequency === f.id
                    ? "border-[#FF6B35] text-[#FF6B35]"
                    : "border-[#2A2D35] text-[#8E8E93] bg-[#0B0C10]"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          <p className="text-xs font-bold uppercase text-[#636366] pt-1">Foods & macros</p>
          <p className="text-xs text-[#636366]">
            Search your food database or saved foods, then tweak amounts.
          </p>

          {foods.map((food, i) => (
            <div
              key={`${food.name}-${i}`}
              className="rounded-xl border border-[#2A2D35] bg-[#0B0C10] p-3 space-y-2"
            >
              <div className="flex items-center justify-between">
                <p className="text-sm font-bold text-white flex-1">{food.name}</p>
                <button type="button" onClick={() => removeFood(i)} className="text-[#636366]">
                  <MdClose size={18} />
                </button>
              </div>
              <input
                className={fieldClass}
                value={food.amount || ""}
                onChange={(e) => updateFood(i, { amount: e.target.value })}
                placeholder="Amount (e.g. 200g)"
              />
              <div className="grid grid-cols-4 gap-1.5">
                {(
                  [
                    ["calories", "kcal"],
                    ["protein", "P"],
                    ["carbs", "C"],
                    ["fats", "F"],
                  ] as const
                ).map(([key, short]) => (
                  <div key={key}>
                    <p className="text-[10px] font-bold text-[#636366] mb-0.5">{short}</p>
                    <input
                      type="number"
                      className="w-full px-2 py-1.5 rounded-lg bg-[#161A22] border border-[#2A2D35] text-white text-sm text-center focus:outline-none focus:ring-1 focus:ring-[#FF6B35]/40"
                      value={food[key] != null ? String(food[key]) : ""}
                      onChange={(e) =>
                        updateFood(i, {
                          [key]: e.target.value === "" ? null : Number(e.target.value) || 0,
                        })
                      }
                      placeholder="0"
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}

          <div className="flex items-center gap-2 border border-[#2A2D35] rounded-lg bg-[#0B0C10] px-3">
            <MdSearch size={18} className="text-[#636366]" />
            <input
              className="flex-1 py-3 bg-transparent text-white text-sm placeholder:text-[#636366] focus:outline-none"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search foods..."
            />
          </div>
          {results.map((item) => (
            <button
              key={item.name}
              type="button"
              onClick={() => addFromDb(item)}
              className="w-full flex items-center gap-2 py-2.5 border-b border-[#2A2D35] text-left"
            >
              <div className="flex-1">
                <p className="text-sm font-semibold text-white">{item.name}</p>
                <p className="text-xs text-[#636366] mt-0.5">
                  {item.serving} · {Math.round(item.calories)} kcal · {Math.round(item.protein)}g P
                </p>
              </div>
              <MdAddCircle size={22} className="text-[#FF6B35]" />
            </button>
          ))}

          <button
            type="button"
            onClick={() => setShowCustom((v) => !v)}
            className="text-sm font-bold text-[#FF6B35] py-2"
          >
            {showCustom ? "Hide custom food" : "+ Add custom food with macros"}
          </button>

          {showCustom ? (
            <div className="space-y-2 mb-2">
              <input
                className={fieldClass}
                value={custom.name || ""}
                onChange={(e) => setCustom((c) => ({ ...c, name: e.target.value }))}
                placeholder="Food name"
              />
              <input
                className={fieldClass}
                value={custom.amount || ""}
                onChange={(e) => setCustom((c) => ({ ...c, amount: e.target.value }))}
                placeholder="Amount"
              />
              <div className="grid grid-cols-4 gap-1.5">
                {(
                  [
                    ["calories", "kcal"],
                    ["protein", "P"],
                    ["carbs", "C"],
                    ["fats", "F"],
                  ] as const
                ).map(([key, short]) => (
                  <div key={key}>
                    <p className="text-[10px] font-bold text-[#636366] mb-0.5">{short}</p>
                    <input
                      type="number"
                      className="w-full px-2 py-1.5 rounded-lg bg-[#0B0C10] border border-[#2A2D35] text-white text-sm text-center focus:outline-none"
                      value={custom[key] != null ? String(custom[key]) : ""}
                      onChange={(e) =>
                        setCustom((c) => ({
                          ...c,
                          [key]: e.target.value === "" ? null : Number(e.target.value) || 0,
                        }))
                      }
                      placeholder="0"
                    />
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={addCustom}
                className="w-full py-2.5 rounded-xl bg-[#FF6B35] text-white font-bold"
              >
                Add food
              </button>
            </div>
          ) : null}

          {totals.calories > 0 || totals.protein > 0 ? (
            <div className="space-y-2 pt-2">
              <p className="text-sm font-bold text-white">Meal total</p>
              <div className="flex flex-wrap gap-1.5">
                {[
                  `${Math.round(totals.calories)} kcal`,
                  `${Math.round(totals.protein)}g protein`,
                  `${Math.round(totals.carbs)}g carbs`,
                  `${Math.round(totals.fats)}g fat`,
                ].map((t) => (
                  <span
                    key={t}
                    className="px-2.5 py-1 rounded-full border border-[#2A2D35] bg-[#0B0C10] text-xs font-semibold text-[#8E8E93]"
                  >
                    {t}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          <p className="text-xs font-bold uppercase text-[#636366] pt-1">Notes (optional)</p>
          <textarea
            className={`${fieldClass} min-h-[64px]`}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. Usually after training"
          />
        </div>

        <div className="flex gap-2.5 p-5 border-t border-[#2A2D35]">
          {onDelete ? (
            <button
              type="button"
              onClick={onDelete}
              className="flex-1 py-3 rounded-xl border border-red-500/40 text-red-400 font-bold"
            >
              Remove
            </button>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 rounded-xl border border-[#2A2D35] text-[#8E8E93] font-bold"
            >
              Cancel
            </button>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={(!foods.length && !label.trim()) || saving}
            className="flex-1 py-3 rounded-xl bg-[#FF6B35] text-white font-bold disabled:opacity-40"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
