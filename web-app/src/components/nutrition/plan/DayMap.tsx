import { useState } from "react";
import { DayMapModel, DayMapSlot, stackPercents } from "../../../lib/dayMap";
import {
  FastFoodPlace,
  PrimaryMealSlot,
  STANCE_OPTIONS,
  SlotStance,
  WEEKDAY_OPTIONS,
} from "../../../api/nutritionPlan";
import { SlotIcon } from "./EditMealAnchorModal";

interface Props {
  map: DayMapModel;
  onEditStrategy?: () => void;
  strategyExpanded?: boolean;
  onAddAnchor?: (slot: PrimaryMealSlot) => void;
  onAddGoTo?: (slot: PrimaryMealSlot) => void;
  onPressSlot?: (slot: DayMapSlot) => void;
  onStanceChange?: (slot: PrimaryMealSlot, stance: SlotStance) => void;
  onSuggestSlot?: (slot: PrimaryMealSlot) => void;
  suggestingSlot?: string | null;
  onAddPlace?: (slot: PrimaryMealSlot, name: string) => void;
  onSuggestOrders?: (place: FastFoodPlace, slot: PrimaryMealSlot) => void;
  suggestingPlaceId?: string | null;
  orderSuggestions?: Record<
    string,
    { orders: Array<{ name: string; items?: string[]; calories?: number; protein?: number; why?: string }>; tip?: string | null }
  >;
  onLogOrder?: (
    order: { name: string; items?: string[]; calories?: number; protein?: number },
    slot: PrimaryMealSlot
  ) => void;
}

function dayTags(slot: DayMapSlot): string[] {
  const days = (slot.days || []).map((d) => String(d).slice(0, 3).toLowerCase());
  if (days.length) {
    const set = new Set(days);
    const ordered = WEEKDAY_OPTIONS.filter((d) => set.has(d.id)).map((d) => d.label);
    if (ordered.length === 7) return ["Daily"];
    return ordered;
  }
  if (slot.daysText) {
    const t = slot.daysText.toLowerCase();
    if (t.includes("every day") || t.includes("daily")) return ["Daily"];
    if (t.includes("most")) return ["Most days"];
    return [slot.daysText];
  }
  return [];
}

export default function DayMap({
  map,
  onEditStrategy,
  strategyExpanded,
  onAddAnchor,
  onAddGoTo,
  onPressSlot,
  onStanceChange,
  onSuggestSlot,
  suggestingSlot,
  onAddPlace,
  onSuggestOrders,
  suggestingPlaceId,
  orderSuggestions,
  onLogOrder,
}: Props) {
  const pct = stackPercents(map.stack);

  return (
    <div className="space-y-4 mb-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-extrabold tracking-[0.12em] text-[#5EEAD4] mb-1">DAY BLUEPRINT</p>
          <p className="text-[15px] font-semibold text-white leading-snug">{map.headline}</p>
          <p className="text-xs text-[#636366] mt-1.5">
            Breakfast · Lunch · Pre-workout · Dinner · Snack. Anchors and go-tos side by side.
          </p>
        </div>
        {onEditStrategy ? (
          <button
            type="button"
            onClick={onEditStrategy}
            className="shrink-0 px-3 py-2 rounded-full border border-[#FF6B35]/40 text-[#FF6B35] text-xs font-bold"
          >
            {strategyExpanded ? "Hide strategy" : "Edit strategy"}
          </button>
        ) : null}
      </div>

      <div className="rounded-2xl border border-[#2A2D35] bg-[#161A22] p-5 space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-2xl font-bold text-white">
            {map.stack.target > 1 ? `${map.stack.target.toLocaleString()} kcal` : "Daily calories"}
          </p>
          {map.proteinTarget > 0 ? (
            <p className="text-xs font-semibold text-[#8E8E93]">
              Protein ~{map.proteinPlanned}g / {map.proteinTarget}g
            </p>
          ) : null}
        </div>
        <div className="h-3 rounded-full bg-[#1C1C1F] overflow-hidden flex">
          {pct.anchors > 0 ? <div className="h-full bg-[#FF6B35]" style={{ width: `${pct.anchors}%` }} /> : null}
          {pct.flexible > 0 ? <div className="h-full bg-[#C4B5FD]" style={{ width: `${pct.flexible}%` }} /> : null}
          {pct.suggested > 0 ? <div className="h-full bg-[#5EEAD4]" style={{ width: `${pct.suggested}%` }} /> : null}
          {pct.free > 0 ? <div className="h-full bg-[#2A2D35]" style={{ width: `${pct.free}%` }} /> : null}
        </div>
      </div>

      {(map.sections || []).map((section) => (
        <SlotBlock
          key={section.slot}
          section={section}
          onAddAnchor={onAddAnchor}
          onAddGoTo={onAddGoTo}
          onPressSlot={onPressSlot}
          onStanceChange={onStanceChange}
          onSuggestSlot={onSuggestSlot}
          suggesting={suggestingSlot === section.slot}
          onAddPlace={onAddPlace}
          onSuggestOrders={onSuggestOrders}
          suggestingPlaceId={suggestingPlaceId}
          orderSuggestions={orderSuggestions}
          onLogOrder={onLogOrder}
        />
      ))}
    </div>
  );
}

function CompactItem({
  slot,
  onEdit,
  accent = "orange",
}: {
  slot: DayMapSlot;
  onEdit?: (slot: DayMapSlot) => void;
  accent?: "orange" | "teal" | "amber";
}) {
  const [open, setOpen] = useState(false);
  const tone = slot.varies ? "amber" : accent;
  const border =
    tone === "teal"
      ? "border-[rgba(94,234,212,0.18)]"
      : tone === "amber"
        ? "border-[rgba(245,197,66,0.35)] bg-[rgba(245,197,66,0.05)]"
        : "border-[rgba(255,107,53,0.14)]";
  const summary = [
    slot.calories ? `${Math.round(slot.calories)} kcal` : null,
    slot.protein ? `${Math.round(slot.protein)}g P` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const tags = dayTags(slot);
  const tagClass =
    tone === "teal"
      ? "border-[rgba(94,234,212,0.35)] bg-[rgba(94,234,212,0.12)] text-[#5EEAD4]"
      : tone === "amber"
        ? "border-[rgba(245,197,66,0.35)] bg-[rgba(245,197,66,0.14)] text-[#F5C542]"
        : "border-[rgba(255,107,53,0.28)] bg-[rgba(255,107,53,0.14)] text-[#FF6B35]";
  const editClass = tone === "amber" ? "text-[#F5C542]" : "text-[#FF6B35]";

  return (
    <div className={`rounded-xl border ${border} bg-[#12151C] overflow-hidden`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left px-2.5 py-2 flex items-center gap-2"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <p className="font-bold text-white text-[13px] truncate">{slot.title}</p>
            {slot.varies ? (
              <span className="shrink-0 px-1.5 py-0.5 rounded-full border border-[rgba(245,197,66,0.35)] bg-[rgba(245,197,66,0.14)] text-[9px] font-extrabold text-[#F5C542]">
                Uncertain
              </span>
            ) : null}
          </div>
          {summary ? <p className="text-[11px] font-bold text-[#636366] mt-0.5 truncate">{summary}</p> : null}
          {tags.length ? (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className={`px-1.5 py-0.5 rounded-full border text-[9px] font-extrabold ${tagClass}`}
                >
                  {tag}
                </span>
              ))}
            </div>
          ) : null}
        </div>
        <span className="text-[#636366] text-xs shrink-0">{open ? "▴" : "▾"}</span>
      </button>
      {open ? (
        <div className="px-2.5 pb-2.5 space-y-1.5 border-t border-[#2A2D35]">
          {slot.detail ? <p className="text-xs text-[#8E8E93] pt-2 leading-snug">{slot.detail}</p> : null}
          {onEdit ? (
            <button type="button" onClick={() => onEdit(slot)} className={`text-[12px] font-bold ${editClass}`}>
              Edit
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function SlotBlock({
  section,
  onAddAnchor,
  onAddGoTo,
  onPressSlot,
  onStanceChange,
  onSuggestSlot,
  suggesting,
  onAddPlace,
  onSuggestOrders,
  suggestingPlaceId,
  orderSuggestions,
  onLogOrder,
}: {
  section: DayMapModel["sections"][number];
  onAddAnchor?: Props["onAddAnchor"];
  onAddGoTo?: Props["onAddGoTo"];
  onPressSlot?: Props["onPressSlot"];
  onStanceChange?: Props["onStanceChange"];
  onSuggestSlot?: Props["onSuggestSlot"];
  suggesting?: boolean;
  onAddPlace?: Props["onAddPlace"];
  onSuggestOrders?: Props["onSuggestOrders"];
  suggestingPlaceId?: string | null;
  orderSuggestions?: Props["orderSuggestions"];
  onLogOrder?: Props["onLogOrder"];
}) {
  const [placeDraft, setPlaceDraft] = useState("");
  const showFastFood = section.slot === "lunch" || section.slot === "dinner";
  const mealAnchors = (section.anchors || []).filter((a) => a.kind === "anchor" || a.kind === "flexible");
  const goTos = section.goTos || [];

  return (
    <div className="rounded-2xl border border-[#2A2D35] bg-[#161A22] p-5 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-[10px] bg-[rgba(255,107,53,0.14)] text-[#FF6B35] flex items-center justify-center">
            <SlotIcon slot={section.slot} size={18} className="" />
          </div>
          <p className="text-lg font-extrabold text-white">{section.label}</p>
        </div>
        {onSuggestSlot ? (
          <button
            type="button"
            disabled={suggesting}
            onClick={() => onSuggestSlot(section.slot)}
            className="px-3 py-1.5 rounded-full border border-[#5EEAD4]/35 text-[#5EEAD4] text-xs font-bold disabled:opacity-50"
          >
            {suggesting ? "…" : "AI ideas"}
          </button>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {STANCE_OPTIONS.map((opt) => {
          const on = section.stance === opt.id;
          const active =
            opt.id === "uncertain"
              ? "border-[#F5C542] bg-[rgba(245,197,66,0.16)] text-[#F5C542]"
              : opt.id === "flexible"
                ? "border-[#C4B5FD] bg-[rgba(196,181,253,0.16)] text-[#C4B5FD]"
                : opt.id === "eat_out"
                  ? "border-[#FB923C] bg-[rgba(251,146,60,0.16)] text-[#FB923C]"
                  : "border-[#FF6B35] bg-[rgba(255,107,53,0.16)] text-[#FF6B35]";
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => onStanceChange?.(section.slot, opt.id)}
              className={`px-2.5 py-1 rounded-full border text-[11px] font-bold ${
                on ? active : "border-[#2A2D35] text-[#8E8E93]"
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
      {section.stanceNotes ? (
        <p
          className={`text-xs leading-snug ${
            section.stance === "uncertain" ? "text-[#F5C542]" : "text-[#636366]"
          }`}
        >
          {section.stanceNotes}
        </p>
      ) : section.stance === "uncertain" || section.stance === "eat_out" ? (
        <p
          className={`text-xs leading-snug ${
            section.stance === "uncertain" ? "text-[#F5C542]" : "text-[#636366]"
          }`}
        >
          {STANCE_OPTIONS.find((o) => o.id === section.stance)?.hint}
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-[rgba(255,107,53,0.22)] bg-[rgba(255,107,53,0.04)] p-2 space-y-1.5 min-w-0">
          <p className="text-[11px] font-extrabold text-white">Anchors</p>
          {mealAnchors.map((slot) => (
            <CompactItem key={slot.id} slot={slot} onEdit={onPressSlot} accent="orange" />
          ))}
          {!mealAnchors.length ? <p className="text-[11px] text-[#636366]">None yet</p> : null}
          {onAddAnchor ? (
            <button
              type="button"
              onClick={() => onAddAnchor(section.slot)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full border border-[#FF6B35]/35 text-[#FF6B35] text-[11px] font-bold"
            >
              + Add
            </button>
          ) : null}
        </div>

        <div className="rounded-xl border border-[rgba(94,234,212,0.22)] bg-[rgba(94,234,212,0.04)] p-2 space-y-1.5 min-w-0">
          <p className="text-[11px] font-extrabold text-white">Go-tos</p>
          {goTos.map((slot) => (
            <CompactItem key={slot.id} slot={slot} onEdit={onPressSlot} accent="teal" />
          ))}
          {!goTos.length ? <p className="text-[11px] text-[#636366]">None yet</p> : null}
          {onAddGoTo ? (
            <button
              type="button"
              onClick={() => onAddGoTo(section.slot)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full border border-[#5EEAD4]/35 text-[#5EEAD4] text-[11px] font-bold"
            >
              + Add
            </button>
          ) : null}
        </div>
      </div>

      {showFastFood &&
      (section.stance === "uncertain" || section.stance === "eat_out" || section.places.length > 0) ? (
        <div className="pt-3 border-t border-[#2A2D35] space-y-2">
          <p
            className={`text-sm font-extrabold ${
              section.stance === "uncertain" ? "text-[#F5C542]" : "text-white"
            }`}
          >
            Uncertain / eat-out days
          </p>
          <p className="text-xs text-[#636366]">
            Places for days without an anchor. AI can suggest orders that fit remaining macros.
          </p>
          {(section.places || []).map((place) => {
            const key = `${place.id || place.name}-${section.slot}`;
            const suggestion = orderSuggestions?.[key];
            return (
              <div key={key} className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-bold text-white">{place.name}</p>
                  {onSuggestOrders ? (
                    <button
                      type="button"
                      disabled={suggestingPlaceId === (place.id || place.name)}
                      onClick={() => onSuggestOrders(place, section.slot)}
                      className="text-xs font-bold text-[#5EEAD4]"
                    >
                      {suggestingPlaceId === (place.id || place.name) ? "…" : "Suggest orders"}
                    </button>
                  ) : null}
                </div>
                {(suggestion?.orders || []).map((order, i) => (
                  <button
                    key={`${order.name}-${i}`}
                    type="button"
                    onClick={() => onLogOrder?.(order, section.slot)}
                    className="w-full text-left rounded-xl border border-[rgba(94,234,212,0.18)] bg-[rgba(94,234,212,0.06)] p-3"
                  >
                    <p className="font-bold text-white text-sm">{order.name}</p>
                    <p className="text-xs text-[#8E8E93] mt-1">{(order.items || []).join(", ")}</p>
                    <p className="text-[11px] font-bold text-[#636366] mt-1">
                      {[
                        order.calories != null ? `${Math.round(order.calories)} kcal` : null,
                        order.protein != null ? `${Math.round(order.protein)}g P` : null,
                        "Click to log",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </button>
                ))}
              </div>
            );
          })}
          {onAddPlace ? (
            <div className="flex gap-2">
              <input
                className="flex-1 px-3 py-2 rounded-lg bg-[#12151C] border border-[#2A2D35] text-white text-sm"
                value={placeDraft}
                onChange={(e) => setPlaceDraft(e.target.value)}
                placeholder="e.g. Chipotle"
              />
              <button
                type="button"
                className="px-3 py-2 rounded-lg bg-[#FF6B35] text-white text-sm font-bold"
                onClick={() => {
                  const name = placeDraft.trim();
                  if (!name) return;
                  onAddPlace(section.slot, name);
                  setPlaceDraft("");
                }}
              >
                Add
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
