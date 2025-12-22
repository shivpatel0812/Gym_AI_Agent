import { View, Text, TextInput, TouchableOpacity, StyleSheet } from "react-native";

interface Set {
  set_number: number;
  reps: string;
  weight: string;
}

interface SetManagerProps {
  sets: Set[];
  currentReps: string;
  currentWeight: string;
  onRepsChange: (reps: string) => void;
  onWeightChange: (weight: string) => void;
  onAddSet: () => void;
  onRemoveSet: (index: number) => void;
}

export default function SetManager({
  sets,
  currentReps,
  currentWeight,
  onRepsChange,
  onWeightChange,
  onAddSet,
  onRemoveSet,
}: SetManagerProps) {
  return (
    <View>
      <Text style={styles.subsectionTitle}>Add Sets</Text>
      <View style={styles.exerciseInputs}>
        <TextInput
          style={[styles.input, styles.exerciseInput]}
          placeholder="Reps"
          value={currentReps}
          onChangeText={onRepsChange}
          keyboardType="numeric"
        />
        <TextInput
          style={[styles.input, styles.exerciseInput]}
          placeholder="Weight (optional)"
          value={currentWeight}
          onChangeText={onWeightChange}
          keyboardType="numeric"
        />
        <TouchableOpacity style={styles.addSetButton} onPress={onAddSet}>
          <Text style={styles.buttonText}>Add Set</Text>
        </TouchableOpacity>
      </View>
      {sets.length > 0 && (
        <View style={styles.setsList}>
          {sets.map((set, idx) => (
            <View key={idx} style={styles.setItem}>
              <Text style={styles.setItemText}>
                Set {set.set_number}: {set.reps} reps
                {set.weight && ` @ ${set.weight}lbs`}
              </Text>
              <TouchableOpacity
                onPress={() => onRemoveSet(idx)}
                style={styles.removeSetButton}
              >
                <Text style={styles.removeSetButtonText}>Remove</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  subsectionTitle: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 8,
    color: "#374151",
  },
  exerciseInputs: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
  },
  exerciseInput: {
    flex: 1,
  },
  addSetButton: {
    backgroundColor: "#2563eb",
    borderRadius: 8,
    padding: 12,
    justifyContent: "center",
  },
  buttonText: {
    color: "white",
    fontSize: 16,
    fontWeight: "600",
  },
  setsList: {
    marginBottom: 12,
  },
  setItem: {
    backgroundColor: "#f3f4f6",
    borderRadius: 6,
    padding: 10,
    marginBottom: 6,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  setItemText: {
    fontSize: 14,
    color: "#374151",
    flex: 1,
  },
  removeSetButton: {
    backgroundColor: "#ef4444",
    borderRadius: 4,
    padding: 4,
    paddingHorizontal: 8,
  },
  removeSetButtonText: {
    color: "white",
    fontSize: 11,
    fontWeight: "600",
  },
});

