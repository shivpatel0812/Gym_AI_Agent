import { useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { colors } from "../../theme";
import { bp } from "../../lib/blueprintTheme";
import Ring from "../nutrition/Ring";
import { FoodItem, NutritionTargets } from "../nutrition/types";
import {
  GoToItem,
  MealAnchor,
  NutritionPlan,
  mealAnchorKind,
  sumGroupedFoodMacros,
} from "../../api/nutritionPlan";
import { normalizeMealLabel } from "../../lib/recentMeals";
import { foodQuantity } from "../../lib/foodQuantity";
import {
  HOME_MEALS,
  HomeMealId,
  currentMealId,
  mealSlotOpenToday,
  planItemAppliesToday,
  slotToMealId,
  sortAnchorsForToday,
  todayWeekdayKey,
} from "../../lib/mealSlots";

type MealKind = "individual" | "potential" | "uncertain";

function pickPrimaryAnchor(anchors: MealAnchor[]): MealAnchor | undefined {
  return sortAnchorsForToday(anchors)[0];
}

function kindAccent(kind: MealKind) {
  if (kind === "uncertain") return bp.uncertain;
  if (kind === "potential") return bp.potential;
  return colors.accentPrimary;
}

function kindKicker(kind: MealKind) {
  if (kind === "uncertain") return "Uncertain";
  if (kind === "potential") return "Potential";
  return "Current anchor";
}

const SLOT_ICONS: Record<string, keyof typeof MaterialCommunityIcons.glyphMap> = {
  breakfast: "coffee-outline",
  shake: "cup",
  pre_workout: "dumbbell",
  lunch: "food-fork-drink",
  snack: "food-apple-outline",
  dinner: "silverware-fork-knife",
  late_night: "weather-night",
  other: "food",
};

function mealMacros(foods: FoodItem[]) {
  return foods.reduce(
    (acc, f) => ({
      calories: acc.calories + (Number(f.calories) || 0),
      protein: acc.protein + (Number(f.protein) || 0),
    }),
    { calories: 0, protein: 0 }
  );
}

function anchorLogged(anchor: MealAnchor, foods: FoodItem[]) {
  const id = anchor.id;
  if (id && foods.some((f) => f.anchor_id === id || f.usual_id === id)) return true;
  const names = (anchor.foods || [])
    .map((f) => String(f.name || "").trim().toLowerCase())
    .filter(Boolean);
  if (!names.length) return false;
  const logged = new Set(foods.map((f) => String(f.name || "").trim().toLowerCase()));
  return names.every((n) => logged.has(n) || [...logged].some((l) => l.includes(n) || n.includes(l)));
}

function goToLogged(item: GoToItem, foods: FoodItem[]) {
  return goToCount(item, foods) > 0;
}

/** How many units of a go-to are on today's log (0 when not logged). */
function goToCount(item: GoToItem, foods: FoodItem[]) {
  const tagged = item.id
    ? foods.find((f) => f.usual_id === item.id || f.anchor_id === item.id)
    : undefined;
  if (tagged) return foodQuantity(tagged);
  const name = String(item.name || "").trim().toLowerCase();
  if (!name) return 0;
  const byName = foods.find(
    (f) => String(f.name || "").trim().toLowerCase() === name
  );
  return byName ? foodQuantity(byName) : 0;
}

export default function TodayFoodLog({
  plan,
  targets,
  todayFoods,
  loggingId,
  onLogMeal,
  onLogFoods,
  onRepeatFoods,
  onRemoveTag,
  onBumpFood,
}: {
  plan: NutritionPlan | null;
  targets: NutritionTargets;
  todayFoods: FoodItem[];
  loggingId: string | null;
  onLogMeal: (meal: HomeMealId, uncertain?: boolean) => void;
  onLogFoods: (foods: FoodItem[]) => Promise<void> | void;
  onRepeatFoods?: (foods: FoodItem[]) => Promise<void> | void;
  onRemoveTag: (tag: string) => Promise<void> | void;
  /** Change the logged count of a tagged item; `base` is the per-unit food. */
  onBumpFood?: (tag: string, delta: number, base: FoodItem) => Promise<void> | void;
}) {
  const [anchorMenuMeal, setAnchorMenuMeal] = useState<HomeMealId | null>(null);
  const [qtyPickerId, setQtyPickerId] = useState<string | null>(null);
  /** Meal the active go-to will log under (defaults to the current time window). */
  const [goToMeal, setGoToMeal] = useState<HomeMealId>(currentMealId());
  const now = currentMealId();
  const calTarget = Math.max(targets.calories, 1);
  const proTarget = Math.max(targets.protein, 1);
  const totals = mealMacros(todayFoods);
  const calLeft = Math.max(calTarget - totals.calories, 0);
  const calOver = Math.max(totals.calories - calTarget, 0);
  const proLeft = Math.max(proTarget - totals.protein, 0);
  const pct = Math.min(totals.calories / calTarget, 1);

  const foodsByMeal = useMemo(() => {
    const map: Record<HomeMealId, FoodItem[]> = {
      Breakfast: [],
      Lunch: [],
      "Pre-Workout": [],
      Dinner: [],
      Snacks: [],
    };
    for (const food of todayFoods) {
      const id = food.meal ? slotToMealId(food.meal) : "Snacks";
      map[id].push(food);
    }
    return map;
  }, [todayFoods]);

  const weekday = todayWeekdayKey();

  /** All plan meals for each slot (any day) — used to detect open/uncertain gap days. */
  const allAnchorsByMeal = useMemo(() => {
    const map: Record<HomeMealId, MealAnchor[]> = {
      Breakfast: [],
      Lunch: [],
      "Pre-Workout": [],
      Dinner: [],
      Snacks: [],
    };
    for (const anchor of plan?.meal_anchors || []) {
      map[slotToMealId(anchor.slot)].push(anchor);
    }
    return map;
  }, [plan]);

  const anchorsByMeal = useMemo(() => {
    const map: Record<HomeMealId, MealAnchor[]> = {
      Breakfast: [],
      Lunch: [],
      "Pre-Workout": [],
      Dinner: [],
      Snacks: [],
    };
    (Object.keys(map) as HomeMealId[]).forEach((id) => {
      const all = allAnchorsByMeal[id];
      const today = sortAnchorsForToday(
        all.filter((a) => planItemAppliesToday(a, weekday))
      );
      const solidToday = today.filter((a) => mealAnchorKind(a) !== "uncertain");
      if (solidToday.length) {
        map[id] = solidToday;
        return;
      }
      const uncertainToday = today.filter((a) => mealAnchorKind(a) === "uncertain");
      if (uncertainToday.length) {
        map[id] = uncertainToday;
        return;
      }
      // No day-matched row — if the slot has an uncertain meal at all, surface it
      // when today is otherwise open (covers empty/mis-set day masks).
      const uncertainAny = all.filter((a) => mealAnchorKind(a) === "uncertain");
      const profile = (plan?.slot_profiles || []).find((p) =>
        HOME_MEALS.find((m) => m.id === id)?.slots.includes(normalizeMealLabel(p.slot))
      );
      if (
        uncertainAny.length &&
        mealSlotOpenToday(all, today, profile?.stance)
      ) {
        map[id] = sortAnchorsForToday(uncertainAny);
        return;
      }
      map[id] = [];
    });
    return map;
  }, [allAnchorsByMeal, plan, weekday]);

  const goTos = useMemo(
    () =>
      (plan?.go_to_items || []).filter(
        (item) => !item.days?.length || planItemAppliesToday(item, weekday)
      ),
    [plan, weekday]
  );

  const slotIsOpen = (mealId: HomeMealId) => {
    const mealMeta = HOME_MEALS.find((m) => m.id === mealId);
    const profile = (plan?.slot_profiles || []).find((p) =>
      mealMeta?.slots.includes(normalizeMealLabel(p.slot))
    );
    const all = allAnchorsByMeal[mealId] || [];
    const today = (allAnchorsByMeal[mealId] || []).filter((a) =>
      planItemAppliesToday(a, weekday)
    );
    return mealSlotOpenToday(all, today, profile?.stance);
  };

  const anchorFoodItems = (anchor: MealAnchor, mealId: HomeMealId): FoodItem[] =>
    (anchor.foods || [])
      .filter((f) => String(f.name || "").trim())
      .map((f) => ({
        name: String(f.name).trim(),
        amount: f.amount ? String(f.amount) : undefined,
        unit_amount: f.amount ? String(f.amount) : undefined,
        calories: Math.round(Number(f.calories) || 0),
        protein: Number(f.protein) || 0,
        carbs: Number(f.carbs) || 0,
        fats: Number(f.fats) || 0,
        fiber: Number(f.fiber) || 0,
        meal: mealId,
        anchor_id: anchor.id,
        usual_id: anchor.id,
      }));

  const logAnchor = async (anchor: MealAnchor, mealId: HomeMealId) => {
    const kind = mealAnchorKind(anchor);
    if (kind === "uncertain" || !(anchor.foods || []).some((f) => f.name)) {
      onLogMeal(mealId, kind === "uncertain");
      return;
    }
    if (anchorLogged(anchor, foodsByMeal[mealId]) && anchor.id) {
      await onRemoveTag(anchor.id);
      return;
    }
    const items: FoodItem[] = anchorFoodItems(anchor, mealId);
    if (items.length) await onLogFoods(items);
    else onLogMeal(mealId);
  };

  /** One tap always adds — never opens a picker or toggles undo. */
  const logAnchorAdd = async (anchor: MealAnchor, mealId: HomeMealId) => {
    const kind = mealAnchorKind(anchor);
    if (kind === "uncertain" || !(anchor.foods || []).some((f) => f.name)) {
      onLogMeal(mealId, kind === "uncertain");
      return;
    }
    const items = anchorFoodItems(anchor, mealId);
    if (!items.length) {
      onLogMeal(mealId);
      return;
    }
    const logged = anchorLogged(anchor, foodsByMeal[mealId]);
    if (logged && anchor.id && onBumpFood && items.length === 1) {
      await onBumpFood(anchor.id, 1, items[0]);
      return;
    }
    if (logged) {
      const repeat = onRepeatFoods ?? onLogFoods;
      await repeat(items);
      return;
    }
    await onLogFoods(items);
  };

  /**
   * Prefer an explicit picker meal. Else use the go-to's plan slot when it's a
   * real meal; "other"/snack/late_night fall through to the current time window
   * so Quick Add no longer dumps everything into Snacks.
   */
  const resolveGoToMeal = (item: GoToItem, override?: HomeMealId): HomeMealId => {
    if (override) return override;
    const planned = normalizeMealLabel(item.slot);
    if (
      planned === "breakfast" ||
      planned === "lunch" ||
      planned === "dinner" ||
      planned === "pre_workout" ||
      planned === "shake"
    ) {
      return slotToMealId(item.slot);
    }
    return now;
  };

  /** The per-unit food a go-to tile logs. */
  const goToBase = (item: GoToItem, mealId?: HomeMealId): FoodItem => ({
    name: item.name,
    amount: item.amount ? String(item.amount) : undefined,
    unit_amount: item.amount ? String(item.amount) : undefined,
    calories: Math.round(Number(item.calories) || 0),
    protein: Number(item.protein) || 0,
    carbs: Number(item.carbs) || 0,
    fats: Number(item.fats) || 0,
    fiber: Number(item.fiber) || 0,
    meal: resolveGoToMeal(item, mealId),
    usual_id: item.id,
    anchor_id: item.id,
  });

  // Tap +1 into the resolved meal (plan slot or current window). Long-press
  // opens quantity + meal picker.
  const logGoTo = (item: GoToItem, mealId?: HomeMealId) => {
    const base = goToBase(item, mealId);
    if (item.id && onBumpFood) {
      void onBumpFood(item.id, 1, base);
      return;
    }
    if (goToLogged(item, todayFoods) && item.id) {
      void onRemoveTag(item.id);
      return;
    }
    void onLogFoods([base]);
  };

  const logGoToQty = (item: GoToItem, qty: number, mealId: HomeMealId = goToMeal) => {
    const current = goToCount(item, todayFoods);
    const delta = qty - current;
    const base = goToBase(item, mealId);
    if (delta === 0) {
      setQtyPickerId(null);
      return;
    }
    if (delta > 0 && item.id && onBumpFood) {
      void onBumpFood(item.id, delta, base);
    } else if (delta > 0) {
      const foods = Array.from({ length: delta }, () => base);
      void onLogFoods(foods);
    } else if (item.id) {
      const doRemove = async () => {
        await onRemoveTag(item.id!);
        if (qty > 0 && onBumpFood && item.id) {
          void onBumpFood(item.id, qty, base);
        } else if (qty > 0) {
          const foods = Array.from({ length: qty }, () => base);
          void onLogFoods(foods);
        }
      };
      void doRemove();
    }
    setQtyPickerId(null);
  };

  const openGoToPicker = (item: GoToItem, tileId: string) => {
    setGoToMeal(resolveGoToMeal(item));
    setQtyPickerId(tileId);
  };

  const clearGoTo = (item: GoToItem) => {
    if (!item.id || !goToLogged(item, todayFoods)) return;
    void onRemoveTag(item.id);
  };

  return (
    <View style={{ marginBottom: 8 }}>
      <Text style={styles.goLabel}>Food log</Text>
      <View style={styles.budget}>
        <View style={styles.budgetCol}>
          <MaterialCommunityIcons name="fire" size={15} color={colors.accentPrimary} />
          <View>
            <Text style={styles.budgetValue}>
              {Math.round(calOver > 0 ? calOver : calLeft).toLocaleString()}
            </Text>
            <Text style={styles.budgetHint}>{calOver > 0 ? "cal over" : "cal left"}</Text>
          </View>
        </View>
        <View style={styles.budgetDivider} />
        <View style={styles.budgetCol}>
          <View>
            <Text style={styles.budgetValue}>{Math.round(proLeft)}g</Text>
            <Text style={styles.budgetHint}>protein left</Text>
          </View>
        </View>
        <View style={styles.budgetDivider} />
        <View style={styles.budgetGoal}>
          <Ring size={36} stroke={3} progress={pct} color={colors.accentPrimary}>
            <Text style={styles.pct}>{Math.round(pct * 100)}%</Text>
          </Ring>
          <Text style={styles.goalLabel}>of daily{"\n"}goal</Text>
        </View>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.mealRow}
      >
        {HOME_MEALS.map((meal) => {
          const loggedFoods = foodsByMeal[meal.id];
          const macros = mealMacros(loggedFoods);
          const logged = loggedFoods.length > 0;
          const anchors = anchorsByMeal[meal.id];
          const primary = pickPrimaryAnchor(anchors);
          const kind = primary ? mealAnchorKind(primary) : "individual";
          const isNow = now === meal.id;
          const showUncertain =
            (kind === "uncertain" || !primary) && slotIsOpen(meal.id);
          const preview = logged
            ? loggedFoods[0].name + (loggedFoods.length > 1 ? ` +${loggedFoods.length - 1}` : "")
            : primary?.label || (showUncertain ? "Open / TBD" : "Not logged");
          const menuOpen = anchorMenuMeal === meal.id;
          const hasAltAnchors = anchors.length > 1;

          return (
            <View
              key={meal.id}
              style={[
                styles.mealCard,
                logged && styles.mealCardOn,
                isNow && styles.mealCardNow,
                menuOpen && styles.mealCardMenuOpen,
              ]}
            >
              <View style={styles.mealTop}>
                <View
                  style={[
                    styles.dot,
                    logged
                      ? styles.dotOn
                      : showUncertain
                        ? { backgroundColor: bp.uncertain }
                        : kind === "potential"
                          ? { backgroundColor: bp.potential }
                          : styles.dotOff,
                  ]}
                >
                  {logged ? (
                    <MaterialCommunityIcons name="check" size={9} color="#05080F" />
                  ) : null}
                </View>
                <Text style={styles.mealName} numberOfLines={1}>
                  {meal.label}
                </Text>
                {hasAltAnchors ? (
                  <TouchableOpacity
                    style={[styles.mealMenuBtn, menuOpen && styles.mealMenuBtnOn]}
                    onPress={() =>
                      setAnchorMenuMeal(menuOpen ? null : meal.id)
                    }
                    hitSlop={6}
                    accessibilityLabel={`Other ${meal.label} options`}
                  >
                    <MaterialCommunityIcons
                      name="dots-vertical"
                      size={15}
                      color={menuOpen ? colors.accentPrimary : "#7C8CA0"}
                    />
                  </TouchableOpacity>
                ) : null}
              </View>

              <Text style={styles.preview} numberOfLines={2}>
                {preview}
              </Text>
              {logged ? (
                <Text style={styles.macros}>
                  {Math.round(macros.calories)} cal · {Math.round(macros.protein)}g P
                </Text>
              ) : primary && kind !== "uncertain" ? (
                <Text style={styles.macros}>
                  {(() => {
                    const t = sumGroupedFoodMacros(primary.foods || []);
                    return t.calories
                      ? `${Math.round(t.calories)} cal · ${Math.round(t.protein)}g P`
                      : "From your plan";
                  })()}
                </Text>
              ) : (
                <Text style={styles.target}>
                  {showUncertain ? "Open / TBD" : "Log this meal"}
                </Text>
              )}

              {menuOpen ? (
                <View style={styles.anchorMenu}>
                  {anchors.map((anchor, i) => {
                    const aKind = mealAnchorKind(anchor);
                    const aAccent = kindAccent(aKind);
                    const aLogged = anchorLogged(anchor, loggedFoods);
                    const aBusy = Boolean(anchor.id && loggingId === anchor.id);
                    const t = sumGroupedFoodMacros(anchor.foods || []);
                    return (
                      <TouchableOpacity
                        key={anchor.id || anchor.label}
                        style={[
                          styles.anchorMenuItem,
                          i === 0 && styles.anchorMenuItemFirst,
                        ]}
                        onPress={() => {
                          void logAnchorAdd(anchor, meal.id);
                          setAnchorMenuMeal(null);
                        }}
                        disabled={aBusy}
                      >
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={styles.anchorMenuLabel} numberOfLines={1}>
                            {anchor.label}
                          </Text>
                          <Text style={styles.anchorMenuMeta} numberOfLines={1}>
                            {aKind === "uncertain"
                              ? "Open / TBD"
                              : t.calories
                                ? `${Math.round(t.calories)} cal · ${Math.round(t.protein)}g P`
                                : aKind === "potential"
                                  ? "Potential"
                                  : "From plan"}
                          </Text>
                        </View>
                        {aBusy ? (
                          <ActivityIndicator size="small" color={aAccent} />
                        ) : (
                          <Text style={[styles.anchorMenuAction, { color: aAccent }]}>
                            {aLogged ? "+1" : "Log"}
                          </Text>
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ) : null}

              <TouchableOpacity
                style={[
                  styles.mealBtn,
                  logged && styles.mealBtnOn,
                  !logged && showUncertain && { backgroundColor: bp.uncertain },
                  !logged && kind === "potential" && { backgroundColor: bp.potential },
                ]}
                onPress={() => onLogMeal(meal.id, showUncertain && !logged)}
              >
                <Text
                  style={[
                    styles.mealBtnText,
                    logged && styles.mealBtnOnText,
                    !logged &&
                      (showUncertain || kind === "potential") && { color: "#fff" },
                  ]}
                >
                  {logged ? "Add" : "Log"}
                </Text>
              </TouchableOpacity>
            </View>
          );
        })}
      </ScrollView>

      <View style={styles.quickHead}>
        <Text style={styles.goLabel}>Quick add</Text>
        <Text style={styles.quickSub}>Log a meal or food quickly.</Text>
      </View>

      {(() => {
        const currentAnchors = anchorsByMeal[now] || [];
        const current = pickPrimaryAnchor(currentAnchors);
        const mealMeta = HOME_MEALS.find((m) => m.id === now);
        const isPrimaryMeal = now !== "Snacks";
        const openToday = slotIsOpen(now);
        const kind: MealKind = current
          ? mealAnchorKind(current)
          : openToday
            ? "uncertain"
            : "individual";
        // Always show the active meal window (dinner at 9pm, etc.) — not only when a
        // day-matched anchor exists. Open/uncertain days still get a Log card.
        const showCurrent =
          currentAnchors.length > 0 || openToday || isPrimaryMeal;
        if (!showCurrent && !goTos.length) {
          return (
            <Text style={styles.prevEmpty}>
              Add meal anchors and go-tos in your nutrition plan to one-tap them here.
            </Text>
          );
        }
        const multi = currentAnchors.length > 1;
        const accent = kindAccent(
          openToday && (!current || mealAnchorKind(current) === "uncertain")
            ? "uncertain"
            : kind
        );
        const displayKind: MealKind =
          openToday && (!current || mealAnchorKind(current) === "uncertain")
            ? "uncertain"
            : kind;
        const totalsA = current ? sumGroupedFoodMacros(current.foods || []) : null;
        const detail =
          current &&
          !multi &&
          ((current.foods || []).map((f) => f.name).filter(Boolean).join(", ") ||
            (displayKind === "uncertain"
              ? "Open / TBD"
              : displayKind === "potential"
                ? "Pick an option"
                : null));
        const eaten = current ? anchorLogged(current, foodsByMeal[now]) : false;
        const busy = Boolean(current?.id && loggingId === current.id);
        const listAnchors = multi ? currentAnchors.slice(0, 5) : [];

        return (
          <View style={styles.quickRow}>
            {showCurrent ? (
              <View
                style={[
                  styles.anchorCard,
                  multi && styles.anchorCardWide,
                  displayKind === "uncertain" &&
                    !multi && {
                      borderColor: `${bp.uncertain}66`,
                      backgroundColor: bp.uncertainSoft,
                    },
                  displayKind === "potential" &&
                    !multi && {
                      borderColor: `${bp.potential}66`,
                      backgroundColor: bp.potentialSoft,
                    },
                ]}
              >
                <View style={styles.anchorKickerRow}>
                  <View style={[styles.kindDot, { backgroundColor: accent }]} />
                  <Text style={[styles.anchorKicker, { color: accent }]}>
                    {multi
                      ? `Today's ${mealMeta?.label || "meal"}`
                      : kindKicker(displayKind)}
                  </Text>
                </View>

                {multi ? (
                  <>
                    <Text style={styles.anchorTitle} numberOfLines={1}>
                      {mealMeta?.label || "Meal"}
                    </Text>
                    <Text style={styles.anchorMacros} numberOfLines={1}>
                      {currentAnchors.length} plan meals · {mealMeta?.window || ""}
                    </Text>
                    {listAnchors.map((anchor) => {
                      const aKind = mealAnchorKind(anchor);
                      const aAccent = kindAccent(aKind);
                      const aEaten = anchorLogged(anchor, foodsByMeal[now]);
                      const aBusy = Boolean(anchor.id && loggingId === anchor.id);
                      const macros = sumGroupedFoodMacros(anchor.foods || []);
                      return (
                        <TouchableOpacity
                          key={anchor.id || anchor.label}
                          style={styles.extraAnchor}
                          onPress={() => logAnchor(anchor, now)}
                          disabled={aBusy}
                        >
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <Text style={styles.extraAnchorText} numberOfLines={1}>
                              {anchor.label}
                            </Text>
                            <Text style={styles.anchorMacros} numberOfLines={1}>
                              {aKind === "uncertain"
                                ? "Uncertain · Open / TBD"
                                : macros.calories
                                  ? `${Math.round(macros.calories)} cal · ${Math.round(macros.protein)}g P`
                                  : aKind === "potential"
                                    ? "Potential"
                                    : "From plan"}
                            </Text>
                          </View>
                          {aBusy ? (
                            <ActivityIndicator size="small" color={aAccent} />
                          ) : (
                            <Text style={[styles.extraAnchorAction, { color: aAccent }]}>
                              {aEaten ? "Undo" : "Log"}
                            </Text>
                          )}
                        </TouchableOpacity>
                      );
                    })}
                  </>
                ) : (
                  <>
                    <Text style={styles.anchorTitle} numberOfLines={1}>
                      {current?.label || mealMeta?.label || "Meal"}
                    </Text>
                    {detail ? (
                      <Text style={styles.anchorDetail} numberOfLines={2}>
                        {detail}
                      </Text>
                    ) : displayKind === "uncertain" ? (
                      <Text style={styles.anchorDetail} numberOfLines={2}>
                        Log when you know
                      </Text>
                    ) : null}
                    <Text style={styles.anchorMacros} numberOfLines={1}>
                      {displayKind === "uncertain"
                        ? mealMeta?.window || "Open meal"
                        : totalsA && totalsA.calories
                          ? `${Math.round(totalsA.calories)} cal · ${Math.round(totalsA.protein)}g P`
                          : mealMeta?.window || ""}
                    </Text>
                    <TouchableOpacity
                      style={[
                        styles.anchorLogBtn,
                        { backgroundColor: accent },
                        eaten && styles.anchorLogBtnOn,
                        eaten && { borderColor: accent },
                      ]}
                      onPress={() => onLogMeal(now, displayKind === "uncertain")}
                      disabled={busy}
                    >
                      {busy ? (
                        <ActivityIndicator size="small" color={eaten ? accent : "#fff"} />
                      ) : (
                        <>
                          <MaterialCommunityIcons
                            name={eaten ? "check" : "plus"}
                            size={16}
                            color={eaten ? accent : "#fff"}
                          />
                          <Text style={[styles.anchorLogText, eaten && { color: accent }]}>
                            {eaten ? "Undo" : displayKind === "uncertain" ? "Log" : "Log this"}
                          </Text>
                        </>
                      )}
                    </TouchableOpacity>
                  </>
                )}
              </View>
            ) : null}

            <View style={[styles.goCard, !showCurrent && { flex: 1 }]}>
              <Text style={styles.goTitle} numberOfLines={1}>
                Go-to items{" "}
                <Text style={styles.goAnytime}>
                  → {HOME_MEALS.find((m) => m.id === now)?.label || now}
                </Text>
              </Text>
              {goTos.length ? (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.goRow}
                >
                  {goTos.map((item, i) => {
                    const count = goToCount(item, todayFoods);
                    const on = count > 0;
                    const icon = SLOT_ICONS[normalizeMealLabel(item.slot) || "other"] || "food";
                    const tileId = item.id || `${item.name}-${i}`;
                    const showQty = qtyPickerId === tileId;
                    return (
                      <TouchableOpacity
                        key={tileId}
                        style={[styles.goTile, on && styles.goTileOn, showQty && styles.goTileSelected]}
                        onPress={() => logGoTo(item)}
                        onLongPress={() =>
                          showQty ? setQtyPickerId(null) : openGoToPicker(item, tileId)
                        }
                        delayLongPress={300}
                        accessibilityLabel={
                          on
                            ? `${item.name}, ${count} logged. Tap +1 to ${now}, hold for quantity and meal.`
                            : `${item.name}. Tap to log to ${now}, hold for quantity and meal.`
                        }
                      >
                        <View style={[styles.goIcon, on && styles.goIconOn]}>
                          <MaterialCommunityIcons
                            name={icon}
                            size={16}
                            color={on ? "#05080F" : "#fff"}
                          />
                        </View>
                        <Text style={[styles.goName, on && styles.goNameOn]} numberOfLines={2}>
                          {item.name}
                        </Text>
                        {count > 0 ? (
                          <View style={styles.goCountBadge}>
                            <Text style={styles.goCountText}>×{count}</Text>
                          </View>
                        ) : null}
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              ) : (
                <Text style={styles.prevEmpty}>No go-tos yet.</Text>
              )}
              {(() => {
                const activeItem = qtyPickerId
                  ? goTos.find((g, j) => (g.id || `${g.name}-${j}`) === qtyPickerId)
                  : null;
                if (!activeItem) return null;
                const cnt = goToCount(activeItem, todayFoods);
                return (
                  <View style={styles.qtyBarWrap}>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.mealPickRow}
                    >
                      {HOME_MEALS.map((meal) => {
                        const on = goToMeal === meal.id;
                        return (
                          <TouchableOpacity
                            key={meal.id}
                            style={[styles.mealPickChip, on && styles.mealPickChipOn]}
                            onPress={() => setGoToMeal(meal.id)}
                          >
                            <Text style={[styles.mealPickText, on && styles.mealPickTextOn]}>
                              {meal.short}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </ScrollView>
                    <View style={styles.qtyBar}>
                      <Text style={styles.qtyBarLabel} numberOfLines={1}>
                        {activeItem.name}
                      </Text>
                      <View style={styles.qtyRow}>
                        <TouchableOpacity
                          style={styles.qtyStepBtn}
                          onPress={() => cnt > 0 && logGoToQty(activeItem, cnt - 1, goToMeal)}
                          disabled={cnt <= 0}
                        >
                          <MaterialCommunityIcons name="minus" size={14} color={cnt > 0 ? "#fff" : "#3A4554"} />
                        </TouchableOpacity>
                        <View style={styles.qtyValueBox}>
                          <Text style={styles.qtyValueText}>{cnt}</Text>
                        </View>
                        <TouchableOpacity
                          style={styles.qtyStepBtn}
                          onPress={() => logGoToQty(activeItem, cnt + 1, goToMeal)}
                        >
                          <MaterialCommunityIcons name="plus" size={14} color="#fff" />
                        </TouchableOpacity>
                      </View>
                      <TouchableOpacity
                        style={styles.qtyDoneBtn}
                        onPress={() => {
                          // Apply meal retarget even if quantity unchanged.
                          if (cnt > 0 && activeItem.id && onBumpFood) {
                            void onBumpFood(activeItem.id, 0, goToBase(activeItem, goToMeal));
                          }
                          setQtyPickerId(null);
                        }}
                      >
                        <Text style={styles.qtyDoneText}>Done</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })()}
            </View>
          </View>
        );
      })()}
    </View>
  );
}

const styles = StyleSheet.create({
  budget: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 10,
    marginBottom: 10,
  },
  budgetCol: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 2,
  },
  budgetValue: { color: "#fff", fontSize: 18, fontWeight: "800", letterSpacing: -0.3 },
  budgetHint: { color: colors.textSecondary, fontSize: 10, fontWeight: "600", marginTop: 1 },
  budgetDivider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: "stretch",
    backgroundColor: colors.border,
    marginVertical: 2,
  },
  budgetGoal: {
    flex: 1.15,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingLeft: 4,
  },
  pct: { color: "#fff", fontSize: 10, fontWeight: "800" },
  goalLabel: { color: colors.textSecondary, fontSize: 10, fontWeight: "600", lineHeight: 13 },
  mealRow: { gap: 6, paddingRight: 6, paddingBottom: 2 },
  mealCard: {
    width: 128,
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 8,
    minHeight: 108,
  },
  mealCardOn: { borderColor: "rgba(74,222,128,0.45)" },
  mealCardNow: { borderColor: "rgba(156,192,232,0.55)" },
  mealCardMenuOpen: { borderColor: "rgba(156,192,232,0.7)" },
  mealTop: { flexDirection: "row", alignItems: "center", gap: 5 },
  mealMenuBtn: {
    width: 22,
    height: 22,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  mealMenuBtnOn: { backgroundColor: "rgba(156,192,232,0.14)" },
  anchorMenu: {
    marginTop: 6,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: "#0E1218",
  },
  anchorMenuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 7,
    paddingHorizontal: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  anchorMenuItemFirst: { borderTopWidth: 0 },
  anchorMenuLabel: { color: "#fff", fontSize: 11, fontWeight: "700" },
  anchorMenuMeta: { color: "#7C8CA0", fontSize: 9, fontWeight: "600", marginTop: 1 },
  anchorMenuAction: { fontSize: 10, fontWeight: "800" },
  kindDot: { width: 6, height: 6, borderRadius: 3 },
  dot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: "#3A4554",
    alignItems: "center",
    justifyContent: "center",
  },
  dotOn: { backgroundColor: "#4ADE80", borderColor: "#4ADE80" },
  dotOff: {},
  dotMaybe: { borderColor: "#A78BFA" },
  mealName: { color: "#fff", fontSize: 12, fontWeight: "800", flex: 1 },
  preview: { color: "#fff", fontSize: 11, fontWeight: "700", marginTop: 5, lineHeight: 14, minHeight: 28 },
  macros: { color: "#7C8CA0", fontSize: 10, fontWeight: "600", marginTop: 2 },
  target: { color: "#55647A", fontSize: 10, fontWeight: "600", marginTop: 2 },
  mealBtn: {
    marginTop: 7,
    backgroundColor: "#9CC0E8",
    borderRadius: 8,
    paddingVertical: 5,
    alignItems: "center",
  },
  mealBtnOn: { backgroundColor: colors.accentPrimary },
  mealBtnText: { color: colors.onAccent, fontSize: 11, fontWeight: "800" },
  mealBtnOnText: { color: colors.onAccent },
  prevEmpty: { color: "#55647A", fontSize: 12, lineHeight: 16, marginBottom: 8, paddingHorizontal: 2 },
  quickHead: { marginTop: 6, marginBottom: 8 },
  quickSub: { color: "#55647A", fontSize: 12, fontWeight: "600", marginTop: -4 },
  quickRow: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: 8,
    marginBottom: 4,
  },
  anchorCard: {
    width: 148,
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: "rgba(156,192,232,0.35)",
    borderRadius: 14,
    padding: 10,
  },
  anchorCardWide: {
    width: 168,
  },
  anchorKickerRow: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 4 },
  anchorKicker: {
    color: colors.accentPrimary,
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  anchorTitle: { color: "#fff", fontSize: 14, fontWeight: "800" },
  anchorDetail: { color: "#8E8E93", fontSize: 11, fontWeight: "600", marginTop: 3, lineHeight: 14, minHeight: 28 },
  anchorMacros: { color: "#7C8CA0", fontSize: 10, fontWeight: "600", marginTop: 4 },
  anchorLogBtn: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: colors.accentPrimary,
  },
  anchorLogBtnOn: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: colors.border,
  },
  anchorLogText: { color: "#fff", fontSize: 11, fontWeight: "800" },
  anchorLogTextOn: { color: colors.accentPrimary },
  extraAnchor: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  extraAnchorText: { color: "#fff", fontSize: 11, fontWeight: "700", flex: 1, marginRight: 6 },
  extraAnchorAction: { color: colors.accentPrimary, fontSize: 11, fontWeight: "800" },
  goCard: {
    flex: 1,
    minWidth: 0,
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingVertical: 10,
    paddingLeft: 10,
    paddingRight: 6,
    justifyContent: "center",
  },
  goTitle: { color: "#fff", fontSize: 12, fontWeight: "800", marginBottom: 8 },
  goAnytime: { color: "#55647A", fontSize: 10, fontWeight: "600" },
  goLabel: {
    color: "#7C8CA0",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.4,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  goRow: { gap: 6, paddingRight: 4, alignItems: "flex-start" },
  goTile: {
    width: 58,
    alignItems: "center",
    gap: 4,
  },
  goTileOn: {},
  goCountBadge: {
    position: "absolute",
    top: -5,
    right: 4,
    minWidth: 20,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 10,
    backgroundColor: "#4ADE80",
    borderWidth: 2,
    borderColor: colors.cardBackground,
    alignItems: "center",
    justifyContent: "center",
  },
  goCountText: { color: "#05080F", fontSize: 11, fontWeight: "800" },
  goIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: "#1E2A38",
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  goIconOn: { backgroundColor: "#4ADE80", borderColor: "#4ADE80" },
  goName: { color: "#8E8E93", fontSize: 9, fontWeight: "700", textAlign: "center", lineHeight: 11 },
  goNameOn: { color: "#DCFCE7" },
  goTileSelected: {
    borderWidth: 1,
    borderColor: colors.accentPrimary,
    borderRadius: 8,
  },
  qtyBarWrap: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    gap: 8,
  },
  mealPickRow: {
    gap: 6,
    paddingRight: 4,
  },
  mealPickChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: "#1E2A38",
    borderWidth: 1,
    borderColor: colors.border,
  },
  mealPickChipOn: {
    backgroundColor: "rgba(156,192,232,0.18)",
    borderColor: colors.accentPrimary,
  },
  mealPickText: { color: "#7C8CA0", fontSize: 11, fontWeight: "800" },
  mealPickTextOn: { color: colors.accentPrimary },
  qtyBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  qtyBarLabel: {
    flex: 1,
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
    minWidth: 0,
  },
  qtyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  qtyStepBtn: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1E2A38",
    borderWidth: 1,
    borderColor: colors.border,
  },
  qtyValueBox: {
    minWidth: 28,
    alignItems: "center",
  },
  qtyValueText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "800",
  },
  qtyDoneBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: colors.accentPrimary,
  },
  qtyDoneText: { color: colors.onAccent, fontSize: 11, fontWeight: "800" },
});
