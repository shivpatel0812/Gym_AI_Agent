import { useState, useEffect } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Modal, FlatList } from "react-native";
import apiClient from "../../api/client";
import { Exercise } from "./types";
import ExerciseForm from "./ExerciseForm";

interface ExercisesSectionProps {
  onExercisesUpdate: () => void;
}

export default function ExercisesSection({ onExercisesUpdate }: ExercisesSectionProps) {
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [showExerciseForm, setShowExerciseForm] = useState(false);

  useEffect(() => {
    fetchExercises();
  }, []);

  const fetchExercises = async () => {
    try {
      const res = await apiClient.get("/api/exercises");
      setExercises(res.data);
      onExercisesUpdate();
    } catch (error) {
      console.error("Error fetching exercises:", error);
    }
  };

  const filteredExercises = exercises.filter((ex) =>
    ex.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <View style={styles.container}>
      <Text style={styles.sectionTitle}>Exercises</Text>
      <View style={styles.searchRow}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search exercises..."
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
        <TouchableOpacity
          style={styles.button}
          onPress={() => setShowExerciseForm(true)}
        >
          <Text style={styles.buttonText}>Create Exercise</Text>
        </TouchableOpacity>
      </View>

      <Modal visible={showExerciseForm} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <ExerciseForm
              onSuccess={() => {
                setShowExerciseForm(false);
                fetchExercises();
              }}
              onCancel={() => setShowExerciseForm(false)}
            />
          </View>
        </View>
      </Modal>

      <FlatList
        data={filteredExercises}
        keyExtractor={(item) => item.id}
        numColumns={2}
        renderItem={({ item }) => (
          <View style={styles.exerciseCard}>
            <Text style={styles.exerciseName}>{item.name}</Text>
            <Text style={styles.exerciseType}>{item.type}</Text>
            {item.muscle_group && (
              <Text style={styles.muscleGroup}>{item.muscle_group}</Text>
            )}
          </View>
        )}
        contentContainerStyle={styles.listContent}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '600',
    marginBottom: 16,
    color: '#111827',
  },
  searchRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  searchInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
  },
  button: {
    backgroundColor: '#2563eb',
    borderRadius: 8,
    padding: 12,
    justifyContent: 'center',
  },
  buttonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: 'white',
    borderRadius: 8,
  },
  listContent: {
    gap: 12,
  },
  exerciseCard: {
    backgroundColor: 'white',
    borderRadius: 8,
    padding: 16,
    flex: 1,
    margin: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  exerciseName: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  exerciseType: {
    fontSize: 14,
    color: '#6b7280',
  },
  muscleGroup: {
    fontSize: 12,
    color: '#9ca3af',
    marginTop: 4,
  },
});
