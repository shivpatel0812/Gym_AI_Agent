/**
 * Cal AI–style photo estimate results: food photo hero + macros card.
 * "Fix Results" opens MacroAdjustChat as a full-screen overlay on top.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ImageBackground,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import apiClient from "../../api/client";
import { colors } from "../../theme";
import type { AiModelId } from "../../lib/aiModels";
import { BAND_COLORS, BAND_LABELS } from "./FitBadge";
import type { FoodFit } from "./types";
import MacroAdjustChat from "./MacroAdjustChat";
import type { PhotoComponent, PhotoEstimate, PortionChoice } from "./photoEstimate";
import { adjustPhotoEstimate, scalePhotoEstimate } from "./photoEstimate";

type RevisedEstimate = {
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
};

type Props = {
  visible: boolean;
  photoUri: string | null;
  estimate: PhotoEstimate;
  model?: AiModelId;
  photoLogId?: string | null;
  mealLabel: string;
  mealSlot: string;
  onPhotoLogId?: (id: string) => void;
  onEstimateChange: (next: PhotoEstimate) => void;
  onDone: (displayed: PhotoEstimate, portion: PortionChoice) => void;
  onClose: () => void;
  onRetake: () => void;
};

function displayNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/** Plain-language read on how well the PHOTO could be measured. */
function confidenceLabel(level: string) {
  if (level === "high") return "Clear photo";
  if (level === "medium") return "Reasonably clear photo";
  return "Hard to measure from this photo";
}

export default function PhotoScanResults({
  visible,
  photoUri,
  estimate,
  model,
  photoLogId,
  mealLabel,
  mealSlot,
  onPhotoLogId,
  onEstimateChange,
  onDone,
  onClose,
  onRetake,
}: Props) {
  const insets = useSafeAreaInsets();
  const [portion, setPortion] = useState<PortionChoice>("estimated");
  const [showChat, setShowChat] = useState(false);
  const [servings, setServings] = useState(1);

  const displayed = useMemo(
    () =>
      scalePhotoEstimate(
        adjustPhotoEstimate(estimate, portion, estimate.analysis.cookingStyle),
        servings
      ),
    [estimate, portion, servings]
  );

  // Goal fit is scored server-side so there is exactly one implementation of
  // it; re-requested as the serving count changes, because a portion that
  // fits the meal at 1x may swallow the whole budget at 3x.
  const [fit, setFit] = useState<FoodFit | null>(null);
  const [fitLoading, setFitLoading] = useState(false);
  const fitSeq = useRef(0);

  useEffect(() => {
    if (!visible) return;
    const seq = ++fitSeq.current;
    setFitLoading(true);
    const timer = setTimeout(() => {
      apiClient
        .post("/api/macros/fit-preview", {
          calories: displayed.calories,
          protein: displayed.protein,
          carbs: displayed.carbs,
          fats: displayed.fats,
          fiber: displayed.fiber,
          meal: mealSlot,
        })
        .then((res) => {
          // Ignore a response that a newer serving count has already
          // superseded, so the badge cannot settle on a stale score.
          if (seq !== fitSeq.current) return;
          setFit(res.data?.fit || null);
        })
        .catch(() => {
          if (seq === fitSeq.current) setFit(null);
        })
        .finally(() => {
          if (seq === fitSeq.current) setFitLoading(false);
        });
    }, 250);
    return () => clearTimeout(timer);
  }, [
    visible,
    mealSlot,
    displayed.calories,
    displayed.protein,
    displayed.carbs,
    displayed.fats,
    displayed.fiber,
  ]);

  const confidence = estimate.analysis.confidence;

  const handleAcceptRevision = (revised: RevisedEstimate) => {
    onEstimateChange({
      ...estimate,
      name: revised.name || estimate.name,
      amount: revised.amount || estimate.amount,
      calories: revised.calories,
      protein: revised.protein,
      carbs: revised.carbs,
      fats: revised.fats,
      fiber: revised.fiber,
      sugar: revised.sugar ?? undefined,
      sodium: revised.sodium ?? undefined,
      analysis: {
        ...estimate.analysis,
        components: revised.components?.length
          ? revised.components
          : estimate.analysis.components,
        // The revision IS the user's statement about what is in the meal, so
        // the "not counted" list is answered whatever they said. Keeping it
        // would leave the banner naming an item the ledger now contains.
        uncounted: [],
      },
    });
    setPortion("estimated");
    setServings(1);
    setShowChat(false);
  };

  const timeLabel = useMemo(() => {
    try {
      return new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    } catch {
      return "";
    }
  }, [visible]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <View style={styles.root}>
        {photoUri ? (
          <ImageBackground source={{ uri: photoUri }} style={styles.hero} resizeMode="cover">
            <View style={[styles.heroTop, { paddingTop: Math.max(insets.top, 10) }]}>
              <TouchableOpacity style={styles.heroBtn} onPress={onClose} hitSlop={8}>
                <MaterialCommunityIcons name="chevron-left" size={26} color="#FFFFFF" />
              </TouchableOpacity>
              <Text style={styles.heroTitle}>Nutrition</Text>
              <TouchableOpacity style={styles.heroBtn} onPress={onRetake} hitSlop={8}>
                <MaterialCommunityIcons name="camera-retake-outline" size={20} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
          </ImageBackground>
        ) : (
          <View style={[styles.hero, styles.heroFallback]}>
            <View style={[styles.heroTop, { paddingTop: Math.max(insets.top, 10) }]}>
              <TouchableOpacity style={styles.heroBtn} onPress={onClose}>
                <MaterialCommunityIcons name="chevron-left" size={26} color="#FFFFFF" />
              </TouchableOpacity>
              <Text style={styles.heroTitle}>Nutrition</Text>
              <View style={styles.heroBtn} />
            </View>
          </View>
        )}

        <ScrollView style={{ flex: 1.7 }} contentContainerStyle={[styles.card, { paddingBottom: Math.max(insets.bottom, 14) + 8 }]}>
          <View style={styles.cardMeta}>
            <MaterialCommunityIcons name="bookmark-outline" size={16} color="#8A8A8E" />
            <Text style={styles.cardTime}>{timeLabel}</Text>
          </View>

          <View style={styles.titleRow}>
            <Text style={styles.foodName} numberOfLines={2}>
              {displayed.name}
            </Text>
            <TouchableOpacity
              style={styles.qtyPill}
              onPress={() => setServings((n) => (n >= 6 ? 1 : n + 1))}
            >
              <Text style={styles.qtyText}>{servings}</Text>
              <MaterialCommunityIcons name="pencil-outline" size={14} color="#3A3A3C" />
            </TouchableOpacity>
          </View>

          {displayed.amount ? (
            // `adjustPhotoEstimate` already prefixes Smaller/Larger, so this
            // renders the label as-is rather than prefixing it a second time.
            <Text style={styles.amountHint}>{displayed.amount}</Text>
          ) : null}

          <View style={styles.calorieRow}>
            <MaterialCommunityIcons name="fire" size={22} color="#FF6B35" />
            <Text style={styles.calorieLabel}>Calories</Text>
            <Text style={styles.calorieValue}>{Math.round(displayed.calories)}</Text>
          </View>

          <View style={styles.macroRow}>
            <View style={styles.macroItem}>
              <MaterialCommunityIcons name="food-drumstick" size={16} color="#E45B5B" />
              <Text style={styles.macroLabel}>Protein</Text>
              <Text style={styles.macroValue}>{displayNumber(displayed.protein)}g</Text>
            </View>
            <View style={styles.macroItem}>
              <MaterialCommunityIcons name="bread-slice" size={16} color="#E8A23A" />
              <Text style={styles.macroLabel}>Carbs</Text>
              <Text style={styles.macroValue}>{displayNumber(displayed.carbs)}g</Text>
            </View>
            <View style={styles.macroItem}>
              <MaterialCommunityIcons name="water" size={16} color="#5B8DE4" />
              <Text style={styles.macroLabel}>Fats</Text>
              <Text style={styles.macroValue}>{displayNumber(displayed.fats)}g</Text>
            </View>
          </View>

          <View style={styles.macroRow}>
            <Text style={styles.macroLabel}>Sugar <Text style={styles.macroValue}>{displayed.sugar == null ? "Unknown" : `${displayNumber(displayed.sugar)}g`}</Text></Text>
            <Text style={styles.macroLabel}>Sodium <Text style={styles.macroValue}>{displayed.sodium == null ? "Unknown" : `${Math.round(displayed.sodium)}mg`}</Text></Text>
          </View>
          <Text style={styles.scoreReason}>Sugar and sodium are estimates unless read from a nutrition label.</Text>

          {fit && fit.score !== null ? (
            <View style={styles.scoreBlock}>
              <View style={styles.scoreHeader}>
                <MaterialCommunityIcons
                  name="target"
                  size={16}
                  color={BAND_COLORS[fit.band].fg}
                />
                <Text style={styles.scoreLabel}>{BAND_LABELS[fit.band]}</Text>
                <Text style={styles.scoreValue}>{fit.score}/100</Text>
              </View>
              <View style={styles.scoreTrack}>
                <View
                  style={[
                    styles.scoreFill,
                    {
                      width: `${fit.score}%` as `${number}%`,
                      backgroundColor: BAND_COLORS[fit.band].fg,
                    },
                  ]}
                />
              </View>
              <Text style={styles.scoreReason}>{fit.reason}</Text>
            </View>
          ) : fitLoading ? (
            <Text style={styles.scoreReason}>Checking how this fits your goal…</Text>
          ) : (
            // No active plan target means there is nothing honest to score
            // against, so nothing is shown rather than a placeholder.
            <Text style={styles.scoreReason}>
              Set a nutrition plan target to see how meals fit your goal.
            </Text>
          )}

          {estimate.analysis.uncounted.length ? (
            // The omission made visible. Silence here is the exact failure
            // this list exists to end: a side dish the model saw, did not
            // cost, and never mentioned.
            <TouchableOpacity
              style={styles.uncountedRow}
              onPress={() => setShowChat(true)}
              accessibilityRole="button"
              accessibilityLabel={`Not counted: ${estimate.analysis.uncounted.join(
                ", "
              )}. Tap to add it.`}
            >
              <MaterialCommunityIcons name="alert-circle-outline" size={15} color={colors.attentionOnLight} />
              <Text style={styles.uncountedText}>
                <Text style={styles.uncountedLead}>Not counted: </Text>
                {estimate.analysis.uncounted.join(", ")} — tap to add it.
              </Text>
            </TouchableOpacity>
          ) : null}

          <View style={styles.confidenceRow}>
            <MaterialCommunityIcons
              name={confidence.level === "high" ? "camera-outline" : "camera-off-outline"}
              size={14}
              color="#8A8A8E"
            />
            <Text style={styles.confidenceText}>
              {confidenceLabel(confidence.level)}
              {confidence.reasons[0] && confidence.level !== "high"
                ? ` · ${confidence.reasons[0]}`
                : ""}
            </Text>
          </View>

          <View style={styles.servingsRow}>
            <Text style={styles.servingsLabel}>Servings</Text>
            <View style={styles.stepper}>
              <TouchableOpacity
                style={styles.stepBtn}
                onPress={() => setServings((n) => Math.max(1, n - 1))}
                disabled={servings <= 1}
              >
                <MaterialCommunityIcons name="minus" size={16} color="#111111" />
              </TouchableOpacity>
              <Text style={styles.stepValue}>{servings}</Text>
              <TouchableOpacity
                style={styles.stepBtn}
                onPress={() => setServings((n) => Math.min(6, n + 1))}
              >
                <MaterialCommunityIcons name="plus" size={16} color="#111111" />
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.actions}>
            <TouchableOpacity style={styles.fixBtn} onPress={() => setShowChat(true)}>
              <MaterialCommunityIcons name="creation" size={16} color="#111111" />
              <Text style={styles.fixText}>Fix Results</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.doneBtn}
              onPress={() => onDone(displayed, portion)}
            >
              <Text style={styles.doneText}>Done</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.mealHint}>Logs to {mealLabel}</Text>
        </ScrollView>
      </View>

      {showChat ? (
        <MacroAdjustChat
          estimate={estimate}
          model={model}
          photoLogId={photoLogId}
          onPhotoLogId={onPhotoLogId}
          onAcceptRevision={handleAcceptRevision}
          onClose={() => setShowChat(false)}
        />
      ) : null}
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#0B0C10",
  },
  hero: {
    flex: 1.05,
    minHeight: 240,
  },
  heroFallback: {
    backgroundColor: "#1A1A1E",
  },
  heroTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
  },
  heroBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.28)",
  },
  heroTitle: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
  },
  card: {
    flexGrow: 1,
    backgroundColor: "#F4E9E6",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 16,
    gap: 12,
  },
  cardMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  cardTime: {
    color: "#8A8A8E",
    fontSize: 12,
    fontWeight: "600",
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  foodName: {
    flex: 1,
    color: "#111111",
    fontSize: 26,
    fontWeight: "800",
    letterSpacing: -0.4,
    lineHeight: 30,
  },
  qtyPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#FFFFFF",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(0,0,0,0.08)",
  },
  qtyText: {
    color: "#111111",
    fontWeight: "700",
    fontSize: 15,
  },
  amountHint: {
    color: "#6B6B70",
    fontSize: 13,
    marginTop: -4,
  },
  calorieRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
  },
  calorieLabel: {
    color: "#111111",
    fontSize: 18,
    fontWeight: "700",
  },
  calorieValue: {
    color: "#111111",
    fontSize: 18,
    fontWeight: "800",
  },
  macroRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
  },
  macroItem: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 4,
  },
  macroLabel: {
    color: "#6B6B70",
    fontSize: 13,
    fontWeight: "600",
  },
  macroValue: {
    color: "#111111",
    fontSize: 14,
    fontWeight: "800",
  },
  scoreBlock: {
    gap: 8,
    marginTop: 2,
  },
  scoreHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  scoreLabel: {
    flex: 1,
    color: "#111111",
    fontSize: 14,
    fontWeight: "700",
  },
  scoreValue: {
    color: "#111111",
    fontSize: 14,
    fontWeight: "800",
  },
  scoreReason: {
    color: "#6B6B70",
    fontSize: 12,
    lineHeight: 16,
  },
  uncountedRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: 10,
    borderRadius: 10,
    backgroundColor: colors.attentionOnLightSoft,
  },
  uncountedText: {
    flex: 1,
    color: colors.attentionOnLight,
    fontSize: 13,
    lineHeight: 18,
  },
  uncountedLead: { fontWeight: "700" },
  confidenceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: -2,
  },
  confidenceText: {
    flex: 1,
    color: "#8A8A8E",
    fontSize: 11,
    lineHeight: 15,
  },
  scoreTrack: {
    height: 8,
    borderRadius: 999,
    backgroundColor: "rgba(0,0,0,0.08)",
    overflow: "hidden",
  },
  scoreFill: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: "#34C759",
  },
  servingsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  servingsLabel: {
    color: "#6B6B70",
    fontSize: 13,
    fontWeight: "600",
  },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#FFFFFF",
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  stepBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F0F0F2",
  },
  stepValue: {
    minWidth: 16,
    textAlign: "center",
    color: "#111111",
    fontWeight: "800",
  },
  actions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 4,
  },
  fixBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "#FFFFFF",
    borderRadius: 999,
    paddingVertical: 14,
    borderWidth: 1.5,
    borderColor: "#111111",
  },
  fixText: {
    color: "#111111",
    fontSize: 15,
    fontWeight: "700",
  },
  doneBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#2C2C2E",
    borderRadius: 999,
    paddingVertical: 14,
  },
  doneText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
  },
  mealHint: {
    textAlign: "center",
    color: "#8A8A8E",
    fontSize: 12,
    marginTop: -2,
  },
});
