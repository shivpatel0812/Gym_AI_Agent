import { useState, useEffect } from "react";
import { View, Text, TouchableOpacity, Alert, Platform } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";
import apiClient from "../../api/client";
import { WellnessSurvey, todayKey } from "./types";
import { EmptyNote, Field, FormCard, LevelSlider, Meter, logStyles } from "./ui";

const emptySurvey = (): WellnessSurvey => ({
  date: todayKey(),
  fatigue: 5,
  body_aches: 5,
  energy: 5,
  sleep_quality: 5,
  mood: 5,
});

export default function WellnessSurveySection() {
  const [entries, setEntries] = useState<WellnessSurvey[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<WellnessSurvey>(emptySurvey());
  const [showDate, setShowDate] = useState(false);

  useEffect(() => {
    fetchEntries();
  }, []);

  const fetchEntries = async () => {
    try {
      const res = await apiClient.get("/api/wellness-survey");
      setEntries(Array.isArray(res.data) ? res.data : []);
    } catch (error) {
      console.error("Error fetching wellness surveys:", error);
    }
  };

  const reset = () => {
    setForm(emptySurvey());
    setEditingId(null);
    setShowForm(false);
  };

  const save = async () => {
    try {
      if (editingId) await apiClient.put(`/api/wellness-survey/${editingId}`, form);
      else await apiClient.post("/api/wellness-survey", form);
      reset();
      fetchEntries();
    } catch (error) {
      console.error("Error saving wellness survey:", error);
    }
  };

  const remove = (id: string) => {
    Alert.alert("Delete survey?", "", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await apiClient.delete(`/api/wellness-survey/${id}`);
            fetchEntries();
          } catch (error) {
            console.error("Error deleting survey:", error);
          }
        },
      },
    ]);
  };

  return (
    <View style={logStyles.wrap}>
      <View style={logStyles.topRow}>
        {!showForm && (
          <TouchableOpacity style={logStyles.logBtn} onPress={() => setShowForm(true)}>
            <MaterialCommunityIcons name="plus" size={18} color="#fff" />
            <Text style={logStyles.logBtnText}>Log Survey</Text>
          </TouchableOpacity>
        )}
      </View>

      {showForm && (
        <FormCard title={editingId ? "Edit Survey" : "Wellness Survey"} onClose={reset}>
          <TouchableOpacity onPress={() => setShowDate(true)}>
            <Field label="Date" value={form.date} onChangeText={() => {}} />
          </TouchableOpacity>
          {showDate && (
            <DateTimePicker
              value={new Date(`${form.date}T00:00:00`)}
              mode="date"
              display={Platform.OS === "ios" ? "spinner" : "default"}
              onChange={(_, date) => {
                if (Platform.OS !== "ios") setShowDate(false);
                if (date) {
                  const y = date.getFullYear();
                  const m = String(date.getMonth() + 1).padStart(2, "0");
                  const d = String(date.getDate()).padStart(2, "0");
                  setForm({ ...form, date: `${y}-${m}-${d}` });
                }
              }}
            />
          )}
          <LevelSlider
            label="Fatigue"
            value={form.fatigue}
            onChange={(v) => setForm({ ...form, fatigue: v })}
            minLabel="None"
            maxLabel="Extreme"
            reverse
          />
          <LevelSlider
            label="Body aches"
            value={form.body_aches}
            onChange={(v) => setForm({ ...form, body_aches: v })}
            minLabel="None"
            maxLabel="Severe"
            reverse
          />
          <LevelSlider
            label="Energy"
            value={form.energy ?? 5}
            onChange={(v) => setForm({ ...form, energy: v })}
            minLabel="Low"
            maxLabel="High"
          />
          <LevelSlider
            label="Mood"
            value={form.mood ?? 5}
            onChange={(v) => setForm({ ...form, mood: v })}
            minLabel="Low"
            maxLabel="High"
          />
          <TouchableOpacity style={logStyles.saveBtn} onPress={save}>
            <Text style={logStyles.saveText}>{editingId ? "Update" : "Save"}</Text>
          </TouchableOpacity>
        </FormCard>
      )}

      {entries.length === 0 && !showForm ? (
        <EmptyNote text="No wellness surveys yet. Log how you feel overall." />
      ) : (
        entries.map((entry) => (
          <TouchableOpacity
            key={entry.id}
            style={logStyles.card}
            onPress={() => {
              setForm(entry);
              setEditingId(entry.id || null);
              setShowForm(true);
            }}
          >
            <View style={logStyles.cardTop}>
              <Text style={logStyles.cardDate}>{entry.date}</Text>
              <TouchableOpacity onPress={() => entry.id && remove(entry.id)} hitSlop={10}>
                <MaterialCommunityIcons name="delete-outline" size={18} color="#55647A" />
              </TouchableOpacity>
            </View>
            <View style={{ marginTop: 10 }}>
              <Meter label="Fatigue" value={entry.fatigue} reverse />
              <Meter label="Aches" value={entry.body_aches} reverse />
              {entry.energy != null ? <Meter label="Energy" value={entry.energy} /> : null}
              {entry.mood != null ? <Meter label="Mood" value={entry.mood} /> : null}
            </View>
          </TouchableOpacity>
        ))
      )}
    </View>
  );
}
