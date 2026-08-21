import { useState } from "react";
import { DayMapModel, DayMapSlot, stackPercents } from "../../../lib/dayMap";
import {
  FastFoodPlace,
  PrimaryMealSlot,
  STANCE_OPTIONS,
  SlotStance,
} from "../../../api/nutritionPlan";
import { SlotIcon } from "./EditMealAnchorModal";

interface Props {
  map: DayMapModel;
  onEditStrategy?: () => void;
  strategyExpanded?: boolean;
  onAddAnchor?: (slot: PrimaryMealSlot) => void;
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

export default function DayMap({
  map,
  onEditStrategy,
  strategyExpanded,
  onAddAnchor,
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
            Breakfast · Lunch · Pre-workout · Dinner · Snack. Tap anchors to edit foods & days.
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
          {pct.free > 0 ? <div className="h-full bg-[#2A2D35]" style={{ width: `${pct.free}%` }} /> : null}
        </div>
      </div>

      {(map.sections || []).map((section) => (
        <SlotBlock
          key={section.slot}
          section={section}
          onAddAnchor={onAddAnchor}
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

function SlotBlock({
  section,
  onAddAnchor,
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
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => onStanceChange?.(section.slot, opt.id)}
              className={`px-2.5 py-1 rounded-full border text-[11px] font-bold ${
                on
                  ? "border-[#FF6B35] bg-[rgba(255,107,53,0.16)] text-[#FF6B35]"
                  : "border-[#2A2D35] text-[#8E8E93]"
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      {section.anchors.map((slot) => (
        <button
          key={slot.id}
          type="button"
          onClick={() => onPressSlot?.(slot)}
          className="w-full text-left rounded-xl border border-[rgba(255,107,53,0.14)] bg-[#12151C] p-3.5"
        >
          <div className="flex items-center justify-between gap-2">
            <p className="font-bold text-white truncate">{slot.title}</p>
            <span className="text-[10px] font-extrabold text-[#FF6B35]">Anchor</span>
          </div>
          <p className="text-sm text-[#8E8E93] mt-1 line-clamp-2">{slot.detail}</p>
          <p className="text-xs font-bold text-[#636366] mt-1.5">
            {[
              slot.calories ? `${Math.round(slot.calories)} kcal` : null,
              slot.protein ? `${Math.round(slot.protein)}g P` : null,
              slot.daysText,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </button>
      ))}

      {onAddAnchor ? (
        <button
          type="button"
          onClick={() => onAddAnchor(section.slot)}
          className="inline-flex items-center gap-1 px-3 py-2 rounded-full border border-[#FF6B35]/35 text-[#FF6B35] text-xs font-bold"
        >
          + Add meal anchor
        </button>
      ) : null}

      {showFastFood ? (
        <div className="pt-3 border-t border-[#2A2D35] space-y-2">
          <p className="text-sm font-extrabold text-white">Fast food / eat out</p>
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
