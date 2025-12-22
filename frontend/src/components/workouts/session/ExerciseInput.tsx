import { useState } from "react";
import { View, TextInput, TouchableOpacity, StyleSheet, FlatList } from "react-native";
import { Exercise } from "../types";

interface ExerciseInputProps {
  exercises: Exercise[];
  value: string;
  onChange: (value: string) => void;
  onFocus?: () => void;
}

export default function ExerciseInput({
  exercises,
  value,
  onChange,
  onFocus,
}: ExerciseInputProps) {
  const [showSuggestions, setShowSuggestions] = useState(false);

  const filteredExercises = exercises.filter((ex) =>
    ex.name.toLowerCase().includes(value.toLowerCase())
  );

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.input}
        placeholder="Type exercise name"
        value={value}
        onChangeText={(text) => {
          onChange(text);
          setShowSuggestions(text.length > 0);
        }}
        onFocus={() => {
          setShowSuggestions(value.length > 0);
          onFocus?.();
        }}
      />
      {showSuggestions && filteredExercises.length > 0 && (
        <View style={styles.suggestionsContainer}>
          <FlatList
            data={filteredExercises}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.suggestionItem}
                onPress={() => {
                  onChange(item.name);
                  setShowSuggestions(false);
                }}
              >
                <Text>{item.name}</Text>
              </TouchableOpacity>
            )}
            nestedScrollEnabled
            style={styles.suggestionsList}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "relative",
    marginBottom: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
  },
  suggestionsContainer: {
    position: "absolute",
    top: "100%",
    left: 0,
    right: 0,
    backgroundColor: "white",
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
    marginTop: 4,
    maxHeight: 200,
    zIndex: 1000,
    elevation: 5,
  },
  suggestionsList: {
    maxHeight: 200,
  },
  suggestionItem: {
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
  },
});

