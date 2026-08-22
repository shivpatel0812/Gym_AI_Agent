import { View, Text, TextInput, StyleSheet, TouchableOpacity } from "react-native";
import type { ReactNode } from "react";
import Slider from "@react-native-community/slider";
import { colors, spacing } from "../../theme";

export function fieldColor(value: number, reverse = false) {
  const n = reverse ? 11 - value : value;
  if (n <= 3) return "#EF4444";
  if (n <= 6) return "#F59E0B";
  return "#9CC0E8";
}

export function LevelSlider({
  label,
  value,
  onChange,
  minLabel,
  maxLabel,
  reverse = false,
  min = 1,
  max = 10,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  minLabel: string;
  maxLabel: string;
  reverse?: boolean;
  min?: number;
  max?: number;
}) {
  const color = fieldColor(value, reverse);
  return (
    <View style={{ marginBottom: 16 }}>
      <View style={styles.sliderHead}>
        <Text style={styles.label}>{label}</Text>
        <Text style={[styles.sliderVal, { color }]}>
          {value}/{max}
        </Text>
      </View>
      <Slider
        minimumValue={min}
        maximumValue={max}
        step={1}
        value={value}
        onValueChange={onChange}
        minimumTrackTintColor={color}
        maximumTrackTintColor="#1E2A38"
        thumbTintColor={color}
      />
      <View style={styles.sliderEnds}>
        <Text style={styles.hint}>{minLabel}</Text>
        <Text style={styles.hint}>{maxLabel}</Text>
      </View>
    </View>
  );
}

export function Meter({
  label,
  value,
  max = 10,
  reverse = false,
}: {
  label: string;
  value: number;
  max?: number;
  reverse?: boolean;
}) {
  const color = fieldColor(value, reverse);
  return (
    <View style={{ marginBottom: 10 }}>
      <View style={styles.sliderHead}>
        <Text style={styles.hint}>{label}</Text>
        <Text style={{ color: "#fff", fontSize: 12, fontWeight: "600" }}>
          {value}/{max}
        </Text>
      </View>
      <View style={styles.track}>
        <View
          style={[
            styles.fill,
            {
              width: `${Math.min((value / max) * 100, 100)}%`,
              backgroundColor: color,
            },
          ]}
        />
      </View>
    </View>
  );
}

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  multiline,
  editable = true,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  keyboardType?: "default" | "numeric" | "decimal-pad";
  multiline?: boolean;
  editable?: boolean;
}) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#55647A"
        keyboardType={keyboardType || "default"}
        multiline={multiline}
        editable={editable}
        style={[styles.input, multiline && { height: 88, textAlignVertical: "top", paddingTop: 12 }]}
      />
    </View>
  );
}

export function FormCard({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <View style={styles.formCard}>
      <View style={styles.formHead}>
        <Text style={styles.formTitle}>{title}</Text>
        <TouchableOpacity onPress={onClose}>
          <Text style={styles.cancel}>Cancel</Text>
        </TouchableOpacity>
      </View>
      {children}
    </View>
  );
}

export function EmptyNote({ text }: { text: string }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

export const logStyles = StyleSheet.create({
  wrap: { paddingHorizontal: spacing.lg, paddingBottom: 40, paddingTop: 12 },
  topRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginBottom: 16,
  },
  logBtn: {
    backgroundColor: "#9CC0E8",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  logBtnText: { color: colors.onAccent, fontWeight: "700", fontSize: 14 },
  saveRow: { flexDirection: "row", gap: 10, marginTop: 8 },
  saveBtn: {
    flex: 1,
    backgroundColor: "#9CC0E8",
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  saveText: { color: colors.onAccent, fontWeight: "700" },
  card: {
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  cardDate: { color: "#fff", fontSize: 16, fontWeight: "700" },
  cardSub: { color: "#7C8CA0", fontSize: 13, marginTop: 4 },
});

const styles = StyleSheet.create({
  label: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.2,
    color: "#55647A",
    textTransform: "uppercase",
    marginBottom: 8,
  },
  hint: { color: "#7C8CA0", fontSize: 11 },
  sliderHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  sliderVal: { fontSize: 14, fontWeight: "700" },
  sliderEnds: { flexDirection: "row", justifyContent: "space-between" },
  track: {
    height: 8,
    borderRadius: 999,
    backgroundColor: "#1E2A38",
    overflow: "hidden",
  },
  fill: { height: 8, borderRadius: 999 },
  input: {
    height: 48,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: "#05080F",
    borderWidth: 1,
    borderColor: colors.border,
    color: "#fff",
    fontSize: 14,
  },
  formCard: {
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
  },
  formHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  formTitle: { color: "#fff", fontSize: 16, fontWeight: "700" },
  cancel: { color: "#7C8CA0", fontWeight: "600" },
  empty: {
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.border,
    borderRadius: 16,
    padding: 28,
    alignItems: "center",
  },
  emptyText: { color: "#7C8CA0", fontSize: 14, textAlign: "center" },
});
