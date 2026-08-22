import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { MdClose } from "react-icons/md";
import {
  BAND_ADD_OPTIONS,
  BlueprintExtra,
  DayBand,
  MealSlot,
  slotLabel,
} from "../../../api/nutritionPlan";
import { defaultMacrosForAdd, slotForBandAdd } from "../../../lib/dayMap";

export type BlueprintPersistence = "anchor" | "flexible" | "one_time";

export interface BlueprintAddResult {
  persistence: BlueprintPersistence;
  band: DayBand;
  slot: MealSlot;
  label: string;
  notes?: string;
  calories?: number;
  protein?: number;
  calorie_min?: number;
  calorie_max?: number;
  protein_min?: number;
  protein_max?: number;
  foods?: { name: string }[];
  id?: string;
}

interface Props {
  visible: boolean;
  band: DayBand | null;
  editing?: BlueprintExtra | null;
  onClose: () => void;
  onSave: (result: BlueprintAddResult) => void;
  onDelete?: () => void;
}

const fieldClass =
  "w-full px-3 py-2.5 rounded-lg bg-[#161A22] border border-[#2A2D35] text-white text-sm placeholder:text-[#636366] focus:outline-none focus:ring-1 focus:ring-[#FF6B35]/40";

export default function AddBlueprintModal({
  visible,
  band,
  editing,
  onClose,
  onSave,
  onDelete,
}: Props) {
  const activeBand = (editing?.band as DayBand) || band;
  const isEdit = !!editing;

  const [mealSlot, setMealSlot] = useState<MealSlot>("snack");
  const [persistence, setPersistence] = useState<BlueprintPersistence>("one_time");
  const [label, setLabel] = useState("Snack");
  const [foodsText, setFoodsText] = useState("");
  const [notes, setNotes] = useState("");
  const [calories, setCalories] = useState("180");
  const [protein, setProtein] = useState("12");

  useEffect(() => {
    if (!visible) return;
    if (editing) {
      setMealSlot((editing.slot as MealSlot) || "snack");
      setPersistence("one_time");
      setLabel(editing.label || "");
      setFoodsText((editing.foods || []).map((f) => f.name).filter(Boolean).join(", "));
      setNotes(editing.notes || "");
      setCalories(String(editing.calories ?? ""));
      setProtein(String(editing.protein ?? ""));
      return;
    }
    if (!band) return;
    const opt = BAND_ADD_OPTIONS[0];
    setMealSlot(opt.id);
    setPersistence("one_time");
    setLabel(opt.defaultLabel);
    setFoodsText("");
    setNotes("");
    const macros = defaultMacrosForAdd(opt.id);
    setCalories(String(macros.calories ?? ""));
    setProtein(String(macros.protein ?? ""));
  }, [visible, band, editing]);

  if (!visible || !activeBand) return null;

  const pickMeal = (slot: MealSlot, defaultLabel: string) => {
    setMealSlot(slot);
    if (!isEdit) setLabel(defaultLabel);
    const macros = defaultMacrosForAdd(slot);
    setCalories(String(macros.calories ?? ""));
    setProtein(String(macros.protein ?? ""));
  };

  const submit = () => {
    const resolvedSlot = isEdit
      ? ((mealSlot as MealSlot) || "snack")
      : slotForBandAdd(activeBand, mealSlot);
    const foods = foodsText
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((name) => ({ name }));
    const cal = Number(calories);
    const pro = Number(protein);
    const defaults = defaultMacrosForAdd(mealSlot);
    onSave({
      id: editing?.id,
      persistence: isEdit ? "one_time" : persistence,
      band: activeBand,
      slot: resolvedSlot,
      label: label.trim() || slotLabel(resolvedSlot),
      notes: notes.trim() || undefined,
      foods: foods.length ? foods : undefined,
      calories: Number.isFinite(cal) ? cal : defaults.calories,
      protein: Number.isFinite(pro) ? pro : defaults.protein,
      calorie_min: defaults.calorie_min,
      calorie_max: defaults.calorie_max,
      protein_min: defaults.protein_min,
      protein_max: defaults.protein_max,
    });
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 p-0 sm:p-4" onClick={onClose}>
      <div
        className="bg-[#0B0C10] border border-[#2A2D35] w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl max-h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-[#2A2D35]">
          <h2 className="text-lg font-bold text-white">
            {isEdit ? `Edit · ${activeBand}` : `Add to ${activeBand}`}
          </h2>
          <button type="button" onClick={onClose} className="text-[#8E8E93] hover:text-white">
            <MdClose size={20} />
          </button>
        </div>
        <div className="p-5 space-y-4 overflow-y-auto">
          {!isEdit ? (
            <>
              <div>
                <p className="text-[11px] font-extrabold uppercase tracking-wide text-[#636366] mb-2">
                  What are you adding?
                </p>
                <div className="flex flex-wrap gap-2">
                  {BAND_ADD_OPTIONS.map((opt) => {
                    const active = mealSlot === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => pickMeal(opt.id, opt.defaultLabel)}
                        className={`px-3 py-2 rounded-full border text-sm font-bold ${
                          active
                            ? "border-[#FF6B35] bg-[rgba(255,107,53,0.16)] text-[#FF6B35]"
                            : "border-[#2A2D35] text-[#8E8E93]"
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <p className="text-[11px] font-extrabold uppercase tracking-wide text-[#636366] mb-2">
                  Save as
                </p>
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      ["one_time", "One-time"],
                      ["anchor", "Anchor"],
                      ["flexible", "Flexible"],
                    ] as const
                  ).map(([id, text]) => {
                    const active = persistence === id;
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setPersistence(id)}
                        className={`px-3 py-2 rounded-full border text-sm font-bold ${
                          active
                            ? "border-[#FF6B35] bg-[rgba(255,107,53,0.16)] text-[#FF6B35]"
                            : "border-[#2A2D35] text-[#8E8E93]"
                        }`}
                      >
                        {text}
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-[#8E8E93] mt-2">
                  {persistence === "one_time"
                    ? "Stays on this day blueprint only — not a forever habit."
                    : persistence === "anchor"
                      ? "Opens the meal editor so you can pick specific foods."
                      : "Becomes a flexible meal with a calorie range."}
                </p>
              </div>
            </>
          ) : (
            <p className="text-xs text-[#8E8E93]">One-time on the blueprint — edit name, foods, and macros.</p>
          )}

          <div>
            <p className="text-[11px] font-extrabold uppercase tracking-wide text-[#636366] mb-2">Name</p>
            <input className={fieldClass} value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>
          <div>
            <p className="text-[11px] font-extrabold uppercase tracking-wide text-[#636366] mb-2">
              Foods (comma-separated)
            </p>
            <input
              className={fieldClass}
              value={foodsText}
              onChange={(e) => setFoodsText(e.target.value)}
              placeholder="yogurt, oatmeal, protein shake"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-[11px] font-extrabold uppercase tracking-wide text-[#636366] mb-2">
                Calories
              </p>
              <input
                className={fieldClass}
                value={calories}
                onChange={(e) => setCalories(e.target.value)}
                type="number"
              />
            </div>
            <div>
              <p className="text-[11px] font-extrabold uppercase tracking-wide text-[#636366] mb-2">
                Protein (g)
              </p>
              <input
                className={fieldClass}
                value={protein}
                onChange={(e) => setProtein(e.target.value)}
                type="number"
              />
            </div>
          </div>
          <div>
            <p className="text-[11px] font-extrabold uppercase tracking-wide text-[#636366] mb-2">
              Notes (optional)
            </p>
            <textarea
              className={`${fieldClass} min-h-[72px]`}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>
        <div className="p-5 border-t border-[#2A2D35] space-y-2">
          {isEdit && onDelete ? (
            <button type="button" onClick={onDelete} className="w-full py-2 text-[#FF453A] font-bold text-sm">
              Remove from blueprint
            </button>
          ) : null}
          <button
            type="button"
            onClick={submit}
            className="w-full py-3 rounded-xl bg-[#FF6B35] text-white font-bold"
          >
            {isEdit
              ? "Save changes"
              : persistence === "anchor"
                ? "Continue to meal foods"
                : `Add to ${activeBand}`}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
