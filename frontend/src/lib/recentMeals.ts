/** Pull distinct foods from recent macro logs, optionally filtered by meal slot. */

export type RecentMealPick = {
  key: string;
  name: string;
  calories: number;
  protein: number;
  carbs?: number;
  fats?: number;
  fiber?: number;
  sugar?: number;
  sodium?: number;
  amount?: string;
  meal?: string;
  date?: string;
  uncertain?: boolean;
};

const MEAL_ALIASES: Record<string, string[]> = {
  breakfast: ["breakfast"],
  lunch: ["lunch"],
  dinner: ["dinner"],
  snack: ["snack", "snacks"],
  pre_workout: ["pre-workout", "pre_workout", "preworkout", "shake"],
};

export function normalizeMealLabel(meal?: string | null): string {
  const m = String(meal || "").trim().toLowerCase().replace(/_/g, "-");
  if (!m) return "";
  if (m.includes("breakfast")) return "breakfast";
  if (m.includes("lunch")) return "lunch";
  if (m.includes("dinner")) return "dinner";
  if (m.includes("pre") || m.includes("shake")) return "pre_workout";
  if (m.includes("snack")) return "snack";
  return m;
}

export function displayMealLabel(slot: string): string {
  const s = normalizeMealLabel(slot);
  if (s === "pre_workout") return "Pre-Workout";
  if (s === "snack") return "Snacks";
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "Meal";
}

function dateKeyDaysAgo(daysAgo: number): string {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Normalize Firestore / API dates to YYYY-MM-DD for range compares. */
function normalizeDateKey(raw: unknown): string {
  const s = String(raw || "").trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : "";
}

export function extractRecentMeals(
  macroRows: any[],
  opts: {
    meal?: string | null;
    days?: number;
    excludeToday?: boolean;
    limit?: number;
  } = {}
): RecentMealPick[] {
  const days = opts.days ?? 7;
  const limit = opts.limit ?? 16;
  const want = normalizeMealLabel(opts.meal);
  const today = dateKeyDaysAgo(0);
  const cutoff = dateKeyDaysAgo(days);
  const aliases = want ? MEAL_ALIASES[want] || [want] : null;

  const seen = new Set<string>();
  const out: RecentMealPick[] = [];

  const rows = Array.isArray(macroRows) ? [...macroRows] : [];
  rows.sort((a, b) => String(b?.date || "").localeCompare(String(a?.date || "")));

  for (const row of rows) {
    const date = String(row?.date || "");
    if (!date || date < cutoff) continue;
    if (opts.excludeToday && date === today) continue;
    const foods = Array.isArray(row?.food_items) ? row.food_items : [];
    for (const food of foods) {
      const name = String(food?.name || "").trim();
      if (!name) continue;
      const meal = normalizeMealLabel(food?.meal);
      if (aliases && meal && !aliases.includes(meal) && meal !== want) continue;
      if (aliases && !meal) {
        // Keep untagged foods only when not filtering tightly — skip for slot-specific lists.
        continue;
      }
      const key = `${name.toLowerCase()}|${Math.round(Number(food.calories) || 0)}|${Math.round(Number(food.protein) || 0)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        key,
        name,
        calories: Math.round(Number(food.calories) || 0),
        protein: Math.round((Number(food.protein) || 0) * 10) / 10,
        carbs: food.carbs != null ? Number(food.carbs) : undefined,
        fats: food.fats != null ? Number(food.fats) : undefined,
        fiber: food.fiber != null ? Number(food.fiber) : undefined,
        sugar: food.sugar != null ? Number(food.sugar) : undefined,
        sodium: food.sodium != null ? Number(food.sodium) : undefined,
        amount: food.amount ? String(food.amount) : undefined,
        meal: food.meal ? String(food.meal) : displayMealLabel(want || "lunch"),
        date,
        uncertain: Boolean(food.uncertain),
      });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

export type LoggedMealPattern = {
  key: string;
  name: string;
  calories: number;
  protein: number;
  carbs?: number;
  fats?: number;
  fiber?: number;
  amount?: string;
  meal: string;
  /** Times logged in the window. */
  count: number;
  /** Weekdays seen (mon…sun), most frequent first. */
  days: string[];
  /** Mon→Sun presence for the day grid. */
  dayMask: boolean[];
  /** Short label e.g. "3× · M W F" */
  summary: string;
};

const WEEKDAY_SHORT = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const WEEKDAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const WEEKDAY_LETTER: Record<string, string> = {
  mon: "M",
  tue: "T",
  wed: "W",
  thu: "T",
  fri: "F",
  sat: "S",
  sun: "S",
};

function weekdayFromDateKey(date: string): string | null {
  const parts = date.split("-").map(Number);
  if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) return null;
  const d = new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0, 0);
  return WEEKDAY_SHORT[d.getDay()] || null;
}

/**
 * Collapse last N days of logs into repeated meals for a slot.
 * Sorted by frequency so common eats float up for blueprint mapping.
 */
export function extractLoggedMealPatterns(
  macroRows: any[],
  opts: {
    meal?: string | null;
    days?: number;
    limit?: number;
    minCount?: number;
  } = {}
): LoggedMealPattern[] {
  const days = opts.days ?? 30;
  const limit = opts.limit ?? 20;
  const minCount = opts.minCount ?? 1;
  const want = normalizeMealLabel(opts.meal);
  const cutoff = dateKeyDaysAgo(days);
  const aliases = want ? MEAL_ALIASES[want] || [want] : null;

  type Acc = {
    name: string;
    calories: number;
    protein: number;
    carbs?: number;
    fats?: number;
    fiber?: number;
    amount?: string;
    meal: string;
    count: number;
    dayCounts: Record<string, number>;
  };
  const byKey = new Map<string, Acc>();

  const rows = Array.isArray(macroRows) ? [...macroRows] : [];
  for (const row of rows) {
    const date = String(row?.date || "");
    if (!date || date < cutoff) continue;
    const wd = weekdayFromDateKey(date);
    const foods = Array.isArray(row?.food_items) ? row.food_items : [];
    for (const food of foods) {
      const name = String(food?.name || "").trim();
      if (!name) continue;
      const meal = normalizeMealLabel(food?.meal);
      if (aliases) {
        if (!meal) continue;
        if (!aliases.includes(meal) && meal !== want) continue;
      }
      const cal = Math.round(Number(food.calories) || 0);
      const pro = Math.round((Number(food.protein) || 0) * 10) / 10;
      const key = `${name.toLowerCase()}|${cal}|${Math.round(pro)}`;
      let acc = byKey.get(key);
      if (!acc) {
        acc = {
          name,
          calories: cal,
          protein: pro,
          carbs: food.carbs != null ? Number(food.carbs) : undefined,
          fats: food.fats != null ? Number(food.fats) : undefined,
          fiber: food.fiber != null ? Number(food.fiber) : undefined,
          amount: food.amount ? String(food.amount) : undefined,
          meal: meal || want || "other",
          count: 0,
          dayCounts: {},
        };
        byKey.set(key, acc);
      }
      acc.count += 1;
      if (wd) acc.dayCounts[wd] = (acc.dayCounts[wd] || 0) + 1;
    }
  }

  const out: LoggedMealPattern[] = [];
  for (const [key, acc] of byKey) {
    if (acc.count < minCount) continue;
    const daysSorted = WEEKDAY_ORDER.filter((d) => (acc.dayCounts[d] || 0) > 0).sort(
      (a, b) => (acc.dayCounts[b] || 0) - (acc.dayCounts[a] || 0)
    );
    const dayLetters = daysSorted.map((d) => WEEKDAY_LETTER[d] || d[0]?.toUpperCase()).join(" ");
    const summary =
      acc.count > 1
        ? `${acc.count}×${dayLetters ? ` · ${dayLetters}` : ""}`
        : dayLetters
          ? `1× · ${dayLetters}`
          : "1×";
    out.push({
      key,
      name: acc.name,
      calories: acc.calories,
      protein: acc.protein,
      carbs: acc.carbs,
      fats: acc.fats,
      fiber: acc.fiber,
      amount: acc.amount,
      meal: acc.meal,
      count: acc.count,
      days: daysSorted,
      dayMask: WEEKDAY_ORDER.map((d) => (acc.dayCounts[d] || 0) > 0),
      summary,
    });
  }

  out.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return out.slice(0, limit);
}

function normFoodName(name: string): string {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function foodsMatch(a: string, b: string): boolean {
  const na = normFoodName(a);
  const nb = normFoodName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const ta = new Set(na.split(" ").filter((t) => t.length > 2));
  const tb = nb.split(" ").filter((t) => t.length > 2);
  if (!ta.size || !tb.length) return false;
  const hit = tb.filter((t) => ta.has(t)).length;
  return hit >= Math.min(2, tb.length);
}

/** Public name matcher for plan foods vs logs / go-tos. */
export function foodNamesMatch(a: string, b: string): boolean {
  return foodsMatch(a, b);
}

/** Soft categories for "any yogurt / any shake" when match_similar is on. */
function foodCategories(name: string): string[] {
  const n = normFoodName(name);
  const cats: string[] = [];
  if (/\byogurt|\byoghurt|\boikos|\bfage|\bsiggi|\bchobani|\bactivia/.test(n)) {
    cats.push("yogurt");
  }
  if (
    /\bshake\b|\bpremier protein|\bfairlife|\bprotein drink|\bprotein shake|\bmuscle milk/.test(
      n
    )
  ) {
    cats.push("shake");
  }
  if (/\bmilk\b|\balmond milk|\boat milk|\bskim|\bwhole milk/.test(n) && !cats.includes("shake")) {
    cats.push("milk");
  }
  if (/\boatmeal|\boats\b|\boatmeal/.test(n)) cats.push("oatmeal");
  if (/\begg\b|\beggs\b/.test(n)) cats.push("eggs");
  if (/\bbanana|\bapple|\borange|\bberry|\bberries|\bfruit/.test(n)) cats.push("fruit");
  if (/\bchicken|\bturkey|\bsteak|\bsalmon|\btuna|\btofu/.test(n)) cats.push("protein");
  return cats;
}

function groupMatchesFood(
  group: { names: string[]; matchSimilar?: boolean },
  foodName: string
): boolean {
  if (group.names.some((n) => foodsMatch(n, foodName))) return true;
  if (!group.matchSimilar) return false;
  const foodCats = new Set(foodCategories(foodName));
  if (!foodCats.size) return false;
  for (const n of group.names) {
    for (const c of foodCategories(n)) {
      if (foodCats.has(c)) return true;
    }
  }
  return false;
}

export type PlanFoodGroup = {
  key: string;
  names: string[];
  matchSimilar?: boolean;
};

export type PlanAnchorRef = {
  id?: string;
  label: string;
  foods: string[];
  /** OR-groups for matching; when omitted, each food is its own required slot. */
  groups?: PlanFoodGroup[];
  /** potential / uncertain options are OR (any one counts), not AND. */
  mealKind?: "individual" | "potential" | "uncertain";
  calories?: number | null;
  protein?: number | null;
};

export type PreviousFoodLine = {
  name: string;
  amount?: string;
  calories: number;
  protein: number;
  carbs?: number;
  fats?: number;
  fiber?: number;
};

export type PreviousViewItem = LoggedMealPattern & {
  /** Matched an existing plan meal — show under that anchor name. */
  matchedAnchor?: boolean;
  matchedFoods?: string[];
  /** Full logged foods + macros for expand / hover. */
  items?: PreviousFoodLine[];
  /** Name is already a food on a plan meal — show row but don't offer Add. */
  inPlanFood?: boolean;
};

export type PreviousWeekBucket = {
  id: string;
  label: string;
  start: string;
  end: string;
  items: PreviousViewItem[];
};

function mondayOf(dateKey: string): string {
  const parts = dateKey.split("-").map(Number);
  const d = new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0, 0);
  const day = d.getDay(); // 0 Sun
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function addDaysKey(dateKey: string, days: number): string {
  const parts = dateKey.split("-").map(Number);
  const d = new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0, 0);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function formatWeekLabel(start: string, end: string, thisMon: string): string {
  if (start === thisMon) return "This week";
  if (start === addDaysKey(thisMon, -7)) return "Last week";
  const fmt = (key: string) => {
    const [, m, d] = key.split("-");
    return `${Number(m)}/${Number(d)}`;
  };
  return `${fmt(start)}–${fmt(end)}`;
}

/** Recent Mon–Sun weeks that have (or could have) logs. */
export function listRecentWeekWindows(count = 5): Omit<PreviousWeekBucket, "items">[] {
  const today = dateKeyDaysAgo(0);
  const thisMon = mondayOf(today);
  const out: Omit<PreviousWeekBucket, "items">[] = [];
  for (let i = 0; i < count; i++) {
    const start = addDaysKey(thisMon, -7 * i);
    const end = addDaysKey(start, 6);
    out.push({
      id: start,
      label: formatWeekLabel(start, end, thisMon),
      start,
      end,
    });
  }
  return out;
}

/**
 * Previous view for a meal slot: group log days into plan anchors when the
 * logged foods line up with an anchored meal (e.g. 3 breakfast items → that anchor).
 * Leftover single foods stay as their own rows.
 */
export function extractPreviousGrouped(
  macroRows: any[],
  anchors: PlanAnchorRef[],
  opts: {
    meal?: string | null;
    days?: number;
    limit?: number;
    /** Inclusive YYYY-MM-DD range; when set, overrides `days`. */
    startDate?: string;
    endDate?: string;
  } = {}
): PreviousViewItem[] {
  const days = opts.days ?? 30;
  const limit = opts.limit ?? 24;
  const want = normalizeMealLabel(opts.meal);
  const cutoff = opts.startDate || dateKeyDaysAgo(days);
  const endCap = opts.endDate || dateKeyDaysAgo(0);
  const aliases = want ? MEAL_ALIASES[want] || [want] : null;

  const slotAnchors = (anchors || []).filter(
    (a) =>
      (a.groups || []).some((g) => g.names?.length) ||
      (a.foods || []).some((f) => String(f || "").trim())
  );

  type DayFood = PreviousFoodLine & { anchorId?: string };
  const byDate = new Map<string, DayFood[]>();

  for (const row of Array.isArray(macroRows) ? macroRows : []) {
    const date = normalizeDateKey(row?.date);
    if (!date || date < cutoff || date > endCap) continue;
    const foods = Array.isArray(row?.food_items) ? row.food_items : [];
    for (const food of foods) {
      const name = String(food?.name || "").trim();
      if (!name) continue;
      const meal = normalizeMealLabel(food?.meal);
      if (aliases) {
        // Slot filter: keep tagged meals for this slot. Untagged foods still show
        // so logs without a meal label aren't dropped from Previous / This week.
        if (meal && !aliases.includes(meal) && meal !== want) continue;
      }
      const list = byDate.get(date) || [];
      list.push({
        name,
        calories: Math.round(Number(food.calories) || 0),
        protein: Math.round((Number(food.protein) || 0) * 10) / 10,
        carbs: food.carbs != null ? Number(food.carbs) : undefined,
        fats: food.fats != null ? Number(food.fats) : undefined,
        fiber: food.fiber != null ? Number(food.fiber) : undefined,
        amount: food.amount ? String(food.amount) : undefined,
        anchorId: String(food.anchor_id || food.usual_id || "").trim() || undefined,
      });
      byDate.set(date, list);
    }
  }

  type AnchorAcc = {
    anchor: PlanAnchorRef;
    count: number;
    dayCounts: Record<string, number>;
    matchedFoods: Set<string>;
    items: PreviousFoodLine[];
    calSum: number;
    proSum: number;
    carbSum: number;
    fatSum: number;
  };
  const anchorAcc = new Map<string, AnchorAcc>();
  const leftoverByKey = new Map<
    string,
    {
      name: string;
      calories: number;
      protein: number;
      carbs?: number;
      fats?: number;
      fiber?: number;
      amount?: string;
      count: number;
      dayCounts: Record<string, number>;
      items: PreviousFoodLine[];
    }
  >();

  const groupsFor = (anchor: PlanAnchorRef): PlanFoodGroup[] => {
    // Potential / uncertain: any one option counts as the meal.
    if (anchor.mealKind === "potential" || anchor.mealKind === "uncertain") {
      const names = [
        ...(anchor.groups || []).flatMap((g) => g.names || []),
        ...(anchor.foods || []).map(String),
      ].filter(Boolean);
      const uniq: string[] = [];
      for (const n of names) {
        if (!uniq.some((u) => u.toLowerCase() === n.toLowerCase())) uniq.push(n);
      }
      return uniq.length
        ? [{ key: "options", names: uniq, matchSimilar: false }]
        : [];
    }
    if (anchor.groups?.length) return anchor.groups.filter((g) => g.names?.length);
    return (anchor.foods || [])
      .map(String)
      .filter(Boolean)
      .map((name, i) => ({ key: `solo:${i}`, names: [name], matchSimilar: false }));
  };

  const needHits = (groupCount: number) =>
    groupCount <= 1 ? 1 : groupCount === 2 ? 2 : Math.ceil(groupCount * 0.67);

  /** True when this food is already defined on a plan meal (Add not needed). */
  const coveredByAnchor = (foodName: string) =>
    slotAnchors.some((anchor) =>
      groupsFor(anchor).some((g) => groupMatchesFood(g, foodName))
    );

  for (const [date, dayFoods] of byDate) {
    const wd = weekdayFromDateKey(date);
    const used = new Set<number>();

    // Prefer richer anchors first so multi-item meals claim their foods.
    const ranked = [...slotAnchors].sort(
      (a, b) => groupsFor(b).length - groupsFor(a).length
    );

    for (const anchor of ranked) {
      const groups = groupsFor(anchor);
      if (!groups.length && !anchor.id) continue;

      // Explicit tag / import — treat as a full match for that plan meal.
      if (anchor.id) {
        const taggedIdx: number[] = [];
        const taggedFoods: PreviousFoodLine[] = [];
        dayFoods.forEach((food, i) => {
          if (used.has(i)) return;
          if (food.anchorId && food.anchorId === anchor.id) {
            taggedIdx.push(i);
            taggedFoods.push(food);
          }
        });
        if (taggedFoods.length) {
          const key = `anchor:${anchor.id || normFoodName(anchor.label)}`;
          let acc = anchorAcc.get(key);
          if (!acc) {
            acc = {
              anchor,
              count: 0,
              dayCounts: {},
              matchedFoods: new Set(),
              items: [],
              calSum: 0,
              proSum: 0,
              carbSum: 0,
              fatSum: 0,
            };
            anchorAcc.set(key, acc);
          }
          acc.count += 1;
          if (wd) acc.dayCounts[wd] = (acc.dayCounts[wd] || 0) + 1;
          taggedFoods.forEach((f) => acc!.matchedFoods.add(f.name));
          if (taggedFoods.length >= acc.items.length) acc.items = taggedFoods;
          acc.calSum += taggedFoods.reduce((s, f) => s + f.calories, 0);
          acc.proSum += taggedFoods.reduce((s, f) => s + f.protein, 0);
          acc.carbSum += taggedFoods.reduce((s, f) => s + (f.carbs || 0), 0);
          acc.fatSum += taggedFoods.reduce((s, f) => s + (f.fats || 0), 0);
          taggedIdx.forEach((i) => used.add(i));
          continue;
        }
      }

      if (!groups.length) continue;
      const hits: number[] = [];
      const matchedNames: string[] = [];
      const hitFoods: PreviousFoodLine[] = [];
      const claimedGroups = new Set<string>();

      for (const group of groups) {
        for (let i = 0; i < dayFoods.length; i++) {
          if (used.has(i) || hits.includes(i)) continue;
          const food = dayFoods[i];
          if (!groupMatchesFood(group, food.name)) continue;
          hits.push(i);
          matchedNames.push(food.name);
          hitFoods.push(food);
          claimedGroups.add(group.key);
          break;
        }
      }
      if (claimedGroups.size < needHits(groups.length)) continue;

      const key = `anchor:${anchor.id || normFoodName(anchor.label)}`;
      let acc = anchorAcc.get(key);
      if (!acc) {
        acc = {
          anchor,
          count: 0,
          dayCounts: {},
          matchedFoods: new Set(),
          items: [],
          calSum: 0,
          proSum: 0,
          carbSum: 0,
          fatSum: 0,
        };
        anchorAcc.set(key, acc);
      }
      acc.count += 1;
      if (wd) acc.dayCounts[wd] = (acc.dayCounts[wd] || 0) + 1;
      matchedNames.forEach((n) => acc!.matchedFoods.add(n));
      // Keep the richest occurrence as the breakdown sample.
      if (hitFoods.length >= acc.items.length) acc.items = hitFoods;
      const dayCal = hitFoods.reduce((s, f) => s + f.calories, 0);
      const dayPro = hitFoods.reduce((s, f) => s + f.protein, 0);
      const dayCarb = hitFoods.reduce((s, f) => s + (f.carbs || 0), 0);
      const dayFat = hitFoods.reduce((s, f) => s + (f.fats || 0), 0);
      acc.calSum += dayCal;
      acc.proSum += dayPro;
      acc.carbSum += dayCarb;
      acc.fatSum += dayFat;
      hits.forEach((i) => used.add(i));
    }

    dayFoods.forEach((food, i) => {
      if (used.has(i)) return;
      // Always keep leftovers visible — hiding them made "This week" look empty.
      const key = `${normFoodName(food.name)}|${food.calories}|${Math.round(food.protein)}`;
      let acc = leftoverByKey.get(key);
      if (!acc) {
        acc = {
          name: food.name,
          calories: food.calories,
          protein: food.protein,
          carbs: food.carbs,
          fats: food.fats,
          fiber: food.fiber,
          amount: food.amount,
          count: 0,
          dayCounts: {},
          items: [food],
        };
        leftoverByKey.set(key, acc);
      }
      acc.count += 1;
      if (wd) acc.dayCounts[wd] = (acc.dayCounts[wd] || 0) + 1;
    });
  }

  const toItem = (
    key: string,
    name: string,
    calories: number,
    protein: number,
    count: number,
    dayCounts: Record<string, number>,
    extra: Partial<PreviousViewItem> = {}
  ): PreviousViewItem => {
    const daysSorted = WEEKDAY_ORDER.filter((d) => (dayCounts[d] || 0) > 0).sort(
      (a, b) => (dayCounts[b] || 0) - (dayCounts[a] || 0)
    );
    const dayLetters = daysSorted.map((d) => WEEKDAY_LETTER[d] || "").join(" ");
    return {
      key,
      name,
      calories,
      protein,
      meal: want || "other",
      count,
      days: daysSorted,
      dayMask: WEEKDAY_ORDER.map((d) => (dayCounts[d] || 0) > 0),
      summary: `${count}×${dayLetters ? ` · ${dayLetters}` : ""}`,
      ...extra,
    };
  };

  const out: PreviousViewItem[] = [];
  for (const [key, acc] of anchorAcc) {
    const foods = acc.anchor.foods || [];
    const avgCal =
      Number(acc.anchor.calories) ||
      (acc.count ? Math.round(acc.calSum / acc.count) : 0);
    const avgPro =
      Number(acc.anchor.protein) ||
      (acc.count ? Math.round((acc.proSum / acc.count) * 10) / 10 : 0);
    out.push(
      toItem(key, acc.anchor.label, avgCal, avgPro, acc.count, acc.dayCounts, {
        matchedAnchor: true,
        matchedFoods: Array.from(acc.matchedFoods),
        amount: foods.length ? foods.join(", ") : undefined,
        carbs: acc.count ? Math.round((acc.carbSum / acc.count) * 10) / 10 : undefined,
        fats: acc.count ? Math.round((acc.fatSum / acc.count) * 10) / 10 : undefined,
        items: acc.items,
      })
    );
  }
  for (const [key, acc] of leftoverByKey) {
    out.push(
      toItem(key, acc.name, acc.calories, acc.protein, acc.count, acc.dayCounts, {
        matchedAnchor: false,
        inPlanFood: coveredByAnchor(acc.name),
        carbs: acc.carbs,
        fats: acc.fats,
        fiber: acc.fiber,
        amount: acc.amount,
        items: acc.items,
      })
    );
  }

  out.sort((a, b) => {
    if (a.matchedAnchor !== b.matchedAnchor) return a.matchedAnchor ? -1 : 1;
    return b.count - a.count || a.name.localeCompare(b.name);
  });
  return out.slice(0, limit);
}

/** Previous logs split into recent calendar weeks (Mon–Sun). */
export function extractPreviousByWeek(
  macroRows: any[],
  anchors: PlanAnchorRef[],
  opts: { meal?: string | null; weeks?: number; limitPerWeek?: number } = {}
): PreviousWeekBucket[] {
  const weeks = opts.weeks ?? 5;
  const windows = listRecentWeekWindows(weeks);
  return windows
    .map((w) => ({
      ...w,
      items: extractPreviousGrouped(macroRows, anchors, {
        meal: opts.meal,
        startDate: w.start,
        endDate: w.end,
        limit: opts.limitPerWeek ?? 24,
      }),
    }))
    .filter((w) => w.items.length > 0);
}

/** Active plan slots that are uncertain / eat-out / have varies anchors. */
export function uncertainSlotsFromPlan(plan: any): string[] {
  if (!plan) return [];
  const out = new Set<string>();
  for (const p of plan.slot_profiles || []) {
    const stance = String(p?.stance || "");
    const slot = normalizeMealLabel(p?.slot);
    if ((stance === "uncertain" || stance === "eat_out") && (slot === "lunch" || slot === "dinner")) {
      out.add(slot);
    }
  }
  for (const a of plan.meal_anchors || []) {
    if (!a?.varies) continue;
    const slot = normalizeMealLabel(a?.slot);
    if (slot === "lunch" || slot === "dinner") out.add(slot);
  }
  return Array.from(out);
}
