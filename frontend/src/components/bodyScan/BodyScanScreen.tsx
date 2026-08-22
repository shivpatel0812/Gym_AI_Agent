/**
 * AI Body Scan — consent, guided 3-view capture, results, apply training focus.
 */
import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Image,
  ActivityIndicator,
  Alert,
  Dimensions,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  BODY_SCAN_VIEWS,
  BodyScanSession,
  BodyScanView,
  acceptBodyScanConsent,
  analyzeBodyScan,
  applyBodyScanFocus,
  getBodyScanConsent,
  getLatestBodyScan,
  listBodyScans,
} from "../../api/bodyScan";
import { AI_MODEL_STORAGE_KEY, normalizeAiModel } from "../../lib/aiModels";
import { BODY_SCAN_DISCLAIMER } from "../legal/disclaimers";
import { colors, spacing, borderRadius } from "../../theme";

const { width: SCREEN_W } = Dimensions.get("window");

const VIEW_COPY: Record<BodyScanView, { title: string; tip: string }> = {
  front: {
    title: "Front",
    tip: "Arms slightly out, feet under hips, face the camera.",
  },
  side: {
    title: "Side",
    tip: "Turn 90°, arms relaxed, stand tall — full body in frame.",
  },
  back: {
    title: "Back",
    tip: "Face away, arms slightly out, same distance as front.",
  },
};

export default function BodyScanScreen() {
  const [loading, setLoading] = useState(true);
  const [accepted, setAccepted] = useState(false);
  const [consentCopy, setConsentCopy] = useState({
    title: "Body scan privacy",
    body: "",
  });
  const [step, setStep] = useState<"home" | "goal" | "capture" | "results">("home");
  const [viewIndex, setViewIndex] = useState(0);
  const [photos, setPhotos] = useState<Partial<Record<BodyScanView, string>>>({});
  const [goalText, setGoalText] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [scan, setScan] = useState<BodyScanSession | null>(null);
  const [history, setHistory] = useState<BodyScanSession[]>([]);
  const [applying, setApplying] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [consent, latest, scans] = await Promise.all([
        getBodyScanConsent(),
        getLatestBodyScan(),
        listBodyScans(),
      ]);
      setAccepted(consent.accepted);
      setConsentCopy(consent.copy);
      setScan(latest);
      setHistory(scans);
      if (latest) setStep("home");
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onAcceptConsent = async () => {
    try {
      await acceptBodyScanConsent();
      setAccepted(true);
      setStep("goal");
    } catch {
      Alert.alert("Error", "Could not save consent.");
    }
  };

  const takePhoto = async () => {
    const view = BODY_SCAN_VIEWS[viewIndex];
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Camera needed", "Allow camera access to take guided progress photos.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
      allowsEditing: false,
    });
    if (result.canceled || !result.assets?.[0]?.uri) return;
    setPhotos((prev) => ({ ...prev, [view]: result.assets[0].uri }));
  };

  const pickPhoto = async () => {
    const view = BODY_SCAN_VIEWS[viewIndex];
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
    });
    if (result.canceled || !result.assets?.[0]?.uri) return;
    setPhotos((prev) => ({ ...prev, [view]: result.assets[0].uri }));
  };

  const goNextView = () => {
    const view = BODY_SCAN_VIEWS[viewIndex];
    if (!photos[view]) {
      Alert.alert("Photo needed", `Capture your ${VIEW_COPY[view].title.toLowerCase()} photo first.`);
      return;
    }
    if (viewIndex < BODY_SCAN_VIEWS.length - 1) {
      setViewIndex((i) => i + 1);
      return;
    }
    runAnalyze();
  };

  const runAnalyze = async () => {
    if (!photos.front || !photos.side || !photos.back) {
      Alert.alert("Missing photos", "Front, side, and back are all required.");
      return;
    }
    if (goalText.trim().length < 3) {
      Alert.alert("Goal needed", "Describe what you want to work on.");
      setStep("goal");
      return;
    }
    setAnalyzing(true);
    try {
      const model = normalizeAiModel(await AsyncStorage.getItem(AI_MODEL_STORAGE_KEY));
      const result = await analyzeBodyScan({
        goalText: goalText.trim(),
        frontUri: photos.front,
        sideUri: photos.side,
        backUri: photos.back,
        model,
      });
      setScan(result);
      setPhotos({});
      setViewIndex(0);
      setStep("results");
      setHistory((prev) => [result, ...prev.filter((s) => s.id !== result.id)]);
    } catch (e: any) {
      const msg =
        e?.response?.data?.detail?.message ||
        e?.response?.data?.detail ||
        e?.message ||
        "Analysis failed.";
      Alert.alert("Could not analyze", String(msg));
    } finally {
      setAnalyzing(false);
    }
  };

  const onApply = async () => {
    if (!scan?.id) return;
    setApplying(true);
    try {
      const { scan: updated, focuses } = await applyBodyScanFocus(scan.id);
      setScan(updated);
      Alert.alert(
        "Focus applied",
        focuses.length
          ? `Added ${focuses.length} temporary training focus${focuses.length === 1 ? "" : "es"} for ~6 weeks. Loads still come from your logged history.`
          : "Emphasis saved. Your recommender will lean toward the highlighted areas."
      );
    } catch {
      Alert.alert("Error", "Could not apply training focus.");
    } finally {
      setApplying(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.accentPrimary} />
      </View>
    );
  }

  if (!accepted) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.pad}>
        <Text style={styles.kicker}>AI BODY SCAN</Text>
        <Text style={styles.title}>{consentCopy.title}</Text>
        <Text style={styles.body}>{consentCopy.body}</Text>
        <Text style={styles.disclaimer}>{BODY_SCAN_DISCLAIMER}</Text>
        <TouchableOpacity style={styles.primary} onPress={onAcceptConsent}>
          <Text style={styles.primaryText}>I understand — continue</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  if (step === "goal") {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.pad} keyboardShouldPersistTaps="handled">
        <Text style={styles.kicker}>YOUR GOAL</Text>
        <Text style={styles.title}>What do you want to change?</Text>
        <Text style={styles.body}>
          Plain language is fine — e.g. “bigger shoulders, keep my squat strength.”
        </Text>
        <TextInput
          style={styles.input}
          value={goalText}
          onChangeText={setGoalText}
          placeholder="Describe your physique / training goal…"
          placeholderTextColor={colors.textMuted}
          multiline
          textAlignVertical="top"
        />
        <TouchableOpacity
          style={styles.primary}
          onPress={() => {
            if (goalText.trim().length < 3) {
              Alert.alert("Add a goal", "A short goal helps the coach personalize emphasis.");
              return;
            }
            setViewIndex(0);
            setStep("capture");
          }}
        >
          <Text style={styles.primaryText}>Start guided photos</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setStep("home")}>
          <Text style={styles.link}>Cancel</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  if (step === "capture") {
    const view = BODY_SCAN_VIEWS[viewIndex];
    const copy = VIEW_COPY[view];
    const uri = photos[view];
    return (
      <View style={styles.container}>
        <ScrollView contentContainerStyle={styles.pad}>
          <Text style={styles.kicker}>
            PHOTO {viewIndex + 1} / {BODY_SCAN_VIEWS.length}
          </Text>
          <Text style={styles.title}>{copy.title}</Text>
          <Text style={styles.body}>{copy.tip}</Text>

          <View style={styles.stage}>
            {uri ? (
              <Image source={{ uri }} style={styles.preview} resizeMode="cover" />
            ) : (
              <View style={styles.silhouette}>
                <Silhouette kind={view} />
                <Text style={styles.silhouetteHint}>Match this outline · full body in frame</Text>
              </View>
            )}
          </View>

          <View style={styles.row}>
            <TouchableOpacity style={styles.secondary} onPress={takePhoto}>
              <MaterialCommunityIcons name="camera" size={18} color={colors.accentPrimary} />
              <Text style={styles.secondaryText}>Camera</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondary} onPress={pickPhoto}>
              <MaterialCommunityIcons name="image" size={18} color={colors.accentPrimary} />
              <Text style={styles.secondaryText}>Library</Text>
            </TouchableOpacity>
          </View>

          {uri ? (
            <TouchableOpacity style={styles.ghost} onPress={() => setPhotos((p) => ({ ...p, [view]: undefined }))}>
              <Text style={styles.link}>Retake</Text>
            </TouchableOpacity>
          ) : null}

          <TouchableOpacity style={styles.primary} onPress={goNextView} disabled={analyzing}>
            {analyzing ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryText}>
                {viewIndex < BODY_SCAN_VIEWS.length - 1 ? "Next view" : "Analyze scan"}
              </Text>
            )}
          </TouchableOpacity>
          <Text style={styles.disclaimer}>Photos are analyzed then deleted. We keep coaching notes only.</Text>
        </ScrollView>
      </View>
    );
  }

  if (step === "results" && scan) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.pad}>
        <ResultsCard scan={scan} applying={applying} onApply={onApply} />
        <TouchableOpacity
          style={styles.secondary}
          onPress={() => {
            setGoalText(scan.goal?.raw_text || "");
            setStep("goal");
          }}
        >
          <Text style={styles.secondaryText}>New scan</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setStep("home")}>
          <Text style={styles.link}>Done</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  // Home
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.pad}>
      <Text style={styles.kicker}>AI BODY SCAN</Text>
      <Text style={styles.title}>See what’s changing</Text>
      <Text style={styles.body}>
        Guided front / side / back photos plus your goal → emphasis grounded in your logs.
      </Text>
      <Text style={styles.disclaimer}>{BODY_SCAN_DISCLAIMER}</Text>

      <TouchableOpacity
        style={styles.primary}
        onPress={() => {
          setPhotos({});
          setViewIndex(0);
          setStep("goal");
        }}
      >
        <Text style={styles.primaryText}>{scan ? "Start new scan" : "Start body scan"}</Text>
      </TouchableOpacity>

      {scan ? (
        <View style={{ marginTop: spacing.lg }}>
          <ResultsCard
            scan={scan}
            applying={applying}
            onApply={scan.synthesis?.applied ? undefined : onApply}
            compact
          />
        </View>
      ) : null}

      {history.length > 1 ? (
        <View style={styles.history}>
          <Text style={styles.section}>Trend</Text>
          {history.slice(0, 6).map((s) => (
            <TouchableOpacity key={s.id} style={styles.historyRow} onPress={() => { setScan(s); setStep("results"); }}>
              <Text style={styles.historyDate}>
                {(s.created_at || "").slice(0, 10) || "Scan"}
              </Text>
              <Text style={styles.historyMeta} numberOfLines={1}>
                {s.goal?.direction || "goal"} · conf {s.observations?.confidence || "?"}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

function ResultsCard({
  scan,
  applying,
  onApply,
  compact,
}: {
  scan: BodyScanSession;
  applying?: boolean;
  onApply?: () => void;
  compact?: boolean;
}) {
  const obs = scan.observations || {};
  const syn = scan.synthesis || {};
  const regions = Object.entries(obs.regions || {}).filter(([, v]) => {
    const development = (v as { development?: string } | undefined)?.development;
    return !!development && development !== "uncertain";
  }) as Array<[string, { development?: string; notes?: string | null }]>;

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>
        {compact ? "Latest scan" : "Your scan"}
      </Text>
      <Text style={styles.meta}>
        {(scan.created_at || "").slice(0, 10)} · confidence {obs.confidence || "low"} · photos deleted
      </Text>
      {syn.explanation ? <Text style={styles.explain}>{syn.explanation}</Text> : null}

      {scan.goal?.raw_text ? (
        <Text style={styles.goalLine}>Goal: {scan.goal.raw_text}</Text>
      ) : null}

      {!compact && regions.length ? (
        <View style={styles.chips}>
          {regions.map(([name, meta]) => (
            <View key={name} style={styles.chip}>
              <Text style={styles.chipText}>
                {name}: {meta?.development}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      {Object.keys(syn.emphasis || {}).length ? (
        <View style={{ marginTop: 10 }}>
          <Text style={styles.section}>Emphasis</Text>
          <View style={styles.chips}>
            {Object.entries(syn.emphasis || {}).map(([k, v]) => (
              <View key={k} style={[styles.chip, styles.chipAi]}>
                <Text style={[styles.chipText, { color: colors.ai }]}>
                  {k} {v}
                </Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {obs.limitations ? <Text style={styles.limit}>{obs.limitations}</Text> : null}

      {onApply ? (
        <TouchableOpacity style={styles.primary} onPress={onApply} disabled={applying}>
          {applying ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryText}>Apply to training focus</Text>
          )}
        </TouchableOpacity>
      ) : syn.applied ? (
        <Text style={styles.applied}>Training focus applied</Text>
      ) : null}
    </View>
  );
}

function Silhouette({ kind }: { kind: BodyScanView }) {
  // Simple geometric stand-in for a body outline (consistent framing cue).
  return (
    <View style={styles.silWrap}>
      <View style={styles.silHead} />
      <View style={[styles.silTorso, kind === "side" && styles.silTorsoSide]} />
      <View style={styles.silLegs}>
        <View style={styles.silLeg} />
        <View style={styles.silLeg} />
      </View>
      {kind !== "side" ? (
        <View style={styles.silArms}>
          <View style={styles.silArm} />
          <View style={styles.silArm} />
        </View>
      ) : null}
      <Text style={styles.silLabel}>{kind.toUpperCase()}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },
  pad: { padding: spacing.xl, paddingBottom: 48, gap: 12 },
  kicker: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1,
    color: colors.ai,
  },
  title: { fontSize: 28, fontWeight: "800", color: colors.textPrimary, lineHeight: 34 },
  body: { fontSize: 15, color: colors.textSecondary, lineHeight: 22 },
  disclaimer: { fontSize: 12, color: colors.textMuted, lineHeight: 18 },
  input: {
    minHeight: 110,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    color: colors.textPrimary,
    backgroundColor: colors.cardBackground,
    fontSize: 15,
  },
  primary: {
    backgroundColor: colors.accentPrimary,
    borderRadius: borderRadius.md,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 8,
  },
  primaryText: { color: colors.onAccent, fontWeight: "800", fontSize: 15 },
  secondary: {
    flex: 1,
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(156, 192, 232,0.4)",
    borderRadius: borderRadius.md,
    paddingVertical: 12,
  },
  secondaryText: { color: colors.accentPrimary, fontWeight: "700" },
  row: { flexDirection: "row", gap: 10 },
  link: { color: colors.accentPrimary, fontWeight: "700", textAlign: "center", marginTop: 8 },
  ghost: { alignItems: "center" },
  stage: {
    width: "100%",
    height: SCREEN_W * 1.15,
    borderRadius: borderRadius.lg,
    overflow: "hidden",
    backgroundColor: "#12151C",
    borderWidth: 1,
    borderColor: colors.border,
  },
  preview: { width: "100%", height: "100%" },
  silhouette: { flex: 1, alignItems: "center", justifyContent: "center" },
  silhouetteHint: { color: colors.textMuted, fontSize: 12, marginTop: 12 },
  silWrap: { width: 140, height: 280, alignItems: "center", justifyContent: "flex-start", marginTop: 20 },
  silHead: { width: 36, height: 36, borderRadius: 18, borderWidth: 2, borderColor: "rgba(94,234,212,0.55)" },
  silTorso: {
    width: 70,
    height: 100,
    borderWidth: 2,
    borderColor: "rgba(94,234,212,0.55)",
    borderRadius: 16,
    marginTop: 8,
  },
  silTorsoSide: { width: 42 },
  silLegs: { flexDirection: "row", gap: 10, marginTop: 8 },
  silLeg: { width: 24, height: 90, borderWidth: 2, borderColor: "rgba(94,234,212,0.55)", borderRadius: 10 },
  silArms: {
    position: "absolute",
    top: 52,
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  silArm: { width: 18, height: 70, borderWidth: 2, borderColor: "rgba(94,234,212,0.45)", borderRadius: 8 },
  silLabel: { position: "absolute", bottom: -28, color: colors.ai, fontWeight: "800", letterSpacing: 1, fontSize: 11 },
  card: {
    backgroundColor: colors.cardBackground,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: 8,
  },
  cardTitle: { fontSize: 18, fontWeight: "800", color: colors.textPrimary },
  meta: { fontSize: 12, color: colors.textMuted },
  explain: { fontSize: 14, color: colors.textSecondary, lineHeight: 20, marginTop: 4 },
  goalLine: { fontSize: 13, color: colors.textPrimary, fontWeight: "600" },
  section: { fontSize: 12, fontWeight: "800", color: colors.textMuted, letterSpacing: 0.4, textTransform: "uppercase" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(156, 192, 232,0.12)",
  },
  chipAi: { backgroundColor: "rgba(94,234,212,0.12)" },
  chipText: { fontSize: 11, fontWeight: "700", color: colors.accentPrimary },
  limit: { fontSize: 12, color: colors.textMuted, fontStyle: "italic", lineHeight: 17 },
  applied: { color: "#4ADE80", fontWeight: "700", marginTop: 8 },
  history: { marginTop: spacing.lg, gap: 8 },
  historyRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  historyDate: { color: colors.textPrimary, fontWeight: "700" },
  historyMeta: { color: colors.textMuted, fontSize: 12, maxWidth: "55%" },
});
