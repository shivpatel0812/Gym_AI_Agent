import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { MdClose } from "react-icons/md";
import { FlexibleMeal, FREQUENCY_OPTIONS } from "../../../api/nutritionPlan";

interface Props {
  visible: boolean;
  meal: FlexibleMeal | null;
  onClose: () => void;
  onSave: (meal: FlexibleMeal) => void | Promise<void>;
  onDelete?: () => void;
}

const fieldClass =
  "w-full px-3 py-2.5 rounded-lg bg-[#0B0C10] border border-[#2A2D35] text-white text-sm placeholder:text-[#636366] focus:outline-none focus:ring-1 focus:ring-[#FF6B35]/40";

function emptyMeal(): FlexibleMeal {
  return {
    name: "Dinner",
    frequency: "most_days",
    calorie_min: 650,
    calorie_max: 900,
    protein_min: 25,
    protein_max: 40,
    user_controls_food: false,
    notes: null,
  };
}

export default function EditFlexibleMealModal({
  visible,
  meal,
  onClose,
  onSave,
  onDelete,
}: Props) {
  const [draft, setDraft] = useState<FlexibleMeal>(emptyMeal());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setDraft(meal ? { ...meal } : emptyMeal());
  }, [visible, meal]);

  const update = (patch: Partial<FlexibleMeal>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
  };

  const handleSave = async () => {
    if (!draft.name.trim() || saving) return;
    setSaving(true);
    try {
      await onSave({
        id: meal?.id,
        name: draft.name.trim(),
        frequency: draft.frequency || "most_days",
        calorie_min: draft.calorie_min != null ? Number(draft.calorie_min) : null,
        calorie_max: draft.calorie_max != null ? Number(draft.calorie_max) : null,
        protein_min: draft.protein_min != null ? Number(draft.protein_min) : null,
        protein_max: draft.protein_max != null ? Number(draft.protein_max) : null,
        user_controls_food: Boolean(draft.user_controls_food),
        notes: draft.notes?.trim() || null,
      });
    } finally {
      setSaving(false);
    }
  };

  if (!visible) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/65 p-0 sm:p-4">
      <div className="w-full sm:max-w-lg max-h-[92vh] flex flex-col rounded-t-2xl sm:rounded-2xl bg-[#161A22] border border-[#2A2D35] shadow-xl">
        <div className="flex items-center justify-between px-5 pt-5 pb-2">
          <h3 className="text-lg font-bold text-white">
            {meal?.id ? "Edit flexible meal" : "Add flexible meal"}
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
          <p className="text-xs text-[#636366] leading-snug">
            Meals you don't fully control — family dinner, work lunches, etc. We'll plan the rest of the day around these ranges.
          </p>

          <p className="text-xs font-bold text-[#636366] mt-2">Name</p>
          <input
            className={fieldClass}
            value={draft.name}
            onChange={(e) => update({ name: e.target.value })}
            placeholder="Dinner"
          />

          <p className="text-xs font-bold text-[#636366] mt-2">How often</p>
          <div className="flex flex-wrap gap-2">
            {FREQUENCY_OPTIONS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => update({ frequency: f.id })}
                className={`px-2.5 py-1.5 rounded-full border text-xs font-semibold ${
                  draft.frequency === f.id
                    ? "border-[#FF6B35] text-[#FF6B35]"
                    : "border-[#2A2D35] text-[#8E8E93]"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          <p className="text-xs font-bold text-[#636366] mt-2">Calorie range</p>
          <div className="grid grid-cols-2 gap-2">
            <input
              type="number"
              className={fieldClass}
              value={draft.calorie_min ?? ""}
              onChange={(e) => update({ calorie_min: e.target.value === "" ? null : Number(e.target.value) || 0 })}
              placeholder="Min"
            />
            <input
              type="number"
              className={fieldClass}
              value={draft.calorie_max ?? ""}
              onChange={(e) => update({ calorie_max: e.target.value === "" ? null : Number(e.target.value) || 0 })}
              placeholder="Max"
            />
          </div>

          <p className="text-xs font-bold text-[#636366] mt-2">Protein range (optional)</p>
          <div className="grid grid-cols-2 gap-2">
            <input
              type="number"
              className={fieldClass}
              value={draft.protein_min ?? ""}
              onChange={(e) => update({ protein_min: e.target.value === "" ? null : Number(e.target.value) || 0 })}
              placeholder="Min g"
            />
            <input
              type="number"
              className={fieldClass}
              value={draft.protein_max ?? ""}
              onChange={(e) => update({ protein_max: e.target.value === "" ? null : Number(e.target.value) || 0 })}
              placeholder="Max g"
            />
          </div>

          <label className="flex items-center justify-between gap-3 mt-3 py-2">
            <div>
              <p className="text-sm font-semibold text-white">You mostly control this meal</p>
              <p className="text-xs text-[#636366] mt-0.5">Turn on if you pick the food but want a calorie range</p>
            </div>
            <input
              type="checkbox"
              checked={Boolean(draft.user_controls_food)}
              onChange={(e) => update({ user_controls_food: e.target.checked })}
              className="w-5 h-5 accent-[#FF6B35]"
            />
          </label>

          <p className="text-xs font-bold text-[#636366] mt-2">Notes (optional)</p>
          <textarea
            className={`${fieldClass} min-h-[64px] resize-none`}
            value={draft.notes || ""}
            onChange={(e) => update({ notes: e.target.value })}
            placeholder="e.g. Family dinner, calories are approximate"
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
