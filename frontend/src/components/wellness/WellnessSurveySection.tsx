import { useState, useEffect } from "react";
import { View, Text, StyleSheet, Modal, ScrollView } from "react-native";
import BlurView from "../shared/BlurView";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import apiClient from "../../api/client";
import { WellnessSurvey } from "./types";
import WellnessSurveyForm from "./WellnessSurveyForm";
import Button from "../shared/Button";
import Card from "../shared/Card";
import { colors, spacing, borderRadius, shadows } from "../../theme";

export default function WellnessSurveySection() {
  const [surveys, setSurveys] = useState<WellnessSurvey[]>([]);
  const [showSurveyForm, setShowSurveyForm] = useState(false);
  const [editingSurvey, setEditingSurvey] = useState<WellnessSurvey | null>(null);

  useEffect(() => {
    fetchSurveys();
  }, []);

  const fetchSurveys = async () => {
    try {
      const res = await apiClient.get("/api/wellness-survey");
      setSurveys(res.data);
    } catch (error) {
      console.error("Error fetching surveys:", error);
    }
  };

  const deleteSurvey = async (id: string) => {
    try {
      await apiClient.delete(`/api/wellness-survey/${id}`);
      fetchSurveys();
    } catch (error) {
      console.error("Error deleting survey:", error);
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 7) return colors.success;
    if (score >= 4) return colors.warning;
    return colors.danger;
  };

  return (
    <View style={styles.container}>
      <Button
        title="Complete Survey"
        onPress={() => setShowSurveyForm(true)}
        variant="primary"
        icon={<MaterialCommunityIcons name="clipboard-text" size={20} color={colors.textPrimary} />}
        style={styles.button}
      />

      <Modal visible={showSurveyForm} animationType="slide" transparent>
        <BlurView intensity={20} style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <WellnessSurveyForm
              survey={editingSurvey}
              onSuccess={() => {
                setShowSurveyForm(false);
                setEditingSurvey(null);
                fetchSurveys();
              }}
              onCancel={() => {
                setShowSurveyForm(false);
                setEditingSurvey(null);
              }}
            />
          </View>
        </BlurView>
      </Modal>

      <ScrollView showsVerticalScrollIndicator={false}>
        {surveys.map((survey) => (
          <Card key={survey.id} style={styles.card}>
            <View style={styles.cardHeader}>
              <MaterialCommunityIcons
                name="clipboard-text"
                size={24}
                color={colors.accentSecondary}
              />
              <Text style={styles.cardDate}>{survey.date}</Text>
            </View>

            <View style={styles.scoresContainer}>
              <View style={styles.scoreRow}>
                <Text style={styles.scoreLabel}>Fatigue</Text>
                <View style={[styles.scoreBadge, { backgroundColor: getScoreColor(survey.fatigue) + "20" }]}>
                  <Text style={[styles.scoreValue, { color: getScoreColor(survey.fatigue) }]}>
                    {survey.fatigue}/10
                  </Text>
                </View>
              </View>
              <View style={styles.scoreRow}>
                <Text style={styles.scoreLabel}>Body Aches</Text>
                <View style={[styles.scoreBadge, { backgroundColor: getScoreColor(survey.body_aches) + "20" }]}>
                  <Text style={[styles.scoreValue, { color: getScoreColor(survey.body_aches) }]}>
                    {survey.body_aches}/10
                  </Text>
                </View>
              </View>
              {survey.energy && (
                <View style={styles.scoreRow}>
                  <Text style={styles.scoreLabel}>Energy</Text>
                  <View style={[styles.scoreBadge, { backgroundColor: getScoreColor(survey.energy) + "20" }]}>
                    <Text style={[styles.scoreValue, { color: getScoreColor(survey.energy) }]}>
                      {survey.energy}/10
                    </Text>
                  </View>
                </View>
              )}
              {survey.sleep_quality && (
                <View style={styles.scoreRow}>
                  <Text style={styles.scoreLabel}>Sleep Quality</Text>
                  <View style={[styles.scoreBadge, { backgroundColor: getScoreColor(survey.sleep_quality) + "20" }]}>
                    <Text style={[styles.scoreValue, { color: getScoreColor(survey.sleep_quality) }]}>
                      {survey.sleep_quality}/10
                    </Text>
                  </View>
                </View>
              )}
              {survey.mood && (
                <View style={styles.scoreRow}>
                  <Text style={styles.scoreLabel}>Mood</Text>
                  <View style={[styles.scoreBadge, { backgroundColor: getScoreColor(survey.mood) + "20" }]}>
                    <Text style={[styles.scoreValue, { color: getScoreColor(survey.mood) }]}>
                      {survey.mood}/10
                    </Text>
                  </View>
                </View>
              )}
            </View>

            <View style={styles.cardActions}>
              <Button
                title="Edit"
                onPress={() => {
                  setEditingSurvey(survey);
                  setShowSurveyForm(true);
                }}
                variant="secondary"
                style={styles.actionButton}
              />
              <Button
                title="Delete"
                onPress={() => survey.id && deleteSurvey(survey.id)}
                variant="danger"
                style={styles.actionButton}
              />
            </View>
          </Card>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: spacing.lg,
  },
  button: {
    marginBottom: spacing.lg,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: "center",
    padding: spacing.lg,
  },
  modalContent: {
    backgroundColor: colors.cardBackground,
    borderRadius: borderRadius.xl,
    maxHeight: "90%",
    borderWidth: 1,
    borderColor: colors.border,
  },
  card: {
    marginBottom: spacing.md,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  cardDate: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.textPrimary,
  },
  scoresContainer: {
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  scoreRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  scoreLabel: {
    fontSize: 14,
    color: colors.textSecondary,
    fontWeight: "500",
  },
  scoreBadge: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.md,
  },
  scoreValue: {
    fontSize: 14,
    fontWeight: "700",
  },
  cardActions: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  actionButton: {
    flex: 1,
  },
});
