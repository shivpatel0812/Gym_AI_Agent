import { useState, useEffect } from "react";
import { View, Text, StyleSheet, Modal, ScrollView } from "react-native";
import BlurView from "../shared/BlurView";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import apiClient from "../../api/client";
import { BodyFeeling } from "./types";
import BodyFeelingForm from "./BodyFeelingForm";
import Button from "../shared/Button";
import Card from "../shared/Card";
import { colors, spacing, borderRadius, shadows } from "../../theme";

export default function BodyFeelingsSection() {
  const [bodyFeelings, setBodyFeelings] = useState<BodyFeeling[]>([]);
  const [showFeelingForm, setShowFeelingForm] = useState(false);
  const [editingFeeling, setEditingFeeling] = useState<BodyFeeling | null>(null);

  useEffect(() => {
    fetchFeelings();
  }, []);

  const fetchFeelings = async () => {
    try {
      const res = await apiClient.get("/api/body-feelings");
      setBodyFeelings(res.data);
    } catch (error) {
      console.error("Error fetching body feelings:", error);
    }
  };

  const deleteFeeling = async (id: string) => {
    try {
      await apiClient.delete(`/api/body-feelings/${id}`);
      fetchFeelings();
    } catch (error) {
      console.error("Error deleting body feeling:", error);
    }
  };

  return (
    <View style={styles.container}>
      <Button
        title="Log Body Feeling"
        onPress={() => setShowFeelingForm(true)}
        variant="primary"
        icon={<MaterialCommunityIcons name="plus" size={20} color={colors.textPrimary} />}
        style={styles.button}
      />

      <Modal visible={showFeelingForm} animationType="slide" transparent>
        <BlurView intensity={20} style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <BodyFeelingForm
              feeling={editingFeeling}
              onSuccess={() => {
                setShowFeelingForm(false);
                setEditingFeeling(null);
                fetchFeelings();
              }}
              onCancel={() => {
                setShowFeelingForm(false);
                setEditingFeeling(null);
              }}
            />
          </View>
        </BlurView>
      </Modal>

      <ScrollView showsVerticalScrollIndicator={false}>
        {bodyFeelings.map((feeling) => (
          <Card key={feeling.id} style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.iconContainer}>
                <MaterialCommunityIcons name="body" size={24} color={colors.accentSecondary} />
              </View>
              <Text style={styles.cardDate}>{feeling.date}</Text>
            </View>
            <Text style={styles.cardDescription}>{feeling.description}</Text>
            <View style={styles.cardActions}>
              <Button
                title="Edit"
                onPress={() => {
                  setEditingFeeling(feeling);
                  setShowFeelingForm(true);
                }}
                variant="secondary"
                style={styles.actionButton}
              />
              <Button
                title="Delete"
                onPress={() => feeling.id && deleteFeeling(feeling.id)}
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
    alignItems: "center",
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.md,
    backgroundColor: colors.accentSecondary + "20",
    justifyContent: "center",
    alignItems: "center",
  },
  cardDate: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.textPrimary,
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
