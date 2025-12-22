import { useState, useEffect } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Modal, FlatList } from "react-native";
import apiClient from "../../api/client";
import { Split } from "./types";
import SplitForm from "./SplitForm";

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
      <Text style={styles.sectionTitle}>Workout Splits</Text>
      <TouchableOpacity
        style={styles.button}
        onPress={() => setShowSplitForm(true)}
      >
        <Text style={styles.buttonText}>Create Split</Text>
      </TouchableOpacity>

      <Modal visible={showSplitForm} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <SplitForm
              onSuccess={() => {
                setShowSplitForm(false);
                fetchSplits();
              }}
              onCancel={() => setShowSplitForm(false)}
            />
          </View>
        </View>
      </Modal>

      <FlatList
        data={splits}
        keyExtractor={(item) => item.id}
        numColumns={2}
        renderItem={({ item }) => (
          <View style={styles.splitCard}>
            <Text style={styles.splitName}>{item.name}</Text>
            <Text style={styles.splitDays}>{item.days.join(", ")}</Text>
          </View>
        )}
        contentContainerStyle={styles.listContent}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '600',
    marginBottom: 16,
    color: '#111827',
  },
  button: {
    backgroundColor: '#2563eb',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    alignItems: 'center',
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: 'white',
    borderRadius: 8,
    maxHeight: '80%',
  },
  listContent: {
    gap: 12,
  },
  splitCard: {
    backgroundColor: 'white',
    borderRadius: 8,
    padding: 16,
    flex: 1,
    margin: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  splitName: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  splitDays: {
    fontSize: 14,
    color: '#6b7280',
  },
});
