import { useState, useEffect } from "react";
import { View, Text, StyleSheet, Modal, ScrollView } from "react-native";
import BlurView from "../shared/BlurView";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import apiClient from "../../api/client";
import { StressEntry } from "./types";
import StressForm from "./StressForm";
import Button from "../shared/Button";
import Card from "../shared/Card";
import { colors, spacing, borderRadius, shadows } from "../../theme";

export default function StressSection() {
  const [stressEntries, setStressEntries] = useState<StressEntry[]>([]);
  const [showStressForm, setShowStressForm] = useState(false);
  const [editingEntry, setEditingEntry] = useState<StressEntry | null>(null);

  useEffect(() => {
    fetchStress();
  }, []);

  const fetchStress = async () => {
    try {
      const res = await apiClient.get("/api/stress");
      setStressEntries(res.data);
    } catch (error) {
      console.error("Error fetching stress entries:", error);
    }
  };

  const deleteStress = async (id: string) => {
    try {
      await apiClient.delete(`/api/stress/${id}`);
      fetchStress();
    } catch (error) {
      console.error("Error deleting stress entry:", error);
    }
  };

  return (
    <View style={styles.container}>
      <Button
        title="Log Stress"
        onPress={() => setShowStressForm(true)}
        variant="primary"
        icon={<MaterialCommunityIcons name="plus" size={20} color={colors.textPrimary} />}
        style={styles.button}
      />

      <Modal visible={showStressForm} animationType="slide" transparent>
        <BlurView intensity={20} style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <StressForm
              entry={editingEntry}
              onSuccess={() => {
                setShowStressForm(false);
                setEditingEntry(null);
                fetchStress();
              }}
              onCancel={() => {
                setShowStressForm(false);
                setEditingEntry(null);
              }}
            />
          </View>
        </BlurView>
      </Modal>

      <ScrollView showsVerticalScrollIndicator={false}>
        {stressEntries.map((entry) => (
          <Card key={entry.id} style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.levelContainer}>
                <MaterialCommunityIcons
                  name="brain"
                  size={24}
                  color={entry.level >= 7 ? colors.danger : entry.level >= 4 ? colors.warning : colors.success}
                />
                <View style={styles.levelBadge}>
                  <Text style={styles.levelText}>{entry.level}/10</Text>
                </View>
              </View>
              <Text style={styles.cardDate}>{entry.date}</Text>
            </View>
            {entry.description && (
              <Text style={styles.cardDescription}>{entry.description}</Text>
            )}
            <View style={styles.cardActions}>
              <Button
                title="Edit"
                onPress={() => {
                  setEditingEntry(entry);
                  setShowStressForm(true);
                }}
                variant="secondary"
                style={styles.actionButton}
              />
              <Button
                title="Delete"
                onPress={() => entry.id && deleteStress(entry.id)}
                variant="danger"
                style={styles.actionButton}
              />
            </View>
          </Card>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: spacing.lg,
  },
  button: {
    marginBottom: spacing.lg,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: "center",
    padding: spacing.lg,
  },
  modalContent: {
    backgroundColor: colors.cardBackground,
    borderRadius: borderRadius.xl,
    maxHeight: "90%",
    borderWidth: 1,
    borderColor: colors.border,
  },
  card: {
    marginBottom: spacing.md,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.md,
  },
  levelContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  levelBadge: {
    backgroundColor: colors.accentPrimary + "20",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.md,
  },
  levelText: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.accentPrimary,
  },
  cardDate: {
    fontSize: 14,
    color: colors.textSecondary,
    fontWeight: "600",
  },
  cardDescription: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 20,
    marginBottom: spacing.md,
  },
  cardActions: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  actionButton: {
    flex: 1,
  },
});
