import { useState, useEffect } from "react";
import { View, Text, TouchableOpacity, Alert, Platform } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";
import apiClient from "../../api/client";
import { BodyFeeling, todayKey } from "./types";
import { EmptyNote, Field, FormCard, logStyles } from "./ui";

export default function BodyFeelingsSection() {
  const [entries, setEntries] = useState<BodyFeeling[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<BodyFeeling>({ date: todayKey(), description: "" });
  const [showDate, setShowDate] = useState(false);

  useEffect(() => {
    fetchEntries();
  }, []);

  const fetchEntries = async () => {
    try {
      const res = await apiClient.get("/api/body-feelings");
      setEntries(Array.isArray(res.data) ? res.data : []);
    } catch (error) {
      console.error("Error fetching body feelings:", error);
    }
  };

  const reset = () => {
    setForm({ date: todayKey(), description: "" });
    setEditingId(null);
    setShowForm(false);
  };

  const save = async () => {
    if (!form.description.trim()) return;
    try {
      if (editingId) await apiClient.put(`/api/body-feelings/${editingId}`, form);
      else await apiClient.post("/api/body-feelings", form);
      reset();
      fetchEntries();
    } catch (error) {
      console.error("Error saving body feeling:", error);
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
            await apiClient.delete(`/api/body-feelings/${id}`);
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
            <Text style={logStyles.logBtnText}>Log Feeling</Text>
          </TouchableOpacity>
        )}
      </View>

      {showForm && (
        <FormCard title={editingId ? "Edit Body Feeling" : "Log Body Feeling"} onClose={reset}>
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
          <Field
            label="Description"
            value={form.description}
            onChangeText={(v) => setForm({ ...form, description: v })}
            placeholder="How does your body feel today?"
            multiline
          />
          <TouchableOpacity
            style={[logStyles.saveBtn, !form.description.trim() && { opacity: 0.4 }]}
            disabled={!form.description.trim()}
            onPress={save}
          >
            <Text style={logStyles.saveText}>{editingId ? "Update" : "Save"}</Text>
          </TouchableOpacity>
        </FormCard>
      )}

      {entries.length === 0 && !showForm ? (
        <EmptyNote text="No body feeling entries yet. Start tracking how your body feels." />
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
            <Text style={[logStyles.cardSub, { marginTop: 8, lineHeight: 20 }]}>
              {entry.description}
            </Text>
          </TouchableOpacity>
        ))
      )}
    </View>
  );
}
