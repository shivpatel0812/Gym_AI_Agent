import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  ScrollView,
  Platform,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import {
  DayMapModel,
  DayMapSlot,
  SLOT_TIME_LABELS,
  SlotSection,
} from "../../../lib/dayMap";
import {
  FastFoodPlace,
  PrimaryMealSlot,
  WEEKDAY_OPTIONS,
} from "../../../api/nutritionPlan";
import { slotIcon } from "./EditMealAnchorModal";
import type {
  LoggedMealPattern,
  PreviousViewItem,
  PreviousWeekBucket,
} from "../../../lib/recentMeals";
import {
  extractPreviousByWeek,
  extractPreviousGrouped,
  listRecentWeekWindows,
} from "../../../lib/recentMeals";

export type SlotIdea = {
  label: string;
  tag?: string;
  foods?: Array<{
    name?: string;
    calories?: number;
    protein?: number;
    carbs?: number;
    fats?: number;
  }>;
  days?: string[];
  notes?: string;
  calories?: number;
  protein?: number;
  carbs?: number;
  fats?: number;
};

interface Props {
  map: DayMapModel;
  onEditStrategy?: () => void;
  strategyExpanded?: boolean;
  onAddAnchor?: (slot: PrimaryMealSlot, kind?: "individual" | "potential" | "uncertain") => void;
  onAddGoTo?: (slot: PrimaryMealSlot) => void;
  onPressSlot?: (slot: DayMapSlot) => void;
  /** Toggle a weekday on an individual meal / go-to row. */
  onToggleDay?: (slot: DayMapSlot, dayId: string) => void;
  onSuggestSlot?: (slot: PrimaryMealSlot) => void;
  onPreloadSlot?: (slot: PrimaryMealSlot) => void;
  suggestingSlot?: string | null;
  slotIdeas?: Record<string, SlotIdea[]> | SlotIdea[];
  onAddIdea?: (idea: SlotIdea, slot: PrimaryMealSlot) => void;
  /** Raw macro log rows — used to show last-month eats under each meal slot. */
  macroLogs?: any[];
  onAddLoggedMeal?: (pattern: LoggedMealPattern, slot: PrimaryMealSlot) => void;
  onAddPlace?: (slot: PrimaryMealSlot, name: string) => void;
  onSuggestOrders?: (place: FastFoodPlace, slot: PrimaryMealSlot) => void;
  suggestingPlaceId?: string | null;
  orderSuggestions?: Record<
    string,
    {
      orders: Array<{
        name: string;
        items?: string[];
        calories?: number;
        protein?: number;
        why?: string;
      }>;
      tip?: string | null;
    }
  >;
  onLogOrder?: (
    order: { name: string; items?: string[]; calories?: number; protein?: number },
    slot: PrimaryMealSlot
  ) => void;
}

const serif = Platform.select({ ios: "Georgia", android: "serif", default: "serif" });

type BlueprintTheme = {
  accent: string;
  accentMuted: string;
  accentSoft: string;
  potential: string;
  potentialSoft: string;
  uncertain: string;
  eatOut: string;
  skip: string;
  ai: string;
  aiSoft: string;
  surface: string;
  surface2: string;
  border: string;
  muted: string;
  target: string;
};

/** Day Blueprint — blue anchor · amber potential · purple uncertain. */
const THEME: BlueprintTheme = {
  accent: "#9CC0E8",
  accentMuted: "#7FA8D0",
  accentSoft: "rgba(156,192,232,0.14)",
  potential: "#E09A45",
  potentialSoft: "rgba(224,154,69,0.16)",
  uncertain: "#A78BFA",
  eatOut: "#E5A3C0",
  skip: "#2A2A2E",
  ai: "#5EEAD4",
  aiSoft: "rgba(94,234,212,0.12)",
  surface: "#111113",
  surface2: "#0C0C0E",
  border: "#1C1C1F",
  muted: "#8E8E93",
  target: "#9CC0E8",
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

function dayMask(slot: DayMapSlot, _emptyIfUnset = false): boolean[] {
  const set = new Set((slot.days || []).map((d) => String(d).slice(0, 3).toLowerCase()));
  // Empty days = nothing selected. Never fake "all 7 on" — that made taps look like they
  // snapped back to every day after a save cleared or never set `days`.
  if (!set.size) return WEEKDAY_OPTIONS.map(() => false);
  return WEEKDAY_OPTIONS.map((d) => set.has(d.id));
}

function ideaMacros(idea: SlotIdea) {
  const foods = idea.foods || [];
  const fromFoods = (key: "calories" | "protein" | "carbs" | "fats") =>
    foods.reduce((s, f) => s + (Number(f[key]) || 0), 0);
  const cal = idea.calories != null ? idea.calories : fromFoods("calories") || null;
  const pro = idea.protein != null ? idea.protein : fromFoods("protein") || null;
  const carbs = idea.carbs != null ? idea.carbs : fromFoods("carbs") || null;
  const fats = idea.fats != null ? idea.fats : fromFoods("fats") || null;
  return { cal, pro, carbs, fats };
}

export default function DayMap({
  map,
  onEditStrategy,
  strategyExpanded,
  onAddAnchor,
  onAddGoTo,
  onPressSlot,
  onToggleDay,
  onSuggestSlot,
  onPreloadSlot,
  suggestingSlot,
  slotIdeas,
  onAddIdea,
  macroLogs,
  onAddLoggedMeal,
  onAddPlace,
  onSuggestOrders,
  suggestingPlaceId,
  orderSuggestions,
  onLogOrder,
}: Props) {
  const theme = THEME;
  const [focusSlot, setFocusSlot] = useState<PrimaryMealSlot>(
    () => map.sections[0]?.slot || "breakfast"
  );
  const section = useMemo(
    () => map.sections.find((s) => s.slot === focusSlot) || map.sections[0],
    [map.sections, focusSlot]
  );

  const maxBar = Math.max(
    map.stack.target || 1,
    ...(map.weeklyBars || []).map((b) => b.calories),
    1
  );
  const mappedDays = (map.weeklyBars || []).filter((b) => b.calories > 0).length;
  const ideasForFocus = useMemo(() => {
    if (!slotIdeas) return [];
    if (Array.isArray(slotIdeas)) return slotIdeas;
    return slotIdeas[focusSlot] || [];
  }, [slotIdeas, focusSlot]);

  const planAnchorsForFocus = useMemo(() => {
    return (map.sections.find((s) => s.slot === focusSlot)?.anchors || [])
      .filter((a) => a.kind === "anchor")
      .map((a) => {
        const foods = a.fillWith || a.foods || [];
        const mealKind = a.mealKind || "individual";
        // Potential/uncertain options are OR — any one food counts as the meal.
        const groups =
          mealKind === "potential" || mealKind === "uncertain"
            ? foods.length
              ? [{ key: "options", names: foods, matchSimilar: false }]
              : []
            : a.foodGroups;
        return {
          id: a.sourceId,
          label: a.title,
          foods,
          groups,
          mealKind,
          calories: a.calories,
          protein: a.protein,
        };
      });
  }, [map.sections, focusSlot]);

  const loggedPatterns = useMemo(() => {
    return extractPreviousGrouped(macroLogs || [], planAnchorsForFocus, {
      meal: focusSlot,
      days: 30,
      limit: 24,
    });
  }, [macroLogs, focusSlot, planAnchorsForFocus]);

  const weekBuckets = useMemo(() => {
    return extractPreviousByWeek(macroLogs || [], planAnchorsForFocus, {
      meal: focusSlot,
      weeks: 5,
      limitPerWeek: 24,
    });
  }, [macroLogs, focusSlot, planAnchorsForFocus]);

  const weekWindows = useMemo(() => listRecentWeekWindows(5), []);

  useEffect(() => {
    onPreloadSlot?.(focusSlot);
    // Only when the focused meal changes — parent guards against re-fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusSlot]);

  return (
    <View style={styles.wrap}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.slotTabs}
      >
        {map.sections.map((s) => {
          const on = s.slot === focusSlot;
          return (
            <TouchableOpacity
              key={s.slot}
              style={[
                styles.slotTab,
                { borderColor: theme.border, backgroundColor: theme.surface2 },
                on && {
                  borderColor: theme.accent,
                  backgroundColor: theme.accentSoft,
                },
              ]}
              onPress={() => setFocusSlot(s.slot)}
              activeOpacity={0.85}
            >
              <MaterialCommunityIcons
                name={slotIcon(s.slot)}
                size={16}
                color={on ? "#fff" : theme.muted}
              />
              <Text style={[styles.slotTabText, on && styles.slotTabTextOn]}>{s.label}</Text>
              {on ? (
                <View style={[styles.slotTabDot, { backgroundColor: theme.accent }]} />
              ) : null}
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <View style={styles.heroHead}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.kicker, { color: theme.muted }]}>DAY BLUEPRINT</Text>
          <Text style={styles.headline}>{map.headline}</Text>
        </View>
        {onEditStrategy ? (
          <TouchableOpacity
            style={[styles.strategyBtn, { borderColor: theme.border }]}
            onPress={onEditStrategy}
          >
            <Text style={styles.strategyBtnText}>
              {strategyExpanded ? "Hide" : "Strategy"}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <View
        style={[
          styles.weekCard,
          { backgroundColor: theme.surface, borderColor: theme.border },
        ]}
      >
        <View style={styles.weekCardTop}>
          <Text style={styles.weekCardKicker}>WEEKLY CALORIE MAP</Text>
          <Text style={styles.weekCardAvg}>
            ~{map.weeklyAvg.toLocaleString()} avg kcal/day
          </Text>
        </View>
        <View style={styles.barsRow}>
          {(map.weeklyBars || []).map((bar) => {
            const h = Math.max(6, Math.round((bar.calories / maxBar) * 72));
            const filled = bar.calories > 0;
            return (
              <View key={bar.id} style={styles.barCol}>
                <View style={styles.barTrack}>
                  {filled ? (
                    <View style={[styles.barFill, { height: h }]} />
                  ) : (
                    <View style={[styles.barEmpty, { height: 28, borderColor: theme.border }]} />
                  )}
                </View>
                <Text style={styles.barLabel}>{bar.short}</Text>
              </View>
            );
          })}
        </View>
        <View style={styles.weekCardFoot}>
          <Text style={styles.weekCardFootText}>{mappedDays} days mapped</Text>
          <View style={styles.targetLine}>
            <View
              style={[
                styles.targetRule,
                { backgroundColor: theme.target, borderStyle: "dashed" },
              ]}
            />
            <Text style={[styles.targetText, { color: theme.target }]}>
              {Math.round(map.stack.target).toLocaleString()} target
            </Text>
          </View>
        </View>
      </View>

      {section ? (
        <SlotFocus
          theme={theme}
          section={section}
          onAddAnchor={onAddAnchor}
          onAddGoTo={onAddGoTo}
          onPressSlot={onPressSlot}
          onToggleDay={onToggleDay}
          onSuggestSlot={onSuggestSlot}
          suggesting={suggestingSlot === section.slot}
          loggedPatterns={loggedPatterns}
          weekBuckets={weekBuckets}
          weekWindows={weekWindows}
          onAddLoggedMeal={onAddLoggedMeal}
          onAddPlace={onAddPlace}
          onSuggestOrders={onSuggestOrders}
          suggestingPlaceId={suggestingPlaceId}
          orderSuggestions={orderSuggestions}
          onLogOrder={onLogOrder}
        />
      ) : null}

      <View style={styles.aiHead}>
        <MaterialCommunityIcons name="auto-fix" size={14} color={theme.ai} />
        <Text style={[styles.aiHeadText, { color: theme.ai }]}>AI SUGGESTIONS</Text>
        <Text style={styles.aiHeadHint}>
          {ideasForFocus.length
            ? `· ${ideasForFocus.length} ready`
            : suggestingSlot === focusSlot
              ? "· loading…"
              : "· 1 preloads"}
        </Text>
      </View>

      {suggestingSlot === focusSlot && !ideasForFocus.length ? (
        <View
          style={[
            styles.aiCard,
            {
              borderColor: `${theme.ai}55`,
              backgroundColor: theme.surface,
              width: 220,
            },
          ]}
        >
          <ActivityIndicator color={theme.ai} />
          <Text style={[styles.aiLoadingText, { color: theme.ai, marginTop: 8 }]}>
            Finding one idea…
          </Text>
        </View>
      ) : null}

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.aiRow}
      >
        {(ideasForFocus || []).map((idea, i) => {
          const m = ideaMacros(idea);
          const tag =
            idea.tag ||
            (m.pro && m.pro >= 30 ? "High protein" : idea.notes ? "Suggested" : "Idea");
          return (
            <View
              key={`${idea.label}-${i}`}
              style={[
                styles.aiCard,
                {
                  borderColor: `${theme.ai}55`,
                  backgroundColor: theme.surface,
                },
              ]}
            >
              <View style={styles.aiCardTop}>
                <View style={[styles.aiTag, { backgroundColor: theme.aiSoft, borderColor: `${theme.ai}66`, borderWidth: 1 }]}>
                  <Text style={[styles.aiTagText, { color: theme.ai }]}>{tag}</Text>
                </View>
                {m.cal ? <Text style={styles.aiCal}>{Math.round(m.cal)} kcal</Text> : null}
              </View>
              <Text style={styles.aiTitle}>{idea.label}</Text>
              <Text style={styles.aiMacros}>
                {[
                  m.pro != null && m.pro > 0 ? `${Math.round(m.pro)}g P` : null,
                  m.carbs != null && m.carbs > 0 ? `${Math.round(m.carbs)}g C` : null,
                  m.fats != null && m.fats > 0 ? `${Math.round(m.fats)}g F` : null,
                ]
                  .filter(Boolean)
                  .join(" · ") || "Tap to add & edit macros"}
              </Text>
              {idea.notes ? (
                <Text style={[styles.aiWhy, { color: `${theme.ai}99` }]} numberOfLines={2}>
                  {idea.notes}
                </Text>
              ) : null}
              <TouchableOpacity
                style={[styles.aiAddBtn, { borderColor: `${theme.ai}77` }]}
                onPress={() => onAddIdea?.(idea, focusSlot)}
              >
                <Text style={[styles.aiAddText, { color: theme.ai }]}>Add to meals →</Text>
              </TouchableOpacity>
            </View>
          );
        })}
        <TouchableOpacity
          style={[
            styles.aiFetchCard,
            { borderColor: `${theme.ai}55`, backgroundColor: theme.aiSoft },
          ]}
          onPress={() => onSuggestSlot?.(focusSlot)}
          disabled={Boolean(suggestingSlot)}
        >
          {suggestingSlot === focusSlot && ideasForFocus.length ? (
            <ActivityIndicator color={theme.ai} />
          ) : (
            <MaterialCommunityIcons name="auto-fix" size={22} color={theme.ai} />
          )}
          <Text style={styles.aiFetchTitle}>
            {ideasForFocus.length ? "More ideas" : "Get an idea"}
          </Text>
          <Text style={styles.aiFetchSub}>
            {ideasForFocus.length ? "Add 2 more" : "Generate with AI"}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

function SlotFocus({
  theme,
  section,
  onAddAnchor,
  onAddGoTo,
  onPressSlot,
  onToggleDay,
  onSuggestSlot,
  suggesting,
  loggedPatterns,
  weekBuckets,
  weekWindows,
  onAddLoggedMeal,
  onAddPlace,
  onSuggestOrders,
  suggestingPlaceId,
  orderSuggestions,
  onLogOrder,
}: {
  theme: BlueprintTheme;
  section: SlotSection;
  onAddAnchor?: (slot: PrimaryMealSlot, kind?: "individual" | "potential" | "uncertain") => void;
  onAddGoTo?: (slot: PrimaryMealSlot) => void;
  onPressSlot?: (slot: DayMapSlot) => void;
  onToggleDay?: (slot: DayMapSlot, dayId: string) => void;
  onSuggestSlot?: (slot: PrimaryMealSlot) => void;
  suggesting?: boolean;
  loggedPatterns?: PreviousViewItem[];
  weekBuckets?: PreviousWeekBucket[];
  weekWindows?: Omit<PreviousWeekBucket, "items">[];
  onAddLoggedMeal?: (pattern: LoggedMealPattern, slot: PrimaryMealSlot) => void;
  onAddPlace?: (slot: PrimaryMealSlot, name: string) => void;
  onSuggestOrders?: (place: FastFoodPlace, slot: PrimaryMealSlot) => void;
  suggestingPlaceId?: string | null;
  orderSuggestions?: Props["orderSuggestions"];
  onLogOrder?: Props["onLogOrder"];
}) {
  const showFastFood = section.slot === "lunch" || section.slot === "dinner";
  const [placeDraft, setPlaceDraft] = useState("");
  const mealAnchors = section.anchors.filter((a) => a.kind === "anchor" || a.kind === "flexible");
  const individualCount = mealAnchors.filter(
    (a) => a.mealKind === "individual" || (!a.varies && !a.uncertain && a.kind === "anchor")
  ).length;
  const potentialCount = mealAnchors.filter(
    (a) => a.mealKind === "potential" || (a.varies && !a.uncertain)
  ).length;
  const uncertainCount = mealAnchors.filter(
    (a) => a.mealKind === "uncertain" || a.uncertain
  ).length;
  const time = SLOT_TIME_LABELS[section.slot] || "";
  type MealFilter = "all" | "individual" | "potential" | "uncertain" | "previous";
  const [mealFilter, setMealFilter] = useState<MealFilter>("all");
  /** null = last 30 days; otherwise a Mon–Sun week start id */
  const [weekId, setWeekId] = useState<string | null>(null);
  const [expandedLogKey, setExpandedLogKey] = useState<string | null>(null);

  useEffect(() => {
    setMealFilter("all");
    setWeekId(null);
    setExpandedLogKey(null);
  }, [section.slot]);

  const mealKindOf = (a: DayMapSlot): "individual" | "potential" | "uncertain" =>
    a.mealKind ||
    (a.uncertain ? "uncertain" : a.varies ? "potential" : "individual");

  const visibleMeals =
    mealFilter === "all" || mealFilter === "previous"
      ? mealAnchors
      : mealAnchors.filter((a) => mealKindOf(a) === mealFilter);

  const filterTone = {
    all: { color: "#fff", soft: "rgba(255,255,255,0.08)" },
    individual: { color: theme.accent, soft: theme.accentSoft },
    potential: { color: theme.potential, soft: theme.potentialSoft },
    uncertain: { color: theme.uncertain, soft: `${theme.uncertain}29` },
    previous: { color: theme.ai, soft: theme.aiSoft },
  } as const;

  const addKind: "individual" | "potential" | "uncertain" =
    mealFilter === "all" || mealFilter === "previous" ? "individual" : mealFilter;
  const activeTone = filterTone[mealFilter];
  const showingPrevious = mealFilter === "previous";

  const activeWeek =
    (weekBuckets || []).find((w) => w.id === weekId) ||
    (weekWindows || []).find((w) => w.id === weekId) ||
    null;
  const weekItems =
    (weekBuckets || []).find((w) => w.id === weekId)?.items || [];
  const previousList = weekId ? weekItems : loggedPatterns || [];

  const toggleExpand = (key: string) => {
    setExpandedLogKey((cur) => (cur === key ? null : key));
  };

  return (
    <View
      style={[
        styles.focusCard,
        { backgroundColor: theme.surface, borderColor: theme.border },
      ]}
    >
      <View style={styles.focusHead}>
        <View style={{ flex: 1 }}>
          <View style={styles.focusTitleRow}>
            <Text style={styles.focusTitle}>{section.label}</Text>
            {time ? <Text style={styles.focusTime}>{time}</Text> : null}
          </View>
          <Text style={[styles.focusMeta, { color: theme.accent }]}>
            {individualCount} anchor
            {"  ·  "}
            <Text style={{ color: theme.potential }}>{potentialCount} potential</Text>
            {"  ·  "}
            <Text style={{ color: theme.uncertain }}>{uncertainCount} uncertain</Text>
          </Text>
        </View>
        {onSuggestSlot ? (
          <TouchableOpacity
            style={[
              styles.aiBtn,
              { borderColor: `${theme.ai}55`, backgroundColor: theme.aiSoft },
            ]}
            onPress={() => onSuggestSlot(section.slot)}
            disabled={suggesting}
          >
            {suggesting ? (
              <ActivityIndicator size="small" color={theme.ai} />
            ) : (
              <MaterialCommunityIcons name="auto-fix" size={16} color={theme.ai} />
            )}
          </TouchableOpacity>
        ) : null}
      </View>

      <View style={styles.stanceRow}>
        {(
          [
            ["all", "All"],
            ["individual", "Anchor"],
            ["potential", "Potential"],
            ["uncertain", "Uncertain"],
            ["previous", "Previous"],
          ] as const
        ).map(([id, label]) => {
          const on = mealFilter === id;
          const tone = filterTone[id];
          const count =
            id === "all"
              ? mealAnchors.length
              : id === "individual"
                ? individualCount
                : id === "potential"
                  ? potentialCount
                  : id === "uncertain"
                    ? uncertainCount
                    : (loggedPatterns || []).length;
          return (
            <TouchableOpacity
              key={id}
              style={[
                styles.stanceChip,
                { borderColor: theme.border, backgroundColor: theme.surface2 },
                on && { borderColor: tone.color, backgroundColor: tone.soft },
              ]}
              onPress={() => {
                setMealFilter(id);
                setExpandedLogKey(null);
                if (id !== "previous") setWeekId(null);
              }}
            >
              {id === "previous" ? (
                <MaterialCommunityIcons
                  name="history"
                  size={12}
                  color={on ? tone.color : theme.muted}
                />
              ) : id !== "all" ? (
                <View style={[styles.filterDot, { backgroundColor: tone.color }]} />
              ) : null}
              <Text style={[styles.stanceText, on && { color: tone.color }]}>
                {label}
                {count ? ` · ${count}` : ""}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {showingPrevious ? (
        <>
          <View style={styles.blockHead}>
            <View style={[styles.blockBar, { backgroundColor: theme.ai }]} />
            <Text style={styles.blockTitle}>PREVIOUS LOGS</Text>
            <Text style={styles.blockHint}>
              {weekId
                ? `${activeWeek?.label || "Week"} · tap a row for full macros`
                : "Last 30 days · tap a row for full macros"}
            </Text>
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.weekChipRow}
          >
            <TouchableOpacity
              style={[
                styles.weekChip,
                { borderColor: theme.border, backgroundColor: theme.surface2 },
                !weekId && { borderColor: theme.ai, backgroundColor: theme.aiSoft },
              ]}
              onPress={() => {
                setWeekId(null);
                setExpandedLogKey(null);
              }}
            >
              <Text style={[styles.weekChipText, !weekId && { color: theme.ai }]}>
                All · {(loggedPatterns || []).length}
              </Text>
            </TouchableOpacity>
            {(weekWindows || []).map((w) => {
              const bucket = (weekBuckets || []).find((b) => b.id === w.id);
              const n = bucket?.items.length || 0;
              const on = weekId === w.id;
              return (
                <TouchableOpacity
                  key={w.id}
                  style={[
                    styles.weekChip,
                    { borderColor: theme.border, backgroundColor: theme.surface2 },
                    on && { borderColor: theme.ai, backgroundColor: theme.aiSoft },
                  ]}
                  onPress={() => {
                    setWeekId(w.id);
                    setExpandedLogKey(null);
                  }}
                >
                  <Text style={[styles.weekChipText, on && { color: theme.ai }]}>
                    {w.label}
                    {n ? ` · ${n}` : ""}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <DayColHeader theme={theme} trailWidth={LOG_DAY_TRAIL} />
          {previousList.length ? (
            previousList.map((p) => (
              <PreviousLogRow
                key={p.key}
                theme={theme}
                pattern={p}
                expanded={expandedLogKey === p.key}
                onToggle={() => toggleExpand(p.key)}
                onAdd={
                  !p.matchedAnchor && !p.inPlanFood && onAddLoggedMeal
                    ? () => onAddLoggedMeal(p, section.slot)
                    : undefined
                }
              />
            ))
          ) : (
            <Text style={styles.empty}>
              {weekId
                ? `No ${section.label.toLowerCase()} logs ${
                    activeWeek?.label ? `for ${activeWeek.label.toLowerCase()}` : "this week"
                  }.`
                : `No ${section.label.toLowerCase()} logs in the last month yet.`}
            </Text>
          )}
        </>
      ) : (
        <>
          <View style={styles.blockHead}>
            <View style={[styles.blockBar, { backgroundColor: activeTone.color }]} />
            <Text style={styles.blockTitle}>YOUR PLAN</Text>
            <Text style={styles.blockHint}>Saved meals · tap day · tap to edit</Text>
          </View>
          <DayColHeader theme={theme} />
          {visibleMeals.map((slot) => {
            const mk = mealKindOf(slot);
            const color = filterTone[mk].color;
            return (
              <MealRow
                key={slot.id}
                theme={theme}
                slot={slot}
                accent={color}
                showOptions={mk === "potential"}
                onPress={() => onPressSlot?.(slot)}
                onToggleDay={onToggleDay}
              />
            );
          })}
          {!visibleMeals.length ? (
            <Text style={styles.empty}>
              {mealFilter === "all"
                ? "No plan meals yet — add one below, or check Previous."
                : `No ${mealFilter === "individual" ? "anchor" : mealFilter} meals yet — add one below.`}
            </Text>
          ) : null}

          {onAddAnchor ? (
            <TouchableOpacity
              style={[
                styles.addKindBtn,
                {
                  borderColor: filterTone[addKind].color,
                  borderStyle: "dashed",
                  backgroundColor: "transparent",
                },
              ]}
              onPress={() => onAddAnchor(section.slot, addKind)}
            >
              <Text style={[styles.addKindText, { color: filterTone[addKind].color }]}>
                + Add {addKind === "individual" ? "anchor" : addKind} meal
              </Text>
            </TouchableOpacity>
          ) : null}
        </>
      )}

      {(section.goTos || []).length > 0 && !showingPrevious ? (
        <View style={{ marginTop: 14 }}>
          <View style={styles.blockHead}>
            <View style={[styles.blockBar, { backgroundColor: theme.muted }]} />
            <Text style={styles.blockTitle}>GO-TOS</Text>
            <Text style={styles.blockHint}>Quick singles · tap day</Text>
          </View>
          <DayColHeader theme={theme} />
          {(section.goTos || []).map((slot) => (
            <MealRow
              key={slot.id}
              theme={theme}
              slot={slot}
              accent={theme.muted}
              emptyIfUnset
              onPress={() => onPressSlot?.(slot)}
              onToggleDay={onToggleDay}
            />
          ))}
        </View>
      ) : null}

      {onAddGoTo ? (
        <TouchableOpacity
          style={[
            styles.addGoTo,
            {
              borderColor: theme.border,
              borderStyle: "dashed",
              backgroundColor: "transparent",
              marginTop: 10,
            },
          ]}
          onPress={() => onAddGoTo(section.slot)}
        >
          <Text style={[styles.addGoToText, { color: theme.muted }]}>+ Go-to</Text>
        </TouchableOpacity>
      ) : null}

      {showFastFood &&
      (section.stance === "uncertain" || section.stance === "eat_out" || section.places.length > 0) ? (
        <View
          style={[
            styles.fastFoodBox,
            {
              borderColor: `${theme.uncertain}55`,
              backgroundColor: `${theme.uncertain}14`,
            },
          ]}
        >
          <Text
            style={[
              styles.fastFoodTitle,
              section.stance === "uncertain" && { color: theme.uncertain },
            ]}
          >
            Places for open days
          </Text>
          {(section.places || []).map((place) => {
            const key = `${place.id || place.name}-${section.slot}`;
            const suggestion = orderSuggestions?.[key];
            return (
              <View key={key} style={styles.placeRow}>
                <Text style={styles.placeName}>{place.name}</Text>
                {onSuggestOrders ? (
                  <TouchableOpacity
                    onPress={() => onSuggestOrders(place, section.slot)}
                    disabled={suggestingPlaceId === (place.id || place.name)}
                  >
                    {suggestingPlaceId === (place.id || place.name) ? (
                      <ActivityIndicator size="small" color={theme.ai} />
                    ) : (
                      <Text style={[styles.placeAi, { color: theme.ai }]}>Orders</Text>
                    )}
                  </TouchableOpacity>
                ) : null}
                {suggestion?.orders?.map((order, i) => (
                  <TouchableOpacity
                    key={`${order.name}-${i}`}
                    style={[
                      styles.orderChip,
                      { backgroundColor: theme.surface2, borderColor: theme.border },
                    ]}
                    onPress={() => onLogOrder?.(order, section.slot)}
                  >
                    <Text style={styles.orderName}>{order.name}</Text>
                    <Text style={styles.orderMeta}>
                      {[
                        order.calories ? `${order.calories} kcal` : null,
                        order.protein ? `${order.protein}g P` : null,
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
            <View style={styles.placeAdd}>
              <TextInput
                value={placeDraft}
                onChangeText={setPlaceDraft}
                placeholder="Add place…"
                placeholderTextColor="#55647A"
                style={[
                  styles.placeInput,
                  { borderColor: theme.border, backgroundColor: theme.surface2 },
                ]}
              />
              <TouchableOpacity
                onPress={() => {
                  const name = placeDraft.trim();
                  if (!name) return;
                  onAddPlace(section.slot, name);
                  setPlaceDraft("");
                }}
              >
                <Text style={[styles.placeAi, { color: theme.ai }]}>Add</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const LOG_DAY_TRAIL = 48;

function PreviousLogRow({
  theme,
  pattern,
  expanded,
  onToggle,
  onAdd,
}: {
  theme: BlueprintTheme;
  pattern: PreviousViewItem;
  expanded: boolean;
  onToggle: () => void;
  onAdd?: () => void;
}) {
  const mark = pattern.matchedAnchor ? theme.accent : theme.ai;
  const mask =
    pattern.dayMask?.length === 7
      ? pattern.dayMask
      : WEEKDAY_OPTIONS.map((d) => (pattern.days || []).includes(d.id));
  const lines =
    pattern.items && pattern.items.length
      ? pattern.items
      : [
          {
            name: pattern.name,
            amount: pattern.amount,
            calories: pattern.calories,
            protein: pattern.protein,
            carbs: pattern.carbs,
            fats: pattern.fats,
            fiber: pattern.fiber,
          },
        ];
  const totalCal = lines.reduce((s, f) => s + (f.calories || 0), 0) || pattern.calories;
  const totalPro = lines.reduce((s, f) => s + (f.protein || 0), 0) || pattern.protein;
  const totalCarb = lines.reduce((s, f) => s + (f.carbs || 0), 0) || pattern.carbs || 0;
  const totalFat = lines.reduce((s, f) => s + (f.fats || 0), 0) || pattern.fats || 0;

  return (
    <View
      style={[
        styles.logBlock,
        expanded && { backgroundColor: theme.surface2, borderRadius: 10 },
      ]}
    >
      <TouchableOpacity style={styles.logRow} onPress={onToggle} activeOpacity={0.75}>
        <View style={[styles.mealBullet, { backgroundColor: mark }]} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={styles.mealTitleRow}>
            <Text style={styles.mealTitle} numberOfLines={1}>
              {pattern.name}
            </Text>
            {pattern.matchedAnchor ? (
              <View style={[styles.uncertainPill, { backgroundColor: theme.accentSoft }]}>
                <Text style={[styles.uncertainPillText, { color: theme.accent }]}>Anchored</Text>
              </View>
            ) : null}
            <MaterialCommunityIcons
              name={expanded ? "chevron-up" : "chevron-down"}
              size={16}
              color={theme.muted}
            />
          </View>
          <Text style={styles.mealMacros} numberOfLines={1}>
            {[
              `${pattern.count}×`,
              pattern.matchedFoods?.length
                ? pattern.matchedFoods.join(", ")
                : pattern.amount || null,
              pattern.calories ? `${Math.round(pattern.calories)} kcal` : null,
              pattern.protein ? `${Math.round(pattern.protein)}g P` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </Text>
        </View>
        <View style={styles.dotGrid}>
          {mask.map((on, i) => (
            <View
              key={WEEKDAY_OPTIONS[i].id}
              style={[
                styles.dotCell,
                { borderColor: theme.border, backgroundColor: theme.surface2 },
                on ? { borderColor: mark, backgroundColor: `${mark}33` } : null,
              ]}
            >
              {on ? <View style={[styles.dotInner, { backgroundColor: mark }]} /> : null}
            </View>
          ))}
        </View>
        <View style={styles.logTrail}>
          {onAdd ? (
            <TouchableOpacity
              style={[styles.logAddBtn, { borderColor: `${theme.ai}66` }]}
              onPress={(e) => {
                e?.stopPropagation?.();
                onAdd();
              }}
              hitSlop={6}
            >
              <Text style={[styles.logAddText, { color: theme.ai }]}>Add</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </TouchableOpacity>

      {expanded ? (
        <View style={styles.logDetail}>
          <View style={styles.macroStrip}>
            <Text style={[styles.macroChip, { color: "#9CC0E8" }]}>
              {Math.round(totalCal)} kcal
            </Text>
            <Text style={[styles.macroChip, { color: "#C4A574" }]}>
              {Math.round(totalPro)}g P
            </Text>
            <Text style={[styles.macroChip, { color: "#E8C547" }]}>
              {Math.round(totalCarb)}g C
            </Text>
            <Text style={[styles.macroChip, { color: "#B8A0D4" }]}>
              {Math.round(totalFat)}g F
            </Text>
          </View>
          {lines.map((line, i) => (
            <View key={`${line.name}-${i}`} style={styles.logItemRow}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.logItemName} numberOfLines={2}>
                  {line.name}
                </Text>
                {line.amount ? (
                  <Text style={styles.logItemAmount}>{line.amount}</Text>
                ) : null}
              </View>
              <Text style={styles.logItemCal}>{Math.round(line.calories || 0)}</Text>
              <Text style={[styles.logItemMacro, { color: "#C4A574" }]}>
                {Math.round(line.protein || 0)}g
              </Text>
              <Text style={[styles.logItemMacro, { color: "#E8C547" }]}>
                {Math.round(line.carbs || 0)}g
              </Text>
              <Text style={[styles.logItemMacro, { color: "#B8A0D4" }]}>
                {Math.round(line.fats || 0)}g
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function DayColHeader({
  theme,
  trailWidth = 0,
}: {
  theme: BlueprintTheme;
  /** Reserve right column (e.g. Add button) so letters sit over the day dots. */
  trailWidth?: number;
}) {
  return (
    <View style={styles.dayColHeader}>
      <View style={styles.dayColHeaderSpacer} />
      <View style={styles.dotGrid}>
        {WEEKDAY_OPTIONS.map((d) => (
          <View key={d.id} style={styles.dayColHeadCell}>
            <Text style={[styles.dayColHeadText, { color: theme.muted }]}>{d.short}</Text>
          </View>
        ))}
      </View>
      {trailWidth > 0 ? <View style={{ width: trailWidth }} /> : null}
    </View>
  );
}

function MealRow({
  theme,
  slot,
  accent,
  emptyIfUnset,
  showOptions,
  onPress,
  onToggleDay,
}: {
  theme: BlueprintTheme;
  slot: DayMapSlot;
  accent: string;
  emptyIfUnset?: boolean;
  showOptions?: boolean;
  onPress?: () => void;
  onToggleDay?: (slot: DayMapSlot, dayId: string) => void;
}) {
  const cal = calorieText(slot);
  const pro = proteinText(slot);
  const mask = dayMask(slot, emptyIfUnset);
  const uncertain = Boolean(slot.uncertain || slot.mealKind === "uncertain");
  const potential = Boolean(slot.varies || slot.mealKind === "potential");
  const mark = uncertain ? theme.uncertain : potential ? theme.potential : accent;
  const optionCount = (slot.foods || []).length;

  return (
    <View style={styles.mealRow}>
      <TouchableOpacity style={styles.mealMain} onPress={onPress} activeOpacity={0.75}>
        <View style={[styles.mealBullet, { backgroundColor: mark }]} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={styles.mealTitleRow}>
            <Text style={styles.mealTitle} numberOfLines={1}>
              {slot.title}
            </Text>
            {uncertain ? (
              <View style={[styles.uncertainPill, { backgroundColor: `${theme.uncertain}29` }]}>
                <Text style={[styles.uncertainPillText, { color: theme.uncertain }]}>
                  Uncertain
                </Text>
              </View>
            ) : null}
            {potential && !uncertain ? (
              <View style={[styles.uncertainPill, { backgroundColor: theme.potentialSoft }]}>
                <Text style={[styles.uncertainPillText, { color: theme.potential }]}>
                  {optionCount ? `${optionCount} opts` : "Options"}
                </Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.mealMacros} numberOfLines={1}>
            {showOptions && optionCount
              ? `${optionCount} options · ${[cal, pro].filter(Boolean).join(" · ") || "avg macros"}`
              : [cal, pro].filter(Boolean).join(" · ") || (uncertain ? "Open / TBD" : "Set macros")}
          </Text>
        </View>
      </TouchableOpacity>
      <View style={styles.dotGrid}>
        {mask.map((on, i) => {
          const dayId = WEEKDAY_OPTIONS[i].id;
          return (
            <TouchableOpacity
              key={dayId}
              style={[
                styles.dotCell,
                { borderColor: theme.border, backgroundColor: theme.surface2 },
                on ? { borderColor: mark, backgroundColor: `${mark}33` } : null,
              ]}
              onPress={() => onToggleDay?.(slot, dayId)}
              hitSlop={4}
              activeOpacity={0.7}
            >
              {on ? <View style={[styles.dotInner, { backgroundColor: mark }]} /> : null}
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}


const styles = StyleSheet.create({
  wrap: { gap: 14, marginBottom: 8 },
  slotTabs: { gap: 8, paddingRight: 8 },
  slotTab: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 12,
    borderWidth: 1.5,
  },
  slotTabText: { color: "#7C8CA0", fontSize: 12, fontWeight: "700" },
  slotTabTextOn: { color: "#fff" },
  slotTabDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    marginLeft: 2,
  },
  heroHead: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  kicker: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.2,
    marginBottom: 6,
  },
  headline: {
    color: "#fff",
    fontSize: 26,
    lineHeight: 32,
    fontFamily: serif,
    fontStyle: "italic",
    fontWeight: "500",
  },
  strategyBtn: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  strategyBtnText: { color: "#7C8CA0", fontSize: 11, fontWeight: "700" },
  weekCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    gap: 12,
  },
  weekCardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  weekCardKicker: {
    color: "#7C8CA0",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.8,
  },
  weekCardAvg: { color: "#fff", fontSize: 12, fontWeight: "700" },
  barsRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    height: 88,
    gap: 4,
  },
  barCol: { flex: 1, alignItems: "center", gap: 6 },
  barTrack: { height: 72, justifyContent: "flex-end", alignItems: "center", width: "100%" },
  barFill: {
    width: "70%",
    maxWidth: 28,
    borderRadius: 6,
    backgroundColor: "#3A3F4A",
  },
  barEmpty: {
    width: "70%",
    maxWidth: 28,
    borderRadius: 6,
    borderWidth: 1,
    backgroundColor: "transparent",
  },
  barLabel: { color: "#55647A", fontSize: 10, fontWeight: "700" },
  weekCardFoot: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  weekCardFootText: { color: "#55647A", fontSize: 11, fontWeight: "600" },
  targetLine: { flexDirection: "row", alignItems: "center", gap: 6 },
  targetRule: { width: 22, height: 2, borderRadius: 1 },
  targetText: { fontSize: 11, fontWeight: "700" },
  focusCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    gap: 12,
  },
  focusHead: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  focusTitleRow: { flexDirection: "row", alignItems: "baseline", gap: 10, flexWrap: "wrap" },
  focusTitle: {
    color: "#fff",
    fontSize: 28,
    fontFamily: serif,
    fontStyle: "italic",
    fontWeight: "500",
  },
  focusTime: { color: "#7C8CA0", fontSize: 13, fontWeight: "600" },
  focusMeta: { fontSize: 12, marginTop: 4, fontWeight: "700" },
  aiBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  stanceRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  stanceChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1.5,
  },
  filterDot: { width: 7, height: 7, borderRadius: 4 },
  stanceText: { color: "#7C8CA0", fontSize: 12, fontWeight: "700" },
  weekChipRow: { gap: 6, paddingVertical: 2 },
  weekChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1.5,
  },
  weekChipText: { color: "#7C8CA0", fontSize: 12, fontWeight: "700" },
  logBlock: {},
  logDetail: {
    paddingLeft: 18,
    paddingRight: 4,
    paddingBottom: 10,
    gap: 6,
  },
  macroStrip: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 2,
  },
  macroChip: { fontSize: 12, fontWeight: "800" },
  logItemRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(42,45,53,0.9)",
  },
  logItemName: { color: "#fff", fontSize: 13, fontWeight: "600" },
  logItemAmount: { color: "#55647A", fontSize: 11, marginTop: 1 },
  logItemCal: {
    width: 36,
    textAlign: "right",
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
  },
  logItemMacro: {
    width: 34,
    textAlign: "right",
    fontSize: 12,
    fontWeight: "700",
  },
  blockHead: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2 },
  blockBar: { width: 3, height: 12, borderRadius: 2 },
  blockTitle: {
    color: "#7C8CA0",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.8,
  },
  blockHint: { color: "#55647A", fontSize: 10, fontWeight: "600", marginLeft: 4 },
  addKindBtn: {
    marginTop: 8,
    alignItems: "center",
    paddingVertical: 11,
    borderRadius: 999,
    borderWidth: 1.5,
  },
  addKindText: { fontSize: 13, fontWeight: "800" },
  mealRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(42,45,53,0.7)",
    gap: 8,
  },
  mealMain: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  mealBullet: { width: 6, height: 6, borderRadius: 3 },
  mealTitleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  mealTitle: { color: "#fff", fontSize: 14, fontWeight: "700", flexShrink: 1 },
  mealMacros: { color: "#7C8CA0", fontSize: 12, marginTop: 2, fontWeight: "600" },
  uncertainPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  uncertainPillText: { fontSize: 9, fontWeight: "800" },
  logRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(42,45,53,0.7)",
  },
  logAddBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  logAddText: { fontSize: 12, fontWeight: "800" },
  logTrail: {
    width: LOG_DAY_TRAIL,
    alignItems: "flex-end",
    justifyContent: "center",
  },
  viewPrevBtn: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    borderRadius: 999,
    borderWidth: 1.5,
  },
  viewPrevText: { fontSize: 13, fontWeight: "800" },
  prevBackdrop: {
    flex: 1,
    backgroundColor: "rgba(11,12,16,0.78)",
    justifyContent: "flex-end",
  },
  prevSheet: {
    maxHeight: "88%",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
  },
  prevHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#1E2A38",
  },
  prevTitle: {
    color: "#fff",
    fontSize: 22,
    fontFamily: serif,
    fontStyle: "italic",
    fontWeight: "500",
  },
  prevSub: { color: "#7C8CA0", fontSize: 12, marginTop: 4, fontWeight: "600" },
  prevClose: {
    width: 32,
    height: 32,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  prevBody: { padding: 16, paddingBottom: 40 },
  dayColHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 2,
  },
  dayColHeaderSpacer: { flex: 1, minWidth: 0 },
  dayColHeadCell: {
    width: 14,
    height: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  dayColHeadText: { fontSize: 9, fontWeight: "800", textAlign: "center" },
  dotGrid: {
    flexDirection: "row",
    gap: 3,
    alignItems: "center",
    width: 7 * 14 + 6 * 3,
  },
  dotCell: {
    width: 14,
    height: 14,
    borderRadius: 3,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  dotInner: { width: 6, height: 6, borderRadius: 3 },
  empty: { color: "#55647A", fontSize: 12, paddingVertical: 6 },
  addRow: { flexDirection: "row", gap: 8, marginTop: 8 },
  addAnchor: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 12,
    borderRadius: 999,
    borderWidth: 1.5,
  },
  addAnchorText: { fontSize: 13, fontWeight: "800" },
  addGoTo: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 12,
    borderRadius: 999,
    borderWidth: 1.5,
  },
  addGoToText: { fontSize: 13, fontWeight: "800" },
  fastFoodBox: {
    marginTop: 8,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    gap: 8,
  },
  fastFoodTitle: { color: "#fff", fontSize: 12, fontWeight: "800" },
  placeRow: { gap: 6 },
  placeName: { color: "#fff", fontSize: 13, fontWeight: "700" },
  placeAi: { fontSize: 12, fontWeight: "700" },
  orderChip: {
    padding: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  orderName: { color: "#fff", fontSize: 12, fontWeight: "700" },
  orderMeta: { color: "#7C8CA0", fontSize: 11, marginTop: 2 },
  placeAdd: { flexDirection: "row", alignItems: "center", gap: 8 },
  placeInput: {
    flex: 1,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 10,
    color: "#fff",
  },
  aiHead: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  aiHeadText: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.8,
  },
  aiHeadHint: { color: "#55647A", fontSize: 11, fontWeight: "600" },
  aiLoading: { flexDirection: "row", alignItems: "center", gap: 8 },
  aiLoadingText: { fontSize: 12 },
  aiRow: { gap: 10, paddingRight: 8 },
  aiCard: {
    width: 220,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    gap: 8,
  },
  aiCardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  aiTag: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  aiTagText: { fontSize: 10, fontWeight: "800" },
  aiCal: { color: "#7C8CA0", fontSize: 11, fontWeight: "700" },
  aiTitle: {
    color: "#fff",
    fontSize: 18,
    fontFamily: serif,
    fontStyle: "italic",
    fontWeight: "500",
  },
  aiMacros: { color: "#7C8CA0", fontSize: 12, fontWeight: "600" },
  aiWhy: { fontSize: 11, lineHeight: 15 },
  aiAddBtn: {
    marginTop: 4,
    alignItems: "center",
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
  },
  aiAddText: { fontSize: 12, fontWeight: "800" },
  aiFetchCard: {
    width: 160,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: "flex-start",
    justifyContent: "center",
    gap: 6,
  },
  aiFetchTitle: { color: "#fff", fontSize: 13, fontWeight: "800" },
  aiFetchSub: { color: "#7C8CA0", fontSize: 11 },
});
