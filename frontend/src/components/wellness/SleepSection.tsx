import { useState, useEffect, useMemo } from "react";
import { View, Text, TouchableOpacity, Alert, Platform, StyleSheet } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";
import apiClient from "../../api/client";
import { SleepBaseline, SleepEntry, todayKey } from "./types";
import { EmptyNote, Field, FormCard, LevelSlider, Meter, logStyles } from "./ui";
import SleepReminderRow from "./SleepReminderRow";
import { colors } from "../../theme";

const emptySleep = (): SleepEntry => ({
  date: todayKey(),
  hours_slept: 8,
  quality: 5,
  bedtime: "",
  wake_time: "",
  notes: "",
});

export default function SleepSection() {
  const [entries, setEntries] = useState<SleepEntry[]>([]);
  const [baseline, setBaseline] = useState<SleepBaseline | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<SleepEntry>(emptySleep());
  const [showDate, setShowDate] = useState(false);
  const [timeField, setTimeField] = useState<"bedtime" | "wake_time" | null>(null);

  useEffect(() => {
    fetchEntries();
    fetchBaseline();
  }, []);

  const fetchEntries = async () => {
    try {
      const res = await apiClient.get("/api/sleep");
      setEntries(Array.isArray(res.data) ? res.data : []);
    } catch (error) {
      console.error("Error fetching sleep entries:", error);
    }
  };

  const fetchBaseline = async () => {
    try {
      const res = await apiClient.get("/api/sleep/baseline");
      setBaseline(res.data ?? null);
    } catch (error) {
      // A missing baseline is a normal state, not an error condition — the
      // strip simply does not render.
      console.error("Error fetching sleep baseline:", error);
      setBaseline(null);
    }
  };

  const reset = () => {
    setForm(emptySleep());
    setEditingId(null);
    setShowForm(false);
  };

  const save = async () => {
    try {
      if (editingId) await apiClient.put(`/api/sleep/${editingId}`, form);
      else await apiClient.post("/api/sleep", form);
      reset();
      fetchEntries();
      fetchBaseline();
    } catch (error) {
      console.error("Error saving sleep entry:", error);
    }
  };

  const remove = (id: string) => {
    Alert.alert("Delete sleep entry?", "", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await apiClient.delete(`/api/sleep/${id}`);
            fetchEntries();
            fetchBaseline();
          } catch (error) {
            console.error("Error deleting entry:", error);
          }
        },
      },
    ]);
  };

  const timeValue = (raw?: string) => {
    if (!raw) return new Date();
    const [h, m] = raw.split(":").map(Number);
    const d = new Date();
    if (Number.isFinite(h)) d.setHours(h, Number.isFinite(m) ? m : 0, 0, 0);
    return d;
  };

  const renderBaseline = () => {
    if (!baseline) return null;

    // Enough nights logged: show what this user's normal actually is.
    if (baseline.status === "ok" && baseline.target != null) {
      const label =
        baseline.source === "declared" ? "Your sleep goal" : "Your usual night";
      return (
        <View style={baselineStyles.strip}>
          <MaterialCommunityIcons name="moon-waning-crescent" size={15} color={colors.ai} />
          <Text style={baselineStyles.label}>{label}</Text>
          <Text style={baselineStyles.value}>{baseline.target}h</Text>
        </View>
      );
    }

    // Not enough yet. Say how much is missing rather than showing a target we
    // would have had to invent — and stay quiet entirely before the first log,
    // where the empty state already explains itself.
    const remaining = baseline.min_samples - baseline.samples;
    if (baseline.samples === 0 || remaining <= 0) return null;
    return (
      <View style={baselineStyles.strip}>
        <MaterialCommunityIcons name="moon-waning-crescent" size={15} color={colors.textMuted} />
        <Text style={baselineStyles.pending}>
          {remaining} more {remaining === 1 ? "night" : "nights"} to learn your usual
        </Text>
      </View>
    );
  };

  // Days that already have an entry, so the reminder can skip them.
  const loggedDates = useMemo(
    () => entries.map((entry) => entry.date).filter(Boolean) as string[],
    [entries]
  );

  return (
    <View style={logStyles.wrap}>
      {renderBaseline()}
      <SleepReminderRow loggedDates={loggedDates} />
      <View style={logStyles.topRow}>
        {!showForm && (
          <TouchableOpacity style={logStyles.logBtn} onPress={() => setShowForm(true)}>
            <MaterialCommunityIcons name="plus" size={18} color="#fff" />
            <Text style={logStyles.logBtnText}>Log Sleep</Text>
          </TouchableOpacity>
        )}
      </View>

      {showForm && (
        <FormCard title={editingId ? "Edit Sleep" : "Log Sleep"} onClose={reset}>
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
            label="Hours slept"
            value={String(form.hours_slept)}
            onChangeText={(v) =>
              setForm({ ...form, hours_slept: v ? parseFloat(v) : 0 })
            }
            keyboardType="decimal-pad"
            placeholder="8"
          />
          <LevelSlider
            label="Sleep quality"
            value={form.quality ?? 5}
            onChange={(v) => setForm({ ...form, quality: v })}
            minLabel="Poor"
            maxLabel="Excellent"
          />
          <TouchableOpacity onPress={() => setTimeField("bedtime")}>
            <Field
              label="Bedtime (optional)"
              value={form.bedtime || "Tap to set"}
              onChangeText={() => {}}
            />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setTimeField("wake_time")}>
            <Field
              label="Wake time (optional)"
              value={form.wake_time || "Tap to set"}
              onChangeText={() => {}}
            />
          </TouchableOpacity>
          {timeField && (
            <DateTimePicker
              value={timeValue(form[timeField])}
              mode="time"
              display={Platform.OS === "ios" ? "spinner" : "default"}
              onChange={(_, date) => {
                if (Platform.OS !== "ios") setTimeField(null);
                if (date && timeField) {
                  const hh = String(date.getHours()).padStart(2, "0");
                  const mm = String(date.getMinutes()).padStart(2, "0");
                  setForm({ ...form, [timeField]: `${hh}:${mm}` });
                }
              }}
            />
          )}
          <Field
            label="Notes (optional)"
            value={form.notes || ""}
            onChangeText={(v) => setForm({ ...form, notes: v })}
            placeholder="How did you sleep?"
            multiline
          />
          <TouchableOpacity style={logStyles.saveBtn} onPress={save}>
            <Text style={logStyles.saveText}>{editingId ? "Update" : "Save"}</Text>
          </TouchableOpacity>
        </FormCard>
      )}

      {entries.length === 0 && !showForm ? (
        <EmptyNote text="No sleep entries yet. Start tracking your sleep." />
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
                <Text style={[logStyles.cardSub, { marginTop: 4 }]}>
                  {entry.hours_slept} hours
                  {entry.bedtime || entry.wake_time
                    ? ` · ${entry.bedtime || "—"} – ${entry.wake_time || "—"}`
                    : ""}
                </Text>
              </View>
              <TouchableOpacity onPress={() => entry.id && remove(entry.id)} hitSlop={10}>
                <MaterialCommunityIcons name="delete-outline" size={18} color="#55647A" />
              </TouchableOpacity>
            </View>
            {entry.quality != null ? (
              <View style={{ marginTop: 10 }}>
                <Meter label="Quality" value={entry.quality} />
              </View>
            ) : null}
            {entry.notes ? <Text style={logStyles.cardSub}>{entry.notes}</Text> : null}
          </TouchableOpacity>
        ))
      )}
    </View>
  );
}

const baselineStyles = StyleSheet.create({
  strip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 12,
  },
  label: { color: colors.textSecondary, fontSize: 13, flex: 1 },
  value: { color: colors.ai, fontSize: 15, fontWeight: "700" },
  pending: { color: colors.textMuted, fontSize: 13, flex: 1 },
});
