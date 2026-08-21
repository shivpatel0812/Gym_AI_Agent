import React, { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import {
  DayMapModel,
  DayMapSlot,
  SlotSection,
  stackPercents,
} from "../../../lib/dayMap";
import {
  FastFoodPlace,
  PrimaryMealSlot,
  STANCE_OPTIONS,
  SlotStance,
} from "../../../api/nutritionPlan";
import { slotIcon } from "./EditMealAnchorModal";
import { colors, spacing, borderRadius } from "../../../theme";

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
  onLogOrder?: (order: {
    name: string;
    items?: string[];
    calories?: number;
    protein?: number;
  }, slot: PrimaryMealSlot) => void;
}

const KIND_META: Record<
  DayMapSlot["kind"],
  { label: string; color: string; bg: string }
> = {
  anchor: { label: "Anchor", color: colors.accentPrimary, bg: "rgba(255,107,53,0.14)" },
  flexible: { label: "Flexible", color: "#C4B5FD", bg: "rgba(196,181,253,0.14)" },
  one_time: { label: "One-time", color: "#F5C542", bg: "rgba(245,197,66,0.14)" },
  suggest: { label: "Suggest", color: colors.ai, bg: "rgba(94,234,212,0.12)" },
  stance: { label: "Note", color: "#8E8E93", bg: "rgba(142,142,147,0.12)" },
};

function calorieText(slot: DayMapSlot) {
  if (slot.kind === "flexible" || (slot.caloriesMin != null && !slot.calories)) {
    const min = slot.caloriesMin;
    const max = slot.caloriesMax;
    if (min != null && max != null) {
      return min === max ? `${Math.round(min)} kcal` : `${Math.round(min)}–${Math.round(max)} kcal`;
    }
  }
  if (slot.calories != null && slot.calories > 0) return `${Math.round(slot.calories)} kcal`;
  return null;
}

function proteinText(slot: DayMapSlot) {
  if (slot.protein != null && slot.protein > 0) return `${Math.round(slot.protein)}g P`;
  return null;
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
    <View style={styles.wrap}>
      <View style={styles.heroHead}>
        <View style={{ flex: 1 }}>
          <Text style={styles.kicker}>DAY BLUEPRINT</Text>
          <Text style={styles.headline}>{map.headline}</Text>
          <Text style={styles.editHint}>
            Breakfast · Lunch · Pre-workout · Dinner · Snack. Tap anchors to edit foods & days.
          </Text>
        </View>
        {onEditStrategy ? (
          <TouchableOpacity style={styles.strategyBtn} onPress={onEditStrategy}>
            <Text style={styles.strategyBtnText}>
              {strategyExpanded ? "Hide strategy" : "Edit strategy"}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <View style={styles.stackCard}>
        <View style={styles.stackTop}>
          <Text style={styles.stackTarget}>
            {map.stack.target > 1
              ? `${map.stack.target.toLocaleString()} kcal`
              : "Daily calories"}
          </Text>
          {map.proteinTarget > 0 ? (
            <Text style={styles.stackProtein}>
              Protein ~{map.proteinPlanned}g / {map.proteinTarget}g
            </Text>
          ) : null}
        </View>
        <View style={styles.barTrack}>
          {pct.anchors > 0 ? (
            <View style={[styles.barSeg, { width: `${pct.anchors}%`, backgroundColor: colors.accentPrimary }]} />
          ) : null}
          {pct.flexible > 0 ? (
            <View style={[styles.barSeg, { width: `${pct.flexible}%`, backgroundColor: "#C4B5FD" }]} />
          ) : null}
          {pct.free > 0 ? (
            <View style={[styles.barSeg, { width: `${pct.free}%`, backgroundColor: "#2A2D35" }]} />
          ) : null}
        </View>
      </View>

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

      <View style={styles.tableCard}>
        <Text style={styles.tableTitle}>Meal targets</Text>
        <Text style={styles.tableSub}>
          Tap a row to edit. Logging a meal anchor on Home adds each food as its own line.
        </Text>
        {map.table.map((row) => {
          const meta = KIND_META[row.kind] || KIND_META.anchor;
          const slot = map.slots.find((s) => s.id === row.id);
          return (
            <TouchableOpacity
              key={row.id}
              style={styles.tableRow}
              onPress={slot && onPressSlot ? () => onPressSlot(slot) : undefined}
              disabled={!slot || !onPressSlot}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.tdTitle}>{row.title}</Text>
                <Text style={[styles.tdKind, { color: meta.color }]}>
                  {row.slot} · {meta.label}
                  {row.daysText ? ` · ${row.daysText}` : ""}
                </Text>
              </View>
              <Text style={styles.colTarget}>{row.targetText}</Text>
            </TouchableOpacity>
          );
        })}
        {!map.table.length ? (
          <Text style={styles.bandEmpty}>Add meal anchors to see targets.</Text>
        ) : null}
      </View>
    </View>
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
  section: SlotSection;
  onAddAnchor?: (slot: PrimaryMealSlot) => void;
  onPressSlot?: (slot: DayMapSlot) => void;
  onStanceChange?: (slot: PrimaryMealSlot, stance: SlotStance) => void;
  onSuggestSlot?: (slot: PrimaryMealSlot) => void;
  suggesting?: boolean;
  onAddPlace?: (slot: PrimaryMealSlot, name: string) => void;
  onSuggestOrders?: (place: FastFoodPlace, slot: PrimaryMealSlot) => void;
  suggestingPlaceId?: string | null;
  orderSuggestions?: Props["orderSuggestions"];
  onLogOrder?: Props["onLogOrder"];
}) {
  const showFastFood = section.slot === "lunch" || section.slot === "dinner";
  const [placeDraft, setPlaceDraft] = useState("");

  return (
    <View style={styles.slotBlock}>
      <View style={styles.slotHead}>
        <View style={styles.slotTitleRow}>
          <View style={styles.slotIconWrap}>
            <MaterialCommunityIcons name={slotIcon(section.slot)} size={18} color={colors.accentPrimary} />
          </View>
          <Text style={styles.slotName}>{section.label}</Text>
        </View>
        {onSuggestSlot ? (
          <TouchableOpacity style={styles.aiBtn} onPress={() => onSuggestSlot(section.slot)} disabled={suggesting}>
            {suggesting ? (
              <ActivityIndicator size="small" color={colors.ai} />
            ) : (
              <>
                <MaterialCommunityIcons name="auto-fix" size={14} color={colors.ai} />
                <Text style={styles.aiBtnText}>AI ideas</Text>
              </>
            )}
          </TouchableOpacity>
        ) : null}
      </View>

      <View style={styles.stanceRow}>
        {STANCE_OPTIONS.map((opt) => {
          const on = section.stance === opt.id;
          return (
            <TouchableOpacity
              key={opt.id}
              style={[styles.stanceChip, on && styles.stanceChipOn]}
              onPress={() => onStanceChange?.(section.slot, opt.id)}
            >
              <Text style={[styles.stanceText, on && styles.stanceTextOn]}>{opt.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {section.stanceNotes ? <Text style={styles.stanceNote}>{section.stanceNotes}</Text> : null}
      {(section.stance === "uncertain" || section.stance === "eat_out") && !section.anchors.length ? (
        <Text style={styles.bandEmpty}>
          {section.stance === "eat_out"
            ? "Usually eat out here — add places below or still attach anchors for days you cook."
            : "Varies day to day — add anchors for days you do know, or ask AI for ideas."}
        </Text>
      ) : null}

      {section.anchors.map((slot) => {
        const meta = KIND_META[slot.kind] || KIND_META.anchor;
        const cal = calorieText(slot);
        const pro = proteinText(slot);
        return (
          <TouchableOpacity
            key={slot.id}
            style={[styles.anchorCard, { borderColor: meta.bg }]}
            onPress={() => onPressSlot?.(slot)}
            activeOpacity={0.75}
          >
            <View style={{ flex: 1 }}>
              <View style={styles.slotTitleRow}>
                <Text style={styles.anchorTitle} numberOfLines={1}>
                  {slot.title}
                </Text>
                <View style={[styles.kindPill, { backgroundColor: meta.bg }]}>
                  <Text style={[styles.kindPillText, { color: meta.color }]}>{meta.label}</Text>
                </View>
              </View>
              <Text style={styles.slotDetail} numberOfLines={2}>
                {slot.detail}
              </Text>
              <Text style={styles.slotMacros}>
                {[cal, pro, slot.daysText].filter(Boolean).join(" · ")}
              </Text>
            </View>
            <MaterialCommunityIcons name="pencil-outline" size={16} color={colors.textMuted} />
          </TouchableOpacity>
        );
      })}

      {onAddAnchor ? (
        <TouchableOpacity style={styles.addAnchorBtn} onPress={() => onAddAnchor(section.slot)}>
          <MaterialCommunityIcons name="plus" size={16} color={colors.accentPrimary} />
          <Text style={styles.addAnchorText}>Add meal anchor</Text>
        </TouchableOpacity>
      ) : null}

      {showFastFood ? (
        <View style={styles.fastFoodBox}>
          <Text style={styles.fastFoodTitle}>Fast food / eat out</Text>
          <Text style={styles.tableSub}>
            Places you like for {section.label.toLowerCase()}. AI can suggest orders that fit your remaining macros.
          </Text>
          {(section.places || []).map((place) => {
            const key = `${place.id || place.name}-${section.slot}`;
            const suggestion = orderSuggestions?.[key];
            return (
              <View key={key} style={styles.placeCard}>
                <View style={styles.placeHead}>
                  <Text style={styles.placeName}>{place.name}</Text>
                  {onSuggestOrders ? (
                    <TouchableOpacity
                      style={styles.aiBtn}
                      onPress={() => onSuggestOrders(place, section.slot)}
                      disabled={suggestingPlaceId === (place.id || place.name)}
                    >
                      {suggestingPlaceId === (place.id || place.name) ? (
                        <ActivityIndicator size="small" color={colors.ai} />
                      ) : (
                        <Text style={styles.aiBtnText}>Suggest orders</Text>
                      )}
                    </TouchableOpacity>
                  ) : null}
                </View>
                {suggestion?.tip ? <Text style={styles.stanceNote}>{suggestion.tip}</Text> : null}
                {(suggestion?.orders || []).map((order, i) => (
                  <TouchableOpacity
                    key={`${order.name}-${i}`}
                    style={styles.orderCard}
                    onPress={() => onLogOrder?.(order, section.slot)}
                  >
                    <Text style={styles.orderName}>{order.name}</Text>
                    <Text style={styles.slotDetail} numberOfLines={2}>
                      {(order.items || []).join(", ")}
                    </Text>
                    <Text style={styles.slotMacros}>
                      {[
                        order.calories != null ? `${Math.round(order.calories)} kcal` : null,
                        order.protein != null ? `${Math.round(order.protein)}g P` : null,
                        "Tap to log",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            );
          })}
          {onAddPlace ? (
            <View style={styles.addPlaceRow}>
              <TextInput
                style={styles.placeInput}
                value={placeDraft}
                onChangeText={setPlaceDraft}
                placeholder="e.g. Chipotle, Chick-fil-A"
                placeholderTextColor={colors.textMuted}
              />
              <TouchableOpacity
                style={styles.addPlaceBtn}
                onPress={() => {
                  const name = placeDraft.trim();
                  if (!name) return;
                  onAddPlace(section.slot, name);
                  setPlaceDraft("");
                }}
              >
                <Text style={styles.addPlaceBtnText}>Add</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md, marginBottom: spacing.lg },
  heroHead: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  kicker: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1,
    color: colors.ai,
    marginBottom: 4,
  },
  headline: { fontSize: 15, fontWeight: "600", color: colors.textPrimary, lineHeight: 21 },
  editHint: { marginTop: 6, fontSize: 12, color: colors.textMuted, lineHeight: 16 },
  strategyBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,107,53,0.4)",
  },
  strategyBtnText: { color: colors.accentPrimary, fontWeight: "700", fontSize: 12 },
  stackCard: {
    backgroundColor: colors.cardBackground,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  stackTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: spacing.sm },
  stackTarget: { fontSize: 22, fontWeight: "700", color: colors.textPrimary },
  stackProtein: { fontSize: 12, fontWeight: "600", color: colors.textSecondary },
  barTrack: {
    height: 12,
    borderRadius: 999,
    backgroundColor: "#1C1C1F",
    overflow: "hidden",
    flexDirection: "row",
  },
  barSeg: { height: "100%" },
  slotBlock: {
    backgroundColor: colors.cardBackground,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 10,
  },
  slotHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  slotTitleRow: { flexDirection: "row", alignItems: "center", gap: 8, flex: 1 },
  slotIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: "rgba(255,107,53,0.14)",
    alignItems: "center",
    justifyContent: "center",
  },
  slotName: { fontSize: 17, fontWeight: "800", color: colors.textPrimary },
  stanceRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  stanceChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
  },
  stanceChipOn: { borderColor: colors.accentPrimary, backgroundColor: "rgba(255,107,53,0.16)" },
  stanceText: { fontSize: 11, fontWeight: "700", color: colors.textSecondary },
  stanceTextOn: { color: colors.accentPrimary },
  stanceNote: { fontSize: 12, color: colors.textMuted, lineHeight: 16 },
  aiBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(94,234,212,0.35)",
  },
  aiBtnText: { color: colors.ai, fontWeight: "700", fontSize: 11 },
  anchorCard: {
    flexDirection: "row",
    gap: 10,
    borderRadius: 14,
    padding: spacing.md,
    borderWidth: 1,
    backgroundColor: "#12151C",
    alignItems: "flex-start",
  },
  anchorTitle: { flex: 1, fontSize: 15, fontWeight: "700", color: colors.textPrimary },
  kindPill: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  kindPillText: { fontSize: 10, fontWeight: "800" },
  slotDetail: { fontSize: 13, color: colors.textSecondary, lineHeight: 18, marginTop: 2 },
  slotMacros: { marginTop: 6, fontSize: 12, fontWeight: "700", color: colors.textMuted },
  addAnchorBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,107,53,0.35)",
  },
  addAnchorText: { color: colors.accentPrimary, fontWeight: "700", fontSize: 12 },
  bandEmpty: { fontSize: 12, color: colors.textMuted, lineHeight: 16 },
  fastFoodBox: {
    marginTop: 4,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: 8,
  },
  fastFoodTitle: { fontSize: 13, fontWeight: "800", color: colors.textPrimary },
  placeCard: { gap: 6, paddingVertical: 4 },
  placeHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  placeName: { fontSize: 14, fontWeight: "700", color: colors.textPrimary, flex: 1 },
  orderCard: {
    backgroundColor: "rgba(94,234,212,0.06)",
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: "rgba(94,234,212,0.18)",
  },
  orderName: { fontSize: 13, fontWeight: "700", color: colors.textPrimary },
  addPlaceRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  placeInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    color: colors.textPrimary,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "#12151C",
  },
  addPlaceBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: borderRadius.md,
    backgroundColor: colors.accentPrimary,
  },
  addPlaceBtnText: { color: "#fff", fontWeight: "700" },
  tableCard: {
    backgroundColor: colors.cardBackground,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 8,
  },
  tableTitle: { fontSize: 15, fontWeight: "700", color: colors.textPrimary },
  tableSub: { fontSize: 12, color: colors.textMuted, lineHeight: 16, marginBottom: 4 },
  tableRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: 10,
  },
  tdTitle: { fontSize: 13, fontWeight: "700", color: colors.textPrimary },
  tdKind: { fontSize: 10, fontWeight: "700", marginTop: 2 },
  colTarget: { width: 110, fontSize: 12, fontWeight: "600", color: colors.textSecondary, textAlign: "right" },
});
