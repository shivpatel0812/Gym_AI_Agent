import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView } from "react-native";
import apiClient from "../../api/client";
import { WellnessSurvey } from "./types";

interface WellnessSurveyFormProps {
  survey?: WellnessSurvey | null;
  onSuccess: () => void;
  onCancel: () => void;
}

export default function WellnessSurveyForm({
  survey,
  onSuccess,
  onCancel,
}: WellnessSurveyFormProps) {
  const [newSurvey, setNewSurvey] = useState<WellnessSurvey>({
    date: survey?.date || new Date().toISOString().split("T")[0],
    fatigue: survey?.fatigue || 5,
    body_aches: survey?.body_aches || 5,
    energy: survey?.energy || 5,
    sleep_quality: survey?.sleep_quality || 5,
    mood: survey?.mood || 5,
  });

  const saveSurvey = async () => {
    try {
      if (survey && survey.id) {
        await apiClient.put(`/api/wellness-survey/${survey.id}`, newSurvey);
      } else {
        await apiClient.post("/api/wellness-survey", newSurvey);
      }
      setNewSurvey({
        date: new Date().toISOString().split("T")[0],
        fatigue: 5,
        body_aches: 5,
        energy: 5,
        sleep_quality: 5,
        mood: 5,
      });
      onSuccess();
    } catch (error) {
      console.error("Error saving survey:", error);
    }
  };

  const renderSlider = (label: string, value: number, onChange: (val: number) => void) => {
    return (
      <View style={styles.sliderContainer}>
        <Text style={styles.sliderLabel}>{label} (1-10): {value}</Text>
        <View style={styles.sliderRow}>
          <Text style={styles.sliderMin}>1</Text>
          <View style={styles.sliderTrack}>
            <View style={[styles.sliderFill, { width: `${(value - 1) * 11.11}%` }]} />
          </View>
          <Text style={styles.sliderMax}>10</Text>
        </View>
        <View style={styles.sliderButtons}>
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((val) => (
            <TouchableOpacity
              key={val}
              style={[styles.sliderButton, value === val && styles.sliderButtonActive]}
              onPress={() => onChange(val)}
            >
              <Text style={[styles.sliderButtonText, value === val && styles.sliderButtonTextActive]}>
                {val}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    );
  };

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>{survey ? "Edit Wellness Survey" : "Wellness Survey"}</Text>
      <TextInput
        style={styles.input}
        value={newSurvey.date}
        onChangeText={(text) => setNewSurvey({ ...newSurvey, date: text })}
        placeholder="Date (YYYY-MM-DD)"
      />
      {renderSlider("Fatigue", newSurvey.fatigue, (val) => setNewSurvey({ ...newSurvey, fatigue: val }))}
      {renderSlider("Body Aches", newSurvey.body_aches, (val) => setNewSurvey({ ...newSurvey, body_aches: val }))}
      {renderSlider("Energy", newSurvey.energy || 5, (val) => setNewSurvey({ ...newSurvey, energy: val }))}
      {renderSlider("Sleep Quality", newSurvey.sleep_quality || 5, (val) => setNewSurvey({ ...newSurvey, sleep_quality: val }))}
      {renderSlider("Mood", newSurvey.mood || 5, (val) => setNewSurvey({ ...newSurvey, mood: val }))}
      <View style={styles.buttonRow}>
        <TouchableOpacity style={[styles.button, styles.saveButton]} onPress={saveSurvey}>
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
    marginBottom: 16,
    fontSize: 16,
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
    marginTop: 16,
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
