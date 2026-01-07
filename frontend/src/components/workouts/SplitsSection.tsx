import { useState, useEffect } from "react";
import { View, Text, StyleSheet, Modal, FlatList } from "react-native";
import BlurView from "../shared/BlurView";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import apiClient from "../../api/client";
import { Split } from "./types";
import SplitForm from "./SplitForm";
import Button from "../shared/Button";
import Card from "../shared/Card";
import { colors, spacing, borderRadius, shadows } from "../../theme";

interface SplitsSectionProps {
  onSplitsUpdate: () => void;
}

export default function SplitsSection({ onSplitsUpdate }: SplitsSectionProps) {
  const [splits, setSplits] = useState<Split[]>([]);
  const [showSplitForm, setShowSplitForm] = useState(false);

  useEffect(() => {
    fetchSplits();
  }, []);

  const fetchSplits = async () => {
    try {
      const res = await apiClient.get("/api/splits");
      setSplits(res.data);
      onSplitsUpdate();
    } catch (error) {
      console.error("Error fetching splits:", error);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.sectionTitle}>Workout Splits</Text>
        <Button
          title="Create"
          onPress={() => setShowSplitForm(true)}
          variant="primary"
          style={styles.createButton}
        />
      </View>

      <Modal visible={showSplitForm} animationType="slide" transparent>
        <BlurView intensity={20} style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <SplitForm
              onSuccess={() => {
                setShowSplitForm(false);
                fetchSplits();
              }}
              onCancel={() => setShowSplitForm(false)}
            />
          </View>
        </BlurView>
      </Modal>

      <FlatList
        data={splits}
        keyExtractor={(item) => item.id || ""}
        numColumns={2}
        scrollEnabled={false}
        renderItem={({ item }) => (
          <Card style={styles.splitCard}>
            <View style={styles.splitCardContent}>
              <View style={styles.splitIconContainer}>
                <MaterialCommunityIcons
                  name="calendar-week"
                  size={24}
                  color={colors.accentSecondary}
                />
              </View>
              <Text style={styles.splitName}>{item.name}</Text>
              <View style={styles.daysContainer}>
                {item.days.map((day, idx) => (
                  <View key={idx} style={styles.dayBadge}>
                    <Text style={styles.dayText}>{day}</Text>
                  </View>
                ))}
              </View>
            </View>
          </Card>
        )}
        contentContainerStyle={styles.listContent}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: spacing.md,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.sm,
  },
  sectionTitle: {
    fontSize: 24,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  createButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: "center",
    padding: spacing.md,
  },
  modalContent: {
    backgroundColor: colors.cardBackground,
    borderRadius: borderRadius.xl,
    maxHeight: "90%",
    borderWidth: 1,
    borderColor: colors.border,
  },
  listContent: {
    gap: spacing.sm,
  },
  splitCard: {
    flex: 1,
    margin: spacing.xs,
    minHeight: 120,
  },
  splitCardContent: {
    alignItems: "center",
  },
  splitIconContainer: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.md,
    backgroundColor: colors.accentSecondary + "20",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: spacing.sm,
  },
  splitName: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.textPrimary,
    marginBottom: spacing.sm,
    textAlign: "center",
  },
  daysContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    justifyContent: "center",
  },
  dayBadge: {
    backgroundColor: colors.accentPrimary + "20",
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.sm,
  },
  dayText: {
    fontSize: 10,
    fontWeight: "600",
    color: colors.accentPrimary,
  },
});
