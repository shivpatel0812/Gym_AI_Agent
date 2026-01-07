import { useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from "react-native";
import LinearGradient from "../shared/LinearGradient";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import apiClient from "../../api/client";
import { WellnessSurvey } from "./types";
import Button from "../shared/Button";
import Input from "../shared/Input";
import Card from "../shared/Card";
import { colors, spacing, borderRadius } from "../../theme";

interface WellnessSurveyFormProps {
  survey?: WellnessSurvey | null;
  onSuccess: () => void;
  onCancel: () => void;
}

export default function WellnessSurveyForm({
  survey,
  onSuccess,
  onCancel,
}: WellnessSurveyFormProps) {
  const [newSurvey, setNewSurvey] = useState<WellnessSurvey>({
    date: survey?.date || new Date().toISOString().split("T")[0],
    fatigue: survey?.fatigue || 5,
    body_aches: survey?.body_aches || 5,
    energy: survey?.energy || 5,
    sleep_quality: survey?.sleep_quality || 5,
    mood: survey?.mood || 5,
  });

  const saveSurvey = async () => {
    try {
      if (survey && survey.id) {
        await apiClient.put(`/api/wellness-survey/${survey.id}`, newSurvey);
      } else {
        await apiClient.post("/api/wellness-survey", newSurvey);
      }
      setNewSurvey({
        date: new Date().toISOString().split("T")[0],
        fatigue: 5,
        body_aches: 5,
        energy: 5,
        sleep_quality: 5,
        mood: 5,
      });
      onSuccess();
    } catch (error) {
      console.error("Error saving survey:", error);
    }
  };

  const getScoreColor = (score: number, reverse: boolean = false) => {
    if (reverse) {
      if (score >= 7) return colors.danger;
      if (score >= 4) return colors.warning;
      return colors.success;
    }
    if (score >= 7) return colors.success;
    if (score >= 4) return colors.warning;
    return colors.danger;
  };

  const renderSlider = (
    label: string,
    value: number,
    onChange: (val: number) => void,
    icon: string,
    reverse: boolean = false
  ) => {
    const scoreColor = getScoreColor(value, reverse);
    return (
      <View style={styles.sliderContainer}>
        <View style={styles.sliderHeader}>
          <View style={styles.sliderLabelRow}>
            <MaterialCommunityIcons name={icon as any} size={20} color={scoreColor} />
            <Text style={styles.sliderLabel}>{label}</Text>
          </View>
          <View style={[styles.scoreBadge, { backgroundColor: scoreColor + "20" }]}>
            <Text style={[styles.scoreText, { color: scoreColor }]}>{value}/10</Text>
          </View>
        </View>
        <View style={styles.sliderTrackContainer}>
          <View style={styles.sliderTrack}>
            <LinearGradient
              colors={[scoreColor, scoreColor + "80"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={[styles.sliderFill, { width: `${((value - 1) / 9) * 100}%` }]}
            />
          </View>
        </View>
        <View style={styles.sliderButtons}>
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((val) => (
            <TouchableOpacity
              key={val}
              style={[
                styles.sliderButton,
                value === val && [
                  styles.sliderButtonActive,
                  { backgroundColor: scoreColor + "30", borderColor: scoreColor },
                ],
              ]}
              onPress={() => onChange(val)}
            >
              <Text
                style={[
                  styles.sliderButtonText,
                  value === val && [styles.sliderButtonTextActive, { color: scoreColor }],
                ]}
              >
                {val}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    );
  };

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <MaterialCommunityIcons name="clipboard-text" size={32} color={colors.accentSecondary} />
        <Text style={styles.title}>
          {survey ? "Edit Wellness Survey" : "Wellness Survey"}
        </Text>
      </View>

      <Card style={styles.card}>
        <Input
          label="Date"
          value={newSurvey.date}
          onChangeText={(text) => setNewSurvey({ ...newSurvey, date: text })}
          placeholder="YYYY-MM-DD"
          icon={<MaterialCommunityIcons name="calendar" size={20} color={colors.textSecondary} />}
        />

        {renderSlider(
          "Fatigue",
          newSurvey.fatigue,
          (val) => setNewSurvey({ ...newSurvey, fatigue: val }),
          "sleep",
          true
        )}
        {renderSlider(
          "Body Aches",
          newSurvey.body_aches,
          (val) => setNewSurvey({ ...newSurvey, body_aches: val }),
          "human-handsup",
          true
        )}
        {renderSlider(
          "Energy",
          newSurvey.energy || 5,
          (val) => setNewSurvey({ ...newSurvey, energy: val }),
          "lightning-bolt"
        )}
        {renderSlider(
          "Sleep Quality",
          newSurvey.sleep_quality || 5,
          (val) => setNewSurvey({ ...newSurvey, sleep_quality: val }),
          "weather-night"
        )}
        {renderSlider(
          "Mood",
          newSurvey.mood || 5,
          (val) => setNewSurvey({ ...newSurvey, mood: val }),
          "emoticon-happy"
        )}

        <View style={styles.buttonRow}>
          <Button title="Save" onPress={saveSurvey} variant="primary" style={styles.button} />
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
    marginBottom: spacing.xl,
  },
  sliderHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.md,
  },
  sliderLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  sliderLabel: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.textPrimary,
  },
  scoreBadge: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.md,
  },
  scoreText: {
    fontSize: 14,
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
    height: 36,
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
    fontSize: 12,
    fontWeight: "600",
    color: colors.textSecondary,
  },
  sliderButtonTextActive: {
    fontWeight: "700",
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
