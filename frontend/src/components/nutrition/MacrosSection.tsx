import { useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Switch,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import apiClient from "../../api/client";
import Button from "../shared/Button";
import Card from "../shared/Card";
import Input from "../shared/Input";
import { colors, spacing, borderRadius } from "../../theme";

interface FoodItem {
  name: string;
  calories: number;
  protein: number;
  carbs?: number;
  fats?: number;
  sodium?: number;
}

interface MacroEntry {
  id?: string;
  date: string;
  food_items: FoodItem[];
  total_calories?: number;
  total_protein?: number;
  total_carbs?: number;
  total_fats?: number;
}

export default function MacrosSection() {
  const [entries, setEntries] = useState<MacroEntry[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingEntry, setEditingEntry] = useState<MacroEntry | null>(null);
  const [logMode, setLogMode] = useState<"foods" | "totals">("foods");
  const [currentEntry, setCurrentEntry] = useState<MacroEntry>({
    date: new Date().toISOString().split("T")[0],
    food_items: [],
  });
  const [newFoodItem, setNewFoodItem] = useState<FoodItem>({
    name: "",
    calories: 0,
    protein: 0,
    carbs: undefined,
    fats: undefined,
    sodium: undefined,
  });

  useEffect(() => {
    fetchEntries();
  }, []);

  const fetchEntries = async () => {
    try {
      const res = await apiClient.get("/api/macros");
      setEntries(Array.isArray(res.data) ? res.data : []);
    } catch (error) {
      console.error("Error fetching macro entries:", error);
      setEntries([]);
    }
  };

  const addFoodItem = () => {
    if (
      newFoodItem.name &&
      newFoodItem.calories > 0 &&
      newFoodItem.protein >= 0
    ) {
      setCurrentEntry({
        ...currentEntry,
        food_items: [...currentEntry.food_items, newFoodItem],
      });
      setNewFoodItem({
        name: "",
        calories: 0,
        protein: 0,
        carbs: undefined,
        fats: undefined,
        sodium: undefined,
      });
    }
  };

  const saveEntry = async () => {
    try {
      if (logMode === "totals") {
        if (!currentEntry.total_calories || currentEntry.total_calories <= 0) {
          return;
        }
        if (
          currentEntry.total_protein === undefined ||
          currentEntry.total_protein < 0
        ) {
          return;
        }
      } else {
        if (currentEntry.food_items.length === 0) {
          return;
        }
      }

      if (editingEntry && editingEntry.id) {
        await apiClient.put(`/api/macros/${editingEntry.id}`, currentEntry);
      } else {
        await apiClient.post("/api/macros", currentEntry);
      }
      resetForm();
      fetchEntries();
    } catch (error) {
      console.error("Error saving macro entry:", error);
    }
  };

  const resetForm = () => {
    setCurrentEntry({
      date: new Date().toISOString().split("T")[0],
      food_items: [],
      total_calories: undefined,
      total_protein: undefined,
      total_carbs: undefined,
      total_fats: undefined,
    });
    setEditingEntry(null);
    setLogMode("foods");
    setShowForm(false);
    setNewFoodItem({
      name: "",
      calories: 0,
      protein: 0,
      carbs: undefined,
      fats: undefined,
      sodium: undefined,
    });
  };

  const handleEdit = (entry: MacroEntry) => {
    setEditingEntry(entry);
    if (entry.food_items && entry.food_items.length > 0) {
      setLogMode("foods");
    } else {
      setLogMode("totals");
    }
    setCurrentEntry({
      date: entry.date,
      food_items: entry.food_items || [],
      total_calories: entry.total_calories,
      total_protein: entry.total_protein,
      total_carbs: entry.total_carbs,
      total_fats: entry.total_fats,
    });
    setShowForm(true);
  };

  const handleCancel = () => {
    resetForm();
  };

  const deleteEntry = async (id: string) => {
    try {
      await apiClient.delete(`/api/macros/${id}`);
      fetchEntries();
    } catch (error) {
      console.error("Error deleting entry:", error);
    }
  };

  const calculateTotals = () => {
    if (logMode === "foods" && currentEntry.food_items.length > 0) {
      return {
        calories: currentEntry.food_items.reduce((sum, item) => sum + item.calories, 0),
        protein: currentEntry.food_items.reduce((sum, item) => sum + item.protein, 0),
        carbs: currentEntry.food_items.reduce((sum, item) => sum + (item.carbs || 0), 0),
        fats: currentEntry.food_items.reduce((sum, item) => sum + (item.fats || 0), 0),
      };
    }
    return {
      calories: currentEntry.total_calories || 0,
      protein: currentEntry.total_protein || 0,
      carbs: currentEntry.total_carbs || 0,
      fats: currentEntry.total_fats || 0,
    };
  };

  return (
    <View style={styles.container}>
      {!showForm && (
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Macro Entries</Text>
          <Button
            title="Log Macros"
            onPress={() => setShowForm(true)}
            variant="primary"
            icon={<MaterialCommunityIcons name="plus" size={20} color={colors.textPrimary} />}
            style={styles.button}
          />
        </View>
      )}

      {showForm && (
        <Card style={styles.formCard}>
          <View style={styles.formHeader}>
            <TouchableOpacity onPress={handleCancel} style={styles.backButton}>
              <MaterialCommunityIcons name="arrow-left" size={24} color={colors.textSecondary} />
            </TouchableOpacity>
            <Text style={styles.formTitle}>
              {editingEntry ? "Edit Macros" : "Log Macros"}
            </Text>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            <Input
              label="Date"
              value={currentEntry.date}
              onChangeText={(text: string) =>
                setCurrentEntry({ ...currentEntry, date: text })
              }
              placeholder="YYYY-MM-DD"
              icon={<MaterialCommunityIcons name="calendar" size={20} color={colors.textSecondary} />}
            />

            <View style={styles.modeToggleContainer}>
              <Text style={styles.modeLabel}>Log Individual Foods</Text>
              <Switch
                value={logMode === "totals"}
                onValueChange={(value) => {
                  setLogMode(value ? "totals" : "foods");
                  if (value) {
                    setCurrentEntry({
                      ...currentEntry,
                      food_items: [],
                    });
                  } else {
                    setCurrentEntry({
                      ...currentEntry,
                      total_calories: undefined,
                      total_protein: undefined,
                      total_carbs: undefined,
                      total_fats: undefined,
                    });
                  }
                }}
                trackColor={{ false: colors.border, true: colors.accentPrimary + "80" }}
                thumbColor={logMode === "totals" ? colors.accentPrimary : colors.textSecondary}
              />
              <Text style={styles.modeLabel}>Log Daily Totals</Text>
            </View>

            {logMode === "foods" ? (
              <>
                <Text style={styles.subsectionTitle}>Add Food Item</Text>
                <Input
                  label="Food Name"
                  value={newFoodItem.name}
                  onChangeText={(text: string) =>
                    setNewFoodItem({ ...newFoodItem, name: text })
                  }
                  placeholder="Food name"
                />
                
                <Text style={styles.requiredLabel}>Required Fields</Text>
                <View style={styles.macroRow}>
                  <View style={styles.macroInputContainer}>
                    <Input
                      label="Calories *"
                      value={newFoodItem.calories.toString()}
                      onChangeText={(text: string) => {
                        const num = text === "" ? 0 : parseFloat(text);
                        if (!isNaN(num)) {
                          setNewFoodItem({
                            ...newFoodItem,
                            calories: num,
                          });
                        }
                      }}
                      placeholder="0"
                      keyboardType="numeric"
                    />
                  </View>
                  <View style={styles.macroInputContainer}>
                    <Input
                      label="Protein (g) *"
                      value={newFoodItem.protein.toString()}
                      onChangeText={(text: string) => {
                        const num = text === "" ? 0 : parseFloat(text);
                        if (!isNaN(num)) {
                          setNewFoodItem({
                            ...newFoodItem,
                            protein: num,
                          });
                        }
                      }}
                      placeholder="0"
                      keyboardType="numeric"
                    />
                  </View>
                </View>

                <Text style={styles.optionalLabel}>Optional Fields</Text>
                <View style={styles.macroRow}>
                  <View style={styles.macroInputContainer}>
                    <Input
                      label="Carbs (g)"
                      value={
                        newFoodItem.carbs !== undefined
                          ? newFoodItem.carbs.toString()
                          : ""
                      }
                      onChangeText={(text: string) => {
                        if (text === "") {
                          setNewFoodItem({
                            ...newFoodItem,
                            carbs: undefined,
                          });
                        } else {
                          const num = parseFloat(text);
                          if (!isNaN(num)) {
                            setNewFoodItem({
                              ...newFoodItem,
                              carbs: num,
                            });
                          }
                        }
                      }}
                      placeholder="0"
                      keyboardType="numeric"
                    />
                  </View>
                  <View style={styles.macroInputContainer}>
                    <Input
                      label="Fats (g)"
                      value={
                        newFoodItem.fats !== undefined
                          ? newFoodItem.fats.toString()
                          : ""
                      }
                      onChangeText={(text: string) => {
                        if (text === "") {
                          setNewFoodItem({
                            ...newFoodItem,
                            fats: undefined,
                          });
                        } else {
                          const num = parseFloat(text);
                          if (!isNaN(num)) {
                            setNewFoodItem({
                              ...newFoodItem,
                              fats: num,
                            });
                          }
                        }
                      }}
                      placeholder="0"
                      keyboardType="numeric"
                    />
                  </View>
                </View>

                <Button
                  title="Add Food"
                  onPress={addFoodItem}
                  variant="secondary"
                  style={styles.addButton}
                />

                {currentEntry.food_items.length > 0 && (
                  <>
                    <Text style={styles.subsectionTitle}>Food Items</Text>
                    {currentEntry.food_items.map((item, idx) => (
                      <Card key={idx} style={styles.foodItemCard}>
                        <View style={styles.foodItemHeader}>
                          <Text style={styles.foodItemName}>{item.name}</Text>
                          <TouchableOpacity
                            onPress={() => {
                              const items = [...currentEntry.food_items];
                              items.splice(idx, 1);
                              setCurrentEntry({ ...currentEntry, food_items: items });
                            }}
                          >
                            <MaterialCommunityIcons
                              name="close"
                              size={20}
                              color={colors.danger}
                            />
                          </TouchableOpacity>
                        </View>
                        <Text style={styles.foodItemDetails}>
                          {item.calories} cal • {item.protein}g protein
                          {item.carbs !== undefined && ` • ${item.carbs}g carbs`}
                          {item.fats !== undefined && ` • ${item.fats}g fats`}
                        </Text>
                      </Card>
                    ))}
                    <Card style={styles.totalsCard}>
                      <Text style={styles.totalsTitle}>Totals</Text>
                      <Text style={styles.totalsText}>
                        {calculateTotals().calories} cal • {calculateTotals().protein}g protein • {calculateTotals().carbs}g carbs • {calculateTotals().fats}g fats
                      </Text>
                    </Card>
                  </>
                )}
              </>
            ) : (
              <>
                <Text style={styles.subsectionTitle}>Daily Totals</Text>
                <Text style={styles.requiredLabel}>Required Fields</Text>
                <View style={styles.macroRow}>
                  <View style={styles.macroInputContainer}>
                    <Input
                      label="Calories *"
                      value={
                        currentEntry.total_calories !== undefined
                          ? currentEntry.total_calories.toString()
                          : ""
                      }
                      onChangeText={(text: string) => {
                        if (text === "") {
                          setCurrentEntry({
                            ...currentEntry,
                            total_calories: undefined,
                          });
                        } else {
                          const num = parseFloat(text);
                          if (!isNaN(num)) {
                            setCurrentEntry({
                              ...currentEntry,
                              total_calories: num,
                            });
                          }
                        }
                      }}
                      placeholder="0"
                      keyboardType="numeric"
                    />
                  </View>
                  <View style={styles.macroInputContainer}>
                    <Input
                      label="Protein (g) *"
                      value={
                        currentEntry.total_protein !== undefined
                          ? currentEntry.total_protein.toString()
                          : ""
                      }
                      onChangeText={(text: string) => {
                        if (text === "") {
                          setCurrentEntry({
                            ...currentEntry,
                            total_protein: undefined,
                          });
                        } else {
                          const num = parseFloat(text);
                          if (!isNaN(num)) {
                            setCurrentEntry({
                              ...currentEntry,
                              total_protein: num,
                            });
                          }
                        }
                      }}
                      placeholder="0"
                      keyboardType="numeric"
                    />
                  </View>
                </View>

                <Text style={styles.optionalLabel}>Optional Fields</Text>
                <View style={styles.macroRow}>
                  <View style={styles.macroInputContainer}>
                    <Input
                      label="Carbs (g)"
                      value={
                        currentEntry.total_carbs !== undefined
                          ? currentEntry.total_carbs.toString()
                          : ""
                      }
                      onChangeText={(text: string) => {
                        if (text === "") {
                          setCurrentEntry({
                            ...currentEntry,
                            total_carbs: undefined,
                          });
                        } else {
                          const num = parseFloat(text);
                          if (!isNaN(num)) {
                            setCurrentEntry({
                              ...currentEntry,
                              total_carbs: num,
                            });
                          }
                        }
                      }}
                      placeholder="0"
                      keyboardType="numeric"
                    />
                  </View>
                  <View style={styles.macroInputContainer}>
                    <Input
                      label="Fats (g)"
                      value={
                        currentEntry.total_fats !== undefined
                          ? currentEntry.total_fats.toString()
                          : ""
                      }
                      onChangeText={(text: string) => {
                        if (text === "") {
                          setCurrentEntry({
                            ...currentEntry,
                            total_fats: undefined,
                          });
                        } else {
                          const num = parseFloat(text);
                          if (!isNaN(num)) {
                            setCurrentEntry({
                              ...currentEntry,
                              total_fats: num,
                            });
                          }
                        }
                      }}
                      placeholder="0"
                      keyboardType="numeric"
                    />
                  </View>
                </View>
              </>
            )}

            <View style={styles.buttonRow}>
              <Button
                title={editingEntry ? "Update Entry" : "Save Entry"}
                onPress={saveEntry}
                variant="primary"
                style={styles.saveButton}
              />
              <Button
                title="Cancel"
                onPress={handleCancel}
                variant="secondary"
                style={styles.cancelButton}
              />
            </View>
          </ScrollView>
        </Card>
      )}

      {!showForm && (
        <ScrollView 
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.entriesContainer}
        >
          {entries.map((entry) => {
            const entryTotals = entry.food_items && entry.food_items.length > 0
              ? {
                  calories: entry.food_items.reduce((sum, item) => sum + item.calories, 0),
                  protein: entry.food_items.reduce((sum, item) => sum + item.protein, 0),
                  carbs: entry.food_items.reduce((sum, item) => sum + (item.carbs || 0), 0),
                  fats: entry.food_items.reduce((sum, item) => sum + (item.fats || 0), 0),
                }
              : {
                  calories: entry.total_calories || 0,
                  protein: entry.total_protein || 0,
                  carbs: entry.total_carbs || 0,
                  fats: entry.total_fats || 0,
                };

            return (
              <Card key={entry.id} style={styles.card}>
                <View style={styles.cardHeader}>
                  <View style={styles.cardHeaderLeft}>
                    <View style={styles.iconContainer}>
                      <MaterialCommunityIcons
                        name="food-apple"
                        size={24}
                        color={colors.accentSecondary}
                      />
                    </View>
                    <View>
                      <Text style={styles.cardDate}>{entry.date}</Text>
                      <Text style={styles.cardTotals}>
                        Daily Totals: {entryTotals.calories} cal, {entryTotals.protein}g protein
                        {entryTotals.carbs > 0 && `, ${entryTotals.carbs}g carbs`}
                        {entryTotals.fats > 0 && `, ${entryTotals.fats}g fats`}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.cardActions}>
                    <Button
                      title="Edit"
                      onPress={() => handleEdit(entry)}
                      variant="secondary"
                      style={styles.actionButton}
                    />
                    <Button
                      title="Delete"
                      onPress={() => entry.id && deleteEntry(entry.id)}
                      variant="danger"
                      style={styles.actionButton}
                    />
                  </View>
                </View>

                {entry.food_items && entry.food_items.length > 0 && (
                  <View style={styles.foodItemsList}>
                    {entry.food_items.map((item, idx) => (
                      <View key={idx} style={styles.foodItemRow}>
                        <MaterialCommunityIcons
                          name="food"
                          size={16}
                          color={colors.textSecondary}
                        />
                        <Text style={styles.foodItemRowText}>
                          <Text style={styles.foodItemRowName}>{item.name}</Text> - {item.calories} cal, {item.protein}g protein
                        </Text>
                      </View>
                    ))}
                  </View>
                )}
              </Card>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: spacing.lg,
    paddingTop: 0,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.xl,
    paddingHorizontal: spacing.xs,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  button: {
    marginBottom: 0,
  },
  formCard: {
    marginBottom: spacing.xl,
    borderRadius: borderRadius.xl,
    overflow: "hidden",
  },
  formHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.xl,
  },
  backButton: {
    marginRight: spacing.md,
  },
  formTitle: {
    fontSize: 24,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  modeToggleContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.cardBackground,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modeLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.textPrimary,
  },
  subsectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.textPrimary,
    marginBottom: spacing.md,
    marginTop: spacing.sm,
  },
  requiredLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.danger,
    marginBottom: spacing.sm,
    marginTop: spacing.sm,
  },
  optionalLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.textSecondary,
    marginBottom: spacing.sm,
    marginTop: spacing.md,
  },
  macroRow: {
    flexDirection: "row",
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  macroInputContainer: {
    flex: 1,
  },
  addButton: {
    marginBottom: spacing.lg,
  },
  foodItemCard: {
    marginBottom: spacing.sm,
    padding: spacing.md,
  },
  foodItemHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.xs,
  },
  foodItemName: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.textPrimary,
    flex: 1,
  },
  foodItemDetails: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  totalsCard: {
    marginTop: spacing.md,
    backgroundColor: colors.accentPrimary + "15",
    borderColor: colors.accentPrimary + "30",
  },
  totalsTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  totalsText: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  buttonRow: {
    flexDirection: "row",
    gap: spacing.md,
    marginTop: spacing.lg,
    marginBottom: spacing.lg,
  },
  saveButton: {
    flex: 1,
  },
  cancelButton: {
    flex: 1,
  },
  card: {
    marginBottom: spacing.md,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: spacing.md,
  },
  cardHeaderLeft: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    flex: 1,
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: borderRadius.md,
    backgroundColor: colors.accentSecondary + "20",
    justifyContent: "center",
    alignItems: "center",
  },
  cardDate: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  cardTotals: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  cardActions: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  actionButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  foodItemsList: {
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  foodItemRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  foodItemRowText: {
    fontSize: 14,
    color: colors.textSecondary,
    flex: 1,
  },
  foodItemRowName: {
    fontWeight: "600",
    color: colors.textPrimary,
  },
  entriesContainer: {
    paddingBottom: spacing.xl,
  },
});