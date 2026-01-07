import { useState, useEffect, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  Alert,
  Platform,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import apiClient from "../../api/client";
import { Exercise, Split, WorkoutSession } from "./types";
import SessionForm from "./session";
import Button from "../shared/Button";
import Card from "../shared/Card";
import { colors, spacing, borderRadius } from "../../theme";

interface SessionsSectionProps {
  exercises: Exercise[];
  splits: Split[];
}

export default function SessionsSection({
  exercises,
  splits,
}: SessionsSectionProps) {
  const [sessions, setSessions] = useState<WorkoutSession[]>([]);
  const [showSessionForm, setShowSessionForm] = useState(false);
  const [editingSession, setEditingSession] = useState<WorkoutSession | null>(
    null
  );
  const [selectedSession, setSelectedSession] = useState<WorkoutSession | null>(
    null
  );
  const [showMenu, setShowMenu] = useState<string | null>(null);

  useEffect(() => {
    fetchSessions();
  }, []);

  const fetchSessions = async () => {
    try {
      const res = await apiClient.get("/api/workout-sessions");
      setSessions(res.data);
    } catch (error) {
      console.error("Error fetching sessions:", error);
    }
  };

  const createSession = async (session: WorkoutSession) => {
    try {
      if (editingSession && editingSession.id) {
        await apiClient.put(
          `/api/workout-sessions/${editingSession.id}`,
          session
        );
      } else {
        await apiClient.post("/api/workout-sessions", session);
      }
      setShowSessionForm(false);
      setEditingSession(null);
      fetchSessions();
    } catch (error) {
      console.error("Error saving session:", error);
    }
  };

  const handleEdit = (session: WorkoutSession) => {
    setEditingSession(session);
    setShowSessionForm(true);
  };

  const handleDelete = async (sessionId: string) => {
    Alert.alert(
      "Delete Workout",
      "Are you sure you want to delete this workout session?",
      [
        { text: "Cancel", style: "cancel", onPress: () => setShowMenu(null) },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await apiClient.delete(`/api/workout-sessions/${sessionId}`);
              setShowMenu(null);
              setSelectedSession(null);
              fetchSessions();
            } catch (error) {
              console.error("Error deleting session:", error);
            }
          },
        },
      ]
    );
  };

  const handleViewSession = (session: WorkoutSession) => {
    setSelectedSession(session);
    setShowMenu(null);
  };

  const handleCancel = () => {
    setShowSessionForm(false);
    setEditingSession(null);
  };

  const getDateHeader = (dateString: string): string => {
    const date = new Date(dateString);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const sessionDate = new Date(date);
    sessionDate.setHours(0, 0, 0, 0);

    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const diffTime = today.getTime() - sessionDate.getTime();
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return "Today";
    } else if (diffDays === 1) {
      return "Yesterday";
    } else {
      const months = [
        "Jan",
        "Feb",
        "Mar",
        "Apr",
        "May",
        "Jun",
        "Jul",
        "Aug",
        "Sep",
        "Oct",
        "Nov",
        "Dec",
      ];
      return `${months[date.getMonth()]} ${date.getDate()}`;
    }
  };

  const groupedSessions = useMemo(() => {
    const sorted = [...sessions].sort((a, b) => {
      const dateA = new Date(a.date).getTime();
      const dateB = new Date(b.date).getTime();

      // If dates are the same, sort by created_at (most recent first)
      if (dateA === dateB) {
        const createdA = (a as any).created_at || "";
        const createdB = (b as any).created_at || "";
        if (createdA && createdB) {
          return new Date(createdB).getTime() - new Date(createdA).getTime();
        }
      }

      return dateB - dateA; // Newest first
    });

    const grouped: { [key: string]: WorkoutSession[] } = {};
    sorted.forEach((session) => {
      const header = getDateHeader(session.date);
      if (!grouped[header]) {
        grouped[header] = [];
      }
      grouped[header].push(session);
    });

    return grouped;
  }, [sessions]);

  return (
    <View style={styles.container}>
      {!showSessionForm && (
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Workout Sessions</Text>
          <Button
            title="Log Workout"
            onPress={() => setShowSessionForm(true)}
            variant="primary"
            icon={
              <MaterialCommunityIcons
                name="plus"
                size={20}
                color={colors.textPrimary}
              />
            }
            style={styles.button}
          />
        </View>
      )}

      {showSessionForm && (
        <Card style={styles.formCard}>
          <SessionForm
            exercises={exercises || []}
            splits={splits || []}
            onSuccess={createSession}
            onCancel={handleCancel}
            initialSession={editingSession || undefined}
          />
        </Card>
      )}

      {/* Session Detail Modal */}
      <Modal
        visible={selectedSession !== null}
        animationType="slide"
        transparent={false}
      >
        {selectedSession && (
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <TouchableOpacity
                onPress={() => setSelectedSession(null)}
                style={styles.backButton}
              >
                <MaterialCommunityIcons
                  name="arrow-left"
                  size={24}
                  color={colors.textPrimary}
                />
              </TouchableOpacity>
              <Text style={styles.modalTitle}>
                {(selectedSession as any).workout_name ||
                  (selectedSession as any).split_day ||
                  selectedSession.split_name ||
                  "Workout Session"}
              </Text>
              <View style={styles.modalHeaderRight}>
                <TouchableOpacity
                  onPress={() => {
                    handleEdit(selectedSession);
                    setSelectedSession(null);
                  }}
                  style={styles.editButton}
                >
                  <MaterialCommunityIcons
                    name="pencil"
                    size={24}
                    color={colors.accentPrimary}
                  />
                </TouchableOpacity>
              </View>
            </View>

            <ScrollView
              style={styles.modalContent}
              showsVerticalScrollIndicator={false}
            >
              <Card style={styles.detailCard}>
                <View style={styles.detailHeader}>
                  <View style={styles.iconContainer}>
                    <MaterialCommunityIcons
                      name="dumbbell"
                      size={32}
                      color={colors.accentPrimary}
                    />
                  </View>
                  <View style={styles.detailInfo}>
                    <Text style={styles.detailDate}>
                      {selectedSession.date}
                    </Text>
                    {((selectedSession as any).split_day ||
                      selectedSession.split_name) && (
                      <View style={styles.splitContainer}>
                        <MaterialCommunityIcons
                          name="calendar-week"
                          size={16}
                          color={colors.textSecondary}
                        />
                        <Text style={styles.splitName}>
                          {(selectedSession as any).split_day ||
                            selectedSession.split_name}
                        </Text>
                      </View>
                    )}
                  </View>
                </View>

                <View style={styles.detailStats}>
                  <View style={styles.detailStatItem}>
                    <MaterialCommunityIcons
                      name="dumbbell"
                      size={20}
                      color={colors.accentPrimary}
                    />
                    <Text style={styles.detailStatLabel}>
                      {Array.isArray(selectedSession.exercises)
                        ? selectedSession.exercises.length
                        : 0}
                    </Text>
                    <Text style={styles.detailStatText}>Exercises</Text>
                  </View>
                  <View style={styles.detailStatItem}>
                    <MaterialCommunityIcons
                      name="repeat"
                      size={20}
                      color={colors.accentPrimary}
                    />
                    <Text style={styles.detailStatLabel}>
                      {Array.isArray(selectedSession.exercises)
                        ? selectedSession.exercises.reduce((total, ex) => {
                            const sets = Array.isArray(ex.sets)
                              ? ex.sets.length
                              : 0;
                            return total + sets;
                          }, 0)
                        : 0}
                    </Text>
                    <Text style={styles.detailStatText}>Sets</Text>
                  </View>
                </View>
              </Card>

              {Array.isArray(selectedSession.exercises) &&
                selectedSession.exercises.length > 0 && (
                  <View style={styles.exercisesContainer}>
                    <Text style={styles.exercisesTitle}>Exercises</Text>
                    {selectedSession.exercises.map((ex: any, idx: number) => {
                      const sets = Array.isArray(ex.sets) ? ex.sets : [];
                      return (
                        <Card key={idx} style={styles.exerciseDetailCard}>
                          <Text style={styles.exerciseDetailName}>
                            {ex.exercise_name}
                          </Text>
                          {sets.length > 0 && (
                            <View style={styles.setsList}>
                              {sets.map((set: any, setIdx: number) => (
                                <View key={setIdx} style={styles.setDetailRow}>
                                  <Text style={styles.setDetailNumber}>
                                    Set {set.set_number}
                                  </Text>
                                  <Text style={styles.setDetailInfo}>
                                    {set.reps} reps
                                    {set.weight && ` @ ${set.weight}lbs`}
                                  </Text>
                                </View>
                              ))}
                            </View>
                          )}
                        </Card>
                      );
                    })}
                  </View>
                )}

              {selectedSession.notes && (
                <Card style={styles.notesCard}>
                  <View style={styles.notesHeader}>
                    <MaterialCommunityIcons
                      name="note-text"
                      size={20}
                      color={colors.accentPrimary}
                    />
                    <Text style={styles.notesTitle}>Notes</Text>
                  </View>
                  <Text style={styles.notesText}>{selectedSession.notes}</Text>
                </Card>
              )}
            </ScrollView>
          </View>
        )}
      </Modal>

      {!showSessionForm && (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.entriesContainer}
        >
          {Object.entries(groupedSessions).map(
            ([dateHeader, sessionsForDate]) => (
              <View key={dateHeader} style={styles.dateGroup}>
                <View style={styles.dateHeader}>
                  <MaterialCommunityIcons
                    name="calendar"
                    size={18}
                    color={colors.textSecondary}
                  />
                  <Text style={styles.dateHeaderText}>{dateHeader}</Text>
                </View>
                {sessionsForDate.map((session) => {
                  const exerciseCount = Array.isArray(session.exercises)
                    ? session.exercises.length
                    : 0;
                  const totalSets = Array.isArray(session.exercises)
                    ? session.exercises.reduce((total, ex) => {
                        const sets = Array.isArray(ex.sets)
                          ? ex.sets.length
                          : 0;
                        return total + sets;
                      }, 0)
                    : 0;

                  return (
                    <View key={session.id}>
                      <TouchableOpacity
                        activeOpacity={0.7}
                        onPress={() => handleViewSession(session)}
                      >
                        <Card style={styles.card}>
                          <View style={styles.cardHeader}>
                            <View style={styles.headerLeft}>
                              <View style={styles.iconContainer}>
                                <MaterialCommunityIcons
                                  name="dumbbell"
                                  size={24}
                                  color={colors.accentPrimary}
                                />
                              </View>
                              <View style={styles.cardInfo}>
                                <View style={styles.workoutTitleRow}>
                                  <Text style={styles.workoutName}>
                                    {(session as any).workout_name ||
                                      (session as any).split_day ||
                                      session.split_name ||
                                      "Workout Session"}
                                  </Text>
                                  {((session as any).split_day ||
                                    session.split_name) && (
                                    <View style={styles.splitTag}>
                                      <Text style={styles.splitTagText}>
                                        {(session as any).split_day ||
                                          session.split_name}
                                      </Text>
                                    </View>
                                  )}
                                </View>
                                <View style={styles.statsRow}>
                                  <View style={styles.statBadge}>
                                    <View
                                      style={[
                                        styles.statDot,
                                        styles.statDotBlue,
                                      ]}
                                    />
                                    <Text style={styles.statBadgeText}>
                                      {exerciseCount} exercises
                                    </Text>
                                  </View>
                                  <View style={styles.statBadge}>
                                    <View
                                      style={[
                                        styles.statDot,
                                        styles.statDotGreen,
                                      ]}
                                    />
                                    <Text style={styles.statBadgeText}>
                                      {totalSets} sets
                                    </Text>
                                  </View>
                                </View>
                              </View>
                            </View>
                            <TouchableOpacity
                              style={styles.menuButton}
                              onPress={(e) => {
                                e.stopPropagation();
                                setShowMenu(
                                  showMenu === session.id
                                    ? null
                                    : session.id || null
                                );
                              }}
                            >
                              <MaterialCommunityIcons
                                name="dots-vertical"
                                size={20}
                                color={colors.textSecondary}
                              />
                            </TouchableOpacity>
                          </View>

                          {session.notes && (
                            <View style={styles.notesContainer}>
                              <MaterialCommunityIcons
                                name="note-text"
                                size={16}
                                color={colors.textSecondary}
                              />
                              <Text style={styles.cardNotes}>
                                {session.notes}
                              </Text>
                            </View>
                          )}
                        </Card>
                      </TouchableOpacity>

                      {showMenu === session.id && (
                        <View style={styles.menuContainer}>
                          <Card style={styles.menuCard}>
                            <TouchableOpacity
                              style={styles.menuItem}
                              onPress={() => {
                                if (session.id) {
                                  handleDelete(session.id);
                                }
                              }}
                            >
                              <MaterialCommunityIcons
                                name="delete"
                                size={18}
                                color={colors.danger}
                              />
                              <Text style={styles.menuItemTextDanger}>
                                Delete
                              </Text>
                            </TouchableOpacity>
                          </Card>
                        </View>
                      )}
                    </View>
                  );
                })}
              </View>
            )
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: spacing.md,
    paddingTop: 0,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.md,
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
    marginBottom: spacing.lg,
    borderRadius: borderRadius.xl,
    overflow: "hidden",
  },
  card: {
    marginBottom: spacing.sm,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: spacing.md,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    flex: 1,
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: borderRadius.md,
    backgroundColor: colors.accentPrimary + "20",
    justifyContent: "center",
    alignItems: "center",
  },
  cardInfo: {
    flex: 1,
  },
  workoutName: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  cardDate: {
    fontSize: 14,
    fontWeight: "500",
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  splitContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  splitName: {
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: "500",
  },
  cardActions: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  actionButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  statsContainer: {
    flexDirection: "row",
    gap: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  statItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  statLabel: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.accentPrimary,
  },
  statText: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  notesContainer: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  cardNotes: {
    fontSize: 14,
    color: colors.textSecondary,
    flex: 1,
    fontStyle: "italic",
  },
  entriesContainer: {
    paddingBottom: spacing.lg,
  },
  dateGroup: {
    marginBottom: spacing.lg,
  },
  dateHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  dateHeaderText: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  workoutTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    flexWrap: "wrap",
    marginBottom: spacing.sm,
  },
  splitTag: {
    backgroundColor: colors.accentPrimary + "20",
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs / 2,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.accentPrimary + "30",
  },
  splitTagText: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.accentPrimary,
  },
  statsRow: {
    flexDirection: "row",
    gap: spacing.md,
    alignItems: "center",
  },
  statBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  statDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statDotBlue: {
    backgroundColor: colors.accentPrimary,
  },
  statDotGreen: {
    backgroundColor: colors.success,
  },
  statBadgeText: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  menuButton: {
    padding: spacing.xs,
  },
  menuContainer: {
    position: "absolute",
    right: spacing.lg,
    top: 60,
    zIndex: 1000,
  },
  menuCard: {
    minWidth: 120,
    padding: spacing.xs,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.md,
  },
  menuItemText: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.textPrimary,
  },
  menuItemTextDanger: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.danger,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: colors.background,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: Platform.OS === "ios" ? 60 : 40,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.textPrimary,
    flex: 1,
    textAlign: "center",
  },
  modalHeaderRight: {
    width: 40,
    alignItems: "flex-end",
  },
  backButton: {
    padding: spacing.xs,
    width: 40,
  },
  editButton: {
    padding: spacing.xs,
  },
  modalContent: {
    flex: 1,
    padding: spacing.lg,
  },
  detailCard: {
    marginBottom: spacing.lg,
  },
  detailHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  detailInfo: {
    flex: 1,
  },
  detailDate: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  detailStats: {
    flexDirection: "row",
    gap: spacing.xl,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  detailStatItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  detailStatLabel: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.accentPrimary,
  },
  detailStatText: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  exercisesContainer: {
    marginBottom: spacing.lg,
  },
  exercisesTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.textPrimary,
    marginBottom: spacing.md,
  },
  exerciseDetailCard: {
    marginBottom: spacing.md,
    padding: spacing.md,
  },
  exerciseDetailName: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.textPrimary,
    marginBottom: spacing.md,
  },
  setsList: {
    gap: spacing.sm,
  },
  setDetailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.background,
    borderRadius: borderRadius.md,
    marginBottom: spacing.xs,
  },
  setDetailNumber: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.accentPrimary,
  },
  setDetailInfo: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  notesCard: {
    marginBottom: spacing.lg,
  },
  notesHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  notesTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  notesText: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 20,
  },
});
