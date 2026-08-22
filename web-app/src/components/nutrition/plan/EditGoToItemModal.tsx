import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { MdClose, MdSearch, MdAddCircle } from "react-icons/md";
import apiClient from "../../../lib/api-client";
import foodDatabase, { FoodDbItem } from "../../../data/foodDatabase";
import { GO_TO_SLOT_OPTIONS, GoToItem } from "../../../api/nutritionPlan";
import { SlotIcon } from "./EditMealAnchorModal";

interface Props {
  visible: boolean;
  item: GoToItem | null;
  onClose: () => void;
  onSave: (item: GoToItem) => void | Promise<void>;
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

function emptyItem(): GoToItem {
  return { slot: "other", name: "", amount: "", calories: null, protein: null, carbs: null, fats: null, fiber: null };
}

export default function EditGoToItemModal({ visible, item, onClose, onSave, onDelete }: Props) {
  const [draft, setDraft] = useState<GoToItem>(emptyItem());
  const [query, setQuery] = useState("");
  const [savedFoods, setSavedFoods] = useState<FoodDbItem[]>([]);
  const [showCustom, setShowCustom] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setDraft(item ? { slot: "other", ...item } : emptyItem());
    setQuery("");
    setShowCustom(false);
  }, [visible, item]);

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

  const pickFromDb = (food: FoodDbItem) => {
    setDraft({
      id: item?.id,
      slot: draft.slot || "other",
      name: food.name,
      amount: food.serving,
      calories: Math.round(food.calories),
      protein: Math.round(food.protein * 10) / 10,
      carbs: Math.round(food.carbs * 10) / 10,
      fats: Math.round(food.fats * 10) / 10,
      fiber: food.fiber != null ? Math.round(food.fiber * 10) / 10 : null,
      notes: draft.notes,
    });
    setQuery("");
    setShowCustom(true);
  };

  const update = (patch: Partial<GoToItem>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
  };

  const handleSave = async () => {
    if (!draft.name.trim() || saving) return;
    setSaving(true);
    try {
      await onSave({
        id: item?.id,
        slot: draft.slot || "other",
        name: draft.name.trim(),
        amount: draft.amount?.trim() || null,
        calories: draft.calories != null ? Number(draft.calories) : null,
        protein: draft.protein != null ? Number(draft.protein) : null,
        carbs: draft.carbs != null ? Number(draft.carbs) : null,
        fats: draft.fats != null ? Number(draft.fats) : null,
        fiber: draft.fiber != null ? Number(draft.fiber) : null,
        notes: draft.notes?.trim() || null,
      });
    } finally {
      setSaving(false);
    }
  };

  if (!visible) return null;

  const hasMacros =
    (Number(draft.calories) || 0) > 0 ||
    (Number(draft.protein) || 0) > 0 ||
    (Number(draft.carbs) || 0) > 0 ||
    (Number(draft.fats) || 0) > 0;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/65 p-0 sm:p-4">
      <div className="w-full sm:max-w-lg max-h-[92vh] flex flex-col rounded-t-2xl sm:rounded-2xl bg-[#161A22] border border-[#2A2D35] shadow-xl">
        <div className="flex items-center justify-between px-5 pt-5 pb-2">
          <h3 className="text-lg font-bold text-white">
            {item?.id ? "Edit go-to item" : "Add go-to item"}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-[#0B0C10] flex items-center justify-center text-[#8E8E93]"
          >
            <MdClose size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-6 space-y-2">
          <p className="text-xs font-bold text-[#636366] mt-2">Search your food database</p>
          <p className="text-xs text-[#636366] mb-2">
            Pick from saved foods or the built-in catalog, then tweak the serving.
          </p>

          <div className="flex items-center gap-2 px-3 rounded-lg border border-[#2A2D35] bg-[#0B0C10]">
            <MdSearch size={18} className="text-[#636366] shrink-0" />
            <input
              className="flex-1 py-3 bg-transparent text-white text-sm focus:outline-none"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search foods..."
            />
          </div>

          {results.map((food) => (
            <button
              key={food.name}
              type="button"
              onClick={() => pickFromDb(food)}
              className="w-full flex items-center gap-2 py-2.5 border-b border-[#2A2D35] text-left hover:bg-[#0B0C10]/50"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-white">{food.name}</p>
                <p className="text-xs text-[#636366] mt-0.5">
                  {food.serving} · {Math.round(food.calories)} kcal · {Math.round(food.protein)}g P
                </p>
              </div>
              <MdAddCircle size={22} className="text-[#FF6B35] shrink-0" />
            </button>
          ))}

          <p className="text-xs font-bold text-[#636366] mt-3">When do you reach for this?</p>
          <div className="flex flex-wrap gap-2">
            {GO_TO_SLOT_OPTIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => update({ slot: s.id })}
                className={`flex items-center gap-1 px-2.5 py-1.5 rounded-full border text-xs font-semibold ${
                  (draft.slot || "other") === s.id
                    ? "border-[#FF6B35] text-[#FF6B35]"
                    : "border-[#2A2D35] text-[#8E8E93]"
                }`}
              >
                <SlotIcon slot={s.id} size={14} />
                {s.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setShowCustom((v) => !v)}
            className="text-[13px] font-bold text-[#FF6B35] py-2"
          >
            {showCustom || draft.name ? "Edit item details" : "+ Enter food manually"}
          </button>

          {showCustom || draft.name ? (
            <div className="space-y-2">
              <input
                className={fieldClass}
                value={draft.name}
                onChange={(e) => update({ name: e.target.value })}
                placeholder="Food name"
              />
              <input
                className={fieldClass}
                value={draft.amount || ""}
                onChange={(e) => update({ amount: e.target.value })}
                placeholder="Amount (e.g. 1 scoop, 200g)"
              />
              <div className="grid grid-cols-4 gap-2">
                {(
                  [
                    ["calories", "kcal"],
                    ["protein", "P"],
                    ["carbs", "C"],
                    ["fats", "F"],
                  ] as const
                ).map(([key, short]) => (
                  <div key={key}>
                    <label className="text-[10px] font-bold text-[#636366]">{short}</label>
                    <input
                      type="number"
                      className={`${fieldClass} text-center py-2`}
                      value={draft[key] != null ? String(draft[key]) : ""}
                      onChange={(e) =>
                        update({ [key]: e.target.value === "" ? null : Number(e.target.value) || 0 })
                      }
                      placeholder="0"
                    />
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {hasMacros ? (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {[
                `${Math.round(Number(draft.calories) || 0)} kcal`,
                `${Math.round(Number(draft.protein) || 0)}g protein`,
                `${Math.round(Number(draft.carbs) || 0)}g carbs`,
                `${Math.round(Number(draft.fats) || 0)}g fat`,
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

          <p className="text-xs font-bold text-[#636366] mt-3">Notes (optional)</p>
          <textarea
            className={`${fieldClass} min-h-[64px] resize-none`}
            value={draft.notes || ""}
            onChange={(e) => update({ notes: e.target.value })}
            placeholder="e.g. Post-workout, keep in fridge"
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
            disabled={!draft.name.trim() || saving}
            className="flex-1 py-3 rounded-xl bg-[#FF6B35] text-white font-bold disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}