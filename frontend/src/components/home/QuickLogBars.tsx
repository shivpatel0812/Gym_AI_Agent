import { useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Pressable,
  ScrollView,
} from "react-native";
import Slider from "@react-native-community/slider";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { colors } from "../../theme";
import { fieldColor } from "../wellness/ui";
import { stressWord } from "../../lib/mealSlots";
import Sparkline, { SparkPoint } from "./Sparkline";

type Kind = "sleep" | "stress";

const WATER = "#6EB5E0";

function lastNDays(n: number) {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    out.push(`${y}-${m}-${day}`);
  }
  return out;
}

function dateKey(raw: unknown) {
  const m = String(raw || "").match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : "";
}

function weekdayShort(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  return ["S", "M", "T", "W", "T", "F", "S"][new Date(y, m - 1, d, 12).getDay()];
}

function series(
  rows: { date?: string; value: number | null | undefined }[],
  days = 7
): SparkPoint[] {
  const byDate = new Map<string, number>();
  for (const row of rows) {
    const key = dateKey(row.date);
    if (!key || row.value == null || !Number.isFinite(Number(row.value))) continue;
    byDate.set(key, Number(row.value));
  }
  return lastNDays(days).map((key) => ({
    label: weekdayShort(key),
    value: byDate.has(key) ? byDate.get(key)! : null,
  }));
}

export default function QuickLogBars({
  available = { sleep: true, stress: true, wellness: true, water: true },
  sleepHours,
  sleepQuality,
  stressLevel,
  energy,
  aches,
  waterCups,
  waterTarget,
  sleepRows,
  stressRows,
  onSaveSleep,
  onSaveStress,
  onSaveWater,
  onOpenWellness,
  onOpenSleep,
  onOpenStress,
  onLockScroll,
}: {
  available?: { sleep: boolean; stress: boolean; wellness: boolean; water: boolean };
  sleepHours: number | null;
  sleepQuality: number | null;
  stressLevel: number | null;
  energy: number | null;
  aches: number | null;
  waterCups: number;
  waterTarget: number;
  sleepRows: { date?: string; hours_slept?: number; quality?: number }[];
  stressRows: { date?: string; level?: number }[];
  onSaveSleep: (hours: number) => void;
  onSaveStress: (level: number) => void;
  onSaveWater: (cups: number) => void;
  onOpenWellness: () => void;
  onOpenSleep?: () => void;
  onOpenStress?: () => void;
  onLockScroll?: (locked: boolean) => void;
}) {
  const [draftSleep, setDraftSleep] = useState(sleepHours ?? 7.5);
  const [draftStress, setDraftStress] = useState(stressLevel ?? 5);
  const [draftWater, setDraftWater] = useState(waterCups);
  const [waterText, setWaterText] = useState(String(waterCups));
  const [history, setHistory] = useState<Kind | null>(null);

  useEffect(() => {
    setDraftSleep(sleepHours ?? 7.5);
  }, [sleepHours]);
  useEffect(() => {
    setDraftStress(stressLevel ?? 5);
  }, [stressLevel]);
  useEffect(() => {
    setDraftWater(waterCups);
    setWaterText(String(waterCups));
  }, [waterCups]);

  const commitWater = (value: number) => {
    const next = Math.max(0, Math.min(40, Math.round(value)));
    setDraftWater(next);
    setWaterText(String(next));
    if (next !== waterCups) onSaveWater(next);
  };

  const bumpWater = (delta: number) => {
    commitWater(draftWater + delta);
  };

  const stressColor = fieldColor(draftStress, true);
  const target = Math.max(waterTarget || 1, 1);
  const waterPct = Math.min(draftWater / target, 1);
  const waterHit = draftWater >= target;

  const recovery =
    energy != null && aches != null
      ? energy - aches >= 3
        ? "Good"
        : energy - aches >= 0
          ? "Okay"
          : "Low"
      : null;

  const historyTitle = history === "sleep" ? "Sleep history" : "Stress history";
  const historyColor = history === "sleep" ? "#A78BFA" : "#9CC0E8";
  const historyPoints =
    history === "sleep"
      ? series(sleepRows.map((r) => ({ date: r.date, value: r.hours_slept })))
      : series(stressRows.map((r) => ({ date: r.date, value: r.level })));
  const historyUnit = history === "sleep" ? "h" : "/10";
  const historyMin = history === "sleep" ? 4 : 1;
  const historyMax = history === "sleep" ? 12 : 10;

  const wellnessLine =
    [
      energy != null ? `E ${energy}` : null,
      aches != null ? `S ${aches}` : null,
      recovery,
    ]
      .filter(Boolean)
      .join(" · ") || "Energy · soreness";

  return (
    <View>
      <View style={styles.head}>
        <Text style={styles.sectionLabel}>Quick log</Text>
        <TouchableOpacity disabled={!available.stress} onPress={() => setHistory("stress")} hitSlop={8}>
          <Text style={styles.historyLink}>History</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.row}>
        {available.sleep ? <View style={styles.card}>
          <TouchableOpacity onPress={() => setHistory("sleep")} activeOpacity={0.8}>
            <Text style={styles.cardLabel}>Sleep</Text>
            <Text style={[styles.cardValue, { color: "#A78BFA" }]}>
              {draftSleep}h
            </Text>
            <Text style={styles.meta}>
              {sleepQuality != null ? `Q ${sleepQuality}/10` : "History"}
            </Text>
          </TouchableOpacity>
          <Slider
            style={styles.slider}
            minimumValue={4}
            maximumValue={12}
            step={0.5}
            value={draftSleep}
            onValueChange={(v) => setDraftSleep(Math.round(v * 2) / 2)}
            onSlidingStart={() => onLockScroll?.(true)}
            onSlidingComplete={(v) => {
              onLockScroll?.(false);
              const next = Math.max(4, Math.min(12, Math.round(v * 2) / 2));
              setDraftSleep(next);
              onSaveSleep(next);
            }}
            minimumTrackTintColor="#A78BFA"
            maximumTrackTintColor="#1E2A38"
            thumbTintColor="#A78BFA"
          />
        </View> : null}

        {available.stress ? <View style={styles.card}>
          <TouchableOpacity onPress={() => setHistory("stress")} activeOpacity={0.8}>
            <Text style={styles.cardLabel}>Stress</Text>
            <Text style={[styles.cardValue, { color: stressColor }]}>
              {draftStress}/10
            </Text>
            <Text style={styles.meta}>{stressWord(draftStress)}</Text>
          </TouchableOpacity>
          <Slider
            style={styles.slider}
            minimumValue={1}
            maximumValue={10}
            step={1}
            value={draftStress}
            onValueChange={setDraftStress}
            onSlidingStart={() => onLockScroll?.(true)}
            onSlidingComplete={(v) => {
              onLockScroll?.(false);
              onSaveStress(v);
            }}
            minimumTrackTintColor={stressColor}
            maximumTrackTintColor="#1E2A38"
            thumbTintColor={stressColor}
          />
        </View> : null}
      </View>

      <View style={styles.bottomRow}>
        {available.wellness ? <TouchableOpacity
          style={styles.wellness}
          onPress={onOpenWellness}
          activeOpacity={0.85}
        >
          <View style={styles.wellnessIcon}>
            <MaterialCommunityIcons name="heart" size={14} color="#F9A8D4" />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.cardLabel}>Wellness</Text>
            <Text style={styles.wellnessLine} numberOfLines={1}>
              {wellnessLine}
            </Text>
          </View>
          <MaterialCommunityIcons name="chevron-right" size={16} color="#55647A" />
        </TouchableOpacity> : null}

        {available.water ? <View style={styles.waterCard}>
          <View style={styles.waterTop}>
            <MaterialCommunityIcons name="cup-water" size={14} color={WATER} />
            <Text style={styles.cardLabel}>Water</Text>
          </View>
          <View style={styles.waterValueRow}>
            <TextInput
              style={styles.waterInput}
              keyboardType="number-pad"
              value={waterText}
              onChangeText={(text) => setWaterText(text.replace(/[^0-9]/g, ""))}
              onEndEditing={() => {
                const parsed = parseInt(waterText, 10);
                commitWater(Number.isFinite(parsed) ? parsed : draftWater);
              }}
              onSubmitEditing={() => {
                const parsed = parseInt(waterText, 10);
                commitWater(Number.isFinite(parsed) ? parsed : draftWater);
              }}
              selectTextOnFocus
              returnKeyType="done"
              maxLength={2}
            />
            <Text style={styles.waterTarget}>/{target}</Text>
          </View>
          <View style={styles.waterTrack}>
            <View
              style={[
                styles.waterFill,
                {
                  width: `${Math.round(waterPct * 100)}%`,
                  backgroundColor: waterHit ? colors.success : WATER,
                },
              ]}
            />
          </View>
          <View style={styles.stepper}>
            <TouchableOpacity
              style={[styles.stepBtn, styles.waterBtn, draftWater <= 0 && { opacity: 0.35 }]}
              onPress={() => bumpWater(-1)}
              disabled={draftWater <= 0}
              hitSlop={6}
            >
              <MaterialCommunityIcons name="minus" size={13} color={WATER} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.stepBtn, styles.waterBtn]}
              onPress={() => bumpWater(1)}
              hitSlop={6}
            >
              <MaterialCommunityIcons name="plus" size={13} color={WATER} />
            </TouchableOpacity>
          </View>
        </View> : null}
      </View>

      <Modal visible={history != null} transparent animationType="slide" onRequestClose={() => setHistory(null)}>
        <View style={styles.modalRoot}>
          <Pressable style={styles.backdrop} onPress={() => setHistory(null)} />
          <View style={styles.sheet}>
            <View style={styles.handle} />
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>{historyTitle}</Text>
              <TouchableOpacity onPress={() => setHistory(null)}>
                <Text style={styles.done}>Done</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.kindRow}>
              {(["sleep", "stress"] as const).map((kind) => (
                <TouchableOpacity
                  key={kind}
                  onPress={() => setHistory(kind)}
                  style={[styles.kindChip, history === kind && styles.kindChipOn]}
                >
                  <Text style={[styles.kindText, history === kind && styles.kindTextOn]}>
                    {kind === "sleep" ? "Sleep" : "Stress"}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <Sparkline
              points={historyPoints}
              color={historyColor}
              min={historyMin}
              max={historyMax}
              unit={historyUnit}
            />
            <Text style={styles.sheetHint}>
              Last 7 days. Adjust sleep and stress on the cards — tap here for the trend.
            </Text>
            <TouchableOpacity
              style={styles.detailsBtn}
              onPress={() => {
                const kind = history;
                setHistory(null);
                if (kind === "sleep") onOpenSleep?.();
                else onOpenStress?.();
              }}
            >
              <Text style={styles.detailsText}>
                {history === "sleep" ? "Edit sleep quality" : "Add a stress note"}
              </Text>
            </TouchableOpacity>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.legend}>
              {historyPoints.map((p, i) => (
                <View key={p.label + i} style={styles.legendItem}>
                  <Text style={styles.legendLabel}>{p.label}</Text>
                  <Text style={[styles.legendVal, { color: historyColor }]}>
                    {p.value == null ? "—" : history === "sleep" ? `${p.value}h` : p.value}
                  </Text>
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  sectionLabel: {
    color: "#7C8CA0",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  historyLink: { color: "#9CC0E8", fontSize: 12, fontWeight: "700" },
  row: { flexDirection: "row", gap: 8, marginBottom: 8 },
  bottomRow: { flexDirection: "row", gap: 8, marginBottom: 14, alignItems: "stretch" },
  card: {
    flex: 1,
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 8,
    minHeight: 96,
  },
  cardLabel: { color: "#7C8CA0", fontSize: 10, fontWeight: "700" },
  cardValue: { color: "#fff", fontSize: 15, fontWeight: "800", marginTop: 2 },
  meta: { color: "#55647A", fontSize: 10, marginTop: 1, fontWeight: "600" },
  stepper: { flexDirection: "row", gap: 6, marginTop: 8 },
  stepBtn: {
    width: 24,
    height: 24,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: "rgba(167,139,250,0.35)",
    backgroundColor: "rgba(167,139,250,0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  waterBtn: {
    borderColor: "rgba(110,181,224,0.4)",
    backgroundColor: "rgba(110,181,224,0.12)",
  },
  slider: { width: "100%", height: 24, marginTop: 2, marginLeft: -8 },
  wellness: {
    flex: 1.15,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  wellnessIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: "#2A1A24",
    alignItems: "center",
    justifyContent: "center",
  },
  wellnessLine: { color: "#fff", fontSize: 11, fontWeight: "600", marginTop: 1 },
  waterCard: {
    width: 112,
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 8,
  },
  waterTop: { flexDirection: "row", alignItems: "center", gap: 4 },
  waterValueRow: { flexDirection: "row", alignItems: "baseline", marginTop: 2, gap: 1 },
  waterInput: {
    color: WATER,
    fontSize: 15,
    fontWeight: "800",
    minWidth: 28,
    paddingVertical: 0,
    paddingHorizontal: 0,
    margin: 0,
  },
  waterTarget: { color: "#55647A", fontSize: 11, fontWeight: "700" },
  waterTrack: {
    height: 3,
    borderRadius: 999,
    backgroundColor: "#1E2A38",
    marginTop: 4,
    overflow: "hidden",
  },
  waterFill: { height: "100%", borderRadius: 999 },
  modalRoot: { flex: 1, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(0,0,0,0.55)" },
  sheet: {
    backgroundColor: "#0E1621",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingBottom: 28,
    paddingTop: 8,
  },
  handle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 999,
    backgroundColor: "#3A3A3C",
    marginBottom: 14,
  },
  sheetHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  sheetTitle: { color: "#fff", fontSize: 20, fontWeight: "700" },
  done: { color: "#9CC0E8", fontWeight: "700" },
  kindRow: { flexDirection: "row", gap: 8, marginBottom: 14 },
  kindChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
  },
  kindChipOn: { borderColor: "#9CC0E8", backgroundColor: "rgba(156,192,232,0.14)" },
  kindText: { color: "#7C8CA0", fontSize: 12, fontWeight: "700" },
  kindTextOn: { color: "#9CC0E8" },
  sheetHint: { color: "#55647A", fontSize: 12, marginTop: 10, lineHeight: 16 },
  detailsBtn: {
    marginTop: 14,
    alignItems: "center",
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  detailsText: { color: "#9CC0E8", fontWeight: "700", fontSize: 14 },
  legend: { gap: 12, paddingTop: 14 },
  legendItem: { alignItems: "center", minWidth: 28 },
  legendLabel: { color: "#55647A", fontSize: 10, fontWeight: "700" },
  legendVal: { fontSize: 12, fontWeight: "800", marginTop: 2 },
});
