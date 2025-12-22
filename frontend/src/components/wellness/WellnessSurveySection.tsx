import { useState, useEffect } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Modal } from "react-native";
import apiClient from "../../api/client";
import { WellnessSurvey } from "./types";
import WellnessSurveyForm from "./WellnessSurveyForm";

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

  return (
    <View style={styles.container}>
      <Text style={styles.sectionTitle}>Wellness Survey</Text>
      <TouchableOpacity
        style={styles.button}
        onPress={() => setShowSurveyForm(true)}
      >
        <Text style={styles.buttonText}>Complete Survey</Text>
      </TouchableOpacity>

      <Modal visible={showSurveyForm} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
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
        </View>
      </Modal>

      {surveys.map((survey) => (
        <View key={survey.id} style={styles.card}>
          <View style={styles.cardContent}>
            <Text style={styles.cardTitle}>{survey.date}</Text>
            <Text style={styles.cardText}>Fatigue: {survey.fatigue}/10</Text>
            <Text style={styles.cardText}>
              Body Aches: {survey.body_aches}/10
            </Text>
            {survey.energy && (
              <Text style={styles.cardText}>Energy: {survey.energy}/10</Text>
            )}
            {survey.sleep_quality && (
              <Text style={styles.cardText}>
                Sleep Quality: {survey.sleep_quality}/10
              </Text>
            )}
            {survey.mood && (
              <Text style={styles.cardText}>Mood: {survey.mood}/10</Text>
            )}
          </View>
          <View style={styles.cardActions}>
            <TouchableOpacity
              style={styles.editButton}
              onPress={() => {
                setEditingSurvey(survey);
                setShowSurveyForm(true);
              }}
            >
              <Text style={styles.editButtonText}>Edit</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.deleteButton}
              onPress={() => survey.id && deleteSurvey(survey.id)}
            >
              <Text style={styles.deleteButtonText}>Delete</Text>
            </TouchableOpacity>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: "600",
    marginBottom: 16,
    color: "#111827",
  },
  button: {
    backgroundColor: "#2563eb",
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    alignItems: "center",
  },
  buttonText: {
    color: "white",
    fontSize: 16,
    fontWeight: "600",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    padding: 20,
  },
  modalContent: {
    backgroundColor: "white",
    borderRadius: 8,
    maxHeight: "90%",
  },
  card: {
    backgroundColor: "white",
    borderRadius: 8,
    padding: 16,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  cardContent: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 8,
  },
  cardText: {
    fontSize: 14,
    color: "#374151",
    marginBottom: 4,
  },
  cardActions: {
    flexDirection: "row",
    gap: 8,
    marginTop: 12,
  },
  editButton: {
    backgroundColor: "#2563eb",
    borderRadius: 6,
    padding: 6,
    paddingHorizontal: 12,
    flex: 1,
    alignItems: "center",
  },
  editButtonText: {
    color: "white",
    fontSize: 14,
    fontWeight: "600",
  },
  deleteButton: {
    backgroundColor: "#ef4444",
    borderRadius: 6,
    padding: 6,
    paddingHorizontal: 12,
    flex: 1,
    alignItems: "center",
  },
  deleteButtonText: {
    color: "white",
    fontSize: 14,
    fontWeight: "600",
  },
});
