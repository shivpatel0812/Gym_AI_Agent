import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView } from "react-native";
import apiClient from "../../api/client";

interface SplitFormProps {
  onSuccess: () => void;
  onCancel: () => void;
}

export default function SplitForm({ onSuccess, onCancel }: SplitFormProps) {
  const [newSplit, setNewSplit] = useState({ name: "", days: [""] });

  const createSplit = async () => {
    try {
      await apiClient.post("/api/splits", {
        ...newSplit,
        days: newSplit.days.filter((d) => d.trim()),
      });
      setNewSplit({ name: "", days: [""] });
      onSuccess();
    } catch (error) {
      console.error("Error creating split:", error);
    }
  };

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Create Split</Text>
      <TextInput
        style={styles.input}
        placeholder="Split name (e.g., Push/Pull/Legs)"
        value={newSplit.name}
        onChangeText={(text) => setNewSplit({ ...newSplit, name: text })}
      />
      {newSplit.days.map((day, idx) => (
        <TextInput
          key={idx}
          style={styles.input}
          placeholder={`Day ${idx + 1} name`}
          value={day}
          onChangeText={(text) => {
            const days = [...newSplit.days];
            days[idx] = text;
            setNewSplit({ ...newSplit, days });
          }}
        />
      ))}
      <TouchableOpacity
        style={styles.addDayButton}
        onPress={() => setNewSplit({ ...newSplit, days: [...newSplit.days, ""] })}
      >
        <Text style={styles.addDayButtonText}>Add Day</Text>
      </TouchableOpacity>
      <View style={styles.buttonRow}>
        <TouchableOpacity style={[styles.button, styles.saveButton]} onPress={createSplit}>
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
  addDayButton: {
    backgroundColor: '#6b7280',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    alignItems: 'center',
  },
  addDayButtonText: {
    color: 'white',
    fontSize: 14,
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
