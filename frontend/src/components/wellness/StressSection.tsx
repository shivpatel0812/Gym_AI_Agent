import { useState, useEffect } from "react";
import { View, Text, TouchableOpacity, Alert } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Platform } from "react-native";
import apiClient from "../../api/client";
import { StressEntry, todayKey } from "./types";
import { EmptyNote, Field, FormCard, LevelSlider, Meter, logStyles } from "./ui";

export default function StressSection() {
  const [entries, setEntries] = useState<StressEntry[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<StressEntry>({ date: todayKey(), level: 5, description: "" });
  const [showDate, setShowDate] = useState(false);

  useEffect(() => {
    fetchEntries();
  }, []);

  const fetchEntries = async () => {
    try {
      const res = await apiClient.get("/api/stress");
      setEntries(Array.isArray(res.data) ? res.data : []);
    } catch (error) {
      console.error("Error fetching stress entries:", error);
    }
  };

  const reset = () => {
    setForm({ date: todayKey(), level: 5, description: "" });
    setEditingId(null);
    setShowForm(false);
  };

  const save = async () => {
    try {
      if (editingId) await apiClient.put(`/api/stress/${editingId}`, form);
      else await apiClient.post("/api/stress", form);
      reset();
      fetchEntries();
    } catch (error) {
      console.error("Error saving stress entry:", error);
    }
  };

  const remove = (id: string) => {
    Alert.alert("Delete entry?", "", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await apiClient.delete(`/api/stress/${id}`);
            fetchEntries();
          } catch (error) {
            console.error("Error deleting entry:", error);
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
            <Text style={logStyles.logBtnText}>Log Stress</Text>
          </TouchableOpacity>
        )}
      </View>

      {showForm && (
        <FormCard title={editingId ? "Edit Stress" : "Log Stress"} onClose={reset}>
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
            label="Stress level"
            value={form.level}
            onChange={(v) => setForm({ ...form, level: v })}
            minLabel="Low (1)"
            maxLabel="High (10)"
            reverse
          />
          <Field
            label="Description (optional)"
            value={form.description || ""}
            onChangeText={(v) => setForm({ ...form, description: v })}
            placeholder="What's causing the stress?"
            multiline
          />
          <TouchableOpacity style={logStyles.saveBtn} onPress={save}>
            <Text style={logStyles.saveText}>{editingId ? "Update" : "Save"}</Text>
          </TouchableOpacity>
        </FormCard>
      )}

      {entries.length === 0 && !showForm ? (
        <EmptyNote text="No stress entries yet. Start tracking your stress levels." />
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
              <View>
                <Text style={logStyles.cardDate}>{entry.date}</Text>
                <Text style={[logStyles.cardSub, { marginTop: 6 }]}>
                  <Text style={{ color: "#fff", fontSize: 22, fontWeight: "700" }}>{entry.level}</Text>
                  <Text> /10</Text>
                </Text>
              </View>
              <TouchableOpacity onPress={() => entry.id && remove(entry.id)} hitSlop={10}>
                <MaterialCommunityIcons name="delete-outline" size={18} color="#55647A" />
              </TouchableOpacity>
            </View>
            <Meter label="Stress" value={entry.level} reverse />
            {entry.description ? <Text style={logStyles.cardSub}>{entry.description}</Text> : null}
          </TouchableOpacity>
        ))
      )}
    </View>
  );
}
