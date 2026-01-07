import { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, Modal, Switch, Platform, StatusBar } from 'react-native';
import BlurView from './shared/BlurView';
import { MaterialCommunityIcons } from "@expo/vector-icons";
import apiClient from '../api/client';
import Button from './shared/Button';
import Card from './shared/Card';
import Input from './shared/Input';
import { colors, spacing, borderRadius, shadows } from '../theme';

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
    <ScrollView
      style={styles.container}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={styles.contentContainer}
    >
      <View style={styles.header}>
        <Text style={styles.title}>Activity</Text>
        <Button
          title="Log Activity"
          onPress={() => setShowForm(true)}
          variant="primary"
          icon={<MaterialCommunityIcons name="plus" size={20} color={colors.textPrimary} />}
          style={styles.headerButton}
        />
      </View>

      <Modal visible={showForm} animationType="slide" transparent>
        <BlurView intensity={20} style={styles.modalOverlay}>
          <ScrollView style={styles.modalContent} showsVerticalScrollIndicator={false}>
            <View style={styles.modalHeader}>
              <MaterialCommunityIcons
                name="run-fast"
                size={28}
                color={colors.success}
              />
              <Text style={styles.modalTitle}>
                {editingActivity ? "Edit Activity" : "Log Activity"}
              </Text>
            </View>

            <Card style={styles.formCard}>
              <Input
                label="Date"
                value={newActivity.date}
                onChangeText={(text) => setNewActivity({ ...newActivity, date: text })}
                placeholder="YYYY-MM-DD"
                icon={<MaterialCommunityIcons name="calendar" size={20} color={colors.textSecondary} />}
              />

              <Input
                label="Steps (Optional)"
                value={newActivity.steps?.toString() || ''}
                onChangeText={(text) => setNewActivity({ ...newActivity, steps: text ? parseInt(text) : undefined })}
                placeholder="Number of steps"
                keyboardType="numeric"
                icon={<MaterialCommunityIcons name="walk" size={20} color={colors.textSecondary} />}
              />

              <Input
                label="Activity Type (Optional)"
                value={newActivity.activity_type || ''}
                onChangeText={(text) => setNewActivity({ ...newActivity, activity_type: text || undefined })}
                placeholder="e.g., Hiking, Construction, etc."
                icon={<MaterialCommunityIcons name="run" size={20} color={colors.textSecondary} />}
              />

              <View style={styles.switchContainer}>
                <View style={styles.switchLabelContainer}>
                  <MaterialCommunityIcons name="calendar-clock" size={20} color={colors.textPrimary} />
                  <Text style={styles.switchLabel}>Whole Day Activity</Text>
                </View>
                <Switch
                  value={newActivity.is_whole_day || false}
                  onValueChange={(value) => {
                    setNewActivity({
                      ...newActivity,
                      is_whole_day: value,
                      duration_minutes: value ? undefined : newActivity.duration_minutes,
                    });
                  }}
                  trackColor={{ false: colors.border, true: colors.success + '80' }}
                  thumbColor={newActivity.is_whole_day ? colors.success : colors.textSecondary}
                />
              </View>

              {!newActivity.is_whole_day && (
                <Input
                  label="Duration (minutes)"
                  value={newActivity.duration_minutes?.toString() || ''}
                  onChangeText={(text) =>
                    setNewActivity({
                      ...newActivity,
                      duration_minutes: text ? parseInt(text) : undefined,
                    })
                  }
                  placeholder="Duration in minutes"
                  keyboardType="numeric"
                  icon={<MaterialCommunityIcons name="timer" size={20} color={colors.textSecondary} />}
                />
              )}

              <Input
                label="Intensity Level (0-10, Optional)"
                value={newActivity.intensity_level?.toString() || ''}
                onChangeText={(text) => {
                  const value = text ? parseInt(text) : undefined;
                  if (value !== undefined && (value < 0 || value > 10)) return;
                  setNewActivity({ ...newActivity, intensity_level: value });
                }}
                placeholder="0-10"
                keyboardType="numeric"
                maxLength={2}
                icon={<MaterialCommunityIcons name="gauge" size={20} color={colors.textSecondary} />}
              />

              <Input
                label="Description (Optional)"
                value={newActivity.description || ''}
                onChangeText={(text) => setNewActivity({ ...newActivity, description: text || undefined })}
                placeholder="Additional details..."
                multiline
                style={styles.textArea}
                icon={<MaterialCommunityIcons name="text" size={20} color={colors.textSecondary} />}
              />

              <View style={styles.buttonRow}>
                <Button
                  title="Save"
                  onPress={saveActivity}
                  variant="primary"
                  style={styles.button}
                />
                <Button
                  title="Cancel"
                  onPress={handleCancel}
                  variant="secondary"
                  style={styles.button}
                />
              </View>
            </Card>
          </ScrollView>
        </BlurView>
      </Modal>

      {activities.map((activity) => (
        <Card key={activity.id} style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={styles.cardHeaderLeft}>
              <View style={styles.activityIconContainer}>
                <MaterialCommunityIcons
                  name={activity.activity_type ? "run" : "walk"}
                  size={24}
                  color={colors.success}
                />
              </View>
              <View>
                <Text style={styles.cardDate}>{activity.date}</Text>
                {activity.activity_type && (
                  <Text style={styles.activityType}>{activity.activity_type}</Text>
                )}
              </View>
            </View>
            <View style={styles.cardActions}>
              <Button
                title="Edit"
                onPress={() => handleEdit(activity)}
                variant="secondary"
                style={styles.actionButton}
              />
              <Button
                title="Delete"
                onPress={() => activity.id && deleteActivity(activity.id)}
                variant="danger"
                style={styles.actionButton}
              />
            </View>
          </View>

          <View style={styles.cardContent}>
            {activity.steps && (
              <View style={styles.infoRow}>
                <MaterialCommunityIcons name="walk" size={18} color={colors.textSecondary} />
                <Text style={styles.cardText}>Steps: {activity.steps.toLocaleString()}</Text>
              </View>
            )}
            {activity.is_whole_day ? (
              <View style={styles.infoRow}>
                <MaterialCommunityIcons name="calendar-clock" size={18} color={colors.textSecondary} />
                <Text style={styles.cardText}>Duration: Whole Day</Text>
              </View>
            ) : (
              activity.duration_minutes && (
                <View style={styles.infoRow}>
                  <MaterialCommunityIcons name="timer" size={18} color={colors.textSecondary} />
                  <Text style={styles.cardText}>Duration: {activity.duration_minutes} minutes</Text>
                </View>
              )
            )}
            {activity.intensity_level !== undefined && (
              <View style={styles.intensityContainer}>
                <Text style={styles.intensityLabel}>Intensity:</Text>
                <View style={styles.intensityBar}>
                  <View
                    style={[
                      styles.intensityFill,
                      {
                        width: `${(activity.intensity_level / 10) * 100}%`,
                        backgroundColor:
                          activity.intensity_level >= 7
                            ? colors.danger
                            : activity.intensity_level >= 4
                            ? colors.warning
                            : colors.success,
                      },
                    ]}
                  />
                </View>
                <Text style={styles.intensityValue}>{activity.intensity_level}/10</Text>
              </View>
            )}
            {activity.description && (
              <View style={styles.descriptionContainer}>
                <MaterialCommunityIcons name="text" size={16} color={colors.textSecondary} />
                <Text style={styles.cardDescription}>{activity.description}</Text>
              </View>
            )}
          </View>
        </Card>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  contentContainer: {
    paddingTop: 0,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: Platform.OS === "ios" ? 60 : StatusBar.currentHeight ? StatusBar.currentHeight + 16 : 16,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    color: colors.textPrimary,
    textAlign: 'left',
  },
  headerButton: {
    marginTop: 0,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    padding: spacing.md,
  },
  modalContent: {
    backgroundColor: colors.cardBackground,
    borderRadius: borderRadius.xl,
    maxHeight: '90%',
    borderWidth: 1,
    borderColor: colors.border,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    paddingTop: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  formCard: {
    margin: spacing.md,
  },
  switchContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.cardBackground,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  switchLabelContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  switchLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  textArea: {
    minHeight: 100,
    textAlignVertical: 'top',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  button: {
    flex: 1,
  },
  card: {
    marginBottom: spacing.md,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.md,
  },
  cardHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    flex: 1,
  },
  activityIconContainer: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.md,
    backgroundColor: colors.success + '20',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardDate: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  activityType: {
    fontSize: 12,
    color: colors.success,
    fontWeight: '500',
    marginTop: spacing.xs,
  },
  cardActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  actionButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  cardContent: {
    gap: spacing.sm,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  cardText: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  intensityContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  intensityLabel: {
    fontSize: 14,
    color: colors.textSecondary,
    fontWeight: '500',
    minWidth: 70,
  },
  intensityBar: {
    flex: 1,
    height: 8,
    backgroundColor: colors.border,
    borderRadius: borderRadius.sm,
    overflow: 'hidden',
  },
  intensityFill: {
    height: '100%',
    borderRadius: borderRadius.sm,
  },
  intensityValue: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textPrimary,
    minWidth: 30,
    textAlign: 'right',
  },
  descriptionContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  cardDescription: {
    fontSize: 14,
    color: colors.textSecondary,
    flex: 1,
    lineHeight: 20,
  },
});
