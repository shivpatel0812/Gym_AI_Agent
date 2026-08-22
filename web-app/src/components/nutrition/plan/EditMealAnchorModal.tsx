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
  MdFitnessCenter,
} from "react-icons/md";
import apiClient from "../../../lib/api-client";
import foodDatabase, { FoodDbItem } from "../../../data/foodDatabase";
import {
  FREQUENCY_OPTIONS,
  MealAnchor,
  MealAnchorFood,
  MealSlot,
  PRIMARY_SLOT_OPTIONS,
  SLOT_OPTIONS,
  WEEKDAY_OPTIONS,
  WeekdayKey,
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
    case "pre_workout":
      return <MdFitnessCenter {...props} />;
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
  const [days, setDays] = useState<WeekdayKey[]>([]);
  const [notes, setNotes] = useState("");
  const [varies, setVaries] = useState(false);
  const [place, setPlace] = useState("");
  const [foods, setFoods] = useState<MealAnchorFood[]>([]);
  const [query, setQuery] = useState("");
  const [savedFoods, setSavedFoods] = useState<FoodDbItem[]>([]);
  const [recentLogs, setRecentLogs] = useState<FoodDbItem[]>([]);
  const [attachOpen, setAttachOpen] = useState(false);
  const [custom, setCustom] = useState(emptyFood());
  const [showCustom, setShowCustom] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setLabel(anchor?.label || "");
    setSlot(anchor?.slot || "breakfast");
    setFrequency(anchor?.frequency || "daily");
    setDays(
      (anchor?.days || [])
        .map((d) => String(d).slice(0, 3).toLowerCase() as WeekdayKey)
        .filter((d) => WEEKDAY_OPTIONS.some((w) => w.id === d))
    );
    setNotes(anchor?.notes || "");
    setVaries(Boolean(anchor?.varies));
    setPlace(anchor?.place || "");
    setFoods(anchor?.foods?.length ? anchor.foods.map((f) => ({ ...f })) : []);
    setQuery("");
    setCustom(emptyFood());
    setShowCustom(false);
    setAttachOpen(Boolean(anchor?.varies));
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
    apiClient
      .get("/api/macros")
      .then((res) => {
        if (cancelled) return;
        const rows = Array.isArray(res.data) ? res.data : [];
        const seen = new Set();
        const out = [];
        for (const row of rows.slice(0, 80)) {
          const name = String((row && row.name) || "").trim();
          if (!name) continue;
          const key = name.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          out.push(
            toFoodDbItem({
              id: row.id,
              name,
              serving: row.serving || row.amount || "1 serving",
              calories: row.calories,
              protein: row.protein,
              carbs: row.carbs,
              fats: row.fats,
              fiber: row.fiber,
            })
          );
          if (out.length >= 24) break;
        }
        setRecentLogs(out);
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

  const previousMeals = useMemo(() => {
    const byName = new Map<string, FoodDbItem>();
    for (const food of recentLogs) byName.set(food.name.toLowerCase(), food);
    for (const food of savedFoods) byName.set(food.name.toLowerCase(), food);
    return Array.from(byName.values()).slice(0, 30);
  }, [recentLogs, savedFoods]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return catalog.filter((f) => foodMatchesQuery(f, q)).slice(0, 8);
  }, [query, catalog]);

  const attachResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = previousMeals.length ? previousMeals : catalog;
    if (!q) return pool.slice(0, 12);
    return pool.filter((f) => foodMatchesQuery(f, q)).slice(0, 12);
  }, [query, previousMeals, catalog]);

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
    if (!label.trim() && !varies) setLabel(item.name);
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
    const nextLabel =
      label.trim() ||
      (varies ? place.trim() || "Varies each time" : "") ||
      foods[0]?.name ||
      "Regular meal";
    if (!varies && !foods.length && !label.trim()) return;
    if (varies && !label.trim() && !place.trim() && !foods.length) return;
    setSaving(true);
    onSave({
      id: anchor?.id,
      slot,
      label: nextLabel,
      frequency: days.length === 7 ? "daily" : days.length ? "most_days" : frequency,
      days,
      notes: notes.trim() || null,
      varies,
      place: place.trim() || null,
      foods: foods.length ? foods : varies ? [] : [{ name: nextLabel }],
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

          <p className="text-xs font-bold uppercase text-[#636366] pt-1">Meal</p>
          <div className="flex flex-wrap gap-2">
            {(PRIMARY_SLOT_OPTIONS.length ? PRIMARY_SLOT_OPTIONS : SLOT_OPTIONS).map((s) => (
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

          <p className="text-xs font-bold uppercase text-[#636366] pt-1">Meal style</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setVaries(false)}
              className={`px-3 py-1.5 rounded-full border text-xs font-semibold ${
                !varies ? "border-[#FF6B35] text-[#FF6B35]" : "border-[#2A2D35] text-[#8E8E93] bg-[#0B0C10]"
              }`}
            >
              Fixed foods
            </button>
            <button
              type="button"
              onClick={() => {
                setVaries(true);
                setAttachOpen(true);
              }}
              className={`px-3 py-1.5 rounded-full border text-xs font-semibold ${
                varies ? "border-[#FF6B35] text-[#FF6B35]" : "border-[#2A2D35] text-[#8E8E93] bg-[#0B0C10]"
              }`}
            >
              Varies / random
            </button>
          </div>
          {varies ? (
            <div className="rounded-xl border border-[rgba(94,234,212,0.25)] bg-[rgba(94,234,212,0.06)] p-3 space-y-2">
              <p className="text-xs text-[#636366]">
                e.g. lunch at Fannie Mae — you go often but pick something different each day.
              </p>
              <p className="text-xs font-bold uppercase text-[#636366]">Place / spot</p>
              <input
                className={fieldClass}
                value={place}
                onChange={(e) => setPlace(e.target.value)}
                placeholder="e.g. Fannie Mae, Chipotle"
              />
            </div>
          ) : null}

          <p className="text-xs font-bold uppercase text-[#636366] pt-1">Days you're certain</p>
          <p className="text-xs text-[#636366]">
            Turn on days you know this meal. Leave other days off if those are uncertain — keep the meal
            slot on Uncertain and add places there.
          </p>
          <div className="flex flex-wrap gap-2">
            {WEEKDAY_OPTIONS.map((d) => {
              const on = days.includes(d.id);
              return (
                <button
                  key={d.id}
                  type="button"
                  onClick={() =>
                    setDays((prev) =>
                      prev.includes(d.id) ? prev.filter((x) => x !== d.id) : [...prev, d.id]
                    )
                  }
                  className={`px-3 py-1.5 rounded-full border text-xs font-semibold ${
                    on
                      ? "border-[#FF6B35] text-[#FF6B35]"
                      : "border-[#2A2D35] text-[#8E8E93] bg-[#0B0C10]"
                  }`}
                >
                  {d.label}
                </button>
              );
            })}
          </div>
          {days.length > 0 && days.length < 7 ? (
            <p className="text-xs text-[#636366]">
              Open / uncertain:{" "}
              {WEEKDAY_OPTIONS.filter((d) => !days.includes(d.id))
                .map((d) => d.label)
                .join(", ")}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setDays(WEEKDAY_OPTIONS.map((d) => d.id))}
              className="px-3 py-1.5 rounded-full border border-[#2A2D35] text-[#8E8E93] text-xs font-semibold bg-[#0B0C10]"
            >
              Every day
            </button>
            <button
              type="button"
              onClick={() => setDays(["mon", "tue", "wed", "thu", "fri"])}
              className="px-3 py-1.5 rounded-full border border-[#2A2D35] text-[#8E8E93] text-xs font-semibold bg-[#0B0C10]"
            >
              Weekdays
            </button>
            <button
              type="button"
              onClick={() => setDays([])}
              className="px-3 py-1.5 rounded-full border border-[#2A2D35] text-[#8E8E93] text-xs font-semibold bg-[#0B0C10]"
            >
              Clear
            </button>
          </div>

          <p className="text-xs font-bold uppercase text-[#636366] pt-1">How often (if no days picked)</p>
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

          <p className="text-xs font-bold uppercase text-[#636366] pt-1">
            {varies ? "Example meals (options)" : "Foods & macros"}
          </p>
          <p className="text-xs text-[#636366]">
            {varies
              ? "Attach previous meals from your log/saved foods — pick one when you eat."
              : "Search your food database or saved foods, then tweak amounts."}
          </p>
          {varies ? (
            <button
              type="button"
              onClick={() => setAttachOpen((v) => !v)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-[#5EEAD4]/35 text-[#5EEAD4] text-xs font-bold"
            >
              {attachOpen ? "Hide previous meals" : "Attach previous meals"}
            </button>
          ) : null}

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
          {(varies && attachOpen ? attachResults : results).map((item) => (
            <button
              key={item.id || item.name}
              type="button"
              onClick={() => addFromDb(item)}
              className="w-full text-left rounded-xl border border-[#2A2D35] bg-[#0B0C10] px-3 py-2.5 flex items-center justify-between gap-2"
            >
              <div className="min-w-0">
                <p className="text-sm font-bold text-white truncate">{item.name}</p>
                <p className="text-xs text-[#636366]">
                  {item.serving} · {Math.round(item.calories)} kcal · {Math.round(item.protein)}g P
                </p>
              </div>
              <MdAddCircle size={22} className="text-[#FF6B35] shrink-0" />
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
