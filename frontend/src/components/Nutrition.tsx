import { useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Modal,
  Switch,
} from "react-native";
import apiClient from "../api/client";

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

export default function Nutrition() {
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
      setEntries(res.data);
    } catch (error) {
      console.error("Error fetching macro entries:", error);
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
      fetchEntries();
    } catch (error) {
      console.error("Error saving macro entry:", error);
    }
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
    setShowForm(false);
    setEditingEntry(null);
    setLogMode("foods");
    setCurrentEntry({
      date: new Date().toISOString().split("T")[0],
      food_items: [],
      total_calories: undefined,
      total_protein: undefined,
      total_carbs: undefined,
      total_fats: undefined,
    });
    setNewFoodItem({
      name: "",
      calories: 0,
      protein: 0,
      carbs: undefined,
      fats: undefined,
      sodium: undefined,
    });
  };

  const deleteEntry = async (id: string) => {
    try {
      await apiClient.delete(`/api/macros/${id}`);
      fetchEntries();
    } catch (error) {
      console.error("Error deleting entry:", error);
    }
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Nutrition</Text>
        <TouchableOpacity
          style={styles.button}
          onPress={() => setShowForm(true)}
        >
          <Text style={styles.buttonText}>Log Macros</Text>
        </TouchableOpacity>
      </View>

      <Modal visible={showForm} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <ScrollView style={styles.modalContent}>
            <Text style={styles.modalTitle}>
              {editingEntry ? "Edit Macros" : "Log Macros"}
            </Text>
            <TextInput
              style={styles.input}
              value={currentEntry.date}
              onChangeText={(text: string) =>
                setCurrentEntry({ ...currentEntry, date: text })
              }
              placeholder="Date (YYYY-MM-DD)"
            />
            <View style={styles.modeToggle}>
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
              />
              <Text style={styles.modeLabel}>Log Daily Totals</Text>
            </View>
            {logMode === "foods" && (
              <>
                <Text style={styles.sectionTitle}>Add Food Item</Text>
                <TextInput
                  style={styles.input}
                  value={newFoodItem.name}
                  onChangeText={(text: string) =>
                    setNewFoodItem({ ...newFoodItem, name: text })
                  }
                  placeholder="Food name"
                />
                <Text style={styles.requiredLabel}>Required Fields</Text>
                <View style={styles.macroRow}>
                  <View style={styles.macroInputContainer}>
                    <Text style={styles.inputLabel}>Calories *</Text>
                    <TextInput
                      style={styles.input}
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
                    <Text style={styles.inputLabel}>Protein (g) *</Text>
                    <TextInput
                      style={styles.input}
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
                    <Text style={styles.inputLabel}>Carbs (g)</Text>
                    <TextInput
                      style={styles.input}
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
                      placeholder=""
                      keyboardType="numeric"
                    />
                  </View>
                  <View style={styles.macroInputContainer}>
                    <Text style={styles.inputLabel}>Fats (g)</Text>
                    <TextInput
                      style={styles.input}
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
                      placeholder=""
                      keyboardType="numeric"
                    />
                  </View>
                  <View style={styles.macroInputContainer}>
                    <Text style={styles.inputLabel}>Sodium (mg)</Text>
                    <TextInput
                      style={styles.input}
                      value={
                        newFoodItem.sodium !== undefined
                          ? newFoodItem.sodium.toString()
                          : ""
                      }
                      onChangeText={(text: string) => {
                        if (text === "") {
                          setNewFoodItem({
                            ...newFoodItem,
                            sodium: undefined,
                          });
                        } else {
                          const num = parseFloat(text);
                          if (!isNaN(num)) {
                            setNewFoodItem({
                              ...newFoodItem,
                              sodium: num,
                            });
                          }
                        }
                      }}
                      placeholder=""
                      keyboardType="numeric"
                    />
                  </View>
                </View>
                <TouchableOpacity
                  style={[styles.button, styles.addButton]}
                  onPress={addFoodItem}
                >
                  <Text style={styles.buttonText}>Add Food</Text>
                </TouchableOpacity>
                <Text style={styles.sectionTitle}>Food Items</Text>
                {currentEntry.food_items.map((item, idx) => (
                  <View key={idx} style={styles.foodItem}>
                    <Text style={styles.foodItemText}>
                      <Text style={styles.bold}>{item.name}</Text> -{" "}
                      {item.calories} cal, {item.protein}g protein
                      {item.carbs !== undefined && `, ${item.carbs}g carbs`}
                      {item.fats !== undefined && `, ${item.fats}g fats`}
                      {item.sodium !== undefined && `, ${item.sodium}mg sodium`}
                    </Text>
                    <TouchableOpacity
                      onPress={() => {
                        const items = [...currentEntry.food_items];
                        items.splice(idx, 1);
                        setCurrentEntry({ ...currentEntry, food_items: items });
                      }}
                      style={styles.removeButton}
                    >
                      <Text style={styles.removeButtonText}>Remove</Text>
                    </TouchableOpacity>
                  </View>
                ))}
                {currentEntry.food_items.length > 0 && (
                  <View style={styles.totals}>
                    <Text style={styles.totalsText}>
                      <Text style={styles.bold}>Totals:</Text>{" "}
                      {currentEntry.food_items.reduce(
                        (sum, item) => sum + item.calories,
                        0
                      )}{" "}
                      cal,{" "}
                      {currentEntry.food_items.reduce(
                        (sum, item) => sum + item.protein,
                        0
                      )}
                      g protein,{" "}
                      {currentEntry.food_items.reduce(
                        (sum, item) => sum + (item.carbs || 0),
                        0
                      )}
                      g carbs,{" "}
                      {currentEntry.food_items.reduce(
                        (sum, item) => sum + (item.fats || 0),
                        0
                      )}
                      g fats
                      {currentEntry.food_items.some(
                        (item) => item.sodium !== undefined
                      ) && (
                        <>
                          ,{" "}
                          {currentEntry.food_items.reduce(
                            (sum, item) => sum + (item.sodium || 0),
                            0
                          )}
                          mg sodium
                        </>
                      )}
                    </Text>
                  </View>
                )}
              </>
            )}
            {logMode === "totals" && (
              <>
                <Text style={styles.sectionTitle}>Daily Totals</Text>
                <Text style={styles.requiredLabel}>Required Fields</Text>
                <View style={styles.macroRow}>
                  <View style={styles.macroInputContainer}>
                    <Text style={styles.inputLabel}>Calories *</Text>
                    <TextInput
                      style={styles.input}
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
                    <Text style={styles.inputLabel}>Protein (g) *</Text>
                    <TextInput
                      style={styles.input}
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
                    <Text style={styles.inputLabel}>Carbs (g)</Text>
                    <TextInput
                      style={styles.input}
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
                      placeholder=""
                      keyboardType="numeric"
                    />
                  </View>
                  <View style={styles.macroInputContainer}>
                    <Text style={styles.inputLabel}>Fats (g)</Text>
                    <TextInput
                      style={styles.input}
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
                      placeholder=""
                      keyboardType="numeric"
                    />
                  </View>
                </View>
              </>
            )}
            <View style={styles.buttonRow}>
              <TouchableOpacity
                style={[styles.button, styles.saveButton]}
                onPress={saveEntry}
              >
                <Text style={styles.buttonText}>Save Entry</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.button, styles.cancelButton]}
                onPress={handleCancel}
              >
                <Text style={styles.buttonText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </Modal>

      {entries.map((entry) => (
        <View key={entry.id} style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>{entry.date}</Text>
            <View style={styles.cardActions}>
              <TouchableOpacity
                style={styles.editButton}
                onPress={() => handleEdit(entry)}
              >
                <Text style={styles.editButtonText}>Edit</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.deleteButton}
                onPress={() => entry.id && deleteEntry(entry.id)}
              >
                <Text style={styles.deleteButtonText}>Delete</Text>
              </TouchableOpacity>
            </View>
          </View>
          <View style={styles.cardContent}>
            {entry.food_items && entry.food_items.length > 0 ? (
              <>
                {entry.food_items.map((item, idx) => (
                  <Text key={idx} style={styles.cardText}>
                    <Text style={styles.bold}>{item.name}</Text> -{" "}
                    {item.calories} cal, {item.protein}g protein
                    {item.carbs !== undefined && `, ${item.carbs}g carbs`}
                    {item.fats !== undefined && `, ${item.fats}g fats`}
                    {item.sodium !== undefined && `, ${item.sodium}mg sodium`}
                  </Text>
                ))}
                <View style={styles.totals}>
                  <Text style={styles.totalsText}>
                    <Text style={styles.bold}>Totals:</Text>{" "}
                    {entry.total_calories ||
                      entry.food_items.reduce(
                        (sum, item) => sum + item.calories,
                        0
                      )}{" "}
                    cal,{" "}
                    {entry.total_protein ||
                      entry.food_items.reduce(
                        (sum, item) => sum + item.protein,
                        0
                      )}
                    g protein,{" "}
                    {entry.total_carbs ||
                      entry.food_items.reduce(
                        (sum, item) => sum + (item.carbs || 0),
                        0
                      )}
                    g carbs,{" "}
                    {entry.total_fats ||
                      entry.food_items.reduce(
                        (sum, item) => sum + (item.fats || 0),
                        0
                      )}
                    g fats
                    {entry.food_items.some(
                      (item) => item.sodium !== undefined
                    ) && (
                      <>
                        ,{" "}
                        {entry.food_items.reduce(
                          (sum, item) => sum + (item.sodium || 0),
                          0
                        )}
                        mg sodium
                      </>
                    )}
                  </Text>
                </View>
              </>
            ) : (
              <View style={styles.totals}>
                <Text style={styles.totalsText}>
                  <Text style={styles.bold}>Daily Totals:</Text>{" "}
                  {entry.total_calories || 0} cal, {entry.total_protein || 0}g
                  protein
                  {entry.total_carbs !== undefined &&
                    `, ${entry.total_carbs}g carbs`}
                  {entry.total_fats !== undefined &&
                    `, ${entry.total_fats}g fats`}
                </Text>
              </View>
            )}
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
  },
  header: {
    padding: 20,
    backgroundColor: "white",
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
  },
  title: {
    fontSize: 28,
    fontWeight: "bold",
    marginBottom: 16,
  },
  button: {
    backgroundColor: "#2563eb",
    borderRadius: 8,
    padding: 12,
    alignItems: "center",
  },
  buttonText: {
    color: "white",
    fontSize: 16,
    fontWeight: "600",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    padding: 20,
  },
  modalContent: {
    backgroundColor: "white",
    borderRadius: 8,
    padding: 20,
    maxHeight: "90%",
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "bold",
    marginBottom: 16,
  },
  input: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    fontSize: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 8,
    marginTop: 8,
  },
  requiredLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#dc2626",
    marginBottom: 8,
    marginTop: 8,
  },
  optionalLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#6b7280",
    marginBottom: 8,
    marginTop: 12,
  },
  macroRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 12,
  },
  macroInputContainer: {
    flex: 1,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#374151",
    marginBottom: 4,
  },
  macroInput: {
    flex: 1,
  },
  addButton: {
    backgroundColor: "#16a34a",
    marginBottom: 16,
  },
  foodItem: {
    backgroundColor: "#f3f4f6",
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  foodItemText: {
    flex: 1,
    fontSize: 14,
  },
  bold: {
    fontWeight: "bold",
  },
  removeButton: {
    backgroundColor: "#ef4444",
    borderRadius: 6,
    padding: 6,
    paddingHorizontal: 12,
  },
  removeButtonText: {
    color: "white",
    fontSize: 12,
    fontWeight: "600",
  },
  totals: {
    backgroundColor: "#e5e7eb",
    borderRadius: 8,
    padding: 12,
    marginTop: 12,
  },
  totalsText: {
    fontSize: 14,
  },
  buttonRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 16,
  },
  saveButton: {
    flex: 1,
    backgroundColor: "#16a34a",
  },
  cancelButton: {
    flex: 1,
    backgroundColor: "#6b7280",
  },
  card: {
    backgroundColor: "white",
    borderRadius: 8,
    padding: 16,
    margin: 16,
    marginBottom: 0,
    marginTop: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: "600",
    flex: 1,
  },
  cardActions: {
    flexDirection: "row",
    gap: 8,
  },
  editButton: {
    backgroundColor: "#2563eb",
    borderRadius: 6,
    padding: 6,
    paddingHorizontal: 12,
  },
  editButtonText: {
    color: "white",
    fontSize: 12,
    fontWeight: "600",
  },
  cardContent: {
    flex: 1,
  },
  cardText: {
    fontSize: 14,
    color: "#374151",
    marginBottom: 4,
  },
  modeToggle: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
    padding: 12,
    backgroundColor: "#f3f4f6",
    borderRadius: 8,
  },
  modeLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#374151",
  },
  deleteButton: {
    backgroundColor: "#ef4444",
    borderRadius: 6,
    padding: 6,
    paddingHorizontal: 12,
  },
  deleteButtonText: {
    color: "white",
    fontSize: 14,
    fontWeight: "600",
  },
});
