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
import { MaterialCommunityIcons } from "@expo/vector-icons";
import apiClient from "../../api/client";
import Button from "../shared/Button";
import Card from "../shared/Card";
import Input from "../shared/Input";
import { colors, spacing, borderRadius } from "../../theme";

interface HydrationEntry {
  id?: string;
  date: string;
  amount_cups: number;
  notes?: string;
}

export default function HydrationSection() {
  const [entries, setEntries] = useState<HydrationEntry[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [formData, setFormData] = useState<HydrationEntry>({
    date: new Date().toISOString().split("T")[0],
    amount_cups: 8,
    notes: "",
  });
  const [showDatePicker, setShowDatePicker] = useState(false);

  useEffect(() => {
    fetchEntries();
  }, []);

  const fetchEntries = async () => {
    try {
      const res = await apiClient.get("/api/hydration");
      setEntries(res.data);
    } catch (error) {
      console.error("Error fetching hydration entries:", error);
    }
  };

  const handleSubmit = async () => {
    setLoading(true);
    try {
      if (editingEntryId) {
        await apiClient.put(`/api/hydration/${editingEntryId}`, formData);
      } else {
        await apiClient.post("/api/hydration", formData);
      }
      resetForm();
      fetchEntries();
    } catch (error) {
      console.error("Error saving hydration entry:", error);
      Alert.alert("Error", "Failed to save hydration entry");
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
            await apiClient.delete(`/api/hydration/${id}`);
            fetchEntries();
          } catch (error) {
            console.error("Error deleting entry:", error);
            Alert.alert("Error", "Failed to delete entry");
          }
        },
      },
    ]);
  };

  const handleEdit = (entry: HydrationEntry) => {
    setFormData(entry);
    setEditingEntryId(entry.id || null);
    setShowForm(true);
  };

  const resetForm = () => {
    setFormData({
      date: new Date().toISOString().split("T")[0],
      amount_cups: 8,
      notes: "",
    });
    setEditingEntryId(null);
    setShowForm(false);
  };

  const handleDateChange = (event: any, selectedDate?: Date) => {
    setShowDatePicker(Platform.OS === "ios");
    if (selectedDate) {
      setFormData({ ...formData, date: selectedDate.toISOString().split("T")[0] });
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Button onPress={() => setShowForm(true)} variant="primary">
          <MaterialCommunityIcons name="plus" size={18} color={colors.textPrimary} />
          <Text style={styles.buttonText}>Log Hydration</Text>
        </Button>
      </View>

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {entries.length === 0 ? (
          <View style={styles.emptyState}>
            <MaterialCommunityIcons name="water" size={64} color={colors.textSecondary} />
            <Text style={styles.emptyText}>No hydration entries yet</Text>
            <Text style={styles.emptySubtext}>Start tracking your water intake!</Text>
          </View>
        ) : (
          <View style={styles.grid}>
            {entries.map((entry) => (
              <Card key={entry.id} variant="default">
                <View style={styles.cardHeader}>
                  <View style={styles.cardContent}>
                    <Text style={styles.cardDate}>{entry.date}</Text>
                    <View style={styles.statsRow}>
                      <MaterialCommunityIcons
                        name="water"
                        size={24}
                        color={colors.accentPrimary}
                      />
                      <Text style={styles.statValue}>{entry.amount_cups}</Text>
                      <Text style={styles.statLabel}>cups</Text>
                    </View>
                  </View>
                  <View style={styles.actionButtons}>
                    <TouchableOpacity onPress={() => handleEdit(entry)} style={styles.editButton}>
                      <MaterialCommunityIcons name="pencil" size={18} color={colors.accentPrimary} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => handleDelete(entry.id!)} style={styles.deleteButton}>
                      <MaterialCommunityIcons name="delete" size={18} color={colors.danger} />
                    </TouchableOpacity>
                  </View>
                </View>
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
                {editingEntryId ? "Edit Hydration Entry" : "Log Hydration"}
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
                label="Amount (Cups)"
                value={formData.amount_cups.toString()}
                onChangeText={(text) =>
                  setFormData({ ...formData, amount_cups: parseFloat(text) || 0 })
                }
                keyboardType="decimal-pad"
                placeholder="8"
              />

              <Input
                label="Notes (Optional)"
                value={formData.notes}
                onChangeText={(text) => setFormData({ ...formData, notes: text })}
                placeholder="Add notes about hydration"
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
  },
  cardContent: {
    flex: 1,
  },
  cardDate: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  statsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  statValue: {
    fontSize: 24,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  statLabel: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  actionButtons: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  editButton: {
    padding: spacing.sm,
  },
  deleteButton: {
    padding: spacing.sm,
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
    maxHeight: "75%",
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
  buttonRow: {
    flexDirection: "row",
    gap: spacing.md,
    marginTop: spacing.lg,
  },
});
