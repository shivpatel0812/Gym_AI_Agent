import { useCallback, useEffect, useMemo, useState } from "react";
import { MdSearch, MdEdit, MdDelete } from "react-icons/md";
import apiClient from "../../lib/api-client";
import { FoodDbItem } from "../../data/foodDatabase";

function toItem(raw: any): FoodDbItem {
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

const fieldClass =
  "w-full h-11 px-3 rounded-lg bg-[#0F1117] border border-[#2A2D35] text-white text-sm placeholder:text-[#636366] focus:outline-none focus:ring-1 focus:ring-[#FF6B35]/40";

export default function SavedFoodsTab() {
  const [foods, setFoods] = useState<FoodDbItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<FoodDbItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get("/api/macros/foods");
      const items = Array.isArray(res.data) ? res.data.map(toItem) : [];
      setFoods(items.filter((f) => f.name && f.id));
      setError(null);
    } catch (err: any) {
      setError(err?.response?.data?.detail || "Could not load saved foods.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return foods;
    return foods.filter((f) =>
      [f.name, f.serving, ...(f.aliases || [])].join(" ").toLowerCase().includes(q)
    );
  }, [foods, query]);

  const saveEdit = async () => {
    if (!editing?.id || !editing.name.trim()) return;
    setSaving(true);
    try {
      const res = await apiClient.patch(`/api/macros/foods/${editing.id}`, {
        name: editing.name.trim(),
        serving: editing.serving.trim() || "1 serving",
        grams: Number(editing.grams) || 100,
        calories: Number(editing.calories) || 0,
        protein: Number(editing.protein) || 0,
        carbs: Number(editing.carbs) || 0,
        fats: Number(editing.fats) || 0,
        fiber: Number(editing.fiber) || 0,
      });
      const next = toItem(res.data);
      setFoods((prev) => prev.map((f) => (f.id === next.id ? next : f)));
      setEditing(null);
    } catch (err: any) {
      setError(err?.response?.data?.detail || "Could not save that food.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (food: FoodDbItem) => {
    if (!food.id) return;
    if (!confirm(`Delete ${food.name}?`)) return;
    try {
      await apiClient.delete(`/api/macros/foods/${food.id}`);
      setFoods((prev) => prev.filter((f) => f.id !== food.id));
      if (editing?.id === food.id) setEditing(null);
    } catch {
      setError("Could not delete that food.");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-10 h-10 border-2 border-[#FF6B35] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-8">
      <div>
        <h2 className="text-[28px] font-bold text-white">Saved foods</h2>
        <p className="text-sm text-[#8E8E93] mt-1 leading-relaxed">
          Foods you've logged or estimated. Edit macros here so search stays accurate.
        </p>
      </div>

      {error ? (
        <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-300">
          {error}
        </div>
      ) : null}

      <div className="flex items-center gap-2 border border-[#2A2D35] rounded-xl bg-[#161A22] px-3">
        <MdSearch size={18} className="text-[#636366]" />
        <input
          className="flex-1 py-3 bg-transparent text-white text-sm placeholder:text-[#636366] focus:outline-none"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search saved foods"
        />
      </div>

      {editing ? (
        <div className="rounded-2xl bg-[#161A22] border border-[#2A2D35] p-4 space-y-3">
          <p className="text-[15px] font-bold text-white">Edit {editing.name}</p>
          <div>
            <p className="text-[11px] font-bold uppercase text-[#636366] mb-1">Name</p>
            <input
              className={fieldClass}
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
            />
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase text-[#636366] mb-1">Serving</p>
            <input
              className={fieldClass}
              value={editing.serving}
              onChange={(e) => setEditing({ ...editing, serving: e.target.value })}
              placeholder="e.g. 180g"
            />
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase text-[#636366] mb-1">
              Grams in one serving
            </p>
            <input
              type="number"
              className={fieldClass}
              value={editing.grams}
              onChange={(e) => setEditing({ ...editing, grams: Number(e.target.value) || 0 })}
            />
          </div>
          <div className="grid grid-cols-5 gap-2">
            {(
              [
                ["calories", "kcal"],
                ["protein", "P"],
                ["carbs", "C"],
                ["fats", "F"],
                ["fiber", "Fi"],
              ] as const
            ).map(([key, short]) => (
              <div key={key}>
                <p className="text-[10px] font-bold text-[#636366] mb-1">{short}</p>
                <input
                  type="number"
                  className="w-full h-10 px-2 rounded-lg bg-[#0F1117] border border-[#2A2D35] text-white text-sm text-center focus:outline-none"
                  value={editing[key] ?? 0}
                  onChange={(e) =>
                    setEditing({ ...editing, [key]: Number(e.target.value) || 0 })
                  }
                />
              </div>
            ))}
          </div>
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={() => setEditing(null)}
              className="flex-1 py-2.5 rounded-xl border border-[#2A2D35] text-[#8E8E93] font-bold"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={saveEdit}
              disabled={saving || !editing.name.trim()}
              className="flex-1 py-2.5 rounded-xl bg-[#FF6B35] text-white font-bold disabled:opacity-40"
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      ) : null}

      {filtered.map((food) => (
        <div
          key={food.id}
          className="flex items-center gap-2 rounded-[14px] bg-[#161A22] border border-[#2A2D35] p-4"
        >
          <button
            type="button"
            onClick={() => setEditing({ ...food })}
            className="flex-1 text-left min-w-0"
          >
            <p className="text-[15px] font-bold text-white">{food.name}</p>
            <p className="text-xs text-[#636366] mt-0.5">
              {food.serving} · {Math.round(food.calories)} kcal · {Math.round(food.protein)}g P
            </p>
          </button>
          <button
            type="button"
            onClick={() => setEditing({ ...food })}
            className="p-2 text-[#8E8E93] hover:text-white"
            aria-label={`Edit ${food.name}`}
          >
            <MdEdit size={18} />
          </button>
          <button
            type="button"
            onClick={() => remove(food)}
            className="p-2 text-red-400 hover:text-red-300"
            aria-label={`Delete ${food.name}`}
          >
            <MdDelete size={18} />
          </button>
        </div>
      ))}

      {!filtered.length ? (
        <p className="text-sm text-[#636366] leading-relaxed">
          {query
            ? "No saved foods match that search."
            : "Nothing saved yet. Log a custom food or estimate one and it will show up here."}
        </p>
      ) : null}
    </div>
  );
}
