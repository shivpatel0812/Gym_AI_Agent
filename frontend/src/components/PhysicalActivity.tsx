import { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Modal, Switch } from 'react-native';
import apiClient from '../api/client';

interface PhysicalActivity {
  id?: string;
  date: string;
  steps?: number;
  activity_type?: string;
  description?: string;
  duration_minutes?: number;
  is_whole_day?: boolean;
  intensity_level?: number;
}

export default function PhysicalActivity() {
  const [activities, setActivities] = useState<PhysicalActivity[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingActivity, setEditingActivity] = useState<PhysicalActivity | null>(null);
  const [newActivity, setNewActivity] = useState<PhysicalActivity>({
    date: new Date().toISOString().split('T')[0],
    steps: undefined,
    activity_type: '',
    description: '',
    duration_minutes: undefined,
    is_whole_day: false,
    intensity_level: undefined,
  });

  useEffect(() => {
    fetchActivities();
  }, []);

  const fetchActivities = async () => {
    try {
      const res = await apiClient.get('/api/physical-activities');
      setActivities(res.data);
    } catch (error) {
      console.error('Error fetching activities:', error);
    }
  };

  const saveActivity = async () => {
    try {
      if (editingActivity && editingActivity.id) {
        await apiClient.put(`/api/physical-activities/${editingActivity.id}`, newActivity);
      } else {
        await apiClient.post('/api/physical-activities', newActivity);
      }
      setNewActivity({
        date: new Date().toISOString().split('T')[0],
        steps: undefined,
        activity_type: '',
        description: '',
        duration_minutes: undefined,
        is_whole_day: false,
        intensity_level: undefined,
      });
      setEditingActivity(null);
      setShowForm(false);
      fetchActivities();
    } catch (error) {
      console.error('Error saving activity:', error);
    }
  };

  const handleEdit = (activity: PhysicalActivity) => {
    setEditingActivity(activity);
    setNewActivity({
      date: activity.date,
      steps: activity.steps,
      activity_type: activity.activity_type || '',
      description: activity.description || '',
      duration_minutes: activity.duration_minutes,
      is_whole_day: activity.is_whole_day || false,
      intensity_level: activity.intensity_level,
    });
    setShowForm(true);
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditingActivity(null);
    setNewActivity({
      date: new Date().toISOString().split('T')[0],
      steps: undefined,
      activity_type: '',
      description: '',
      duration_minutes: undefined,
      is_whole_day: false,
      intensity_level: undefined,
    });
  };

  const deleteActivity = async (id: string) => {
    try {
      await apiClient.delete(`/api/physical-activities/${id}`);
      fetchActivities();
    } catch (error) {
      console.error('Error deleting activity:', error);
    }
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Physical Activity</Text>
        <TouchableOpacity style={styles.button} onPress={() => setShowForm(true)}>
          <Text style={styles.buttonText}>Log Activity</Text>
        </TouchableOpacity>
      </View>

      <Modal visible={showForm} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>
              {editingActivity ? "Edit Activity" : "Log Activity"}
            </Text>
            <TextInput
              style={styles.input}
              value={newActivity.date}
              onChangeText={(text) => setNewActivity({ ...newActivity, date: text })}
              placeholder="Date (YYYY-MM-DD)"
            />
            <TextInput
              style={styles.input}
              value={newActivity.steps?.toString() || ''}
              onChangeText={(text) => setNewActivity({ ...newActivity, steps: text ? parseInt(text) : undefined })}
              placeholder="Steps"
              keyboardType="numeric"
            />
            <TextInput
              style={styles.input}
              value={newActivity.activity_type || ''}
              onChangeText={(text) => setNewActivity({ ...newActivity, activity_type: text || undefined })}
              placeholder="Activity type"
            />
            <View style={styles.switchContainer}>
              <Text style={styles.switchLabel}>Whole Day Activity</Text>
              <Switch
                value={newActivity.is_whole_day || false}
                onValueChange={(value) => {
                  setNewActivity({ 
                    ...newActivity, 
                    is_whole_day: value,
                    duration_minutes: value ? undefined : newActivity.duration_minutes
                  });
                }}
              />
            </View>
            {!newActivity.is_whole_day && (
              <TextInput
                style={styles.input}
                value={newActivity.duration_minutes?.toString() || ''}
                onChangeText={(text) => setNewActivity({ ...newActivity, duration_minutes: text ? parseInt(text) : undefined })}
                placeholder="Duration (minutes)"
                keyboardType="numeric"
              />
            )}
            <TextInput
              style={styles.input}
              value={newActivity.intensity_level?.toString() || ''}
              onChangeText={(text) => {
                const value = text ? parseInt(text) : undefined;
                if (value !== undefined && (value < 0 || value > 10)) return;
                setNewActivity({ ...newActivity, intensity_level: value });
              }}
              placeholder="Intensity Level (0-10, optional)"
              keyboardType="numeric"
            />
            <TextInput
              style={[styles.input, styles.textArea]}
              value={newActivity.description || ''}
              onChangeText={(text) => setNewActivity({ ...newActivity, description: text || undefined })}
              placeholder="Description"
              multiline
            />
            <View style={styles.buttonRow}>
              <TouchableOpacity style={[styles.button, styles.saveButton]} onPress={saveActivity}>
                <Text style={styles.buttonText}>Save</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.button, styles.cancelButton]} onPress={handleCancel}>
                <Text style={styles.buttonText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {activities.map((activity) => (
        <View key={activity.id} style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>{activity.date}</Text>
            <View style={styles.cardActions}>
              <TouchableOpacity
                style={styles.editButton}
                onPress={() => handleEdit(activity)}
              >
                <Text style={styles.editButtonText}>Edit</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.deleteButton}
                onPress={() => activity.id && deleteActivity(activity.id)}
              >
                <Text style={styles.deleteButtonText}>Delete</Text>
              </TouchableOpacity>
            </View>
          </View>
          <View style={styles.cardContent}>
            {activity.steps && <Text style={styles.cardText}>Steps: {activity.steps}</Text>}
            {activity.activity_type && <Text style={styles.cardText}>Activity: {activity.activity_type}</Text>}
            {activity.is_whole_day ? (
              <Text style={styles.cardText}>Duration: Whole Day</Text>
            ) : (
              activity.duration_minutes && <Text style={styles.cardText}>Duration: {activity.duration_minutes} minutes</Text>
            )}
            {activity.intensity_level !== undefined && (
              <Text style={styles.cardText}>Intensity Level: {activity.intensity_level}/10</Text>
            )}
            {activity.description && <Text style={styles.cardDescription}>{activity.description}</Text>}
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    padding: 20,
    backgroundColor: 'white',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  button: {
    backgroundColor: '#2563eb',
    borderRadius: 8,
    padding: 12,
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
    padding: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  input: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    fontSize: 16,
  },
  switchContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    paddingVertical: 8,
  },
  switchLabel: {
    fontSize: 16,
    color: '#374151',
  },
  textArea: {
    height: 100,
    textAlignVertical: 'top',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  saveButton: {
    flex: 1,
    backgroundColor: '#16a34a',
  },
  cancelButton: {
    flex: 1,
    backgroundColor: '#6b7280',
  },
  card: {
    backgroundColor: 'white',
    borderRadius: 8,
    padding: 16,
    margin: 16,
    marginBottom: 0,
    marginTop: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '600',
    flex: 1,
  },
  cardActions: {
    flexDirection: 'row',
    gap: 8,
  },
  editButton: {
    backgroundColor: '#2563eb',
    borderRadius: 6,
    padding: 6,
    paddingHorizontal: 12,
  },
  editButtonText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '600',
  },
  cardContent: {
    flex: 1,
  },
  cardText: {
    fontSize: 14,
    color: '#374151',
    marginBottom: 4,
  },
  cardDescription: {
    fontSize: 14,
    color: '#6b7280',
    marginTop: 8,
  },
  deleteButton: {
    backgroundColor: '#ef4444',
    borderRadius: 6,
    padding: 6,
    paddingHorizontal: 12,
  },
  deleteButtonText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '600',
  },
});
