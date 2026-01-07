import { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from "react-native";
import { Picker } from "@react-native-picker/picker";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import LinearGradient from "./shared/LinearGradient";
import Button from "./shared/Button";
import Card from "./shared/Card";
import apiClient from "../api/client";
import { colors, spacing, borderRadius, shadows } from "../theme";

interface Analysis {
  id: string;
  year: number;
  month: number;
  analysis: string;
  created_at?: string;
  tokens_used?: number;
  model?: string;
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export default function AIAnalysis() {
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;

  const [analyses, setAnalyses] = useState<Analysis[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
  const [expandedAnalysis, setExpandedAnalysis] = useState<string | null>(null);

  const years = [currentYear - 1, currentYear, currentYear + 1];

  useEffect(() => {
    fetchAnalyses();
  }, []);

  const fetchAnalyses = async () => {
    setLoading(true);
    try {
      const res = await apiClient.get(`/api/ai-analysis/analyses?year=${currentYear}&limit=12`);
      setAnalyses(Array.isArray(res.data) ? res.data : []);
    } catch (error) {
      console.error("Error fetching analyses:", error);
      setAnalyses([]); // Ensure it's always an array
    } finally {
      setLoading(false);
    }
  };

  const generateAnalysis = async () => {
    setGenerating(true);
    try {
      await apiClient.post("/api/ai-analysis/generate", {
        year: selectedYear,
        month: selectedMonth,
        include_previous_months: true,
      });
      Alert.alert("Success", "Analysis generated successfully!");
      fetchAnalyses();
    } catch (error: any) {
      console.error("Error generating analysis:", error);
      Alert.alert(
        "Error",
        error.response?.data?.detail || "Failed to generate analysis. Please try again."
      );
    } finally {
      setGenerating(false);
    }
  };

  const deleteAnalysis = async (id: string) => {
    Alert.alert("Delete Analysis", "Are you sure you want to delete this analysis?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await apiClient.delete(`/api/ai-analysis/analyses/${id}`);
            fetchAnalyses();
          } catch (error) {
            console.error("Error deleting analysis:", error);
            Alert.alert("Error", "Failed to delete analysis");
          }
        },
      },
    ]);
  };

  const toggleExpanded = (id: string) => {
    setExpandedAnalysis(expandedAnalysis === id ? null : id);
  };

  const getPreview = (text: string) => {
    return text.length > 200 ? text.substring(0, 200) + "..." : text;
  };

  return (
    <View style={styles.container}>
      <LinearGradient colors={[colors.background, colors.cardBackground]} style={styles.header}>
        <View style={styles.headerContent}>
          <MaterialCommunityIcons name="chart-line" size={32} color={colors.accentPrimary} />
          <View>
            <Text style={styles.headerTitle}>AI Analysis</Text>
            <Text style={styles.headerSubtitle}>Monthly fitness insights</Text>
          </View>
        </View>
      </LinearGradient>

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {/* Control Panel */}
        <Card variant="gradient" style={styles.controlPanel}>
          <Text style={styles.controlTitle}>Generate New Analysis</Text>
          <Text style={styles.controlSubtitle}>
            Create an AI-powered analysis of your fitness data
          </Text>

          <View style={styles.pickerRow}>
            <View style={styles.pickerContainer}>
              <Text style={styles.pickerLabel}>Year</Text>
              <View style={styles.pickerWrapper}>
                <Picker
                  selectedValue={selectedYear}
                  onValueChange={setSelectedYear}
                  style={styles.picker}
                  dropdownIconColor={colors.textPrimary}
                >
                  {years.map((year) => (
                    <Picker.Item key={year} label={year.toString()} value={year} />
                  ))}
                </Picker>
              </View>
            </View>

            <View style={styles.pickerContainer}>
              <Text style={styles.pickerLabel}>Month</Text>
              <View style={styles.pickerWrapper}>
                <Picker
                  selectedValue={selectedMonth}
                  onValueChange={setSelectedMonth}
                  style={styles.picker}
                  dropdownIconColor={colors.textPrimary}
                >
                  {MONTHS.map((month, index) => (
                    <Picker.Item key={index} label={month} value={index + 1} />
                  ))}
                </Picker>
              </View>
            </View>
          </View>

          <Button
            onPress={generateAnalysis}
            variant="primary"
            loading={generating}
            style={styles.generateButton}
          >
            <MaterialCommunityIcons name="sparkles" size={18} color={colors.textPrimary} />
            <Text style={styles.generateButtonText}>Generate Analysis</Text>
          </Button>
        </Card>

        {/* Analyses List */}
        <View style={styles.listHeader}>
          <Text style={styles.listTitle}>Your Analyses</Text>
          {loading && <ActivityIndicator size="small" color={colors.accentPrimary} />}
        </View>

        {loading && analyses.length === 0 ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.accentPrimary} />
            <Text style={styles.loadingText}>Loading analyses...</Text>
          </View>
        ) : analyses.length === 0 ? (
          <View style={styles.emptyState}>
            <MaterialCommunityIcons name="chart-box-outline" size={64} color={colors.textSecondary} />
            <Text style={styles.emptyText}>No analyses yet</Text>
            <Text style={styles.emptySubtext}>Generate your first AI fitness analysis above</Text>
          </View>
        ) : (
          <View style={styles.analysesList}>
            {(analyses || []).map((analysis) => {
              const isExpanded = expandedAnalysis === analysis.id;
              return (
                <Card key={analysis.id} variant="default" style={styles.analysisCard}>
                  <View style={styles.analysisHeader}>
                    <View style={styles.analysisHeaderLeft}>
                      <MaterialCommunityIcons
                        name="calendar-month"
                        size={20}
                        color={colors.accentPrimary}
                      />
                      <Text style={styles.analysisDate}>
                        {MONTHS[analysis.month - 1]} {analysis.year}
                      </Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => deleteAnalysis(analysis.id)}
                      style={styles.deleteButton}
                    >
                      <MaterialCommunityIcons name="delete" size={18} color={colors.danger} />
                    </TouchableOpacity>
                  </View>

                  <Text style={styles.analysisText}>
                    {isExpanded ? analysis.analysis : getPreview(analysis.analysis)}
                  </Text>

                  {analysis.analysis.length > 200 && (
                    <TouchableOpacity
                      onPress={() => toggleExpanded(analysis.id)}
                      style={styles.expandButton}
                    >
                      <Text style={styles.expandButtonText}>
                        {isExpanded ? "Show Less" : "Read More"}
                      </Text>
                      <MaterialCommunityIcons
                        name={isExpanded ? "chevron-up" : "chevron-down"}
                        size={16}
                        color={colors.accentPrimary}
                      />
                    </TouchableOpacity>
                  )}

                  {analysis.created_at && (
                    <Text style={styles.metadata}>
                      Created: {new Date(analysis.created_at).toLocaleDateString()}
                    </Text>
                  )}
                </Card>
              );
            })}
          </View>
        )}
      </ScrollView>
    </View>
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
  controlPanel: {
    marginBottom: spacing.xl,
  },
  controlTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  controlSubtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
  },
  pickerRow: {
    flexDirection: "row",
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  pickerContainer: {
    flex: 1,
  },
  pickerLabel: {
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
    backgroundColor: "transparent",
  },
  generateButton: {
    width: "100%",
  },
  generateButtonText: {
    color: colors.textPrimary,
    fontWeight: "600",
    marginLeft: spacing.xs,
  },
  listHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.md,
  },
  listTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  loadingContainer: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing["3xl"],
  },
  loadingText: {
    color: colors.textSecondary,
    fontSize: 16,
    marginTop: spacing.md,
  },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing["3xl"],
  },
  emptyText: {
    color: colors.textSecondary,
    fontSize: 16,
    marginTop: spacing.lg,
  },
  emptySubtext: {
    color: colors.textSecondary,
    fontSize: 14,
    marginTop: spacing.xs,
  },
  analysesList: {
    gap: spacing.md,
    paddingBottom: spacing.xl,
  },
  analysisCard: {
    marginBottom: spacing.sm,
  },
  analysisHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.md,
  },
  analysisHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  analysisDate: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.textPrimary,
  },
  deleteButton: {
    padding: spacing.sm,
  },
  analysisText: {
    fontSize: 14,
    color: colors.textPrimary,
    lineHeight: 20,
    marginBottom: spacing.sm,
  },
  expandButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingVertical: spacing.sm,
  },
  expandButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.accentPrimary,
  },
  metadata: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});
