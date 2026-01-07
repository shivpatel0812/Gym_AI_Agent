import { useState, useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Alert,
  Platform,
} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import Slider from "@react-native-community/slider";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import apiClient from "../../api/client";
import Button from "../shared/Button";
import Card from "../shared/Card";
import Input from "../shared/Input";
import { colors, spacing, borderRadius } from "../../theme";

interface SleepEntry {
  id?: string;
  date: string;
  hours_slept: number;
  quality: number;
  bedtime?: string;
  wake_time?: string;
  notes?: string;
}

export default function SleepSection() {
  const [entries, setEntries] = useState<SleepEntry[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [formData, setFormData] = useState<SleepEntry>({
    date: new Date().toISOString().split("T")[0],
    hours_slept: 8,
    quality: 5,
    bedtime: "",
    wake_time: "",
    notes: "",
  });

  // Date picker states
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showBedtimePicker, setShowBedtimePicker] = useState(false);
  const [showWaketimePicker, setShowWaketimePicker] = useState(false);

  useEffect(() => {
    fetchEntries();
  }, []);

  const fetchEntries = async () => {
    try {
      const res = await apiClient.get("/api/sleep");
      setEntries(res.data);
    } catch (error) {
      console.error("Error fetching sleep entries:", error);
    }
  };

  const handleSubmit = async () => {
    setLoading(true);
    try {
      if (editingEntryId) {
        await apiClient.put(`/api/sleep/${editingEntryId}`, formData);
      } else {
        await apiClient.post("/api/sleep", formData);
      }
      resetForm();
      fetchEntries();
    } catch (error) {
      console.error("Error saving sleep entry:", error);
      Alert.alert("Error", "Failed to save sleep entry");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    Alert.alert("Delete Entry", "Are you sure you want to delete this entry?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await apiClient.delete(`/api/sleep/${id}`);
            fetchEntries();
          } catch (error) {
            console.error("Error deleting entry:", error);
            Alert.alert("Error", "Failed to delete entry");
          }
        },
      },
    ]);
  };

  const resetForm = () => {
    setFormData({
      date: new Date().toISOString().split("T")[0],
      hours_slept: 8,
      quality: 5,
      bedtime: "",
      wake_time: "",
      notes: "",
    });
    setEditingEntryId(null);
    setShowForm(false);
  };

  const getQualityColor = (quality: number) => {
    if (quality <= 3) return colors.danger;
    if (quality <= 6) return colors.warning;
    return colors.success;
  };

  const handleDateChange = (event: any, selectedDate?: Date) => {
    setShowDatePicker(Platform.OS === "ios");
    if (selectedDate) {
      setFormData({ ...formData, date: selectedDate.toISOString().split("T")[0] });
    }
  };

  const handleBedtimeChange = (event: any, selectedTime?: Date) => {
    setShowBedtimePicker(Platform.OS === "ios");
    if (selectedTime) {
      const hours = selectedTime.getHours().toString().padStart(2, "0");
      const minutes = selectedTime.getMinutes().toString().padStart(2, "0");
      setFormData({ ...formData, bedtime: `${hours}:${minutes}` });
    }
  };

  const handleWaketimeChange = (event: any, selectedTime?: Date) => {
    setShowWaketimePicker(Platform.OS === "ios");
    if (selectedTime) {
      const hours = selectedTime.getHours().toString().padStart(2, "0");
      const minutes = selectedTime.getMinutes().toString().padStart(2, "0");
      setFormData({ ...formData, wake_time: `${hours}:${minutes}` });
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Button onPress={() => setShowForm(true)} variant="primary">
          <MaterialCommunityIcons name="plus" size={18} color={colors.textPrimary} />
          <Text style={styles.buttonText}>Log Sleep</Text>
        </Button>
      </View>

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {entries.length === 0 ? (
          <View style={styles.emptyState}>
            <MaterialCommunityIcons name="bedtime" size={64} color={colors.textSecondary} />
            <Text style={styles.emptyText}>No sleep entries yet</Text>
            <Text style={styles.emptySubtext}>Start tracking your sleep!</Text>
          </View>
        ) : (
          <View style={styles.grid}>
            {entries.map((entry) => (
              <Card key={entry.id} variant="default">
                <View style={styles.cardHeader}>
                  <View>
                    <Text style={styles.cardDate}>{entry.date}</Text>
                    <View style={styles.statsRow}>
                      <View style={styles.stat}>
                        <MaterialCommunityIcons
                          name="bedtime"
                          size={20}
                          color={colors.accentPrimary}
                        />
                        <Text style={styles.statValue}>{entry.hours_slept}h</Text>
                      </View>
                      <View style={styles.stat}>
                        <Text style={[styles.qualityValue, { color: getQualityColor(entry.quality) }]}>
                          {entry.quality}
                        </Text>
                        <Text style={styles.qualityLabel}>/10</Text>
                      </View>
                    </View>
                  </View>
                  <TouchableOpacity onPress={() => handleDelete(entry.id!)} style={styles.deleteButton}>
                    <MaterialCommunityIcons name="delete" size={20} color={colors.danger} />
                  </TouchableOpacity>
                </View>

                <View style={styles.qualityBar}>
                  <View
                    style={[
                      styles.qualityProgress,
                      {
                        backgroundColor: getQualityColor(entry.quality),
                        width: `${(entry.quality / 10) * 100}%`,
                      },
                    ]}
                  />
                </View>

                {(entry.bedtime || entry.wake_time) && (
                  <View style={styles.timesContainer}>
                    {entry.bedtime && (
                      <Text style={styles.timeText}>
                        <Text style={styles.timeLabel}>Bedtime:</Text> {entry.bedtime}
                      </Text>
                    )}
                    {entry.wake_time && (
                      <Text style={styles.timeText}>
                        <Text style={styles.timeLabel}>Wake:</Text> {entry.wake_time}
                      </Text>
                    )}
                  </View>
                )}

                {entry.notes && <Text style={styles.notes}>{entry.notes}</Text>}
              </Card>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Form Modal */}
      <Modal visible={showForm} animationType="slide" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {editingEntryId ? "Edit Sleep Entry" : "Log Sleep"}
              </Text>
              <TouchableOpacity onPress={resetForm}>
                <MaterialCommunityIcons name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.formScroll} showsVerticalScrollIndicator={false}>
              <TouchableOpacity
                style={styles.inputWrapper}
                onPress={() => setShowDatePicker(true)}
              >
                <Text style={styles.label}>Date</Text>
                <View style={styles.dateInput}>
                  <Text style={styles.dateText}>{formData.date}</Text>
                  <MaterialCommunityIcons name="calendar" size={20} color={colors.accentPrimary} />
                </View>
              </TouchableOpacity>

              {showDatePicker && (
                <DateTimePicker
                  value={new Date(formData.date)}
                  mode="date"
                  display="default"
                  onChange={handleDateChange}
                />
              )}

              <Input
                label="Hours Slept"
                value={formData.hours_slept.toString()}
                onChangeText={(text) =>
                  setFormData({ ...formData, hours_slept: parseFloat(text) || 0 })
                }
                keyboardType="decimal-pad"
                placeholder="8.0"
              />

              <View style={styles.sliderWrapper}>
                <Text style={styles.label}>Sleep Quality: {formData.quality}</Text>
                <Slider
                  style={styles.slider}
                  minimumValue={1}
                  maximumValue={10}
                  step={1}
                  value={formData.quality}
                  onValueChange={(value) => setFormData({ ...formData, quality: value })}
                  minimumTrackTintColor={colors.accentPrimary}
                  maximumTrackTintColor={colors.border}
                  thumbTintColor={colors.accentPrimary}
                />
                <View style={styles.sliderLabels}>
                  <Text style={styles.sliderLabel}>Poor (1)</Text>
                  <Text style={styles.sliderLabel}>Excellent (10)</Text>
                </View>
              </View>

              <TouchableOpacity
                style={styles.inputWrapper}
                onPress={() => setShowBedtimePicker(true)}
              >
                <Text style={styles.label}>Bedtime (Optional)</Text>
                <View style={styles.dateInput}>
                  <Text style={styles.dateText}>{formData.bedtime || "Not set"}</Text>
                  <MaterialCommunityIcons name="clock-outline" size={20} color={colors.accentPrimary} />
                </View>
              </TouchableOpacity>

              {showBedtimePicker && (
                <DateTimePicker
                  value={new Date()}
                  mode="time"
                  display="default"
                  onChange={handleBedtimeChange}
                />
              )}

              <TouchableOpacity
                style={styles.inputWrapper}
                onPress={() => setShowWaketimePicker(true)}
              >
                <Text style={styles.label}>Wake Time (Optional)</Text>
                <View style={styles.dateInput}>
                  <Text style={styles.dateText}>{formData.wake_time || "Not set"}</Text>
                  <MaterialCommunityIcons name="clock-outline" size={20} color={colors.accentPrimary} />
                </View>
              </TouchableOpacity>

              {showWaketimePicker && (
                <DateTimePicker
                  value={new Date()}
                  mode="time"
                  display="default"
                  onChange={handleWaketimeChange}
                />
              )}

              <Input
                label="Notes (Optional)"
                value={formData.notes}
                onChangeText={(text) => setFormData({ ...formData, notes: text })}
                placeholder="How did you sleep?"
                multiline
                numberOfLines={3}
              />

              <View style={styles.buttonRow}>
                <Button
                  onPress={handleSubmit}
                  variant="primary"
                  loading={loading}
                  style={{ flex: 1 }}
                >
                  {editingEntryId ? "Update" : "Save"}
                </Button>
                <Button onPress={resetForm} variant="secondary" style={{ flex: 1 }}>
                  Cancel
                </Button>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    padding: spacing.lg,
    paddingBottom: spacing.md,
  },
  buttonText: {
    color: colors.textPrimary,
    fontWeight: "600",
    marginLeft: spacing.xs,
  },
  scrollView: {
    flex: 1,
    paddingHorizontal: spacing.lg,
  },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing["3xl"],
  },
  emptyText: {
    color: colors.textSecondary,
    fontSize: 16,
    marginTop: spacing.lg,
  },
  emptySubtext: {
    color: colors.textSecondary,
    fontSize: 14,
    marginTop: spacing.xs,
  },
  grid: {
    gap: spacing.md,
    paddingBottom: spacing.xl,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: spacing.md,
  },
  cardDate: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  statsRow: {
    flexDirection: "row",
    gap: spacing.lg,
  },
  stat: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  statValue: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  qualityValue: {
    fontSize: 18,
    fontWeight: "700",
  },
  qualityLabel: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  deleteButton: {
    padding: spacing.sm,
  },
  qualityBar: {
    width: "100%",
    height: 8,
    backgroundColor: colors.border,
    borderRadius: borderRadius.sm,
    marginBottom: spacing.md,
    overflow: "hidden",
  },
  qualityProgress: {
    height: "100%",
    borderRadius: borderRadius.sm,
  },
  timesContainer: {
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  timeText: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  timeLabel: {
    fontWeight: "600",
  },
  notes: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    justifyContent: "flex-end",
  },
  modalContent: {
    backgroundColor: colors.cardBackground,
    borderTopLeftRadius: borderRadius["2xl"],
    borderTopRightRadius: borderRadius["2xl"],
    maxHeight: "90%",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  formScroll: {
    padding: spacing.lg,
  },
  inputWrapper: {
    marginBottom: spacing.lg,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  dateInput: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
  },
  dateText: {
    fontSize: 16,
    color: colors.textPrimary,
  },
  sliderWrapper: {
    marginBottom: spacing.lg,
  },
  slider: {
    width: "100%",
    height: 40,
  },
  sliderLabels: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: -spacing.sm,
  },
  sliderLabel: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  buttonRow: {
    flexDirection: "row",
    gap: spacing.md,
    marginTop: spacing.lg,
  },
});
