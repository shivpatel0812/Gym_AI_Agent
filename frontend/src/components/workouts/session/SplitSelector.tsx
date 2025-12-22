import { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Split } from "../types";

interface SplitSelectorProps {
  splits: Split[];
  selectedSplitName: string;
  selectedDay: string;
  onSplitChange: (splitName: string) => void;
  onDayChange: (day: string) => void;
}

export default function SplitSelector({
  splits,
  selectedSplitName,
  selectedDay,
  onSplitChange,
  onDayChange,
}: SplitSelectorProps) {
  const [showSplitPicker, setShowSplitPicker] = useState(false);
  const [showDayPicker, setShowDayPicker] = useState(false);

  const selectedSplit = splits.find((s) => s.name === selectedSplitName);

  return (
    <>
      <TouchableOpacity
        style={styles.pickerButton}
        onPress={() => setShowSplitPicker(true)}
      >
        <Text style={styles.pickerButtonText}>
          {selectedSplitName || "No Split"}
        </Text>
      </TouchableOpacity>
      {showSplitPicker && (
        <View style={styles.pickerContainer}>
          <TouchableOpacity
            style={styles.pickerOption}
            onPress={() => {
              onSplitChange("");
              onDayChange("");
              setShowSplitPicker(false);
            }}
          >
            <Text>No Split</Text>
          </TouchableOpacity>
          {splits.map((split) => (
            <TouchableOpacity
              key={split.id}
              style={styles.pickerOption}
              onPress={() => {
                onSplitChange(split.name);
                onDayChange("");
                setShowSplitPicker(false);
              }}
            >
              <Text>{split.name}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
      {selectedSplit && selectedSplit.days.length > 0 && (
        <>
          <TouchableOpacity
            style={styles.pickerButton}
            onPress={() => setShowDayPicker(true)}
          >
            <Text style={styles.pickerButtonText}>
              {selectedDay || "Select Day"}
            </Text>
          </TouchableOpacity>
          {showDayPicker && (
            <View style={styles.pickerContainer}>
              <TouchableOpacity
                style={styles.pickerOption}
                onPress={() => {
                  onDayChange("");
                  setShowDayPicker(false);
                }}
              >
                <Text>All Days</Text>
              </TouchableOpacity>
              {selectedSplit.days.map((day, idx) => (
                <TouchableOpacity
                  key={idx}
                  style={styles.pickerOption}
                  onPress={() => {
                    onDayChange(day);
                    setShowDayPicker(false);
                  }}
                >
                  <Text>{day}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  pickerButton: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  pickerButtonText: {
    fontSize: 16,
    color: "#111827",
  },
  pickerContainer: {
    backgroundColor: "white",
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
    marginBottom: 12,
    maxHeight: 200,
  },
  pickerOption: {
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
  },
});

