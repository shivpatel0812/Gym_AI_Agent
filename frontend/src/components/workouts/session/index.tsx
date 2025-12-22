import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
} from "react-native";
import { Exercise, Split, WorkoutSession } from "../types";
import SplitSelector from "./SplitSelector";
import ExerciseInput from "./ExerciseInput";
import SetManager from "./SetManager";
import ExerciseList from "./ExerciseList";

interface SessionFormProps {
  exercises: Exercise[];
  splits: Split[];
  onSuccess: (session: WorkoutSession) => void;
  onCancel: () => void;
  initialSession?: WorkoutSession;
}

export default function SessionForm({
  exercises,
  splits,
  onSuccess,
  onCancel,
  initialSession,
}: SessionFormProps) {
  const [newSession, setNewSession] = useState<WorkoutSession>(
    initialSession || {
      date: new Date().toISOString().split("T")[0],
      exercises: [],
      split_name: "",
      notes: "",
    }
  );
  const [exerciseNameInput, setExerciseNameInput] = useState("");
  const [currentSets, setCurrentSets] = useState<
    Array<{ set_number: number; reps: string; weight: string }>
  >([]);
  const [currentSetReps, setCurrentSetReps] = useState("");
  const [currentSetWeight, setCurrentSetWeight] = useState("");
  const [selectedDay, setSelectedDay] = useState(
    (initialSession as any)?.selected_day || ""
  );

  const getFilteredExercisesByDay = () => {
    if (!selectedDay) return exercises;
    const dayLower = selectedDay.toLowerCase();
    return exercises.filter((ex) => {
      const nameMatch = ex.name.toLowerCase().includes(dayLower);
      const muscleMatch = ex.muscle_group?.toLowerCase().includes(dayLower);
      const typeMatch = ex.type?.toLowerCase().includes(dayLower);
      return nameMatch || muscleMatch || typeMatch;
    });
  };

  const filteredExercises = getFilteredExercisesByDay();

  const addSet = () => {
    if (currentSetReps.trim()) {
      const newSet = {
        set_number: currentSets.length + 1,
        reps: currentSetReps.trim(),
        weight: currentSetWeight.trim() || "",
      };
      setCurrentSets([...currentSets, newSet]);
      setCurrentSetReps("");
      setCurrentSetWeight("");
    }
  };

  const removeSet = (index: number) => {
    const updatedSets = currentSets
      .filter((_, i) => i !== index)
      .map((set, i) => ({ ...set, set_number: i + 1 }));
    setCurrentSets(updatedSets);
  };

  const addExerciseToSession = () => {
    if (exerciseNameInput.trim() && currentSets.length > 0) {
      const matchedExercise = exercises.find(
        (ex) => ex.name.toLowerCase() === exerciseNameInput.trim().toLowerCase()
      );
      const setsData = currentSets.map((set) => ({
        set_number: set.set_number,
        reps: parseInt(set.reps),
        weight: set.weight ? parseFloat(set.weight) : null,
      }));
      const exerciseEntry = {
        exercise_id: matchedExercise
          ? matchedExercise.id
          : `custom-${Date.now()}`,
        exercise_name: exerciseNameInput.trim(),
        sets: setsData,
        is_custom: !matchedExercise,
      };
      setNewSession({
        ...newSession,
        exercises: [...newSession.exercises, exerciseEntry],
      });
      setExerciseNameInput("");
      setCurrentSets([]);
      setCurrentSetReps("");
      setCurrentSetWeight("");
    }
  };

  const handleSave = () => {
    onSuccess(newSession);
    if (!initialSession) {
      setNewSession({
        date: new Date().toISOString().split("T")[0],
        exercises: [],
        split_name: "",
        notes: "",
      });
      setSelectedDay("");
      setExerciseNameInput("");
      setCurrentSets([]);
      setCurrentSetReps("");
      setCurrentSetWeight("");
    }
  };

  const removeExercise = (index: number) => {
    const updatedExercises = [...newSession.exercises];
    updatedExercises.splice(index, 1);
    setNewSession({ ...newSession, exercises: updatedExercises });
  };

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>
        {initialSession ? "Edit Workout" : "Log Workout"}
      </Text>
      <TextInput
        style={styles.input}
        value={newSession.date}
        onChangeText={(text) => setNewSession({ ...newSession, date: text })}
        placeholder="Date (YYYY-MM-DD)"
      />
      <SplitSelector
        splits={splits}
        selectedSplitName={newSession.split_name || ""}
        selectedDay={selectedDay}
        onSplitChange={(splitName) => {
          setNewSession({ ...newSession, split_name: splitName });
          setSelectedDay("");
        }}
        onDayChange={setSelectedDay}
      />

      <Text style={styles.sectionTitle}>Add Exercise</Text>
      <ExerciseInput
        exercises={filteredExercises}
        value={exerciseNameInput}
        onChange={setExerciseNameInput}
      />
      {exerciseNameInput.trim() && (
        <View>
          <SetManager
            sets={currentSets}
            currentReps={currentSetReps}
            currentWeight={currentSetWeight}
            onRepsChange={setCurrentSetReps}
            onWeightChange={setCurrentSetWeight}
            onAddSet={addSet}
            onRemoveSet={removeSet}
          />
          {currentSets.length > 0 && (
            <TouchableOpacity
              style={styles.addExerciseButton}
              onPress={addExerciseToSession}
            >
              <Text style={styles.buttonText}>Add Exercise</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      <Text style={styles.sectionTitle}>Exercises in Session</Text>
      <ExerciseList
        exercises={newSession.exercises}
        onRemove={removeExercise}
      />

      <TextInput
        style={[styles.input, styles.textArea]}
        placeholder="Notes (optional)"
        value={newSession.notes || ""}
        onChangeText={(text) => setNewSession({ ...newSession, notes: text })}
        multiline
      />

      <View style={styles.buttonRow}>
        <TouchableOpacity
          style={[styles.button, styles.saveButton]}
          onPress={handleSave}
        >
          <Text style={styles.buttonText}>Save Session</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.button, styles.cancelButton]}
          onPress={onCancel}
        >
          <Text style={styles.buttonText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: "white",
    borderRadius: 8,
    padding: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: "bold",
    marginBottom: 16,
  },
  input: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    fontSize: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 8,
    marginTop: 8,
  },
  addExerciseButton: {
    backgroundColor: "#16a34a",
    borderRadius: 8,
    padding: 12,
    alignItems: "center",
    marginTop: 12,
  },
  buttonText: {
    color: "white",
    fontSize: 16,
    fontWeight: "600",
  },
  textArea: {
    height: 100,
    textAlignVertical: "top",
  },
  buttonRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 16,
  },
  button: {
    flex: 1,
    borderRadius: 8,
    padding: 12,
    alignItems: "center",
  },
  saveButton: {
    backgroundColor: "#16a34a",
  },
  cancelButton: {
    backgroundColor: "#6b7280",
  },
});

