import { useState, useMemo, useRef, useEffect } from "react";
import { FoodItem } from "@/types";
import foodDatabase, { FoodDbItem } from "@/data/foodDatabase";
import apiClient from "@/lib/api-client";
import { MdClose, MdSearch, MdPhotoCamera, MdImage } from "react-icons/md";

async function compressImage(file: File): Promise<File> {
  const maxWidth = 1280;
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Could not read photo"));
      image.src = url;
    });
    let width = img.width;
    let height = img.height;
    if (width > maxWidth) {
      height = Math.round((height * maxWidth) / width);
      width = maxWidth;
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(img, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.82)
    );
    if (!blob) return file;
    return new File([blob], "meal.jpg", { type: "image/jpeg" });
  } finally {
    URL.revokeObjectURL(url);
  }
}

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

function foodSearchText(food: FoodDbItem) {
  return [food.name, food.serving, ...(food.aliases || [])]
    .join(" ")
    .toLowerCase();
}

function foodMatchesQuery(food: FoodDbItem, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  const blob = foodSearchText(food);
  if (blob.includes(q)) return true;
  const tokens = q.split(/\s+/).filter((t) => t.length > 2 && !/^\d+$/.test(t));
  return tokens.length > 0 && tokens.every((t) => blob.includes(t));
}

export default function LogFoodForm({ meal, onAdd, onCancel }: LogFoodFormProps) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<FoodDbItem | null>(null);
  const [amountMode, setAmountMode] = useState<"serving" | "custom">("serving");
  const [customGrams, setCustomGrams] = useState("");
  const [mode, setMode] = useState<"search" | "photo" | "custom">("search");
  const [customName, setCustomName] = useState("");
  const [customCalories, setCustomCalories] = useState("");
  const [customProtein, setCustomProtein] = useState("");
  const [customCarbs, setCustomCarbs] = useState("");
  const [customFats, setCustomFats] = useState("");
  const [customFiber, setCustomFiber] = useState("");
  const [customAmount, setCustomAmount] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoNote, setPhotoNote] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [fromPhoto, setFromPhoto] = useState(false);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const [savedFoods, setSavedFoods] = useState<FoodDbItem[]>([]);
  const [estimating, setEstimating] = useState(false);
  const [estimateError, setEstimateError] = useState<string | null>(null);
  const estimateQueryRef = useRef("");
  const lastEstimatedRef = useRef("");

  useEffect(() => {
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
  }, []);

  const catalog = useMemo(() => {
    const byName = new Map<string, FoodDbItem>();
    for (const food of foodDatabase) {
      byName.set(food.name.toLowerCase(), food);
    }
    for (const food of savedFoods) {
      byName.set(food.name.toLowerCase(), food);
    }
    return Array.from(byName.values());
  }, [savedFoods]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return catalog.filter((f) => foodMatchesQuery(f, q)).slice(0, 8);
  }, [query, catalog]);

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
      fiber: Math.round((selected.fiber || 0) * scale),
    };
  }, [selected, scale]);

  const rememberFood = async (food: FoodDbItem, extraAliases: string[] = []) => {
    try {
      const res = await apiClient.post("/api/macros/foods", {
        name: food.name,
        serving: food.serving,
        grams: food.grams,
        calories: food.calories,
        protein: food.protein,
        carbs: food.carbs,
        fats: food.fats,
        fiber: food.fiber || 0,
        aliases: [...(food.aliases || []), ...extraAliases].filter(Boolean),
      });
      const saved = toFoodDbItem(res.data);
      setSavedFoods((prev) => {
        const rest = prev.filter(
          (f) => f.name.toLowerCase() !== saved.name.toLowerCase()
        );
        return [saved, ...rest];
      });
    } catch {
      // Search still works from the in-session list if save fails.
    }
  };

  const estimateFood = async (rawQuery: string) => {
    const q = rawQuery.trim();
    if (q.length < 2 || estimating) return;
    estimateQueryRef.current = q;
    setEstimating(true);
    setEstimateError(null);
    try {
      const res = await apiClient.post(
        "/api/macros/estimate-food",
        { query: q },
        { timeout: 30000 }
      );
      if (estimateQueryRef.current !== q) return;
      const item = toFoodDbItem(res.data);
      if (!item.name) {
        setEstimateError("Could not estimate that food.");
        return;
      }
      setSavedFoods((prev) => {
        const rest = prev.filter(
          (f) => f.name.toLowerCase() !== item.name.toLowerCase()
        );
        return [item, ...rest];
      });
      setSelected(item);
      setAmountMode("serving");
    } catch (error: any) {
      if (estimateQueryRef.current !== q) return;
      setEstimateError(
        error.response?.data?.detail ||
          "Could not estimate that food. Try a clearer name."
      );
    } finally {
      setEstimating(false);
    }
  };

  useEffect(() => {
    if (mode !== "search" || selected) return;
    const q = query.trim();
    if (q.length < 4 || results.length > 0) return;
    if (lastEstimatedRef.current === q) return;
    const timer = window.setTimeout(() => {
      lastEstimatedRef.current = q;
      void estimateFood(q);
    }, 750);
    return () => window.clearTimeout(timer);
  }, [query, results.length, selected, mode]);

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
      fiber: scaled.fiber,
      meal,
      amount: amountLabel,
    });
    void rememberFood(selected, [query.trim(), amountLabel]);
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
    const fiber = parseFloat(customFiber);
    onAdd({
      name,
      calories: Math.round(calories),
      protein: Math.round(protein * 10) / 10,
      carbs: Number.isFinite(carbs) && carbs >= 0 ? Math.round(carbs * 10) / 10 : 0,
      fats: Number.isFinite(fats) && fats >= 0 ? Math.round(fats * 10) / 10 : 0,
      fiber: Number.isFinite(fiber) && fiber >= 0 ? Math.round(fiber * 10) / 10 : 0,
      meal,
      amount: customAmount.trim() || undefined,
    });
    void rememberFood(
      {
        name,
        serving: customAmount.trim() || "1 serving",
        grams: 100,
        calories: Math.round(calories),
        protein: Math.round(protein * 10) / 10,
        carbs: Number.isFinite(carbs) && carbs >= 0 ? Math.round(carbs * 10) / 10 : 0,
        fats: Number.isFinite(fats) && fats >= 0 ? Math.round(fats * 10) / 10 : 0,
        fiber: Number.isFinite(fiber) && fiber >= 0 ? Math.round(fiber * 10) / 10 : 0,
      },
      [name]
    );
  };

  const handlePhotoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setPhotoError(null);
    try {
      const compressed = await compressImage(file);
      setPhotoFile(compressed);
      const reader = new FileReader();
      reader.onloadend = () => setPhotoPreview(reader.result as string);
      reader.readAsDataURL(compressed);
    } catch {
      setPhotoError("Could not open that photo. Try another one.");
    }
  };

  const clearPhoto = () => {
    setPhotoFile(null);
    setPhotoPreview(null);
    setPhotoError(null);
  };

  const handleAnalyzePhoto = async () => {
    if (!photoFile) return;
    setAnalyzing(true);
    setPhotoError(null);
    try {
      const payload = new FormData();
      payload.append("file", photoFile);
      const note = photoNote.trim();
      if (note) payload.append("description", note);

      const response = await apiClient.post("/api/macros/analyze-image", payload, {
        timeout: 60000,
      });
      const item = response.data?.food || response.data?.food_items?.[0];
      if (!item) {
        setPhotoError(
          response.data?.message || "Could not estimate macros. Try a clearer photo or add what it is."
        );
        return;
      }

      setCustomName(item.name || note || "Meal");
      setCustomAmount(item.amount || "");
      setCustomCalories(String(Math.round(Number(item.calories) || 0)));
      setCustomProtein(String(Number(item.protein) || 0));
      setCustomCarbs(String(Number(item.carbs) || 0));
      setCustomFats(String(Number(item.fats) || 0));
      setCustomFiber(String(Number(item.fiber) || 0));
      setFromPhoto(true);
      setMode("custom");
    } catch (error: any) {
      setPhotoError(
        error.response?.data?.detail || "Failed to analyze photo. Please try again."
      );
    } finally {
      setAnalyzing(false);
    }
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

      <div className="grid grid-cols-3 gap-2 p-1 rounded-xl bg-[#0F1117] border border-[#2A2D35]">
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
          onClick={() => setMode("photo")}
          className={`py-2 rounded-lg text-sm font-semibold transition-colors ${
            mode === "photo"
              ? "bg-[#FF6B35] text-white"
              : "text-[#8E8E93] hover:text-white"
          }`}
        >
          Photo
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

      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handlePhotoSelect}
      />
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handlePhotoSelect}
      />

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
                setEstimateError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (!selected) void estimateFood(query);
                }
              }}
              placeholder="Search or type 2 belvita crackers..."
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

          {!selected && query.trim().length >= 2 && results.length > 0 && (
            <button
              type="button"
              onClick={() => void estimateFood(query)}
              disabled={estimating}
              className="w-full text-sm font-semibold text-[#FF6B35] hover:text-[#E85A2A] disabled:opacity-50"
            >
              {estimating ? "Filling macros..." : `Fill macros for “${query.trim()}”`}
            </button>
          )}

          {!selected && query && results.length === 0 && (
            <div className="text-center py-2 space-y-2">
              {estimating ? (
                <p className="text-sm text-[#8E8E93]">
                  Filling macros for “{query.trim()}”...
                </p>
              ) : (
                <>
                  <p className="text-sm text-[#8E8E93]">
                    {estimateError || `No saved match for “${query.trim()}”.`}
                  </p>
                  <button
                    type="button"
                    onClick={() => void estimateFood(query)}
                    className="w-full py-3 rounded-xl bg-[#FF6B35] text-white text-sm font-bold hover:bg-[#E85A2A] transition-colors"
                  >
                    Fill macros
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCustomName(query.trim());
                      setMode("custom");
                    }}
                    className="text-sm font-semibold text-[#8E8E93] hover:text-white"
                  >
                    Enter macros myself
                  </button>
                </>
              )}
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

      {mode === "photo" && (
        <div className="space-y-4">
          <p className="text-sm text-[#8E8E93]">
            Snap the meal, say what it is, then GPT fills estimated macros.
          </p>

          {!photoPreview ? (
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => cameraInputRef.current?.click()}
                className="flex flex-col items-center justify-center gap-2 h-28 rounded-xl border border-dashed border-[#2A2D35] bg-[#0F1117] text-[#8E8E93] hover:text-white hover:border-[#FF6B35]/40 transition-colors"
              >
                <MdPhotoCamera size={22} className="text-[#FF6B35]" />
                <span className="text-sm font-semibold">Take photo</span>
              </button>
              <button
                type="button"
                onClick={() => galleryInputRef.current?.click()}
                className="flex flex-col items-center justify-center gap-2 h-28 rounded-xl border border-dashed border-[#2A2D35] bg-[#0F1117] text-[#8E8E93] hover:text-white hover:border-[#FF6B35]/40 transition-colors"
              >
                <MdImage size={22} className="text-[#5EEAD4]" />
                <span className="text-sm font-semibold">Choose photo</span>
              </button>
            </div>
          ) : (
            <div className="relative">
              <img
                src={photoPreview}
                alt="Meal preview"
                className="w-full h-44 object-cover rounded-xl border border-[#2A2D35]"
              />
              <button
                type="button"
                onClick={clearPhoto}
                className="absolute top-2 right-2 p-1.5 rounded-full bg-[#0B0C10]/80 text-white hover:bg-[#1C1C1E]"
                aria-label="Remove photo"
              >
                <MdClose size={16} />
              </button>
            </div>
          )}

          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#636366] mb-2">
              What is it?
            </p>
            <input
              type="text"
              value={photoNote}
              onChange={(e) => setPhotoNote(e.target.value)}
              placeholder="e.g. Chipotle chicken bowl, extra rice"
              className="w-full h-12 px-4 rounded-xl bg-[#0F1117] border border-[#2A2D35] text-white text-sm placeholder:text-[#636366] focus:outline-none focus:ring-2 focus:ring-[#FF6B35]/40"
            />
          </div>

          {photoError && (
            <p className="text-sm text-[#FCA5A5]">{photoError}</p>
          )}

          <button
            type="button"
            onClick={handleAnalyzePhoto}
            disabled={!photoFile || analyzing}
            className="w-full py-3.5 rounded-xl bg-[#FF6B35] text-white font-bold hover:bg-[#E85A2A] disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-orange"
          >
            {analyzing ? "Estimating macros..." : "Estimate macros"}
          </button>
        </div>
      )}

      {mode === "custom" && (
        <>
          {fromPhoto && (
            <p className="text-xs text-[#5EEAD4]">
              Filled from your photo — edit anything that looks off, then add.
            </p>
          )}
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
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#636366] mb-2">
                Fiber (g)
              </p>
              <input
                type="number"
                min="0"
                step="0.1"
                value={customFiber}
                onChange={(e) => setCustomFiber(e.target.value)}
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
