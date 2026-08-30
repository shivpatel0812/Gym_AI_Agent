import { useState } from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import apiClient from "../../api/client";
import { BodyFeeling } from "./types";
import Button from "../shared/Button";
import Input from "../shared/Input";
import Card from "../shared/Card";
import { colors, spacing } from "../../theme";

interface BodyFeelingFormProps {
  feeling?: BodyFeeling | null;
  onSuccess: () => void;
  onCancel: () => void;
}

export default function BodyFeelingForm({
  feeling,
  onSuccess,
  onCancel,
}: BodyFeelingFormProps) {
  const [newFeeling, setNewFeeling] = useState<BodyFeeling>({
    date: feeling?.date || new Date().toISOString().split("T")[0],
    description: feeling?.description || "",
  });

  const saveFeeling = async () => {
    try {
      if (feeling && feeling.id) {
        await apiClient.put(`/api/body-feelings/${feeling.id}`, newFeeling);
      } else {
        await apiClient.post("/api/body-feelings", newFeeling);
      }
      setNewFeeling({
        date: new Date().toISOString().split("T")[0],
        description: "",
      });
      onSuccess();
    } catch (error) {
      console.error("Error saving body feeling:", error);
    }
  };

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <MaterialCommunityIcons name="human" size={32} color={colors.accentSecondary} />
        <Text style={styles.title}>
          {feeling ? "Edit Body Feeling" : "Log Body Feeling"}
        </Text>
      </View>

      <Card style={styles.card}>
        <Input
          label="Date"
          value={newFeeling.date}
          onChangeText={(text) => setNewFeeling({ ...newFeeling, date: text })}
          placeholder="YYYY-MM-DD"
          icon={<MaterialCommunityIcons name="calendar" size={20} color={colors.textSecondary} />}
        />

        <Input
          label="Description"
          placeholder="Describe how your body feels (energy, fatigue, etc.)..."
          value={newFeeling.description}
          onChangeText={(text) => setNewFeeling({ ...newFeeling, description: text })}
          multiline
          style={styles.textArea}
          icon={<MaterialCommunityIcons name="text" size={20} color={colors.textSecondary} />}
        />

        <View style={styles.buttonRow}>
          <Button title="Save" onPress={saveFeeling} variant="primary" style={styles.button} />
          <Button title="Cancel" onPress={onCancel} variant="secondary" style={styles.button} />
        </View>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
    paddingTop: spacing.xl,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  card: {
    margin: spacing.lg,
  },
  textArea: {
    minHeight: 150,
    textAlignVertical: "top",
  },
  buttonRow: {
    flexDirection: "row",
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  button: {
    flex: 1,
  },
});
