import { useState, useMemo, useEffect } from "react";
import { FoodItem } from "@/types";
import foodDatabase, { FoodDbItem } from "@/data/foodDatabase";
import { MdClose, MdSearch } from "react-icons/md";

export const MEALS = [
  { id: "Breakfast", label: "Breakfast", icon: "☀️" },
  { id: "Lunch", label: "Lunch", icon: "🥗" },
  { id: "Pre-Workout", label: "Pre-Workout", icon: "⚡" },
  { id: "Dinner", label: "Dinner", icon: "🌙" },
  { id: "Snacks", label: "Snacks", icon: "🫐" },
];

interface LogFoodModalProps {
  isOpen: boolean;
  initialMeal?: string;
  onClose: () => void;
  onAdd: (food: FoodItem) => void;
}

export default function LogFoodModal({
  isOpen,
  initialMeal,
  onClose,
  onAdd,
}: LogFoodModalProps) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<FoodDbItem | null>(null);
  const [amountMode, setAmountMode] = useState<"serving" | "custom">("serving");
  const [customGrams, setCustomGrams] = useState("");
  const [meal, setMeal] = useState(initialMeal || "Breakfast");

  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setSelected(null);
      setAmountMode("serving");
      setCustomGrams("");
      setMeal(initialMeal || "Breakfast");
    }
  }, [isOpen, initialMeal]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return foodDatabase
      .filter((f) => f.name.toLowerCase().includes(q))
      .slice(0, 8);
  }, [query]);

  const scale = useMemo(() => {
    if (!selected) return 1;
    if (amountMode === "custom") {
      const grams = parseFloat(customGrams);
      if (!grams || grams <= 0) return 0;
      return grams / selected.grams;
    }
    return 1;
  }, [selected, amountMode, customGrams]);

  const scaled = useMemo(() => {
    if (!selected) return null;
    return {
      calories: Math.round(selected.calories * scale),
      protein: Math.round(selected.protein * scale),
      carbs: Math.round(selected.carbs * scale),
      fats: Math.round(selected.fats * scale),
    };
  }, [selected, scale]);

  if (!isOpen) return null;

  const handleAdd = () => {
    if (!selected || !scaled || scale === 0) return;
    const amountLabel =
      amountMode === "custom" ? `${customGrams}g` : selected.serving;
    onAdd({
      name: selected.name,
      calories: scaled.calories,
      protein: scaled.protein,
      carbs: scaled.carbs,
      fats: scaled.fats,
      meal,
      amount: amountLabel,
    });
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 backdrop-blur-sm px-4 pt-[10vh] overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl rounded-2xl bg-[#161A22] border border-[#2A2D35] shadow-xl mb-10"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#2A2D35]">
          <h3 className="text-lg font-bold text-white">Log Food</h3>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-[#1C1C1E] border border-[#2A2D35] flex items-center justify-center text-[#8E8E93] hover:text-white transition-colors"
          >
            <MdClose size={16} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {/* Search */}
          <div className="relative">
            <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#636366]">
              <MdSearch size={16} />
            </div>
            <input
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSelected(null);
              }}
              placeholder="Search foods — chicken, oats, banana..."
              autoFocus
              className="w-full h-12 pl-10 pr-9 rounded-xl bg-[#0F1117] border border-[#2A2D35] text-white text-sm placeholder:text-[#636366] focus:outline-none focus:ring-2 focus:ring-[#FF6B35]/40"
            />
            {query && (
              <button
                onClick={() => {
                  setQuery("");
                  setSelected(null);
                }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#636366] hover:text-white"
              >
                <MdClose size={15} />
              </button>
            )}
          </div>

          {/* Results */}
          {!selected && results.length > 0 && (
            <div className="rounded-xl border border-[#2A2D35] divide-y divide-[#2A2D35] overflow-hidden">
              {results.map((f) => (
                <button
                  key={f.name}
                  onClick={() => setSelected(f)}
                  className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-[#1C1C1E] transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white truncate">
                      {f.name}
                    </p>
                    <p className="text-xs text-[#636366] mt-0.5">{f.serving}</p>
                  </div>
                  <div className="flex items-end gap-3 flex-shrink-0">
                    <div className="text-center">
                      <p className="text-sm font-bold text-[#FF6B35]">
                        {f.calories}
                      </p>
                      <p className="text-[9px] uppercase tracking-wide text-[#636366] font-semibold">
                        kcal
                      </p>
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-bold text-[#5EEAD4]">
                        {f.protein}g
                      </p>
                      <p className="text-[9px] uppercase tracking-wide text-[#636366] font-semibold">
                        P
                      </p>
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-bold text-[#F5C542]">
                        {f.carbs}g
                      </p>
                      <p className="text-[9px] uppercase tracking-wide text-[#636366] font-semibold">
                        C
                      </p>
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-bold text-[#C4B5FD]">
                        {f.fats}g
                      </p>
                      <p className="text-[9px] uppercase tracking-wide text-[#636366] font-semibold">
                        F
                      </p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {!selected && query && results.length === 0 && (
            <p className="text-sm text-[#8E8E93] text-center py-4">
              No foods found for “{query}”.
            </p>
          )}

          {/* Selected food */}
          {selected && scaled && (
            <>
              <div className="flex items-center justify-between px-4 py-3.5 rounded-xl bg-[#FF6B35]/5 border border-[#FF6B35]/30">
                <p className="text-sm font-bold text-white">{selected.name}</p>
                <button
                  onClick={() => setSelected(null)}
                  className="text-xs font-semibold text-[#8E8E93] px-2.5 py-1 rounded-lg bg-[#1C1C1E] border border-[#2A2D35] hover:text-white transition-colors"
                >
                  Change
                </button>
              </div>

              {/* Amount */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#636366] mb-2">
                  Amount
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => setAmountMode("serving")}
                    className={`rounded-xl px-4 py-3 text-left border transition-colors ${
                      amountMode === "serving"
                        ? "border-[#FF6B35] bg-[#FF6B35]/10"
                        : "border-[#2A2D35] bg-[#0F1117] hover:border-[#3A3A3C]"
                    }`}
                  >
                    <p
                      className={`text-[9px] font-bold uppercase tracking-[0.14em] mb-1 ${
                        amountMode === "serving"
                          ? "text-[#FF6B35]"
                          : "text-[#636366]"
                      }`}
                    >
                      Serving
                    </p>
                    <p
                      className={`text-sm font-semibold ${
                        amountMode === "serving"
                          ? "text-[#FF6B35]"
                          : "text-[#8E8E93]"
                      }`}
                    >
                      {selected.serving}
                    </p>
                  </button>
                  <div
                    className={`rounded-xl px-4 py-3 border transition-colors ${
                      amountMode === "custom"
                        ? "border-[#FF6B35] bg-[#FF6B35]/10"
                        : "border-[#2A2D35] bg-[#0F1117]"
                    }`}
                    onClick={() => setAmountMode("custom")}
                  >
                    <p
                      className={`text-[9px] font-bold uppercase tracking-[0.14em] mb-1 ${
                        amountMode === "custom"
                          ? "text-[#FF6B35]"
                          : "text-[#636366]"
                      }`}
                    >
                      Custom (g)
                    </p>
                    <input
                      type="number"
                      min="1"
                      value={customGrams}
                      onFocus={() => setAmountMode("custom")}
                      onChange={(e) => setCustomGrams(e.target.value)}
                      placeholder="Enter grams"
                      className="w-full bg-transparent text-sm font-semibold text-white placeholder:text-[#636366] focus:outline-none"
                    />
                  </div>
                </div>
              </div>

              {/* Macro preview */}
              <div className="grid grid-cols-4 gap-3">
                <div className="rounded-xl bg-[#0F1117] border border-[#2A2D35] px-3 py-3.5 text-center">
                  <p className="text-lg font-bold text-[#FF6B35]">
                    {scale === 0 ? "—" : scaled.calories}
                  </p>
                  <p className="text-xs text-[#8E8E93] mt-0.5">Calories</p>
                </div>
                <div className="rounded-xl bg-[#0F1117] border border-[#2A2D35] px-3 py-3.5 text-center">
                  <p className="text-lg font-bold text-[#5EEAD4]">
                    {scale === 0 ? "—" : scaled.protein}
                  </p>
                  <p className="text-xs text-[#8E8E93] mt-0.5">Protein</p>
                </div>
                <div className="rounded-xl bg-[#0F1117] border border-[#2A2D35] px-3 py-3.5 text-center">
                  <p className="text-lg font-bold text-[#F5C542]">
                    {scale === 0 ? "—" : scaled.carbs}
                  </p>
                  <p className="text-xs text-[#8E8E93] mt-0.5">Carbs</p>
                </div>
                <div className="rounded-xl bg-[#0F1117] border border-[#2A2D35] px-3 py-3.5 text-center">
                  <p className="text-lg font-bold text-[#C4B5FD]">
                    {scale === 0 ? "—" : scaled.fats}
                  </p>
                  <p className="text-xs text-[#8E8E93] mt-0.5">Fat</p>
                </div>
              </div>

              {/* Meal selection */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#636366] mb-2">
                  Add to Meal
                </p>
                <div className="flex flex-wrap gap-2">
                  {MEALS.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => setMeal(m.id)}
                      className={`px-3.5 py-2 rounded-full text-sm font-semibold border transition-colors ${
                        meal === m.id
                          ? "border-[#FF6B35] bg-[#FF6B35]/10 text-[#FF6B35]"
                          : "border-[#2A2D35] text-[#8E8E93] hover:text-white hover:border-[#3A3A3C]"
                      }`}
                    >
                      {m.icon} {m.label}
                    </button>
                  ))}
                </div>
              </div>

              <button
                onClick={handleAdd}
                disabled={scale === 0}
                className="w-full py-3.5 rounded-xl bg-[#FF6B35] text-white font-bold hover:bg-[#E85A2A] disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-orange"
              >
                Add to {meal}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
