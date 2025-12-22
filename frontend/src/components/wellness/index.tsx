import { useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from "react-native";
import StressSection from "./StressSection";
import BodyFeelingsSection from "./BodyFeelingsSection";
import WellnessSurveySection from "./WellnessSurveySection";

type TabType = "stress" | "body" | "survey";

export default function Wellness() {
  const [activeTab, setActiveTab] = useState<TabType>("stress");

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Wellness</Text>
      </View>
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tab, activeTab === "stress" && styles.tabActive]}
          onPress={() => setActiveTab("stress")}
        >
          <Text style={[styles.tabText, activeTab === "stress" && styles.tabTextActive]}>
            Stress Levels
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === "body" && styles.tabActive]}
          onPress={() => setActiveTab("body")}
        >
          <Text style={[styles.tabText, activeTab === "body" && styles.tabTextActive]}>
            Body Feelings
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === "survey" && styles.tabActive]}
          onPress={() => setActiveTab("survey")}
        >
          <Text style={[styles.tabText, activeTab === "survey" && styles.tabTextActive]}>
            Wellness Survey
          </Text>
        </TouchableOpacity>
      </View>
      <ScrollView style={styles.content}>
        {activeTab === "stress" && <StressSection />}
        {activeTab === "body" && <BodyFeelingsSection />}
        {activeTab === "survey" && <WellnessSurveySection />}
      </ScrollView>
    </View>
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
    color: '#111827',
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: 'white',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: {
    borderBottomColor: '#2563eb',
  },
  tabText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6b7280',
  },
  tabTextActive: {
    color: '#2563eb',
  },
  content: {
    flex: 1,
  },
});
