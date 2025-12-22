import { useState, useEffect } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Modal } from "react-native";
import apiClient from "../../api/client";
import { Exercise, Split, WorkoutSession } from "./types";
import SessionForm from "./session";

interface SessionsSectionProps {
  exercises: Exercise[];
  splits: Split[];
}

export default function SessionsSection({
  exercises,
  splits,
}: SessionsSectionProps) {
  const [sessions, setSessions] = useState<WorkoutSession[]>([]);
  const [showSessionForm, setShowSessionForm] = useState(false);
  const [editingSession, setEditingSession] = useState<WorkoutSession | null>(
    null
  );

  useEffect(() => {
    fetchSessions();
  }, []);

  const fetchSessions = async () => {
    try {
      const res = await apiClient.get("/api/workout-sessions");
      setSessions(res.data);
    } catch (error) {
      console.error("Error fetching sessions:", error);
    }
  };

  const createSession = async (session: WorkoutSession) => {
    try {
      if (editingSession && editingSession.id) {
        await apiClient.put(
          `/api/workout-sessions/${editingSession.id}`,
          session
        );
      } else {
        await apiClient.post("/api/workout-sessions", session);
      }
      setShowSessionForm(false);
      setEditingSession(null);
      fetchSessions();
    } catch (error) {
      console.error("Error saving session:", error);
    }
  };

  const handleEdit = (session: WorkoutSession) => {
    setEditingSession(session);
    setShowSessionForm(true);
  };

  const handleDelete = async (sessionId: string) => {
    try {
      await apiClient.delete(`/api/workout-sessions/${sessionId}`);
      fetchSessions();
    } catch (error) {
      console.error("Error deleting session:", error);
    }
  };

  const handleCancel = () => {
    setShowSessionForm(false);
    setEditingSession(null);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.sectionTitle}>Workout Sessions</Text>
      <TouchableOpacity
        style={styles.button}
        onPress={() => setShowSessionForm(true)}
      >
        <Text style={styles.buttonText}>Log Workout</Text>
      </TouchableOpacity>

      <Modal visible={showSessionForm} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <SessionForm
              exercises={exercises}
              splits={splits}
              onSuccess={createSession}
              onCancel={handleCancel}
              initialSession={editingSession || undefined}
            />
          </View>
        </View>
      </Modal>

      {sessions.map((session) => (
        <View key={session.id} style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>
              {session.date} {session.split_name && `- ${session.split_name}`}
            </Text>
            <View style={styles.cardActions}>
              <TouchableOpacity
                style={styles.editButton}
                onPress={() => handleEdit(session)}
              >
                <Text style={styles.editButtonText}>Edit</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.deleteButton}
                onPress={() => session.id && handleDelete(session.id)}
              >
                <Text style={styles.deleteButtonText}>Delete</Text>
              </TouchableOpacity>
            </View>
          </View>
          {session.exercises.map((ex, idx) => (
            <View key={idx} style={styles.exerciseCard}>
              <Text style={styles.exerciseName}>{ex.exercise_name}</Text>
              {Array.isArray(ex.sets) ? (
                ex.sets.map((set: any, setIdx: number) => (
                  <Text key={setIdx} style={styles.setText}>
                    Set {set.set_number}: {set.reps} reps
                    {set.weight && ` @ ${set.weight}lbs`}
                  </Text>
                ))
              ) : (
                <Text style={styles.cardText}>
                  {ex.sets} sets x {ex.reps} reps
                  {ex.weight && ` @ ${ex.weight}lbs`}
                </Text>
              )}
            </View>
          ))}
          {session.notes && (
            <Text style={styles.cardNotes}>{session.notes}</Text>
          )}
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
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: "600",
    flex: 1,
  },
  cardActions: {
    flexDirection: "row",
    gap: 8,
  },
  editButton: {
    backgroundColor: "#2563eb",
    borderRadius: 6,
    padding: 6,
    paddingHorizontal: 12,
  },
  editButtonText: {
    color: "white",
    fontSize: 12,
    fontWeight: "600",
  },
  deleteButton: {
    backgroundColor: "#ef4444",
    borderRadius: 6,
    padding: 6,
    paddingHorizontal: 12,
  },
  deleteButtonText: {
    color: "white",
    fontSize: 12,
    fontWeight: "600",
  },
  exerciseCard: {
    backgroundColor: "#f3f4f6",
    borderRadius: 6,
    padding: 10,
    marginBottom: 8,
  },
  exerciseName: {
    fontSize: 15,
    fontWeight: "600",
    color: "#111827",
    marginBottom: 4,
  },
  setText: {
    fontSize: 13,
    color: "#6b7280",
    marginLeft: 8,
    marginBottom: 2,
  },
  cardText: {
    fontSize: 14,
    color: "#374151",
    marginBottom: 4,
  },
  cardNotes: {
    fontSize: 14,
    color: "#6b7280",
    marginTop: 8,
    fontStyle: "italic",
  },
});
