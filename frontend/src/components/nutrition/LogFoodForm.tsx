import { useState, useMemo, useRef, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Image,
  ActivityIndicator,
  ScrollView,
  Alert,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import apiClient from "../../api/client";
import foodDatabase, { FoodDbItem } from "../../data/foodDatabase";
import { colors } from "../../theme";
import { FoodItem, MEALS } from "./types";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  AI_MODEL_STORAGE_KEY,
  DEFAULT_PHOTO_MODEL,
  normalizePhotoModel,
  AiModelId,
} from "../../lib/aiModels";
import {
  displayMealLabel,
  extractRecentMeals,
  normalizeMealLabel,
  RecentMealPick,
} from "../../lib/recentMeals";
import type { MealAnchorFood } from "../../api/nutritionPlan";
import {
  adjustPhotoEstimate,
  COOKING_STYLE_STORAGE_KEY,
  CookingStyle,
  MacroValues,
  PhotoComponent,
  PhotoEstimate,
  PortionChoice,
  normalizeCookingStyle,
  toPhotoEstimate,
  optionalNutrient,
} from "./photoEstimate";
import MacroAdjustChat from "./MacroAdjustChat";
import ScanFoodCamera, { type ScanCapture } from "./ScanFoodCamera";
import PhotoScanResults from "./PhotoScanResults";

export type PlanMealPick = {
  id: string;
  label: string;
  kind: "individual" | "potential" | "uncertain";
  foods: MealAnchorFood[];
  /** e.g. "Mon, Wed" or "Weekdays" */
  schedule?: string;
  /** Whether this anchor applies on the day being logged. */
  appliesToday?: boolean;
  /** Plan slot (breakfast, lunch, …) — shown when listing all plan meals. */
  slot?: string;
};

interface LogFoodFormProps {
  meal: string;
  onAdd: (food: FoodItem) => void;
  /** Import a full anchored meal (multiple foods) in one save. */
  onAddMany?: (foods: FoodItem[]) => void;
  onCancel: () => void;
  /** Prefill uncertain checkbox (e.g. lunch/dinner stance). */
  defaultUncertain?: boolean;
  /** Active plan meals for this slot — import or tag. */
  planMeals?: PlanMealPick[];
  /** Let the user retag breakfast / lunch / … without backing out. */
  onMealChange?: (meal: string) => void;
  /** Tighter layout for the Home sheet. */
  compact?: boolean;
}

function toFoodDbItem(raw: any): FoodDbItem {
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
    sugar: optionalNutrient(raw.sugar),
    sodium: optionalNutrient(raw.sodium),
    aliases: Array.isArray(raw.aliases) ? raw.aliases : [],
  };
}

function foodSearchText(food: FoodDbItem) {
  return [food.name, food.serving, ...(food.aliases || [])]
    .join(" ")
    .toLowerCase();
}

function foodMatchesQuery(food: FoodDbItem, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  const blob = foodSearchText(food);
  if (blob.includes(q)) return true;
  const tokens = q.split(/\s+/).filter((t) => t.length > 2 && !/^\d+$/.test(t));
  return tokens.length > 0 && tokens.every((t) => blob.includes(t));
}

const field = {
  height: 48,
  paddingHorizontal: 16,
  borderRadius: 12,
  backgroundColor: "#05080F",
  borderWidth: 1,
  borderColor: colors.border,
  color: "#fff",
  fontSize: 14,
};

const PLAN_MEALS_COLLAPSED = 2;

function planMealMatchesSlot(slot: string | undefined, activeSlot: string) {
  const candidate = normalizeMealLabel(slot);
  if (activeSlot === "snack") {
    return candidate === "snack" || candidate === "late-night" || candidate === "other";
  }
  return candidate === activeSlot;
}

type PhotoMacroDraft = Record<keyof MacroValues, string>;

const emptyPhotoMacroDraft = (): PhotoMacroDraft => ({
  calories: "",
  protein: "",
  carbs: "",
  fats: "",
  fiber: "",
  sugar: "",
  sodium: "",
});

const photoMacroDraftFrom = (estimate: PhotoEstimate): PhotoMacroDraft => ({
  calories: String(estimate.calories),
  protein: String(estimate.protein),
  carbs: String(estimate.carbs),
  fats: String(estimate.fats),
  fiber: String(estimate.fiber),
  sugar: String(estimate.sugar ?? ""),
  sodium: String(estimate.sodium ?? ""),
});

const parsedPhotoMacroDraft = (draft: PhotoMacroDraft): Partial<MacroValues> => {
  const parsed: Partial<MacroValues> = {};
  (Object.keys(draft) as (keyof MacroValues)[]).forEach((key) => {
    if (!draft[key].trim()) return;
    const value = Number(draft[key]);
    if (Number.isFinite(value) && value >= 0) parsed[key] = value;
  });
  return parsed;
};

export default function LogFoodForm({
  meal,
  onAdd,
  onAddMany,
  onCancel,
  defaultUncertain,
  planMeals = [],
  onMealChange,
  compact = false,
}: LogFoodFormProps) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<FoodDbItem | null>(null);
  const [amountMode, setAmountMode] = useState<"serving" | "custom">("serving");
  const [customGrams, setCustomGrams] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [mode, setMode] = useState<"search" | "photo" | "custom">("photo");
  const [customName, setCustomName] = useState("");
  const [customCalories, setCustomCalories] = useState("");
  const [customProtein, setCustomProtein] = useState("");
  const [customCarbs, setCustomCarbs] = useState("");
  const [customFats, setCustomFats] = useState("");
  const [customFiber, setCustomFiber] = useState("");
  const [customAmount, setCustomAmount] = useState("");
  const [photoTitle, setPhotoTitle] = useState("");
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [photoFileName, setPhotoFileName] = useState("meal.jpg");
  const [photoMimeType, setPhotoMimeType] = useState("image/jpeg");
  const [photoNote, setPhotoNote] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [photoResult, setPhotoResult] = useState<PhotoEstimate | null>(null);
  // Accepting a Fix Results revision REPLACES photoResult, so comparing the
  // logged macros against it afterwards always matches and the correction
  // reads as "no change". The backend needs two corrections before a photo
  // food becomes a calibrated prior, so losing them stalls that forever.
  const [photoRevised, setPhotoRevised] = useState(false);
  const [photoLogId, setPhotoLogId] = useState<string | null>(null);
  const [photoAdjustOpen, setPhotoAdjustOpen] = useState(false);
  const [photoAdvancedOpen, setPhotoAdvancedOpen] = useState(false);
  const [photoPortion, setPhotoPortion] = useState<PortionChoice>("estimated");
  const [cookingStyle, setCookingStyle] = useState<CookingStyle>("normal");
  const [photoMacroDraft, setPhotoMacroDraft] = useState<PhotoMacroDraft>(
    emptyPhotoMacroDraft
  );
  const [photoMacroEdited, setPhotoMacroEdited] = useState(false);
  const [showAdjustChat, setShowAdjustChat] = useState(false);
  const [scanCameraOpen, setScanCameraOpen] = useState(false);
  const [scanResultsOpen, setScanResultsOpen] = useState(false);
  const [aiModel, setAiModel] = useState<AiModelId>(DEFAULT_PHOTO_MODEL);
  const [savedFoods, setSavedFoods] = useState<FoodDbItem[]>([]);
  const [estimating, setEstimating] = useState(false);
  const [estimateError, setEstimateError] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(Boolean(defaultUncertain));
  const [weekMeals, setWeekMeals] = useState<RecentMealPick[]>([]);
  const [tagAnchorId, setTagAnchorId] = useState<string | null>(null);
  const [expandedPotential, setExpandedPotential] = useState<string | null>(null);
  const [planListExpanded, setPlanListExpanded] = useState(false);
  const [activeMeal, setActiveMeal] = useState(meal);
  const estimateQueryRef = useRef("");
  const lastEstimatedRef = useRef("");

  useEffect(() => {
    setActiveMeal(meal);
  }, [meal]);

  useEffect(() => {
    setPlanListExpanded(false);
    setTagAnchorId(null);
    setExpandedPotential(null);
  }, [meal, planMeals.length]);

  const selectMeal = (next: string) => {
    setActiveMeal(next);
    onMealChange?.(next);
  };

  const mealSlot = normalizeMealLabel(activeMeal);
  const showUncertain = mealSlot === "lunch" || mealSlot === "dinner";
  const collapsedPlanMeals = useMemo(() => {
    const slotMatches = planMeals.filter((pick) =>
      planMealMatchesSlot(pick.slot, mealSlot)
    );
    return (slotMatches.length ? slotMatches : planMeals).slice(
      0,
      PLAN_MEALS_COLLAPSED
    );
  }, [mealSlot, planMeals]);

  useEffect(() => {
    // An explicit pick elsewhere still wins; only the unset case changes.
    AsyncStorage.getItem(AI_MODEL_STORAGE_KEY)
      .then((raw) => setAiModel(normalizePhotoModel(raw)))
      .catch(() => {});
    AsyncStorage.getItem(COOKING_STYLE_STORAGE_KEY)
      .then((raw) => setCookingStyle(normalizeCookingStyle(raw)))
      .catch(() => {});
  }, []);

  const selectCookingStyle = (style: CookingStyle) => {
    setCookingStyle(style);
    setPhotoMacroEdited(false);
    AsyncStorage.setItem(COOKING_STYLE_STORAGE_KEY, style).catch(() => {});
  };

  useEffect(() => {
    let cancelled = false;
    apiClient
      .get("/api/macros/foods")
      .then((res) => {
        if (cancelled) return;
        const items = Array.isArray(res.data) ? res.data.map(toFoodDbItem) : [];
        setSavedFoods(items.filter((f) => f.name));
      })
      .catch(() => {});
    if (showUncertain) {
      apiClient
        .get("/api/macros")
        .then((res) => {
          if (cancelled) return;
          setWeekMeals(
            extractRecentMeals(Array.isArray(res.data) ? res.data : [], {
              meal: mealSlot,
              days: 7,
              excludeToday: true,
              limit: 12,
            })
          );
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [showUncertain, mealSlot]);

  useEffect(() => {
    setUncertain(Boolean(defaultUncertain));
  }, [defaultUncertain]);

  useEffect(() => {
    setQuantity(1);
  }, [selected]);

  const catalog = useMemo(() => {
    const byName = new Map<string, FoodDbItem>();
    for (const food of foodDatabase) {
      byName.set(food.name.toLowerCase(), food);
    }
    for (const food of savedFoods) {
      byName.set(food.name.toLowerCase(), food);
    }
    return Array.from(byName.values());
  }, [savedFoods]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return catalog.filter((f) => foodMatchesQuery(f, q)).slice(0, 8);
  }, [query, catalog]);

  const scale = useMemo(() => {
    if (!selected) return 1;
    if (amountMode === "custom") {
      const grams = parseFloat(customGrams);
      if (!grams || grams <= 0) return 0;
      return grams / selected.grams;
    }
    return quantity;
  }, [selected, amountMode, customGrams, quantity]);

  const scaled = useMemo(() => {
    if (!selected) return null;
    return {
      calories: Math.round(selected.calories * scale),
      protein: Math.round(selected.protein * scale),
      carbs: Math.round(selected.carbs * scale),
      fats: Math.round(selected.fats * scale),
      fiber: Math.round((selected.fiber || 0) * scale),
      sugar: selected.sugar == null ? undefined : Math.round(selected.sugar * scale * 10) / 10,
      sodium: selected.sodium == null ? undefined : Math.round(selected.sodium * scale),
    };
  }, [selected, scale]);

  const photoAdjustedBase = useMemo(
    () =>
      photoResult
        ? adjustPhotoEstimate(photoResult, photoPortion, cookingStyle)
        : null,
    [photoResult, photoPortion, cookingStyle]
  );

  const photoDisplayed = useMemo(() => {
    if (!photoResult) return null;
    return adjustPhotoEstimate(
      photoResult,
      photoPortion,
      cookingStyle,
      photoMacroEdited ? parsedPhotoMacroDraft(photoMacroDraft) : null
    );
  }, [photoResult, photoPortion, cookingStyle, photoMacroEdited, photoMacroDraft]);

  useEffect(() => {
    if (photoAdjustedBase && !photoMacroEdited) {
      setPhotoMacroDraft(photoMacroDraftFrom(photoAdjustedBase));
    }
  }, [photoAdjustedBase, photoMacroEdited]);

  const rememberFood = async (
    food: FoodDbItem,
    extraAliases: string[] = [],
    metadata?: { logSource?: "photo"; wasAdjusted?: boolean }
  ) => {
    try {
      const res = await apiClient.post("/api/macros/foods", {
        name: food.name,
        serving: food.serving,
        grams: food.grams,
        calories: food.calories,
        protein: food.protein,
        carbs: food.carbs,
        fats: food.fats,
        fiber: food.fiber || 0,
        sugar: food.sugar,
        sodium: food.sodium,
        aliases: [...(food.aliases || []), ...extraAliases].filter(Boolean),
        log_source: metadata?.logSource,
        was_adjusted: metadata?.wasAdjusted,
      });
      const saved = toFoodDbItem(res.data);
      setSavedFoods((prev) => {
        const rest = prev.filter(
          (f) => f.name.toLowerCase() !== saved.name.toLowerCase()
        );
        return [saved, ...rest];
      });
    } catch (err) {
      console.warn("Could not save food to library", err);
    }
  };

  const estimateFood = async (rawQuery: string) => {
    const q = rawQuery.trim();
    if (q.length < 2 || estimating) return;
    estimateQueryRef.current = q;
    setEstimating(true);
    setEstimateError(null);
    try {
      const res = await apiClient.post(
        "/api/macros/estimate-food",
        { query: q },
        { timeout: 60000 }
      );
      if (estimateQueryRef.current !== q) return;
      const item = toFoodDbItem(res.data);
      if (!item.name) {
        setEstimateError("Could not estimate that food.");
        return;
      }
      setSavedFoods((prev) => {
        const rest = prev.filter(
          (f) => f.name.toLowerCase() !== item.name.toLowerCase()
        );
        return [item, ...rest];
      });
      setSelected(item);
      setAmountMode("serving");
    } catch (error: any) {
      if (estimateQueryRef.current !== q) return;
      setEstimateError(
        error.response?.data?.detail ||
          "Could not estimate that food. Try a clearer name."
      );
    } finally {
      setEstimating(false);
    }
  };

  useEffect(() => {
    if (mode !== "search" || selected) return;
    const q = query.trim();
    if (q.length < 4 || results.length > 0) return;
    if (lastEstimatedRef.current === q) return;
    const timer = setTimeout(() => {
      lastEstimatedRef.current = q;
      void estimateFood(q);
    }, 750);
    return () => clearTimeout(timer);
  }, [query, results.length, selected, mode]);

  const handleAdd = () => {
    if (!selected || !scaled || scale === 0) return;
    const isMultiple = amountMode === "serving" && quantity > 1;
    const amountLabel =
      amountMode === "custom"
        ? `${customGrams}g`
        : isMultiple
          ? `${quantity} × ${selected.serving}`
          : selected.serving;
    onAdd({
      name: selected.name,
      calories: scaled.calories,
      protein: scaled.protein,
      carbs: scaled.carbs,
      fats: scaled.fats,
      fiber: scaled.fiber,
      sugar: scaled.sugar ?? undefined,
      sodium: scaled.sodium ?? undefined,
      meal: activeMeal,
      amount: amountLabel,
      ...(amountMode === "serving"
        ? { quantity, unit_amount: selected.serving }
        : {}),
      uncertain: showUncertain ? uncertain : undefined,
      ...(tagAnchorId
        ? { anchor_id: tagAnchorId, usual_id: tagAnchorId }
        : {}),
    });
    void rememberFood(selected, [query.trim(), amountLabel]);
  };

  const handleAddCustom = () => {
    const name = customName.trim();
    const calories = parseFloat(customCalories);
    const protein = parseFloat(customProtein);
    if (
      !name ||
      !Number.isFinite(calories) ||
      calories < 0 ||
      !Number.isFinite(protein) ||
      protein < 0
    ) {
      return;
    }
    const carbs = parseFloat(customCarbs);
    const fats = parseFloat(customFats);
    const fiber = parseFloat(customFiber);
    onAdd({
      name,
      calories: Math.round(calories),
      protein: Math.round(protein * 10) / 10,
      carbs: Number.isFinite(carbs) && carbs >= 0 ? Math.round(carbs * 10) / 10 : 0,
      fats: Number.isFinite(fats) && fats >= 0 ? Math.round(fats * 10) / 10 : 0,
      fiber: Number.isFinite(fiber) && fiber >= 0 ? Math.round(fiber * 10) / 10 : 0,
      meal: activeMeal,
      amount: customAmount.trim() || undefined,
      uncertain: showUncertain ? uncertain : undefined,
      ...(tagAnchorId
        ? { anchor_id: tagAnchorId, usual_id: tagAnchorId }
        : {}),
    });
    void rememberFood(
      {
        name,
        serving: customAmount.trim() || "1 serving",
        grams: 100,
        calories: Math.round(calories),
        protein: Math.round(protein * 10) / 10,
        carbs: Number.isFinite(carbs) && carbs >= 0 ? Math.round(carbs * 10) / 10 : 0,
        fats: Number.isFinite(fats) && fats >= 0 ? Math.round(fats * 10) / 10 : 0,
        fiber: Number.isFinite(fiber) && fiber >= 0 ? Math.round(fiber * 10) / 10 : 0,
      },
      [name]
    );
  };

  const foodFromPlan = (f: MealAnchorFood, anchorId: string): FoodItem => ({
    name: String(f.name || "Food").trim() || "Food",
    calories: Math.round(Number(f.calories) || 0),
    protein: Math.round((Number(f.protein) || 0) * 10) / 10,
    carbs: f.carbs != null ? Math.round(Number(f.carbs) * 10) / 10 : 0,
    fats: f.fats != null ? Math.round(Number(f.fats) * 10) / 10 : 0,
    fiber: f.fiber != null ? Math.round(Number(f.fiber) * 10) / 10 : 0,
    amount: f.amount ? String(f.amount) : undefined,
    meal: activeMeal,
    anchor_id: anchorId,
    usual_id: anchorId,
    uncertain: showUncertain ? uncertain : undefined,
  });

  const importPlanMeal = (pick: PlanMealPick) => {
    const foods = (pick.foods || [])
      .filter((f) => String(f.name || "").trim())
      .map((f) => foodFromPlan(f, pick.id));
    if (!foods.length) {
      onAdd({
        name: pick.label,
        calories: 0,
        protein: 0,
        meal: activeMeal,
        anchor_id: pick.id,
        usual_id: pick.id,
      });
      return;
    }
    if (onAddMany) onAddMany(foods);
    else foods.forEach((f) => onAdd(f));
  };

  const importPlanOption = (pick: PlanMealPick, food: MealAnchorFood) => {
    onAdd(foodFromPlan(food, pick.id));
  };

  const kindColor = (kind: PlanMealPick["kind"]) =>
    kind === "potential" ? "#E09A45" : kind === "uncertain" ? "#A78BFA" : colors.accentPrimary;

  const kindLabel = (kind: PlanMealPick["kind"]) =>
    kind === "potential" ? "Potential" : kind === "uncertain" ? "Uncertain" : "Anchor";

  const pickPhoto = async (fromCamera: boolean) => {
    if (fromCamera) {
      setPhotoError(null);
      setScanCameraOpen(true);
      return;
    }
    setPhotoError(null);
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        setPhotoError("Photo library permission is needed.");
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.9,
      });
      if (result.canceled || !result.assets?.[0]?.uri) return;
      const asset = result.assets[0];
      await analyzeScanCapture({
        uri: asset.uri,
        fileName: asset.fileName || "meal.jpg",
        mimeType: asset.mimeType || "image/jpeg",
      });
    } catch {
      setPhotoError("Could not open that photo. Try another one.");
    }
  };

  const analyzeScanCapture = async (capture: ScanCapture) => {
    setPhotoUri(capture.uri);
    setPhotoFileName(capture.fileName);
    setPhotoMimeType(capture.mimeType);
    setPhotoResult(null);
    setPhotoRevised(false);
    setPhotoLogId(null);
    setPhotoError(null);
    setAnalyzing(true);
    setScanResultsOpen(false);
    try {
      const payload = new FormData();
      payload.append("file", {
        uri: capture.uri,
        name: capture.fileName,
        type: capture.mimeType,
      } as any);
      const note = photoNote.trim();
      const title = photoTitle.trim();
      if (note) payload.append("description", note);
      if (title) payload.append("title", title);
      payload.append("cooking_style", cookingStyle);
      payload.append("model", aiModel);
      const response = await apiClient.post("/api/macros/analyze-image", payload, {
        timeout: 120000,
        headers: { "Content-Type": "multipart/form-data" },
      });
      if (!acceptPhotoEstimate(response.data, title)) {
        const message =
          response.data?.message ||
          "Could not estimate macros. Try a clearer photo or add a description.";
        setPhotoError(message);
        Alert.alert("Couldn't estimate", message);
        return;
      }
      setScanCameraOpen(false);
      setScanResultsOpen(true);
    } catch (error: any) {
      const message =
        error.response?.data?.detail || "Could not estimate macros. Please try again.";
      setPhotoError(message);
      Alert.alert("Couldn't estimate", String(message));
    } finally {
      setAnalyzing(false);
    }
  };

  const handleScanResultsDone = (
    displayed: PhotoEstimate,
    portion: PortionChoice
  ) => {
    const wasAdjusted =
      photoRevised ||
      portion !== "estimated" ||
      cookingStyle !== photoResult?.analysis.cookingStyle ||
      displayed.calories !== photoResult?.calories;
    onAdd({
      name: displayed.name,
      calories: displayed.calories,
      protein: displayed.protein,
      carbs: displayed.carbs,
      fats: displayed.fats,
      fiber: displayed.fiber,
      sugar: displayed.sugar ?? undefined,
      sodium: displayed.sodium ?? undefined,
      meal: activeMeal,
      amount: displayed.amount,
      uncertain: showUncertain ? uncertain : undefined,
      log_source: "photo",
      was_adjusted: wasAdjusted,
      ...(tagAnchorId
        ? { anchor_id: tagAnchorId, usual_id: tagAnchorId }
        : {}),
    });
    void rememberFood(
      {
        name: displayed.name,
        serving: displayed.amount || "1 serving",
        grams: displayed.estimatedGrams || 100,
        calories: displayed.calories,
        protein: displayed.protein,
        carbs: displayed.carbs,
        fats: displayed.fats,
        fiber: displayed.fiber,
        sugar: displayed.sugar ?? undefined,
        sodium: displayed.sodium ?? undefined,
      },
      [photoTitle.trim(), photoNote.trim()].filter(Boolean),
      {
        logSource: "photo",
        wasAdjusted,
      }
    );
    if (photoLogId) {
      void apiClient
        .post(`/api/macros/photo-logs/${photoLogId}/accepted`, {
          name: displayed.name,
          amount: displayed.amount,
          calories: displayed.calories,
          protein: displayed.protein,
          carbs: displayed.carbs,
          fats: displayed.fats,
          fiber: displayed.fiber,
          sugar: displayed.sugar ?? undefined,
          sodium: displayed.sodium ?? undefined,
        })
        .catch(() => {});
    }
    setScanResultsOpen(false);
    setScanCameraOpen(false);
    resetPhotoEstimate();
  };

  const acceptPhotoEstimate = (raw: any, title: string) => {
    const estimate = toPhotoEstimate(raw, title);
    if (!estimate) return false;
    const withPreference = {
      ...estimate,
      analysis: { ...estimate.analysis, cookingStyle },
    };
    setPhotoResult(withPreference);
    setPhotoLogId(
      typeof raw?.photo_log_id === "string" && raw.photo_log_id.trim()
        ? raw.photo_log_id.trim()
        : null
    );
    setPhotoPortion("estimated");
    setPhotoAdjustOpen(false);
    setPhotoAdvancedOpen(false);
    setPhotoMacroEdited(false);
    setPhotoMacroDraft(photoMacroDraftFrom(withPreference));
    return true;
  };

  const resetPhotoEstimate = () => {
    setPhotoResult(null);
    setPhotoRevised(false);
    setPhotoLogId(null);
    setPhotoUri(null);
    setPhotoFileName("meal.jpg");
    setPhotoMimeType("image/jpeg");
    setPhotoTitle("");
    setPhotoNote("");
    setPhotoError(null);
    setPhotoPortion("estimated");
    setPhotoAdjustOpen(false);
    setPhotoAdvancedOpen(false);
    setPhotoMacroEdited(false);
    setPhotoMacroDraft(emptyPhotoMacroDraft());
    setShowAdjustChat(false);
    setScanCameraOpen(false);
    setScanResultsOpen(false);
  };

  const handleAcceptRevision = (revised: {
    name: string;
    amount?: string | null;
    calories: number;
    protein: number;
    carbs: number;
    fats: number;
    fiber: number;
    sugar?: number;
    sodium?: number;
    components?: PhotoComponent[];
  }) => {
    if (!photoResult) return;
    const updated: PhotoEstimate = {
      ...photoResult,
      name: revised.name || photoResult.name,
      amount: revised.amount || photoResult.amount,
      calories: revised.calories,
      protein: revised.protein,
      carbs: revised.carbs,
      fats: revised.fats,
      fiber: revised.fiber,
      sugar: revised.sugar ?? undefined,
      sodium: revised.sodium ?? undefined,
      analysis: {
        ...photoResult.analysis,
        // The revision re-prices line items, so keeping the old ledger would
        // leave the breakdown contradicting the total it explains.
        components: revised.components?.length
          ? revised.components
          : photoResult.analysis.components,
      },
    };
    setPhotoResult(updated);
    setPhotoRevised(true);
    setPhotoMacroDraft(photoMacroDraftFrom(updated));
    setPhotoMacroEdited(false);
    setPhotoPortion("estimated");
    setShowAdjustChat(false);
  };

  const handleAddPhotoEstimate = () => {
    if (!photoDisplayed) return;
    const wasAdjusted =
      photoRevised ||
      photoPortion !== "estimated" ||
      cookingStyle !== photoResult?.analysis.cookingStyle ||
      photoMacroEdited;
    onAdd({
      name: photoDisplayed.name,
      calories: photoDisplayed.calories,
      protein: photoDisplayed.protein,
      carbs: photoDisplayed.carbs,
      fats: photoDisplayed.fats,
      fiber: photoDisplayed.fiber,
      sugar: photoDisplayed.sugar ?? undefined,
      sodium: photoDisplayed.sodium ?? undefined,
      meal: activeMeal,
      amount: photoDisplayed.amount,
      uncertain: showUncertain ? uncertain : undefined,
      log_source: "photo",
      was_adjusted: wasAdjusted,
      ...(tagAnchorId
        ? { anchor_id: tagAnchorId, usual_id: tagAnchorId }
        : {}),
    });
    void rememberFood(
      {
        name: photoDisplayed.name,
        serving: photoDisplayed.amount || "1 serving",
        grams: photoDisplayed.estimatedGrams || 100,
        calories: photoDisplayed.calories,
        protein: photoDisplayed.protein,
        carbs: photoDisplayed.carbs,
        fats: photoDisplayed.fats,
        fiber: photoDisplayed.fiber,
        sugar: photoDisplayed.sugar ?? undefined,
        sodium: photoDisplayed.sodium ?? undefined,
      },
      [photoTitle.trim(), photoNote.trim()].filter(Boolean),
      {
        logSource: "photo",
        wasAdjusted,
      }
    );

    // Label the archived photo with what was actually committed. The stored
    // estimate is only what the model guessed; this is the number to score a
    // prompt or model change against. Best-effort — never block the log.
    if (photoLogId) {
      void apiClient
        .post(`/api/macros/photo-logs/${photoLogId}/accepted`, {
          name: photoDisplayed.name,
          amount: photoDisplayed.amount,
          calories: photoDisplayed.calories,
          protein: photoDisplayed.protein,
          carbs: photoDisplayed.carbs,
          fats: photoDisplayed.fats,
          fiber: photoDisplayed.fiber,
          sugar: photoDisplayed.sugar ?? undefined,
          sodium: photoDisplayed.sodium ?? undefined,
        })
        .catch(() => {});
    }
  };

  const updatePhotoMacro = (key: keyof MacroValues, value: string) => {
    setPhotoMacroDraft((previous) => ({ ...previous, [key]: value }));
    setPhotoMacroEdited(true);
  };

  const handleEstimateMacros = async () => {
    const note = photoNote.trim();
    const title = photoTitle.trim();
    if (!photoUri && note.length < 2) return;
    setAnalyzing(true);
    setPhotoError(null);
    try {
      if (photoUri) {
        const payload = new FormData();
        payload.append("file", {
          uri: photoUri,
          name: photoFileName,
          type: photoMimeType,
        } as any);
        if (note) payload.append("description", note);
        if (title) payload.append("title", title);
        payload.append("cooking_style", cookingStyle);
        payload.append("model", aiModel);
        const response = await apiClient.post("/api/macros/analyze-image", payload, {
          // A cheap first pass can escalate to a second, stronger one server
          // side, so even the 4o request may take two vision calls.
          timeout: 120000,
          headers: { "Content-Type": "multipart/form-data" },
        });
        if (!acceptPhotoEstimate(response.data, title)) {
          setPhotoError(
            response.data?.message ||
              "Could not estimate macros. Try a clearer photo or add a description."
          );
          return;
        }
        return;
      }
      const res = await apiClient.post(
        "/api/macros/estimate-food",
        { query: note, name: title || undefined, model: aiModel },
        // A described meal now gets the same two-pass treatment as a
        // photographed one, so this request may cost two model calls — the
        // second on a reasoning model. 30s was the old single-cheap-call budget.
        { timeout: 90000 }
      );
      if (!acceptPhotoEstimate(res.data, title)) {
        setPhotoError("Could not estimate that food. Add more detail.");
        return;
      }
    } catch (error: any) {
      setPhotoError(
        error.response?.data?.detail || "Could not estimate macros. Please try again."
      );
    } finally {
      setAnalyzing(false);
    }
  };

  const canAddCustom =
    customName.trim().length > 0 &&
    Number.isFinite(parseFloat(customCalories)) &&
    parseFloat(customCalories) >= 0 &&
    Number.isFinite(parseFloat(customProtein)) &&
    parseFloat(customProtein) >= 0;

  const slotLabel = (slot?: string) => {
    if (!slot) return "";
    const id =
      slot === "pre_workout" || slot === "shake"
        ? "Pre-Workout"
        : slot === "snack" || slot === "late_night" || slot === "other"
          ? "Snacks"
          : MEALS.find((m) => normalizeMealLabel(m.id) === slot)?.label;
    return id || slot;
  };

  const tabBtn = (id: "search" | "photo" | "custom", label: string) => (
    <TouchableOpacity
      key={id}
      onPress={() => {
        setMode(id);
        if (id === "custom" && !customName && query.trim()) setCustomName(query.trim());
      }}
      style={[styles.tab, mode === id && styles.tabActive]}
    >
      <Text style={[styles.tabText, mode === id && styles.tabTextActive]}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={[styles.wrap, compact && { gap: 10 }]}>
      {compact ? null : (
        <View style={styles.rowBetween}>
          <Text style={styles.addTitle}>Add food · {displayMealLabel(activeMeal)}</Text>
          <TouchableOpacity onPress={onCancel}>
            <Text style={styles.cancel}>Cancel</Text>
          </TouchableOpacity>
        </View>
      )}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.mealChips}>
        {MEALS.map((item) => {
          const on = activeMeal === item.id;
          const short =
            item.id === "Pre-Workout" ? "Pre" : item.id === "Breakfast" ? "Bfast" : item.id === "Snacks" ? "Snack" : item.label;
          return (
            <TouchableOpacity
              key={item.id}
              onPress={() => selectMeal(item.id)}
              style={[styles.mealChip, on && styles.mealChipOn]}
            >
              <Text style={[styles.mealChipText, on && styles.mealChipTextOn]}>{short}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {planMeals.length > 0 ? (
        <View style={[styles.planBox, compact && { padding: 8, gap: 6 }]}>
          <View style={styles.planHead}>
            {!compact ? (
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.planTitle}>From your plan</Text>
                <Text style={styles.planHint}>
                  Import a meal, or tap Tag then log food to link it.
                </Text>
              </View>
            ) : (
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.planTitle, { flex: 1 }]}>From your plan</Text>
                <Text style={styles.planHint}>Import, tag, or search any food below.</Text>
              </View>
            )}
            {planMeals.length > PLAN_MEALS_COLLAPSED ? (
              <TouchableOpacity
                style={styles.planExpandBtn}
                onPress={() => setPlanListExpanded((v) => !v)}
                hitSlop={8}
              >
                <Text style={styles.planExpandText}>
                  {planListExpanded
                    ? "Show less"
                    : `Show all (${planMeals.length})`}
                </Text>
                <MaterialCommunityIcons
                  name={planListExpanded ? "chevron-up" : "chevron-down"}
                  size={16}
                  color="#9CC0E8"
                />
              </TouchableOpacity>
            ) : null}
          </View>
          {(planListExpanded ? planMeals : collapsedPlanMeals).map(
            (pick) => {
            const color = kindColor(pick.kind);
            const tagging = tagAnchorId === pick.id;
            const expanded = expandedPotential === pick.id;
            const isOptions = pick.kind === "potential" || pick.kind === "uncertain";
            const foodCount = (pick.foods || []).filter((f) => f.name).length;
            return (
              <View
                key={pick.id}
                style={[styles.planCard, tagging && { borderColor: color }]}
              >
                <View style={styles.planCardTop}>
                  <View style={[styles.planKindDot, { backgroundColor: color }]} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.planName} numberOfLines={1}>
                      {pick.label}
                    </Text>
                    <Text style={styles.planMeta}>
                      {pick.slot ? `${slotLabel(pick.slot)} · ` : ""}
                      {kindLabel(pick.kind)}
                      {pick.schedule ? ` · ${pick.schedule}` : ""}
                      {foodCount
                        ? ` · ${foodCount} ${isOptions ? "option" : "food"}${
                            foodCount === 1 ? "" : "s"
                          }`
                        : ""}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={[
                      styles.planTagBtn,
                      tagging && { backgroundColor: `${color}33`, borderColor: color },
                    ]}
                    onPress={() => setTagAnchorId(tagging ? null : pick.id)}
                  >
                    <Text style={[styles.planTagText, tagging && { color }]}>
                      {tagging ? "Tagged" : "Tag"}
                    </Text>
                  </TouchableOpacity>
                  {isOptions && foodCount > 1 ? (
                    <TouchableOpacity
                      style={styles.planImportBtn}
                      onPress={() =>
                        setExpandedPotential(expanded ? null : pick.id)
                      }
                    >
                      <Text style={[styles.planImportText, { color }]}>
                        {expanded ? "Hide" : "Pick"}
                      </Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      style={[styles.planImportBtn, { borderColor: color }]}
                      onPress={() => importPlanMeal(pick)}
                    >
                      <Text style={[styles.planImportText, { color }]}>Import</Text>
                    </TouchableOpacity>
                  )}
                </View>
                {expanded && isOptions
                  ? (pick.foods || [])
                      .filter((f) => f.name)
                      .map((food, i) => (
                        <TouchableOpacity
                          key={`${food.name}-${i}`}
                          style={styles.planOptionRow}
                          onPress={() => importPlanOption(pick, food)}
                        >
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <Text style={styles.planOptionName} numberOfLines={1}>
                              {food.name}
                            </Text>
                            <Text style={styles.planMeta}>
                              {[
                                food.calories != null
                                  ? `${Math.round(Number(food.calories))} kcal`
                                  : null,
                                food.protein != null
                                  ? `${Math.round(Number(food.protein))}g P`
                                  : null,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </Text>
                          </View>
                          <MaterialCommunityIcons
                            name="plus-circle"
                            size={20}
                            color={color}
                          />
                        </TouchableOpacity>
                      ))
                  : null}
                {!isOptions && foodCount > 1 ? (
                  <Text style={styles.planFoods} numberOfLines={2}>
                    {(pick.foods || [])
                      .map((f) => f.name)
                      .filter(Boolean)
                      .join(", ")}
                  </Text>
                ) : null}
              </View>
            );
          }
          )}
        </View>
      ) : null}

      {showUncertain ? (
        <TouchableOpacity
          style={[styles.uncertainRow, uncertain && styles.uncertainRowOn]}
          onPress={() => setUncertain((v) => !v)}
          activeOpacity={0.8}
        >
          <MaterialCommunityIcons
            name={uncertain ? "checkbox-marked" : "checkbox-blank-outline"}
            size={22}
            color={uncertain ? "#F5C542" : "#7C8CA0"}
          />
          <View style={{ flex: 1 }}>
            <Text style={[styles.uncertainTitle, uncertain && { color: "#F5C542" }]}>
              Uncertain {displayMealLabel(activeMeal).toLowerCase()}
            </Text>
            <Text style={styles.uncertainHint}>
              Different each time — pick from this week or search.
            </Text>
          </View>
        </TouchableOpacity>
      ) : null}

      {showUncertain && uncertain && weekMeals.length > 0 ? (
        <View style={styles.weekBox}>
          <Text style={styles.weekTitle}>Past week · {displayMealLabel(activeMeal)}</Text>
          {weekMeals.map((item) => (
            <TouchableOpacity
              key={item.key}
              style={styles.weekRow}
              onPress={() => {
                onAdd({
                  name: item.name,
                  calories: item.calories,
                  protein: item.protein,
                  carbs: item.carbs,
                  fats: item.fats,
                  fiber: item.fiber,
                  sugar: item.sugar,
                  sodium: item.sodium,
                  amount: item.amount,
                  meal: displayMealLabel(mealSlot),
                  uncertain: true,
                  ...(tagAnchorId
                    ? { anchor_id: tagAnchorId, usual_id: tagAnchorId }
                    : {}),
                });
                void rememberFood(
                  {
                    name: item.name,
                    serving: item.amount || "1 serving",
                    grams: 100,
                    calories: item.calories,
                    protein: item.protein,
                    carbs: item.carbs || 0,
                    fats: item.fats || 0,
                    fiber: item.fiber || 0,
                    sugar: item.sugar,
                    sodium: item.sodium,
                  },
                  [item.name]
                );
              }}
            >
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.weekName} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={styles.weekMeta}>
                  {[
                    item.calories ? `${item.calories} kcal` : null,
                    item.protein ? `${item.protein}g P` : null,
                    item.date,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </Text>
              </View>
              <MaterialCommunityIcons name="plus-circle" size={22} color="#F5C542" />
            </TouchableOpacity>
          ))}
        </View>
      ) : null}

      <View style={styles.tabs}>{["Photo", "Search", "Custom"].map((label, i) =>
        tabBtn((["photo", "search", "custom"] as const)[i], label)
      )}</View>

      {mode === "search" && (
        <View style={{ gap: 12 }}>
          <View>
            <MaterialCommunityIcons
              name="magnify"
              size={16}
              color="#55647A"
              style={styles.searchIcon}
            />
            <TextInput
              value={query}
              onChangeText={(v) => {
                setQuery(v);
                setSelected(null);
                setEstimateError(null);
              }}
              onSubmitEditing={() => {
                if (!selected) void estimateFood(query);
              }}
              placeholder="Search or type 2 belvita crackers..."
              placeholderTextColor="#55647A"
              autoFocus
              style={[field, { paddingLeft: 40, paddingRight: 36 }]}
            />
            {query ? (
              <TouchableOpacity
                style={styles.clearQuery}
                onPress={() => {
                  setQuery("");
                  setSelected(null);
                }}
              >
                <MaterialCommunityIcons name="close" size={15} color="#55647A" />
              </TouchableOpacity>
            ) : null}
          </View>

          {!selected && results.length > 0 && (
            <View style={styles.resultList}>
              {results.map((f) => (
                <TouchableOpacity
                  key={f.name}
                  onPress={() => setSelected(f)}
                  style={styles.resultRow}
                >
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.resultName} numberOfLines={1}>
                      {f.name}
                    </Text>
                    <Text style={styles.mutedXs}>{f.serving}</Text>
                  </View>
                  <View style={styles.macroRow}>
                    <View style={styles.macroCell}>
                      <Text style={[styles.macroVal, { color: "#9CC0E8" }]}>{f.calories}</Text>
                      <Text style={styles.macroUnit}>kcal</Text>
                    </View>
                    <View style={styles.macroCell}>
                      <Text style={[styles.macroVal, { color: "#E4B896" }]}>{f.protein}g</Text>
                      <Text style={styles.macroUnit}>P</Text>
                    </View>
                    <View style={styles.macroCell}>
                      <Text style={[styles.macroVal, { color: "#F5C542" }]}>{f.carbs}g</Text>
                      <Text style={styles.macroUnit}>C</Text>
                    </View>
                    <View style={styles.macroCell}>
                      <Text style={[styles.macroVal, { color: "#C4B5FD" }]}>{f.fats}g</Text>
                      <Text style={styles.macroUnit}>F</Text>
                    </View>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {!selected && query.trim().length >= 2 && results.length > 0 && (
            <TouchableOpacity
              onPress={() => void estimateFood(query)}
              disabled={estimating}
            >
              <Text style={styles.fillLink}>
                {estimating
                  ? "Filling macros..."
                  : `Fill macros for “${query.trim()}”`}
              </Text>
            </TouchableOpacity>
          )}

          {!selected && query && results.length === 0 && (
            <View style={{ alignItems: "center", gap: 8, paddingVertical: 8 }}>
              {estimating ? (
                <Text style={styles.muted}>
                  Filling macros for “{query.trim()}”...
                </Text>
              ) : (
                <>
                  <Text style={styles.muted}>
                    {estimateError || `No saved match for “${query.trim()}”.`}
                  </Text>
                  <TouchableOpacity style={styles.primaryBtn} onPress={() => void estimateFood(query)}>
                    <Text style={styles.primaryBtnText}>Fill macros</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => {
                      setCustomName(query.trim());
                      setMode("custom");
                    }}
                  >
                    <Text style={styles.mutedBold}>Enter macros myself</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          )}

          {selected && scaled && (
            <>
              <View style={styles.selectedBar}>
                <Text style={styles.selectedName}>{selected.name}</Text>
                <TouchableOpacity onPress={() => setSelected(null)} style={styles.changeBtn}>
                  <Text style={styles.cancel}>Change</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.label}>Amount</Text>
              <View style={{ flexDirection: "row", gap: 12 }}>
                <TouchableOpacity
                  onPress={() => setAmountMode("serving")}
                  style={[
                    styles.amountCard,
                    amountMode === "serving" && styles.amountCardOn,
                  ]}
                >
                  <Text
                    style={[
                      styles.amountLabel,
                      amountMode === "serving" && { color: "#9CC0E8" },
                    ]}
                  >
                    Serving
                  </Text>
                  <Text
                    style={[
                      styles.amountVal,
                      amountMode === "serving" && { color: "#9CC0E8" },
                    ]}
                  >
                    {selected.serving}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setAmountMode("custom")}
                  style={[
                    styles.amountCard,
                    amountMode === "custom" && styles.amountCardOn,
                  ]}
                >
                  <Text
                    style={[
                      styles.amountLabel,
                      amountMode === "custom" && { color: "#9CC0E8" },
                    ]}
                  >
                    Custom (g)
                  </Text>
                  <TextInput
                    keyboardType="numeric"
                    value={customGrams}
                    onFocus={() => setAmountMode("custom")}
                    onChangeText={setCustomGrams}
                    placeholder="Enter grams"
                    placeholderTextColor="#55647A"
                    style={{ color: "#fff", fontSize: 14, fontWeight: "600" }}
                  />
                </TouchableOpacity>
              </View>

              {amountMode === "serving" && (
                <View style={styles.qtyRow}>
                  <TouchableOpacity
                    style={[styles.qtyStep, quantity <= 1 && styles.qtyStepOff]}
                    disabled={quantity <= 1}
                    onPress={() => setQuantity((q) => Math.max(1, q - 1))}
                  >
                    <MaterialCommunityIcons
                      name="minus"
                      size={18}
                      color={quantity <= 1 ? "#3A4757" : "#fff"}
                    />
                  </TouchableOpacity>
                  <View style={styles.qtyValueBox}>
                    <Text style={styles.qtyValue}>×{quantity}</Text>
                  </View>
                  <TouchableOpacity
                    style={styles.qtyStep}
                    onPress={() => setQuantity((q) => Math.min(99, q + 1))}
                  >
                    <MaterialCommunityIcons name="plus" size={18} color="#fff" />
                  </TouchableOpacity>
                  <View style={styles.qtyChips}>
                    {[1, 2, 3, 4].map((n) => (
                      <TouchableOpacity
                        key={n}
                        style={[styles.qtyChip, quantity === n && styles.qtyChipOn]}
                        onPress={() => setQuantity(n)}
                      >
                        <Text
                          style={[
                            styles.qtyChipText,
                            quantity === n && styles.qtyChipTextOn,
                          ]}
                        >
                          {n}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              )}

              <View style={{ flexDirection: "row", gap: 8 }}>
                {[
                  ["Calories", scaled.calories, "#9CC0E8"],
                  ["Protein", scaled.protein, "#E4B896"],
                  ["Carbs", scaled.carbs, "#F5C542"],
                  ["Fat", scaled.fats, "#C4B5FD"],
                ].map(([label, val, color]) => (
                  <View key={String(label)} style={styles.scaledBox}>
                    <Text style={[styles.scaledVal, { color: String(color) }]}>
                      {scale === 0 ? "—" : val}
                    </Text>
                    <Text style={styles.mutedXs}>{label}</Text>
                  </View>
                ))}
              </View>
              <TouchableOpacity
                style={[styles.primaryBtn, scale === 0 && { opacity: 0.4 }]}
                disabled={scale === 0}
                onPress={handleAdd}
              >
                <Text style={styles.primaryBtnText}>Add to {activeMeal}</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      )}

      {mode === "photo" && (
        <View style={{ gap: 14 }}>
          {photoResult && photoDisplayed ? (
            <>
              <View style={styles.photoResultCard}>
                <View style={styles.photoResultHead}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.photoResultName}>{photoDisplayed.name}</Text>
                    <Text style={styles.photoResultAmount}>
                      {photoDisplayed.amount || "Estimated portion"}
                    </Text>
                  </View>
                  <Text style={styles.photoEstimatedLabel}>Estimated</Text>
                </View>

                <View style={styles.photoMacroGrid}>
                  {(
                    [
                      ["Calories", photoDisplayed.calories, "kcal", "#9CC0E8"],
                      ["Protein", photoDisplayed.protein, "g", "#E4B896"],
                      ["Carbs", photoDisplayed.carbs, "g", "#F5C542"],
                      ["Fat", photoDisplayed.fats, "g", "#C4B5FD"],
                    ] as const
                  ).map(([label, value, unit, color]) => (
                    <View key={label} style={styles.photoMacroCell}>
                      <Text style={[styles.photoMacroValue, { color }]}>{value}</Text>
                      <Text style={styles.photoMacroUnit}>{unit}</Text>
                      <Text style={styles.mutedXs}>{label}</Text>
                    </View>
                  ))}
                </View>

                {photoDisplayed.analysis.components.length ? (
                  <View style={styles.photoLedger}>
                    <Text style={styles.photoLedgerTitle}>What's counted</Text>
                    {photoDisplayed.analysis.components.map((component, index) => (
                      <View key={`${component.name}-${index}`} style={styles.photoLedgerRow}>
                        <Text style={styles.photoLedgerName} numberOfLines={1}>
                          {component.name}
                          {component.amount ? (
                            <Text style={styles.photoLedgerAmount}>{`  ${component.amount}`}</Text>
                          ) : null}
                        </Text>
                        <Text style={styles.photoLedgerCal}>{component.calories} kcal</Text>
                      </View>
                    ))}
                    <Text style={styles.photoLedgerHint}>
                      Missing something? Tap Refine with AI and tell it what changed.
                    </Text>
                  </View>
                ) : null}

                {photoResult.analysis.confidence.shouldNudge ? (
                  <View style={styles.photoNudge}>
                    <MaterialCommunityIcons name="help-circle-outline" size={18} color="#F5C542" />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.photoNudgeTitle}>Does this look right?</Text>
                      <Text style={styles.photoNudgeText}>
                        {photoResult.analysis.confidence.reasons[0] ||
                          "Portion or cooking oil may be uncertain."}
                      </Text>
                    </View>
                  </View>
                ) : null}

                <View style={styles.photoActionRow}>
                  <TouchableOpacity
                    style={styles.photoFixBtn}
                    onPress={() => setShowAdjustChat(true)}
                  >
                    <MaterialCommunityIcons name="chat-processing-outline" size={15} color="#5EEAD4" />
                    <Text style={styles.photoFixText}>Refine with AI</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.photoAdjustToggle}
                    onPress={() => setPhotoAdjustOpen((open) => !open)}
                  >
                    <MaterialCommunityIcons name="pencil-outline" size={16} color="#9CC0E8" />
                    <Text style={styles.photoAdjustText}>Adjust</Text>
                    <MaterialCommunityIcons
                      name={photoAdjustOpen ? "chevron-up" : "chevron-down"}
                      size={18}
                      color="#7C8CA0"
                    />
                  </TouchableOpacity>
                </View>

                {showAdjustChat && photoResult ? (
                  <MacroAdjustChat
                    estimate={photoResult}
                    model={aiModel}
                    photoLogId={photoLogId}
                    onPhotoLogId={(id) => setPhotoLogId(id)}
                    onAcceptRevision={handleAcceptRevision}
                    onClose={() => setShowAdjustChat(false)}
                  />
                ) : null}

                {photoAdjustOpen ? (
                  <View style={styles.photoAdjustPanel}>
                    <Text style={styles.label}>Portion</Text>
                    <View style={styles.photoChoiceRow}>
                      {(
                        [
                          ["smaller", "Smaller"],
                          ["estimated", "As estimated"],
                          ["larger", "Larger"],
                        ] as const
                      ).map(([value, label]) => {
                        const active = photoPortion === value;
                        return (
                          <TouchableOpacity
                            key={value}
                            style={[styles.photoChoice, active && styles.photoChoiceOn]}
                            onPress={() => {
                              setPhotoPortion(value);
                              setPhotoMacroEdited(false);
                            }}
                          >
                            <Text
                              style={[
                                styles.photoChoiceText,
                                active && styles.photoChoiceTextOn,
                              ]}
                            >
                              {label}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                    {photoResult.estimatedGrams ? (
                      <Text style={styles.photoAdjustHint}>
                        Best estimate {Math.round(photoResult.estimatedGrams)}g
                        {photoResult.analysis.portionLowGrams &&
                        photoResult.analysis.portionHighGrams
                          ? ` · likely ${Math.round(
                              photoResult.analysis.portionLowGrams
                            )}–${Math.round(photoResult.analysis.portionHighGrams)}g`
                          : ""}
                      </Text>
                    ) : null}

                    <Text style={styles.label}>Your usual cooking oil</Text>
                    <View style={styles.photoChoiceRow}>
                      {(
                        [
                          ["light", "Light"],
                          ["normal", "Normal"],
                          ["generous", "Generous"],
                        ] as const
                      ).map(([value, label]) => {
                        const active = cookingStyle === value;
                        return (
                          <TouchableOpacity
                            key={value}
                            style={[styles.photoChoice, active && styles.photoChoiceOn]}
                            onPress={() => selectCookingStyle(value)}
                          >
                            <Text
                              style={[
                                styles.photoChoiceText,
                                active && styles.photoChoiceTextOn,
                              ]}
                            >
                              {label}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                    <Text style={styles.photoAdjustHint}>Remembered for future food photos.</Text>

                    {photoResult.analysis.assumptions.length ||
                    photoResult.analysis.uncertainties.length ? (
                      <Text style={styles.photoAssumption}>
                        {[...photoResult.analysis.assumptions, ...photoResult.analysis.uncertainties]
                          .slice(0, 2)
                          .join(" · ")}
                      </Text>
                    ) : null}

                    <TouchableOpacity
                      style={styles.photoAdvancedToggle}
                      onPress={() => {
                        if (!photoAdvancedOpen && photoDisplayed && !photoMacroEdited) {
                          setPhotoMacroDraft(photoMacroDraftFrom(photoDisplayed));
                        }
                        setPhotoAdvancedOpen((open) => !open);
                      }}
                    >
                      <Text style={styles.photoAdvancedText}>Edit macros</Text>
                      <MaterialCommunityIcons
                        name={photoAdvancedOpen ? "chevron-up" : "chevron-down"}
                        size={17}
                        color="#7C8CA0"
                      />
                    </TouchableOpacity>

                    {photoAdvancedOpen ? (
                      <View style={styles.photoAdvancedGrid}>
                        {(
                          [
                            ["Calories", "calories"],
                            ["Protein (g)", "protein"],
                            ["Carbs (g)", "carbs"],
                            ["Fat (g)", "fats"],
                            ["Fiber (g)", "fiber"],
                            ["Sugar (g)", "sugar"],
                            ["Sodium (mg)", "sodium"],
                          ] as const
                        ).map(([label, key]) => (
                          <View key={key} style={styles.photoAdvancedField}>
                            <Text style={styles.label}>{label}</Text>
                            <TextInput
                              keyboardType="decimal-pad"
                              value={photoMacroDraft[key]}
                              onChangeText={(value) => updatePhotoMacro(key, value)}
                              placeholder="0"
                              placeholderTextColor="#55647A"
                              style={field}
                            />
                          </View>
                        ))}
                      </View>
                    ) : null}
                  </View>
                ) : null}
              </View>

              <TouchableOpacity
                style={styles.primaryBtn}
                onPress={handleAddPhotoEstimate}
              >
                <Text style={styles.primaryBtnText}>Add to {activeMeal}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={resetPhotoEstimate} style={styles.photoStartOver}>
                <Text style={styles.photoStartOverText}>Scan another</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={styles.muted}>
                Point the camera at your plate for a ready-to-log estimate. Fix Results opens a chat on top if anything looks off.
              </Text>
              <Text style={styles.photoTip}>
                Tip: fill the frame with the whole plate in good light.
              </Text>
              {!photoUri ? (
                <View style={{ gap: 12 }}>
                  <TouchableOpacity
                    style={styles.scanLaunchBtn}
                    onPress={() => pickPhoto(true)}
                  >
                    <MaterialCommunityIcons name="camera" size={22} color="#070708" />
                    <Text style={styles.scanLaunchText}>Scan food</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.photoBox} onPress={() => pickPhoto(false)}>
                    <MaterialCommunityIcons name="image" size={22} color="#E4B896" />
                    <Text style={styles.photoBoxText}>Choose from library</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View>
                  <Image source={{ uri: photoUri }} style={styles.preview} />
                  <TouchableOpacity
                    style={styles.removePhoto}
                    onPress={() => {
                      setPhotoUri(null);
                      setPhotoResult(null);
                      setPhotoError(null);
                    }}
                  >
                    <MaterialCommunityIcons name="close" size={16} color="#fff" />
                  </TouchableOpacity>
                </View>
              )}
              <Text style={styles.label}>Food title (optional)</Text>
              <TextInput
                value={photoTitle}
                onChangeText={setPhotoTitle}
                placeholder="e.g. Chickpea frankie"
                placeholderTextColor="#55647A"
                style={field}
              />
              <Text style={styles.label}>Description (optional)</Text>
              <TextInput
                value={photoNote}
                onChangeText={setPhotoNote}
                placeholder="e.g. I had 3, homemade, with chutney"
                placeholderTextColor="#55647A"
                multiline
                style={[field, { height: 84, paddingTop: 12, textAlignVertical: "top" }]}
              />
              {photoError ? <Text style={styles.error}>{photoError}</Text> : null}
              <TouchableOpacity
                style={[
                  styles.primaryBtn,
                  ((!photoUri && photoNote.trim().length < 2) || analyzing) && { opacity: 0.4 },
                ]}
                disabled={(!photoUri && photoNote.trim().length < 2) || analyzing}
                onPress={handleEstimateMacros}
              >
                {analyzing ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <ActivityIndicator color="#fff" />
                    <Text style={styles.primaryBtnText}>Estimating macros...</Text>
                  </View>
                ) : (
                  <Text style={styles.primaryBtnText}>
                    {photoUri ? "Estimate from photo" : "Estimate from description"}
                  </Text>
                )}
              </TouchableOpacity>
            </>
          )}
        </View>
      )}

      {mode === "custom" && (
        <View style={{ gap: 12 }}>
          <Text style={styles.label}>Food name</Text>
          <TextInput
            value={customName}
            onChangeText={setCustomName}
            placeholder="e.g. Homemade protein shake"
            placeholderTextColor="#55647A"
            style={field}
          />
          <Text style={styles.label}>Amount (optional)</Text>
          <TextInput
            value={customAmount}
            onChangeText={setCustomAmount}
            placeholder="e.g. 1 bowl, 200g"
            placeholderTextColor="#55647A"
            style={field}
          />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
            {(
              [
                ["Calories", customCalories, setCustomCalories],
                ["Protein (g)", customProtein, setCustomProtein],
                ["Carbs (g)", customCarbs, setCustomCarbs],
                ["Fat (g)", customFats, setCustomFats],
                ["Fiber (g)", customFiber, setCustomFiber],
              ] as const
            ).map(([label, val, setVal]) => (
              <View key={label} style={{ width: "47%" }}>
                <Text style={styles.label}>{label}</Text>
                <TextInput
                  keyboardType="decimal-pad"
                  value={val}
                  onChangeText={setVal}
                  placeholder="0"
                  placeholderTextColor="#55647A"
                  style={field}
                />
              </View>
            ))}
          </View>
          <TouchableOpacity
            style={[styles.primaryBtn, !canAddCustom && { opacity: 0.4 }]}
            disabled={!canAddCustom}
            onPress={handleAddCustom}
          >
            <Text style={styles.primaryBtnText}>Add to {activeMeal}</Text>
          </TouchableOpacity>
        </View>
      )}

      <ScanFoodCamera
        visible={scanCameraOpen}
        busy={analyzing}
        busyLabel="Estimating macros…"
        onClose={() => {
          if (analyzing) return;
          setScanCameraOpen(false);
        }}
        onCapture={(capture) => {
          void analyzeScanCapture(capture);
        }}
      />

      {photoResult && scanResultsOpen ? (
        <PhotoScanResults
          visible={scanResultsOpen}
          photoUri={photoUri}
          estimate={photoResult}
          model={aiModel}
          photoLogId={photoLogId}
          mealLabel={displayMealLabel(activeMeal)}
          mealSlot={mealSlot}
          onPhotoLogId={(id) => setPhotoLogId(id)}
          onEstimateChange={(next) => {
            setPhotoResult(next);
            setPhotoRevised(true);
            setPhotoMacroDraft(photoMacroDraftFrom(next));
            setPhotoMacroEdited(false);
            setPhotoPortion("estimated");
          }}
          onDone={handleScanResultsDone}
          onClose={() => setScanResultsOpen(false)}
          onRetake={() => {
            setScanResultsOpen(false);
            setPhotoResult(null);
            setPhotoRevised(false);
            setPhotoLogId(null);
            setPhotoUri(null);
            setPhotoError(null);
            setScanCameraOpen(true);
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 16 },
  mealChips: { gap: 6, paddingRight: 4 },
  mealChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#05080F",
  },
  mealChipOn: {
    borderColor: "#9CC0E8",
    backgroundColor: "rgba(156,192,232,0.16)",
  },
  mealChipText: { color: "#7C8CA0", fontSize: 12, fontWeight: "700" },
  mealChipTextOn: { color: "#9CC0E8" },
  uncertainRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#1E2A38",
    backgroundColor: "#12151C",
  },
  uncertainRowOn: {
    borderColor: "rgba(245,197,66,0.45)",
    backgroundColor: "rgba(245,197,66,0.08)",
  },
  uncertainTitle: { color: "#fff", fontSize: 13, fontWeight: "700" },
  uncertainHint: { color: "#55647A", fontSize: 11, marginTop: 2, lineHeight: 15 },
  weekBox: {
    gap: 8,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(245,197,66,0.28)",
    backgroundColor: "rgba(245,197,66,0.05)",
  },
  weekTitle: { color: "#F5C542", fontSize: 12, fontWeight: "800" },
  weekRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: "rgba(245,197,66,0.12)",
  },
  weekName: { color: "#fff", fontSize: 13, fontWeight: "600" },
  weekMeta: { color: "#7C8CA0", fontSize: 11, marginTop: 2 },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  addTitle: { color: "#fff", fontSize: 14, fontWeight: "600" },
  cancel: { color: "#7C8CA0", fontSize: 12, fontWeight: "600" },
  tabs: {
    flexDirection: "row",
    padding: 4,
    borderRadius: 12,
    backgroundColor: "#05080F",
    borderWidth: 1,
    borderColor: colors.border,
  },
  tab: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: "center" },
  tabActive: { backgroundColor: "#9CC0E8" },
  tabText: { color: "#7C8CA0", fontSize: 14, fontWeight: "600" },
  tabTextActive: { color: colors.onAccent },
  searchIcon: { position: "absolute", left: 14, top: 16, zIndex: 1 },
  clearQuery: { position: "absolute", right: 12, top: 16 },
  resultList: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    overflow: "hidden",
  },
  resultRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  resultName: { color: "#fff", fontSize: 14, fontWeight: "600" },
  muted: { color: "#7C8CA0", fontSize: 14 },
  mutedXs: { color: "#55647A", fontSize: 12, marginTop: 2 },
  mutedBold: { color: "#7C8CA0", fontSize: 14, fontWeight: "600" },
  macroRow: { flexDirection: "row", gap: 10 },
  macroCell: { alignItems: "center" },
  macroVal: { fontSize: 13, fontWeight: "700" },
  macroUnit: {
    fontSize: 9,
    fontWeight: "600",
    color: "#55647A",
    textTransform: "uppercase",
  },
  fillLink: { color: "#9CC0E8", fontSize: 14, fontWeight: "600", textAlign: "center" },
  primaryBtn: {
    backgroundColor: "#9CC0E8",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    width: "100%",
  },
  primaryBtnText: { color: colors.onAccent, fontWeight: "700", fontSize: 14 },
  selectedBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: "rgba(156, 192, 232,0.05)",
    borderWidth: 1,
    borderColor: "rgba(156, 192, 232,0.3)",
  },
  selectedName: { color: "#fff", fontWeight: "700", fontSize: 14, flex: 1 },
  changeBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: "#1C1C1E",
    borderWidth: 1,
    borderColor: colors.border,
  },
  label: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.4,
    color: "#55647A",
    textTransform: "uppercase",
    marginBottom: 4,
  },
  amountCard: {
    flex: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#05080F",
  },
  amountCardOn: {
    borderColor: "#9CC0E8",
    backgroundColor: "rgba(156, 192, 232,0.1)",
  },
  amountLabel: {
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 1.4,
    color: "#55647A",
    textTransform: "uppercase",
    marginBottom: 4,
  },
  amountVal: { color: "#7C8CA0", fontSize: 14, fontWeight: "600" },
  scaledBox: {
    flex: 1,
    borderRadius: 12,
    backgroundColor: "#05080F",
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 12,
    alignItems: "center",
  },
  scaledVal: { fontSize: 18, fontWeight: "700" },
  photoBox: {
    flex: 1,
    height: 112,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.border,
    backgroundColor: "#05080F",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  photoBoxText: { color: "#7C8CA0", fontSize: 14, fontWeight: "600" },
  scanLaunchBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    minHeight: 56,
    borderRadius: 999,
    backgroundColor: "#9CC0E8",
  },
  scanLaunchText: {
    color: "#070708",
    fontSize: 16,
    fontWeight: "800",
  },
  photoTip: {
    color: "#66768A",
    fontSize: 12,
    lineHeight: 17,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: "rgba(156,192,232,0.06)",
    borderWidth: 1,
    borderColor: "rgba(156,192,232,0.14)",
  },
  photoResultCard: {
    gap: 14,
    borderRadius: 14,
    padding: 14,
    backgroundColor: "#0C1017",
    borderWidth: 1,
    borderColor: "rgba(156,192,232,0.26)",
  },
  photoResultHead: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  photoLedger: {
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "#232A36",
  },
  photoLedgerTitle: {
    color: "#7C8CA0",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  photoLedgerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 3,
  },
  photoLedgerName: { color: "#C9D4E2", fontSize: 13, flex: 1, minWidth: 0 },
  photoLedgerAmount: { color: "#6B7A8C", fontSize: 12 },
  photoLedgerCal: { color: "#9CC0E8", fontSize: 13, fontWeight: "700" },
  photoLedgerHint: { color: "#6B7A8C", fontSize: 11, marginTop: 8 },
  photoResultName: { color: "#fff", fontSize: 17, fontWeight: "800" },
  photoResultAmount: { color: "#7C8CA0", fontSize: 12, marginTop: 3 },
  photoEstimatedLabel: {
    color: "#7C8CA0",
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    paddingTop: 3,
  },
  photoMacroGrid: { flexDirection: "row", gap: 7 },
  photoMacroCell: {
    flex: 1,
    minWidth: 0,
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 3,
    borderRadius: 10,
    backgroundColor: "#05080F",
    borderWidth: 1,
    borderColor: colors.border,
  },
  photoMacroValue: { fontSize: 17, fontWeight: "800" },
  photoMacroUnit: { color: "#55647A", fontSize: 9, fontWeight: "700", marginTop: -1 },
  photoNudge: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 9,
    padding: 11,
    borderRadius: 10,
    backgroundColor: "rgba(245,197,66,0.07)",
    borderWidth: 1,
    borderColor: "rgba(245,197,66,0.24)",
  },
  photoNudgeTitle: { color: "#F5C542", fontSize: 12, fontWeight: "800" },
  photoNudgeText: { color: "#8B8061", fontSize: 11, lineHeight: 15, marginTop: 2 },
  photoActionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  photoFixBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingVertical: 3,
  },
  photoFixText: { color: "#5EEAD4", fontSize: 13, fontWeight: "700" },
  photoAdjustToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingVertical: 3,
  },
  photoAdjustText: { color: "#9CC0E8", fontSize: 13, fontWeight: "700" },
  photoAdjustPanel: {
    gap: 9,
    paddingTop: 13,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  photoChoiceRow: { flexDirection: "row", gap: 7 },
  photoChoice: {
    flex: 1,
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 9,
    borderRadius: 9,
    backgroundColor: "#05080F",
    borderWidth: 1,
    borderColor: colors.border,
  },
  photoChoiceOn: {
    backgroundColor: "rgba(156,192,232,0.14)",
    borderColor: "#9CC0E8",
  },
  photoChoiceText: { color: "#7C8CA0", fontSize: 12, fontWeight: "700" },
  photoChoiceTextOn: { color: "#9CC0E8" },
  photoAdjustHint: { color: "#66768A", fontSize: 11, lineHeight: 15 },
  photoAssumption: {
    color: "#8B8061",
    fontSize: 11,
    lineHeight: 16,
    paddingTop: 2,
  },
  photoAdvancedToggle: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 7,
    marginTop: 2,
  },
  photoAdvancedText: { color: "#7C8CA0", fontSize: 12, fontWeight: "700" },
  photoAdvancedGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  photoAdvancedField: { width: "47%" },
  photoStartOver: { alignItems: "center", paddingVertical: 4 },
  photoStartOverText: { color: "#7C8CA0", fontSize: 12, fontWeight: "700" },
  qtyRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  qtyStep: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#05080F",
    borderWidth: 1,
    borderColor: colors.border,
  },
  qtyStepOff: { opacity: 0.45 },
  qtyValueBox: { minWidth: 46, alignItems: "center" },
  qtyValue: { color: "#fff", fontSize: 17, fontWeight: "800" },
  qtyChips: { flexDirection: "row", gap: 6, marginLeft: "auto" },
  qtyChip: {
    minWidth: 34,
    paddingVertical: 7,
    paddingHorizontal: 8,
    borderRadius: 9,
    alignItems: "center",
    backgroundColor: "#05080F",
    borderWidth: 1,
    borderColor: colors.border,
  },
  qtyChipOn: { borderColor: "#9CC0E8", backgroundColor: "#111C2B" },
  qtyChipText: { color: "#7C8CA0", fontWeight: "700", fontSize: 13 },
  qtyChipTextOn: { color: "#9CC0E8" },
  modelRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  modelChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#05080F",
  },
  modelChipOn: {
    borderColor: "#9CC0E8",
    backgroundColor: "rgba(156, 192, 232,0.18)",
  },
  modelChipText: { color: "#7C8CA0", fontWeight: "700", fontSize: 13 },
  modelChipTextOn: { color: "#9CC0E8" },
  preview: {
    width: "100%",
    height: 176,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  removePhoto: {
    position: "absolute",
    top: 8,
    right: 8,
    padding: 6,
    borderRadius: 999,
    backgroundColor: "rgba(11,12,16,0.8)",
  },
  error: { color: "#FCA5A5", fontSize: 14 },
  planBox: {
    gap: 8,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#0C0C0E",
  },
  planTitle: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.4,
  },
  planHead: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 2,
  },
  planExpandBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingVertical: 2,
    paddingLeft: 6,
  },
  planExpandText: { color: "#9CC0E8", fontSize: 11, fontWeight: "700" },
  planHint: { color: "#636366", fontSize: 11, fontWeight: "600", marginBottom: 2 },
  planCard: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#111113",
    padding: 10,
    gap: 6,
  },
  planCardTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  planKindDot: { width: 8, height: 8, borderRadius: 4 },
  planName: { color: "#fff", fontSize: 13, fontWeight: "700" },
  planMeta: { color: "#636366", fontSize: 11, marginTop: 1 },
  planTagBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
  },
  planTagText: { color: "#8E8E93", fontSize: 11, fontWeight: "800" },
  planImportBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
  },
  planImportText: { fontSize: 11, fontWeight: "800" },
  planOptionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  planOptionName: { color: "#fff", fontSize: 13, fontWeight: "600" },
  planFoods: { color: "#8E8E93", fontSize: 11, marginTop: 2 },
});
