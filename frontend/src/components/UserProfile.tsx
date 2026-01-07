import { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from "react-native";
import { Picker } from "@react-native-picker/picker";
import Slider from "@react-native-community/slider";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import LinearGradient from "./shared/LinearGradient";
import Button from "./shared/Button";
import Card from "./shared/Card";
import Input from "./shared/Input";
import apiClient from "../api/client";
import { colors, spacing, borderRadius } from "../theme";

interface UserProfileData {
  // Basic Info
  height_ft?: number;
  height_in?: number;
  weight?: number;
  age?: number;
  gender?: string;

  // Goals
  primary_goal?: string;
  secondary_goals?: string[];
  time_horizon?: string;

  // Background
  experience_level?: string;
  training_history_notes?: string;

  // Lifestyle
  work_school_hours?: number;
  busy_level?: number;
  typical_stress_level?: number;
  family_obligations?: boolean;
  family_obligations_note?: string;

  // Training Preferences
  preferred_workout_time?: string;
  preferred_session_length?: string;
  preferred_workout_frequency?: string;
  coaching_style_preference?: string;

  // Nutrition
  dietary_preference?: string;
  dietary_preference_other?: string;
  willingness_to_track?: string;

  // Progress
  progress_feeling?: string;
  biggest_blocker?: string;

  // Reflection
  open_reflection?: string;
}

export default function UserProfile() {
  const [profile, setProfile] = useState<UserProfileData>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    basic: true,
    goals: false,
    background: false,
    lifestyle: false,
    training: false,
    nutrition: false,
    progress: false,
    reflection: false,
  });

  useEffect(() => {
    fetchProfile();
  }, []);

  const fetchProfile = async () => {
    setLoading(true);
    try {
      const res = await apiClient.get("/api/user-profile");
      if (res.data) {
        setProfile(res.data);
      }
    } catch (error) {
      console.error("Error fetching profile:", error);
    } finally {
      setLoading(false);
    }
  };

  const saveProfile = async () => {
    setSaving(true);
    try {
      await apiClient.post("/api/user-profile", profile);
      Alert.alert("Success", "Profile saved successfully!");
    } catch (error: any) {
      console.error("Error saving profile:", error);
      Alert.alert("Error", "Failed to save profile");
    } finally {
      setSaving(false);
    }
  };

  const toggleSection = (section: string) => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  const updateProfile = (updates: Partial<UserProfileData>) => {
    setProfile((prev) => ({ ...prev, ...updates }));
  };

  const renderSectionHeader = (
    key: string,
    title: string,
    icon: keyof typeof MaterialCommunityIcons.glyphMap
  ) => {
    const isExpanded = expandedSections[key];
    return (
      <TouchableOpacity
        style={styles.sectionHeader}
        onPress={() => toggleSection(key)}
        activeOpacity={0.7}
      >
        <View style={styles.sectionHeaderLeft}>
          <MaterialCommunityIcons name={icon} size={24} color={colors.accentPrimary} />
          <Text style={styles.sectionTitle}>{title}</Text>
        </View>
        <MaterialCommunityIcons
          name={isExpanded ? "chevron-up" : "chevron-down"}
          size={24}
          color={colors.textSecondary}
        />
      </TouchableOpacity>
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
    >
      <LinearGradient colors={[colors.background, colors.cardBackground]} style={styles.header}>
        <View style={styles.headerContent}>
          <MaterialCommunityIcons name="account-circle" size={32} color={colors.accentPrimary} />
          <View>
            <Text style={styles.headerTitle}>My Profile</Text>
            <Text style={styles.headerSubtitle}>Complete fitness profile</Text>
          </View>
        </View>
      </LinearGradient>

      <ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Section 1: Basic Info */}
        <Card variant="default" style={styles.sectionCard}>
          {renderSectionHeader("basic", "Basic Information", "account")}
          {expandedSections.basic && (
            <View style={styles.sectionContent}>
              <View style={styles.row}>
                <View style={styles.halfWidth}>
                  <Input
                    label="Height (ft)"
                    value={profile.height_ft?.toString() || ""}
                    onChangeText={(text) =>
                      updateProfile({ height_ft: parseInt(text) || undefined })
                    }
                    keyboardType="number-pad"
                    placeholder="5"
                  />
                </View>
                <View style={styles.halfWidth}>
                  <Input
                    label="Height (in)"
                    value={profile.height_in?.toString() || ""}
                    onChangeText={(text) =>
                      updateProfile({ height_in: parseInt(text) || undefined })
                    }
                    keyboardType="number-pad"
                    placeholder="10"
                  />
                </View>
              </View>

              <View style={styles.row}>
                <View style={styles.halfWidth}>
                  <Input
                    label="Weight (lbs)"
                    value={profile.weight?.toString() || ""}
                    onChangeText={(text) =>
                      updateProfile({ weight: parseFloat(text) || undefined })
                    }
                    keyboardType="decimal-pad"
                    placeholder="150"
                  />
                </View>
                <View style={styles.halfWidth}>
                  <Input
                    label="Age"
                    value={profile.age?.toString() || ""}
                    onChangeText={(text) => updateProfile({ age: parseInt(text) || undefined })}
                    keyboardType="number-pad"
                    placeholder="25"
                  />
                </View>
              </View>

              <View style={styles.pickerContainer}>
                <Text style={styles.label}>Gender</Text>
                <View style={styles.pickerWrapper}>
                  <Picker
                    selectedValue={profile.gender || ""}
                    onValueChange={(value) => updateProfile({ gender: value })}
                    style={styles.picker}
                  >
                    <Picker.Item label="Select gender" value="" />
                    <Picker.Item label="Male" value="male" />
                    <Picker.Item label="Female" value="female" />
                    <Picker.Item label="Other" value="other" />
                    <Picker.Item label="Prefer not to say" value="prefer_not_to_say" />
                  </Picker>
                </View>
              </View>
            </View>
          )}
        </Card>

        {/* Section 2: Goals */}
        <Card variant="default" style={styles.sectionCard}>
          {renderSectionHeader("goals", "Fitness Goals", "target")}
          {expandedSections.goals && (
            <View style={styles.sectionContent}>
              <View style={styles.pickerContainer}>
                <Text style={styles.label}>Primary Goal</Text>
                <View style={styles.pickerWrapper}>
                  <Picker
                    selectedValue={profile.primary_goal || ""}
                    onValueChange={(value) => updateProfile({ primary_goal: value })}
                    style={styles.picker}
                  >
                    <Picker.Item label="Select primary goal" value="" />
                    <Picker.Item label="Lose weight" value="lose_weight" />
                    <Picker.Item label="Build muscle" value="build_muscle" />
                    <Picker.Item label="Improve strength" value="improve_strength" />
                    <Picker.Item label="Improve endurance" value="improve_endurance" />
                    <Picker.Item label="General fitness" value="general_fitness" />
                    <Picker.Item label="Athletic performance" value="athletic_performance" />
                  </Picker>
                </View>
              </View>

              <View style={styles.pickerContainer}>
                <Text style={styles.label}>Time Horizon</Text>
                <View style={styles.pickerWrapper}>
                  <Picker
                    selectedValue={profile.time_horizon || ""}
                    onValueChange={(value) => updateProfile({ time_horizon: value })}
                    style={styles.picker}
                  >
                    <Picker.Item label="Select time horizon" value="" />
                    <Picker.Item label="1-3 months" value="1_3_months" />
                    <Picker.Item label="3-6 months" value="3_6_months" />
                    <Picker.Item label="6-12 months" value="6_12_months" />
                    <Picker.Item label="1+ years" value="1_plus_years" />
                  </Picker>
                </View>
              </View>
            </View>
          )}
        </Card>

        {/* Section 3: Background */}
        <Card variant="default" style={styles.sectionCard}>
          {renderSectionHeader("background", "Fitness Background", "history")}
          {expandedSections.background && (
            <View style={styles.sectionContent}>
              <View style={styles.pickerContainer}>
                <Text style={styles.label}>Experience Level</Text>
                <View style={styles.pickerWrapper}>
                  <Picker
                    selectedValue={profile.experience_level || ""}
                    onValueChange={(value) => updateProfile({ experience_level: value })}
                    style={styles.picker}
                  >
                    <Picker.Item label="Select experience level" value="" />
                    <Picker.Item label="Beginner (0-1 year)" value="beginner" />
                    <Picker.Item label="Intermediate (1-3 years)" value="intermediate" />
                    <Picker.Item label="Advanced (3-5 years)" value="advanced" />
                    <Picker.Item label="Expert (5+ years)" value="expert" />
                  </Picker>
                </View>
              </View>

              <Input
                label="Training History Notes"
                value={profile.training_history_notes || ""}
                onChangeText={(text) => updateProfile({ training_history_notes: text })}
                placeholder="Describe your training background"
                multiline
                numberOfLines={4}
              />
            </View>
          )}
        </Card>

        {/* Section 4: Lifestyle */}
        <Card variant="default" style={styles.sectionCard}>
          {renderSectionHeader("lifestyle", "Lifestyle & Schedule", "calendar-clock")}
          {expandedSections.lifestyle && (
            <View style={styles.sectionContent}>
              <Input
                label="Work/School Hours per Week"
                value={profile.work_school_hours?.toString() || ""}
                onChangeText={(text) =>
                  updateProfile({ work_school_hours: parseInt(text) || undefined })
                }
                keyboardType="number-pad"
                placeholder="40"
              />

              <View style={styles.sliderContainer}>
                <Text style={styles.label}>
                  Busy Level: {profile.busy_level || 5}
                </Text>
                <Slider
                  style={styles.slider}
                  minimumValue={1}
                  maximumValue={10}
                  step={1}
                  value={profile.busy_level || 5}
                  onValueChange={(value) => updateProfile({ busy_level: value })}
                  minimumTrackTintColor={colors.accentPrimary}
                  maximumTrackTintColor={colors.border}
                  thumbTintColor={colors.accentPrimary}
                />
                <View style={styles.sliderLabels}>
                  <Text style={styles.sliderLabel}>Not busy (1)</Text>
                  <Text style={styles.sliderLabel}>Very busy (10)</Text>
                </View>
              </View>

              <View style={styles.sliderContainer}>
                <Text style={styles.label}>
                  Typical Stress Level: {profile.typical_stress_level || 5}
                </Text>
                <Slider
                  style={styles.slider}
                  minimumValue={1}
                  maximumValue={10}
                  step={1}
                  value={profile.typical_stress_level || 5}
                  onValueChange={(value) => updateProfile({ typical_stress_level: value })}
                  minimumTrackTintColor={colors.accentPrimary}
                  maximumTrackTintColor={colors.border}
                  thumbTintColor={colors.accentPrimary}
                />
                <View style={styles.sliderLabels}>
                  <Text style={styles.sliderLabel}>Low stress (1)</Text>
                  <Text style={styles.sliderLabel}>High stress (10)</Text>
                </View>
              </View>

              <View style={styles.switchContainer}>
                <Text style={styles.label}>Family Obligations</Text>
                <Switch
                  value={profile.family_obligations || false}
                  onValueChange={(value) => updateProfile({ family_obligations: value })}
                  trackColor={{ false: colors.border, true: colors.accentPrimary }}
                  thumbColor={colors.textPrimary}
                />
              </View>

              {profile.family_obligations && (
                <Input
                  label="Family Obligations Notes"
                  value={profile.family_obligations_note || ""}
                  onChangeText={(text) => updateProfile({ family_obligations_note: text })}
                  placeholder="Describe your family obligations"
                  multiline
                  numberOfLines={3}
                />
              )}
            </View>
          )}
        </Card>

        {/* Section 5: Training Preferences */}
        <Card variant="default" style={styles.sectionCard}>
          {renderSectionHeader("training", "Training Preferences", "weight-lifter")}
          {expandedSections.training && (
            <View style={styles.sectionContent}>
              <View style={styles.pickerContainer}>
                <Text style={styles.label}>Preferred Workout Time</Text>
                <View style={styles.pickerWrapper}>
                  <Picker
                    selectedValue={profile.preferred_workout_time || ""}
                    onValueChange={(value) => updateProfile({ preferred_workout_time: value })}
                    style={styles.picker}
                  >
                    <Picker.Item label="Select preferred time" value="" />
                    <Picker.Item label="Early Morning (5-7 AM)" value="early_morning" />
                    <Picker.Item label="Morning (7-10 AM)" value="morning" />
                    <Picker.Item label="Midday (10 AM-2 PM)" value="midday" />
                    <Picker.Item label="Afternoon (2-6 PM)" value="afternoon" />
                    <Picker.Item label="Evening (6-9 PM)" value="evening" />
                    <Picker.Item label="Night (9 PM+)" value="night" />
                  </Picker>
                </View>
              </View>

              <View style={styles.pickerContainer}>
                <Text style={styles.label}>Preferred Session Length</Text>
                <View style={styles.pickerWrapper}>
                  <Picker
                    selectedValue={profile.preferred_session_length || ""}
                    onValueChange={(value) => updateProfile({ preferred_session_length: value })}
                    style={styles.picker}
                  >
                    <Picker.Item label="Select session length" value="" />
                    <Picker.Item label="30 minutes or less" value="30_min" />
                    <Picker.Item label="30-45 minutes" value="30_45_min" />
                    <Picker.Item label="45-60 minutes" value="45_60_min" />
                    <Picker.Item label="60-90 minutes" value="60_90_min" />
                    <Picker.Item label="90+ minutes" value="90_plus_min" />
                  </Picker>
                </View>
              </View>

              <View style={styles.pickerContainer}>
                <Text style={styles.label}>Preferred Workout Frequency</Text>
                <View style={styles.pickerWrapper}>
                  <Picker
                    selectedValue={profile.preferred_workout_frequency || ""}
                    onValueChange={(value) =>
                      updateProfile({ preferred_workout_frequency: value })
                    }
                    style={styles.picker}
                  >
                    <Picker.Item label="Select frequency" value="" />
                    <Picker.Item label="2-3 days per week" value="2_3_days" />
                    <Picker.Item label="3-4 days per week" value="3_4_days" />
                    <Picker.Item label="4-5 days per week" value="4_5_days" />
                    <Picker.Item label="5-6 days per week" value="5_6_days" />
                    <Picker.Item label="Daily" value="daily" />
                  </Picker>
                </View>
              </View>

              <View style={styles.pickerContainer}>
                <Text style={styles.label}>Coaching Style Preference</Text>
                <View style={styles.pickerWrapper}>
                  <Picker
                    selectedValue={profile.coaching_style_preference || ""}
                    onValueChange={(value) =>
                      updateProfile({ coaching_style_preference: value })
                    }
                    style={styles.picker}
                  >
                    <Picker.Item label="Select coaching style" value="" />
                    <Picker.Item label="Supportive & encouraging" value="supportive" />
                    <Picker.Item label="Direct & challenging" value="direct" />
                    <Picker.Item label="Analytical & data-driven" value="analytical" />
                    <Picker.Item label="Flexible & adaptive" value="flexible" />
                  </Picker>
                </View>
              </View>
            </View>
          )}
        </Card>

        {/* Section 6: Nutrition */}
        <Card variant="default" style={styles.sectionCard}>
          {renderSectionHeader("nutrition", "Nutrition Preferences", "food-apple")}
          {expandedSections.nutrition && (
            <View style={styles.sectionContent}>
              <View style={styles.pickerContainer}>
                <Text style={styles.label}>Dietary Preference</Text>
                <View style={styles.pickerWrapper}>
                  <Picker
                    selectedValue={profile.dietary_preference || ""}
                    onValueChange={(value) => updateProfile({ dietary_preference: value })}
                    style={styles.picker}
                  >
                    <Picker.Item label="Select dietary preference" value="" />
                    <Picker.Item label="No restrictions" value="none" />
                    <Picker.Item label="Vegetarian" value="vegetarian" />
                    <Picker.Item label="Vegan" value="vegan" />
                    <Picker.Item label="Pescatarian" value="pescatarian" />
                    <Picker.Item label="Keto" value="keto" />
                    <Picker.Item label="Paleo" value="paleo" />
                    <Picker.Item label="Other" value="other" />
                  </Picker>
                </View>
              </View>

              {profile.dietary_preference === "other" && (
                <Input
                  label="Other Dietary Preference"
                  value={profile.dietary_preference_other || ""}
                  onChangeText={(text) => updateProfile({ dietary_preference_other: text })}
                  placeholder="Describe your dietary preference"
                />
              )}

              <View style={styles.pickerContainer}>
                <Text style={styles.label}>Willingness to Track Nutrition</Text>
                <View style={styles.pickerWrapper}>
                  <Picker
                    selectedValue={profile.willingness_to_track || ""}
                    onValueChange={(value) => updateProfile({ willingness_to_track: value })}
                    style={styles.picker}
                  >
                    <Picker.Item label="Select willingness level" value="" />
                    <Picker.Item label="Very willing (daily tracking)" value="very_willing" />
                    <Picker.Item label="Somewhat willing (occasional tracking)" value="somewhat" />
                    <Picker.Item label="Not very willing (prefer not to track)" value="not_willing" />
                  </Picker>
                </View>
              </View>
            </View>
          )}
        </Card>

        {/* Section 7: Progress */}
        <Card variant="default" style={styles.sectionCard}>
          {renderSectionHeader("progress", "Self-Perceived Progress", "chart-line")}
          {expandedSections.progress && (
            <View style={styles.sectionContent}>
              <View style={styles.pickerContainer}>
                <Text style={styles.label}>How do you feel about your progress?</Text>
                <View style={styles.pickerWrapper}>
                  <Picker
                    selectedValue={profile.progress_feeling || ""}
                    onValueChange={(value) => updateProfile({ progress_feeling: value })}
                    style={styles.picker}
                  >
                    <Picker.Item label="Select progress feeling" value="" />
                    <Picker.Item label="Making great progress" value="great" />
                    <Picker.Item label="Making some progress" value="some" />
                    <Picker.Item label="Stagnant / no progress" value="stagnant" />
                    <Picker.Item label="Going backward" value="backward" />
                  </Picker>
                </View>
              </View>

              <Input
                label="What's your biggest blocker?"
                value={profile.biggest_blocker || ""}
                onChangeText={(text) => updateProfile({ biggest_blocker: text })}
                placeholder="Time, motivation, knowledge, etc."
                multiline
                numberOfLines={3}
              />
            </View>
          )}
        </Card>

        {/* Section 8: Reflection */}
        <Card variant="default" style={styles.sectionCard}>
          {renderSectionHeader("reflection", "Open Reflection", "text")}
          {expandedSections.reflection && (
            <View style={styles.sectionContent}>
              <Input
                label="Tell us about your fitness journey"
                value={profile.open_reflection || ""}
                onChangeText={(text) => updateProfile({ open_reflection: text })}
                placeholder="Share your story, challenges, wins, and what fitness means to you..."
                multiline
                numberOfLines={6}
              />
            </View>
          )}
        </Card>

        <Button
          onPress={saveProfile}
          variant="primary"
          loading={saving}
          style={styles.saveButton}
        >
          <MaterialCommunityIcons name="content-save" size={18} color={colors.textPrimary} />
          <Text style={styles.saveButtonText}>Save Profile</Text>
        </Button>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    padding: spacing.lg,
    paddingTop: spacing.xl,
  },
  headerContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  headerSubtitle: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  scrollView: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  sectionCard: {
    marginBottom: spacing.md,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: spacing.sm,
  },
  sectionHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  sectionContent: {
    paddingTop: spacing.md,
    gap: spacing.md,
  },
  row: {
    flexDirection: "row",
    gap: spacing.md,
  },
  halfWidth: {
    flex: 1,
  },
  pickerContainer: {
    marginBottom: spacing.sm,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  pickerWrapper: {
    backgroundColor: colors.background,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  picker: {
    color: colors.textPrimary,
  },
  sliderContainer: {
    marginBottom: spacing.md,
  },
  slider: {
    width: "100%",
    height: 40,
  },
  sliderLabels: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: -spacing.sm,
  },
  sliderLabel: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  switchContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.sm,
  },
  saveButton: {
    marginVertical: spacing.xl,
  },
  saveButtonText: {
    color: colors.textPrimary,
    fontWeight: "600",
    marginLeft: spacing.xs,
  },
});
