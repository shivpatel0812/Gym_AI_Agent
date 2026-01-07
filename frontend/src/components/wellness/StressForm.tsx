import { useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from "react-native";
import LinearGradient from "../shared/LinearGradient";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import apiClient from "../../api/client";
import { StressEntry } from "./types";
import Button from "../shared/Button";
import Input from "../shared/Input";
import Card from "../shared/Card";
import { colors, spacing, borderRadius, shadows } from "../../theme";

interface StressFormProps {
  entry?: StressEntry | null;
  onSuccess: () => void;
  onCancel: () => void;
}

export default function StressForm({ entry, onSuccess, onCancel }: StressFormProps) {
  const [newStress, setNewStress] = useState<StressEntry>({
    date: entry?.date || new Date().toISOString().split("T")[0],
    level: entry?.level || 5,
    description: entry?.description || "",
  });

  const saveStress = async () => {
    try {
      if (entry && entry.id) {
        await apiClient.put(`/api/stress/${entry.id}`, newStress);
      } else {
        await apiClient.post("/api/stress", newStress);
      }
      setNewStress({
        date: new Date().toISOString().split("T")[0],
        level: 5,
        description: "",
      });
      onSuccess();
    } catch (error) {
      console.error("Error saving stress entry:", error);
    }
  };

  const getLevelColor = (level: number) => {
    if (level >= 7) return colors.danger;
    if (level >= 4) return colors.warning;
    return colors.success;
  };

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <MaterialCommunityIcons
          name="brain"
          size={32}
          color={getLevelColor(newStress.level)}
        />
        <Text style={styles.title}>{entry ? "Edit Stress" : "Log Stress"}</Text>
      </View>

      <Card style={styles.card}>
        <Input
          label="Date"
          value={newStress.date}
          onChangeText={(text) => setNewStress({ ...newStress, date: text })}
          placeholder="YYYY-MM-DD"
          icon={<MaterialCommunityIcons name="calendar" size={20} color={colors.textSecondary} />}
        />

        <View style={styles.sliderContainer}>
          <View style={styles.sliderHeader}>
            <Text style={styles.sliderLabel}>Stress Level</Text>
            <View style={[styles.levelBadge, { backgroundColor: getLevelColor(newStress.level) + "20" }]}>
              <Text style={[styles.levelText, { color: getLevelColor(newStress.level) }]}>
                {newStress.level}/10
              </Text>
            </View>
          </View>

          <View style={styles.sliderTrackContainer}>
            <View style={styles.sliderTrack}>
              <LinearGradient
                colors={[getLevelColor(newStress.level), getLevelColor(newStress.level) + "80"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={[styles.sliderFill, { width: `${((newStress.level - 1) / 9) * 100}%` }]}
              />
            </View>
          </View>

          <View style={styles.sliderButtons}>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((val) => (
              <TouchableOpacity
                key={val}
                style={[
                  styles.sliderButton,
                  newStress.level === val && [
                    styles.sliderButtonActive,
                    { backgroundColor: getLevelColor(val) + "30", borderColor: getLevelColor(val) },
                  ],
                ]}
                onPress={() => setNewStress({ ...newStress, level: val })}
              >
                <Text
                  style={[
                    styles.sliderButtonText,
                    newStress.level === val && [
                      styles.sliderButtonTextActive,
                      { color: getLevelColor(val) },
                    ],
                  ]}
                >
                  {val}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <Input
          label="Description (Optional)"
          placeholder="Describe your stress..."
          value={newStress.description || ""}
          onChangeText={(text) => setNewStress({ ...newStress, description: text || undefined })}
          multiline
          style={styles.textArea}
          icon={<MaterialCommunityIcons name="text" size={20} color={colors.textSecondary} />}
        />

        <View style={styles.buttonRow}>
          <Button title="Save" onPress={saveStress} variant="primary" style={styles.button} />
          <Button title="Cancel" onPress={onCancel} variant="secondary" style={styles.button} />
        </View>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
    paddingTop: spacing.xl,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  card: {
    margin: spacing.lg,
  },
  sliderContainer: {
    marginBottom: spacing.lg,
  },
  sliderHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.md,
  },
  sliderLabel: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.textPrimary,
  },
  levelBadge: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.md,
  },
  levelText: {
    fontSize: 16,
    fontWeight: "700",
  },
  sliderTrackContainer: {
    marginBottom: spacing.md,
  },
  sliderTrack: {
    height: 8,
    backgroundColor: colors.border,
    borderRadius: borderRadius.sm,
    overflow: "hidden",
  },
  sliderFill: {
    height: "100%",
    borderRadius: borderRadius.sm,
  },
  sliderButtons: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.xs,
  },
  sliderButton: {
    flex: 1,
    height: 40,
    borderRadius: borderRadius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.cardBackground,
    justifyContent: "center",
    alignItems: "center",
  },
  sliderButtonActive: {
    borderWidth: 2,
  },
  sliderButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.textSecondary,
  },
  sliderButtonTextActive: {
    fontWeight: "700",
  },
  textArea: {
    minHeight: 100,
    textAlignVertical: "top",
  },
  buttonRow: {
    flexDirection: "row",
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  button: {
    flex: 1,
  },
});
