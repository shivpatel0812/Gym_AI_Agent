import { useState, useEffect } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Modal } from "react-native";
import apiClient from "../../api/client";
import { BodyFeeling } from "./types";
import BodyFeelingForm from "./BodyFeelingForm";

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
      <Text style={styles.sectionTitle}>Body Feelings</Text>
      <TouchableOpacity
        style={styles.button}
        onPress={() => setShowFeelingForm(true)}
      >
        <Text style={styles.buttonText}>Log Body Feeling</Text>
      </TouchableOpacity>

      <Modal visible={showFeelingForm} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
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
        </View>
      </Modal>

      {bodyFeelings.map((feeling) => (
        <View key={feeling.id} style={styles.card}>
          <View style={styles.cardContent}>
            <Text style={styles.cardTitle}>{feeling.date}</Text>
            <Text style={styles.cardDescription}>{feeling.description}</Text>
          </View>
          <View style={styles.cardActions}>
            <TouchableOpacity
              style={styles.editButton}
              onPress={() => {
                setEditingFeeling(feeling);
                setShowFeelingForm(true);
              }}
            >
              <Text style={styles.editButtonText}>Edit</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.deleteButton}
              onPress={() => feeling.id && deleteFeeling(feeling.id)}
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
