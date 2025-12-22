import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView } from "react-native";
import apiClient from "../../api/client";
import { BodyFeeling } from "./types";

interface BodyFeelingFormProps {
  feeling?: BodyFeeling | null;
  onSuccess: () => void;
  onCancel: () => void;
}

export default function BodyFeelingForm({
  feeling,
  onSuccess,
  onCancel,
}: BodyFeelingFormProps) {
  const [newFeeling, setNewFeeling] = useState<BodyFeeling>({
    date: feeling?.date || new Date().toISOString().split("T")[0],
    description: feeling?.description || "",
  });

  const saveFeeling = async () => {
    try {
      if (feeling && feeling.id) {
        await apiClient.put(`/api/body-feelings/${feeling.id}`, newFeeling);
      } else {
        await apiClient.post("/api/body-feelings", newFeeling);
      }
      setNewFeeling({
        date: new Date().toISOString().split("T")[0],
        description: "",
      });
      onSuccess();
    } catch (error) {
      console.error("Error saving body feeling:", error);
    }
  };

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>{feeling ? "Edit Body Feeling" : "Log Body Feeling"}</Text>
      <TextInput
        style={styles.input}
        value={newFeeling.date}
        onChangeText={(text) => setNewFeeling({ ...newFeeling, date: text })}
        placeholder="Date (YYYY-MM-DD)"
      />
      <TextInput
        style={[styles.input, styles.textArea]}
        placeholder="Describe how your body feels (energy, fatigue, etc.)..."
        value={newFeeling.description}
        onChangeText={(text) => setNewFeeling({ ...newFeeling, description: text })}
        multiline
      />
      <View style={styles.buttonRow}>
        <TouchableOpacity style={[styles.button, styles.saveButton]} onPress={saveFeeling}>
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
    height: 150,
    textAlignVertical: 'top',
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
