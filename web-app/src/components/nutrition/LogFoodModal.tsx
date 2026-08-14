import { useState, useMemo } from "react";
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

interface LogFoodFormProps {
  meal: string;
  onAdd: (food: FoodItem) => void;
  onCancel: () => void;
}

export default function LogFoodForm({ meal, onAdd, onCancel }: LogFoodFormProps) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<FoodDbItem | null>(null);
  const [amountMode, setAmountMode] = useState<"serving" | "custom">("serving");
  const [customGrams, setCustomGrams] = useState("");
  const [mode, setMode] = useState<"search" | "custom">("search");
  const [customName, setCustomName] = useState("");
  const [customCalories, setCustomCalories] = useState("");
  const [customProtein, setCustomProtein] = useState("");
  const [customCarbs, setCustomCarbs] = useState("");
  const [customFats, setCustomFats] = useState("");
  const [customAmount, setCustomAmount] = useState("");

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
  };

  const handleAddCustom = () => {
    const name = customName.trim();
    const calories = parseFloat(customCalories);
    const protein = parseFloat(customProtein);
    if (!name || !Number.isFinite(calories) || calories < 0 || !Number.isFinite(protein) || protein < 0) {
      return;
    }
    const carbs = parseFloat(customCarbs);
    const fats = parseFloat(customFats);
    onAdd({
      name,
      calories: Math.round(calories),
      protein: Math.round(protein * 10) / 10,
      carbs: Number.isFinite(carbs) && carbs >= 0 ? Math.round(carbs * 10) / 10 : 0,
      fats: Number.isFinite(fats) && fats >= 0 ? Math.round(fats * 10) / 10 : 0,
      meal,
      amount: customAmount.trim() || undefined,
    });
  };

  const canAddCustom =
    customName.trim().length > 0 &&
    Number.isFinite(parseFloat(customCalories)) &&
    parseFloat(customCalories) >= 0 &&
    Number.isFinite(parseFloat(customProtein)) &&
    parseFloat(customProtein) >= 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-white">Add food</p>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs font-semibold text-[#8E8E93] hover:text-white"
        >
          Cancel
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-[#0F1117] border border-[#2A2D35]">
        <button
          type="button"
          onClick={() => setMode("search")}
          className={`py-2 rounded-lg text-sm font-semibold transition-colors ${
            mode === "search"
              ? "bg-[#FF6B35] text-white"
              : "text-[#8E8E93] hover:text-white"
          }`}
        >
          Search
        </button>
        <button
          type="button"
          onClick={() => {
            setMode("custom");
            if (!customName && query.trim()) setCustomName(query.trim());
          }}
          className={`py-2 rounded-lg text-sm font-semibold transition-colors ${
            mode === "custom"
              ? "bg-[#FF6B35] text-white"
              : "text-[#8E8E93] hover:text-white"
          }`}
        >
          Custom
        </button>
      </div>

      {mode === "search" && (
        <>
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
                type="button"
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

          {!selected && results.length > 0 && (
            <div className="rounded-xl border border-[#2A2D35] divide-y divide-[#2A2D35] overflow-hidden">
              {results.map((f) => (
                <button
                  key={f.name}
                  type="button"
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
                      <p className="text-sm font-bold text-[#FF6B35]">{f.calories}</p>
                      <p className="text-[9px] uppercase tracking-wide text-[#636366] font-semibold">
                        kcal
                      </p>
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-bold text-[#5EEAD4]">{f.protein}g</p>
                      <p className="text-[9px] uppercase tracking-wide text-[#636366] font-semibold">
                        P
                      </p>
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-bold text-[#F5C542]">{f.carbs}g</p>
                      <p className="text-[9px] uppercase tracking-wide text-[#636366] font-semibold">
                        C
                      </p>
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-bold text-[#C4B5FD]">{f.fats}g</p>
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
            <div className="text-center py-2 space-y-2">
              <p className="text-sm text-[#8E8E93]">
                No foods found for “{query}”.
              </p>
              <button
                type="button"
                onClick={() => {
                  setCustomName(query.trim());
                  setMode("custom");
                }}
                className="text-sm font-semibold text-[#FF6B35] hover:text-[#E85A2A]"
              >
                Log “{query.trim()}” as custom food
              </button>
            </div>
          )}

          {selected && scaled && (
            <>
              <div className="flex items-center justify-between px-4 py-3.5 rounded-xl bg-[#FF6B35]/5 border border-[#FF6B35]/30">
                <p className="text-sm font-bold text-white">{selected.name}</p>
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  className="text-xs font-semibold text-[#8E8E93] px-2.5 py-1 rounded-lg bg-[#1C1C1E] border border-[#2A2D35] hover:text-white transition-colors"
                >
                  Change
                </button>
              </div>

              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#636366] mb-2">
                  Amount
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setAmountMode("serving")}
                    className={`rounded-xl px-4 py-3 text-left border transition-colors ${
                      amountMode === "serving"
                        ? "border-[#FF6B35] bg-[#FF6B35]/10"
                        : "border-[#2A2D35] bg-[#0F1117] hover:border-[#3A3A3C]"
                    }`}
                  >
                    <p
                      className={`text-[9px] font-bold uppercase tracking-[0.14em] mb-1 ${
                        amountMode === "serving" ? "text-[#FF6B35]" : "text-[#636366]"
                      }`}
                    >
                      Serving
                    </p>
                    <p
                      className={`text-sm font-semibold ${
                        amountMode === "serving" ? "text-[#FF6B35]" : "text-[#8E8E93]"
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
                        amountMode === "custom" ? "text-[#FF6B35]" : "text-[#636366]"
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

              <button
                type="button"
                onClick={handleAdd}
                disabled={scale === 0}
                className="w-full py-3.5 rounded-xl bg-[#FF6B35] text-white font-bold hover:bg-[#E85A2A] disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-orange"
              >
                Add to {meal}
              </button>
            </>
          )}
        </>
      )}

      {mode === "custom" && (
        <>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#636366] mb-2">
              Food name
            </p>
            <input
              type="text"
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              placeholder="e.g. Homemade protein shake"
              autoFocus
              className="w-full h-12 px-4 rounded-xl bg-[#0F1117] border border-[#2A2D35] text-white text-sm placeholder:text-[#636366] focus:outline-none focus:ring-2 focus:ring-[#FF6B35]/40"
            />
          </div>

          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#636366] mb-2">
              Amount (optional)
            </p>
            <input
              type="text"
              value={customAmount}
              onChange={(e) => setCustomAmount(e.target.value)}
              placeholder="e.g. 1 bowl, 200g"
              className="w-full h-12 px-4 rounded-xl bg-[#0F1117] border border-[#2A2D35] text-white text-sm placeholder:text-[#636366] focus:outline-none focus:ring-2 focus:ring-[#FF6B35]/40"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#636366] mb-2">
                Calories
              </p>
              <input
                type="number"
                min="0"
                value={customCalories}
                onChange={(e) => setCustomCalories(e.target.value)}
                placeholder="0"
                className="w-full h-12 px-4 rounded-xl bg-[#0F1117] border border-[#2A2D35] text-white text-sm placeholder:text-[#636366] focus:outline-none focus:ring-2 focus:ring-[#FF6B35]/40"
              />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#636366] mb-2">
                Protein (g)
              </p>
              <input
                type="number"
                min="0"
                step="0.1"
                value={customProtein}
                onChange={(e) => setCustomProtein(e.target.value)}
                placeholder="0"
                className="w-full h-12 px-4 rounded-xl bg-[#0F1117] border border-[#2A2D35] text-white text-sm placeholder:text-[#636366] focus:outline-none focus:ring-2 focus:ring-[#FF6B35]/40"
              />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#636366] mb-2">
                Carbs (g)
              </p>
              <input
                type="number"
                min="0"
                step="0.1"
                value={customCarbs}
                onChange={(e) => setCustomCarbs(e.target.value)}
                placeholder="0"
                className="w-full h-12 px-4 rounded-xl bg-[#0F1117] border border-[#2A2D35] text-white text-sm placeholder:text-[#636366] focus:outline-none focus:ring-2 focus:ring-[#FF6B35]/40"
              />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#636366] mb-2">
                Fat (g)
              </p>
              <input
                type="number"
                min="0"
                step="0.1"
                value={customFats}
                onChange={(e) => setCustomFats(e.target.value)}
                placeholder="0"
                className="w-full h-12 px-4 rounded-xl bg-[#0F1117] border border-[#2A2D35] text-white text-sm placeholder:text-[#636366] focus:outline-none focus:ring-2 focus:ring-[#FF6B35]/40"
              />
            </div>
          </div>

          <button
            type="button"
            onClick={handleAddCustom}
            disabled={!canAddCustom}
            className="w-full py-3.5 rounded-xl bg-[#FF6B35] text-white font-bold hover:bg-[#E85A2A] disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-orange"
          >
            Add to {meal}
          </button>
        </>
      )}
    </div>
  );
}
