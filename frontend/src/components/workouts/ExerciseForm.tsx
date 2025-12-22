import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView } from "react-native";
import apiClient from "../../api/client";

interface ExerciseFormProps {
  onSuccess: () => void;
  onCancel: () => void;
}

export default function ExerciseForm({ onSuccess, onCancel }: ExerciseFormProps) {
  const [newExercise, setNewExercise] = useState({
    name: "",
    type: "strength",
    muscle_group: "",
    is_custom: true,
  });

  const createExercise = async () => {
    try {
      await apiClient.post("/api/exercises", newExercise);
      setNewExercise({
        name: "",
        type: "strength",
        muscle_group: "",
        is_custom: true,
      });
      onSuccess();
    } catch (error) {
      console.error("Error creating exercise:", error);
    }
  };

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Create Exercise</Text>
      <TextInput
        style={styles.input}
        placeholder="Exercise name"
        value={newExercise.name}
        onChangeText={(text) => setNewExercise({ ...newExercise, name: text })}
      />
      <View style={styles.typeContainer}>
        <TouchableOpacity
          style={[styles.typeButton, newExercise.type === 'strength' && styles.typeButtonActive]}
          onPress={() => setNewExercise({ ...newExercise, type: 'strength' })}
        >
          <Text style={[styles.typeButtonText, newExercise.type === 'strength' && styles.typeButtonTextActive]}>Strength</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.typeButton, newExercise.type === 'cardio' && styles.typeButtonActive]}
          onPress={() => setNewExercise({ ...newExercise, type: 'cardio' })}
        >
          <Text style={[styles.typeButtonText, newExercise.type === 'cardio' && styles.typeButtonTextActive]}>Cardio</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.typeButton, newExercise.type === 'custom' && styles.typeButtonActive]}
          onPress={() => setNewExercise({ ...newExercise, type: 'custom' })}
        >
          <Text style={[styles.typeButtonText, newExercise.type === 'custom' && styles.typeButtonTextActive]}>Custom</Text>
        </TouchableOpacity>
      </View>
      <TextInput
        style={styles.input}
        placeholder="Muscle group (optional)"
        value={newExercise.muscle_group}
        onChangeText={(text) => setNewExercise({ ...newExercise, muscle_group: text })}
      />
      <View style={styles.buttonRow}>
        <TouchableOpacity style={[styles.button, styles.saveButton]} onPress={createExercise}>
          <Text style={styles.buttonText}>Save</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.button, styles.cancelButton]} onPress={onCancel}>
          <Text style={styles.buttonText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: 'white',
    borderRadius: 8,
    padding: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  input: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    fontSize: 16,
  },
  typeContainer: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  typeButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
  },
  typeButtonActive: {
    backgroundColor: '#2563eb',
    borderColor: '#2563eb',
  },
  typeButtonText: {
    fontSize: 14,
    color: '#6b7280',
  },
  typeButtonTextActive: {
    color: 'white',
    fontWeight: '600',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  button: {
    flex: 1,
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
  },
  saveButton: {
    backgroundColor: '#16a34a',
  },
  cancelButton: {
    backgroundColor: '#6b7280',
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
});
