import { useState } from "react";
import { MdAutoAwesome, MdCheck, MdClose, MdEdit } from "react-icons/md";
import {
  NutritionPlanEdit,
  NutritionSuggestionSet,
} from "../../../api/nutritionPlan";

interface Props {
  set: NutritionSuggestionSet;
  /** The plan moved since these were proposed, so some may no longer apply. */
  planChangedSince?: boolean;
  busy?: boolean;
  onAccept: (editIds?: string[]) => void;
  onDismiss: (editIds?: string[]) => void;
  /** Opens the matching editor prefilled, so a suggestion can be tweaked first. */
  onEdit?: (edit: NutritionPlanEdit) => void;
}

const MACRO_UNITS: Record<string, string> = {
  calories: " kcal",
  protein: "g protein",
  carbs: "g carbs",
  fats: "g fat",
  fiber: "g fiber",
};

/**
 * A one-line "what changes" for a suggestion.
 *
 * Deliberately not a JSON dump: the point is that the user can read the diff
 * for the one meal it touches and decide, without parsing the whole plan.
 */
function describe(edit: NutritionPlanEdit): string | null {
  if (edit.op === "update_targets") {
    const before = edit.before || {};
    const parts = Object.entries(edit.payload || {}).map(([key, value]) => {
      const unit = MACRO_UNITS[key] ?? "";
      const was = before[key];
      return was != null && was !== value
        ? `${key === "calories" ? "" : ""}${was} → ${value}${unit}`
        : `${value}${unit}`;
    });
    return parts.join(" · ") || null;
  }

  if (edit.op.startsWith("remove_")) {
    const foods = (edit.before?.foods || [])
      .map((f: any) => f?.name)
      .filter(Boolean);
    return foods.length ? foods.join(" + ") : null;
  }

  const foods = (edit.payload?.foods || []).map((f: any) => f?.name).filter(Boolean);
  if (foods.length) return foods.join(" + ");

  if (typeof edit.payload?.strategy === "string") return edit.payload.strategy;
  if (Array.isArray(edit.payload?.food_priorities)) {
    return edit.payload.food_priorities.join(", ");
  }
  return null;
}

function SuggestionRow({
  edit,
  busy,
  onAccept,
  onDismiss,
  onEdit,
}: {
  edit: NutritionPlanEdit;
  busy?: boolean;
  onAccept: () => void;
  onDismiss: () => void;
  onEdit?: () => void;
}) {
  const detail = describe(edit);
  const stale = edit.status === "stale";

  return (
    <div
      data-testid="suggestion-row"
      className="rounded-xl bg-[#0B0C10] border border-[#2A2D35] p-3 flex items-start gap-3"
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-white">{edit.title}</p>
        {detail ? (
          <p className="text-xs text-[#8E8E93] mt-0.5 break-words">{detail}</p>
        ) : null}
        {edit.rationale ? (
          <p className="text-xs text-[#5EEAD4] mt-1 leading-relaxed">{edit.rationale}</p>
        ) : null}
        {stale ? (
          <p className="text-xs text-[#F59E0B] mt-1">
            This no longer matches your plan — dismiss it and ask again.
          </p>
        ) : null}
      </div>

      <div className="flex items-center gap-1 shrink-0">
        {onEdit && !stale ? (
          <button
            type="button"
            aria-label={`Edit suggestion: ${edit.title}`}
            disabled={busy}
            onClick={onEdit}
            className="p-2 rounded-lg text-[#8E8E93] hover:text-white hover:bg-[#161A22] disabled:opacity-40"
          >
            <MdEdit size={16} />
          </button>
        ) : null}
        <button
          type="button"
          aria-label={`Dismiss suggestion: ${edit.title}`}
          disabled={busy}
          onClick={onDismiss}
          className="p-2 rounded-lg text-[#8E8E93] hover:text-red-300 hover:bg-[#161A22] disabled:opacity-40"
        >
          <MdClose size={16} />
        </button>
        {!stale ? (
          <button
            type="button"
            aria-label={`Accept suggestion: ${edit.title}`}
            disabled={busy}
            onClick={onAccept}
            className="px-3 py-2 rounded-lg bg-[#5EEAD4] text-[#0B0C10] text-xs font-bold hover:bg-[#4DD8C2] disabled:opacity-40"
          >
            Accept
          </button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Coach-proposed edits, reviewed where the plan actually lives.
 *
 * Chat never writes the plan: it stages these, and nothing here changes until
 * the user accepts an individual suggestion or the whole set.
 */
export default function PlanSuggestions({
  set,
  planChangedSince,
  busy,
  onAccept,
  onDismiss,
  onEdit,
}: Props) {
  const [expanded, setExpanded] = useState(true);
  // Stale rows stay visible so the user can see what was dropped and why,
  // but only genuinely pending ones can still be accepted.
  const visible = (set.edits || []).filter(
    (e) => e.status === "pending" || e.status === "stale"
  );
  const acceptable = visible.filter((e) => e.status === "pending");
  if (!visible.length) return null;

  return (
    <div
      data-testid="plan-suggestions"
      className="rounded-2xl bg-[rgba(94,234,212,0.06)] border border-[#5EEAD4]/40 p-4 space-y-3"
    >
      <div className="flex items-start gap-3">
        <MdAutoAwesome size={20} className="text-[#5EEAD4] mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-white">
            Coach suggested {visible.length} {visible.length === 1 ? "update" : "updates"}
          </p>
          <p className="text-xs text-[#8E8E93] mt-0.5">{set.summary}</p>
          {planChangedSince ? (
            <p className="text-xs text-[#F59E0B] mt-1">
              You've edited the plan since these were suggested.
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-xs font-bold text-[#5EEAD4] shrink-0"
        >
          {expanded ? "Hide" : "Review"}
        </button>
      </div>

      {expanded ? (
        <>
          <div className="space-y-2">
            {visible.map((edit) => (
              <SuggestionRow
                key={edit.id}
                edit={edit}
                busy={busy}
                onAccept={() => onAccept([edit.id])}
                onDismiss={() => onDismiss([edit.id])}
                onEdit={onEdit ? () => onEdit(edit) : undefined}
              />
            ))}
          </div>

          <div className="flex items-center gap-2">
            {acceptable.length ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => onAccept()}
                className="flex-1 py-2.5 rounded-xl bg-[#5EEAD4] text-[#0B0C10] text-sm font-bold hover:bg-[#4DD8C2] disabled:opacity-40 flex items-center justify-center gap-1.5"
              >
                <MdCheck size={16} /> Accept all
              </button>
            ) : null}
            <button
              type="button"
              disabled={busy}
              onClick={() => onDismiss()}
              className={`${acceptable.length ? "px-4" : "flex-1"} py-2.5 rounded-xl border border-[#2A2D35] text-sm font-bold text-[#8E8E93] hover:text-white disabled:opacity-40`}
            >
              Dismiss all
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
