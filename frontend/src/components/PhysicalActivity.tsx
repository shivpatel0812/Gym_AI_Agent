import { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
  StatusBar,
  Alert,
  KeyboardAvoidingView,
} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import apiClient from "../api/client";
import { colors, spacing } from "../theme";
import { ActivityEntry, todayKey } from "./wellness/types";
import {
  EmptyNote,
  Field,
  FormCard,
  LevelSlider,
  Meter,
  logStyles,
} from "./wellness/ui";

const emptyActivity = (): ActivityEntry => ({
  date: todayKey(),
  steps: undefined,
  activity_type: "",
  description: "",
  duration_minutes: undefined,
  is_whole_day: false,
  intensity_level: 5,
});

export default function PhysicalActivity() {
  const [activities, setActivities] = useState<ActivityEntry[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ActivityEntry>(emptyActivity());
  const [showDate, setShowDate] = useState(false);

  useEffect(() => {
    fetchActivities();
  }, []);

  const fetchActivities = async () => {
    try {
      const res = await apiClient.get("/api/physical-activities");
      setActivities(Array.isArray(res.data) ? res.data : []);
    } catch (error) {
      console.error("Error fetching activities:", error);
    }
  };

  const reset = () => {
    setForm(emptyActivity());
    setEditingId(null);
    setShowForm(false);
  };

  const save = async () => {
    try {
      if (editingId) {
        await apiClient.put(`/api/physical-activities/${editingId}`, form);
      } else {
        await apiClient.post("/api/physical-activities", form);
      }
      reset();
      fetchActivities();
    } catch (error) {
      console.error("Error saving activity:", error);
    }
  };

  const remove = (id: string) => {
    Alert.alert("Delete activity?", "This cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await apiClient.delete(`/api/physical-activities/${id}`);
            fetchActivities();
          } catch (error) {
            console.error("Error deleting activity:", error);
          }
        },
      },
    ]);
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <Text style={styles.title}>Activity</Text>
          <Text style={styles.sub}>Track daily movement outside the gym</Text>
        </View>

        <View style={logStyles.topRow}>
          {!showForm && (
            <TouchableOpacity
              style={logStyles.logBtn}
              onPress={() => {
                setForm(emptyActivity());
                setEditingId(null);
                setShowForm(true);
              }}
            >
              <MaterialCommunityIcons name="plus" size={18} color="#fff" />
              <Text style={logStyles.logBtnText}>Log Activity</Text>
            </TouchableOpacity>
          )}
        </View>

        {showForm && (
          <FormCard title={editingId ? "Edit Activity" : "Log Activity"} onClose={reset}>
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
              label="Steps (optional)"
              value={form.steps != null ? String(form.steps) : ""}
              onChangeText={(v) =>
                setForm({ ...form, steps: v ? parseInt(v, 10) : undefined })
              }
              placeholder="10000"
              keyboardType="numeric"
            />
            <Field
              label="Activity type (optional)"
              value={form.activity_type || ""}
              onChangeText={(v) => setForm({ ...form, activity_type: v })}
              placeholder="e.g. Hiking, Running"
            />
            <TouchableOpacity
              style={styles.checkRow}
              onPress={() =>
                setForm({
                  ...form,
                  is_whole_day: !form.is_whole_day,
                  duration_minutes: !form.is_whole_day ? undefined : form.duration_minutes,
                })
              }
            >
              <View style={[styles.check, form.is_whole_day && styles.checkOn]}>
                {form.is_whole_day ? (
                  <MaterialCommunityIcons name="check" size={14} color={colors.onAccent} />
                ) : null}
              </View>
              <Text style={styles.checkLabel}>Whole day activity</Text>
            </TouchableOpacity>
            {!form.is_whole_day && (
              <Field
                label="Duration (minutes)"
                value={form.duration_minutes != null ? String(form.duration_minutes) : ""}
                onChangeText={(v) =>
                  setForm({
                    ...form,
                    duration_minutes: v ? parseInt(v, 10) : undefined,
                  })
                }
                placeholder="60"
                keyboardType="numeric"
              />
            )}
            <LevelSlider
              label="Intensity"
              value={form.intensity_level ?? 5}
              onChange={(v) => setForm({ ...form, intensity_level: v })}
              minLabel="Low"
              maxLabel="High"
              min={0}
              max={10}
              reverse
            />
            <Field
              label="Description (optional)"
              value={form.description || ""}
              onChangeText={(v) => setForm({ ...form, description: v })}
              placeholder="How did you feel?"
              multiline
            />
            <TouchableOpacity style={logStyles.saveBtn} onPress={save}>
              <Text style={logStyles.saveText}>{editingId ? "Update" : "Save"}</Text>
            </TouchableOpacity>
          </FormCard>
        )}

        {activities.length === 0 && !showForm ? (
          <EmptyNote text="No activities yet. Log a walk, hike, or active day." />
        ) : (
          activities.map((activity) => (
            <TouchableOpacity
              key={activity.id}
              style={logStyles.card}
              onPress={() => {
                setForm(activity);
                setEditingId(activity.id || null);
                setShowForm(true);
              }}
            >
              <View style={logStyles.cardTop}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 12, flex: 1 }}>
                  <View style={styles.iconBox}>
                    <MaterialCommunityIcons name="run-fast" size={22} color="#9CC0E8" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={logStyles.cardDate}>
                      {activity.activity_type || "Activity"}
                    </Text>
                    <Text style={logStyles.cardSub}>{activity.date}</Text>
                  </View>
                </View>
                <TouchableOpacity onPress={() => activity.id && remove(activity.id)} hitSlop={10}>
                  <MaterialCommunityIcons name="delete-outline" size={18} color="#55647A" />
                </TouchableOpacity>
              </View>
              <View style={{ marginTop: 12 }}>
                {activity.steps != null ? (
                  <Text style={styles.meta}>Steps: {activity.steps.toLocaleString()}</Text>
                ) : null}
                {activity.duration_minutes != null ? (
                  <Text style={styles.meta}>Duration: {activity.duration_minutes} min</Text>
                ) : null}
                {activity.is_whole_day ? <Text style={styles.meta}>Whole day activity</Text> : null}
                {activity.intensity_level != null ? (
                  <View style={{ marginTop: 8 }}>
                    <Meter label="Intensity" value={activity.intensity_level} reverse />
                  </View>
                ) : null}
                {activity.description ? (
                  <Text style={[logStyles.cardSub, { fontStyle: "italic", marginTop: 8 }]}>
                    {activity.description}
                  </Text>
                ) : null}
              </View>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { paddingBottom: 40 },
  header: {
    paddingTop: Platform.OS === "ios" ? 60 : StatusBar.currentHeight ? StatusBar.currentHeight + 16 : 16,
    paddingHorizontal: spacing.lg,
    paddingBottom: 8,
  },
  title: { fontSize: 32, fontWeight: "700", color: "#fff" },
  sub: { color: "#7C8CA0", fontSize: 14, marginTop: 4 },
  checkRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 16 },
  check: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#05080F",
    alignItems: "center",
    justifyContent: "center",
  },
  checkOn: { backgroundColor: "#9CC0E8", borderColor: "#9CC0E8" },
  checkLabel: { color: "#fff", fontSize: 14, fontWeight: "600" },
  iconBox: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: "rgba(156, 192, 232,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  meta: { color: "#fff", fontSize: 13, marginTop: 2 },
});
