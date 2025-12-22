import { useState, useEffect } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Modal } from "react-native";
import apiClient from "../../api/client";
import { StressEntry } from "./types";
import StressForm from "./StressForm";

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
      <Text style={styles.sectionTitle}>Stress Levels</Text>
      <TouchableOpacity
        style={styles.button}
        onPress={() => setShowStressForm(true)}
      >
        <Text style={styles.buttonText}>Log Stress</Text>
      </TouchableOpacity>

      <Modal visible={showStressForm} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
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
        </View>
      </Modal>

      {stressEntries.map((entry) => (
        <View key={entry.id} style={styles.card}>
          <View style={styles.cardContent}>
            <Text style={styles.cardTitle}>
              {entry.date} - Stress Level: {entry.level}/10
            </Text>
            {entry.description && (
              <Text style={styles.cardDescription}>{entry.description}</Text>
            )}
          </View>
          <View style={styles.cardActions}>
            <TouchableOpacity
              style={styles.editButton}
              onPress={() => {
                setEditingEntry(entry);
                setShowStressForm(true);
              }}
            >
              <Text style={styles.editButtonText}>Edit</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.deleteButton}
              onPress={() => entry.id && deleteStress(entry.id)}
            >
              <Text style={styles.deleteButtonText}>Delete</Text>
            </TouchableOpacity>
          </View>
        </View>
      ))}
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
  card: {
    backgroundColor: 'white',
    borderRadius: 8,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  cardContent: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
  },
  cardDescription: {
    fontSize: 14,
    color: '#6b7280',
  },
  cardActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  editButton: {
    backgroundColor: '#2563eb',
    borderRadius: 6,
    padding: 6,
    paddingHorizontal: 12,
    flex: 1,
    alignItems: 'center',
  },
  editButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
  deleteButton: {
    backgroundColor: '#ef4444',
    borderRadius: 6,
    padding: 6,
    paddingHorizontal: 12,
    flex: 1,
    alignItems: 'center',
  },
  deleteButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
});
