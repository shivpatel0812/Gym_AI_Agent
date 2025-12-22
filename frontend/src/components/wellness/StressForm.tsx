import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView } from "react-native";
import apiClient from "../../api/client";
import { StressEntry } from "./types";

interface StressFormProps {
  entry?: StressEntry | null;
  onSuccess: () => void;
  onCancel: () => void;
}

export default function StressForm({ entry, onSuccess, onCancel }: StressFormProps) {
  const [newStress, setNewStress] = useState<StressEntry>({
    date: entry?.date || new Date().toISOString().split("T")[0],
    level: entry?.level || 5,
    description: entry?.description || "",
  });

  const saveStress = async () => {
    try {
      if (entry && entry.id) {
        await apiClient.put(`/api/stress/${entry.id}`, newStress);
      } else {
        await apiClient.post("/api/stress", newStress);
      }
      setNewStress({
        date: new Date().toISOString().split("T")[0],
        level: 5,
        description: "",
      });
      onSuccess();
    } catch (error) {
      console.error("Error saving stress entry:", error);
    }
  };

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>{entry ? "Edit Stress" : "Log Stress"}</Text>
      <TextInput
        style={styles.input}
        value={newStress.date}
        onChangeText={(text) => setNewStress({ ...newStress, date: text })}
        placeholder="Date (YYYY-MM-DD)"
      />
      <View style={styles.sliderContainer}>
        <Text style={styles.sliderLabel}>Stress Level (1-10): {newStress.level}</Text>
        <View style={styles.sliderRow}>
          <Text style={styles.sliderMin}>1</Text>
          <View style={styles.sliderTrack}>
            <View style={[styles.sliderFill, { width: `${(newStress.level - 1) * 11.11}%` }]} />
          </View>
          <Text style={styles.sliderMax}>10</Text>
        </View>
        <View style={styles.sliderButtons}>
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((val) => (
            <TouchableOpacity
              key={val}
              style={[styles.sliderButton, newStress.level === val && styles.sliderButtonActive]}
              onPress={() => setNewStress({ ...newStress, level: val })}
            >
              <Text style={[styles.sliderButtonText, newStress.level === val && styles.sliderButtonTextActive]}>
                {val}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
      <TextInput
        style={[styles.input, styles.textArea]}
        placeholder="Describe your stress..."
        value={newStress.description || ""}
        onChangeText={(text) => setNewStress({ ...newStress, description: text || undefined })}
        multiline
      />
      <View style={styles.buttonRow}>
        <TouchableOpacity style={[styles.button, styles.saveButton]} onPress={saveStress}>
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
  textArea: {
    height: 100,
    textAlignVertical: 'top',
  },
  sliderContainer: {
    marginBottom: 16,
  },
  sliderLabel: {
    fontSize: 16,
    marginBottom: 8,
  },
  sliderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  sliderTrack: {
    flex: 1,
    height: 4,
    backgroundColor: '#e5e7eb',
    borderRadius: 2,
    marginHorizontal: 8,
  },
  sliderFill: {
    height: '100%',
    backgroundColor: '#2563eb',
    borderRadius: 2,
  },
  sliderMin: {
    fontSize: 12,
    color: '#6b7280',
  },
  sliderMax: {
    fontSize: 12,
    color: '#6b7280',
  },
  sliderButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  sliderButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: '#d1d5db',
    justifyContent: 'center',
    alignItems: 'center',
  },
  sliderButtonActive: {
    backgroundColor: '#2563eb',
    borderColor: '#2563eb',
  },
  sliderButtonText: {
    fontSize: 12,
    color: '#6b7280',
  },
  sliderButtonTextActive: {
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
