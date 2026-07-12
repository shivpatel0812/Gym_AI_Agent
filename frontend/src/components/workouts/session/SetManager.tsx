import { View, Text, TextInput, TouchableOpacity, StyleSheet } from "react-native";
import { useState } from "react";

interface Set {
  set_number: number;
  reps: string;
  weight: string;
  // Phase 1: Optional enhanced tracking fields
  rpe?: number;
  rir?: number;
  completed?: boolean;
  form_quality?: string;
  notes?: string;
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
  const [showEnhancedFields, setShowEnhancedFields] = useState(false);
  const [currentRPE, setCurrentRPE] = useState("");
  const [currentCompleted, setCurrentCompleted] = useState(true);

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

      {/* Phase 1: Optional enhanced tracking fields */}
      <TouchableOpacity
        style={styles.toggleButton}
        onPress={() => setShowEnhancedFields(!showEnhancedFields)}
      >
        <Text style={styles.toggleButtonText}>
          {showEnhancedFields ? "Hide" : "Show"} Advanced Tracking
        </Text>
      </TouchableOpacity>

      {showEnhancedFields && (
        <View style={styles.enhancedFields}>
          <Text style={styles.fieldLabel}>RPE (1-10, optional):</Text>
          <TextInput
            style={[styles.input, styles.smallInput]}
            placeholder="Rate difficulty (1-10)"
            value={currentRPE}
            onChangeText={setCurrentRPE}
            keyboardType="numeric"
          />

          <View style={styles.checkboxRow}>
            <TouchableOpacity
              style={styles.checkbox}
              onPress={() => setCurrentCompleted(!currentCompleted)}
            >
              <View style={[styles.checkboxInner, currentCompleted && styles.checkboxChecked]}>
                {currentCompleted && <Text style={styles.checkmark}>✓</Text>}
              </View>
              <Text style={styles.checkboxLabel}>Set completed successfully</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {sets.length > 0 && (
        <View style={styles.setsList}>
          {sets.map((set, idx) => (
            <View key={idx} style={styles.setItem}>
              <View style={styles.setItemContent}>
                <Text style={styles.setItemText}>
                  Set {set.set_number}: {set.reps} reps
                  {set.weight && ` @ ${set.weight}lbs`}
                  {set.rpe && ` (RPE: ${set.rpe})`}
                  {set.completed === false && " ❌"}
                </Text>
              </View>
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
  toggleButton: {
    backgroundColor: "#f3f4f6",
    borderRadius: 6,
    padding: 8,
    marginBottom: 8,
    alignItems: "center",
  },
  toggleButtonText: {
    color: "#6b7280",
    fontSize: 12,
    fontWeight: "500",
  },
  enhancedFields: {
    backgroundColor: "#fefce8",
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#fef08a",
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: "500",
    color: "#374151",
    marginBottom: 4,
  },
  smallInput: {
    marginBottom: 12,
  },
  checkboxRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  checkbox: {
    flexDirection: "row",
    alignItems: "center",
  },
  checkboxInner: {
    width: 20,
    height: 20,
    borderWidth: 2,
    borderColor: "#d1d5db",
    borderRadius: 4,
    marginRight: 8,
    justifyContent: "center",
    alignItems: "center",
  },
  checkboxChecked: {
    backgroundColor: "#2563eb",
    borderColor: "#2563eb",
  },
  checkmark: {
    color: "white",
    fontSize: 14,
    fontWeight: "bold",
  },
  checkboxLabel: {
    fontSize: 13,
    color: "#374151",
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
  setItemContent: {
    flex: 1,
  },
  setItemText: {
    fontSize: 14,
    color: "#374151",
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













