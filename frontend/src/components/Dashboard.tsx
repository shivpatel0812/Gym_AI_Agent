import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import apiClient from '../api/client';

export default function Dashboard() {
  const [stats, setStats] = useState<any>({});

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const [sessions, activities, macros, stress] = await Promise.all([
          apiClient.get('/api/workout-sessions?date_filter=' + new Date().toISOString().split('T')[0]),
          apiClient.get('/api/physical-activities?date_filter=' + new Date().toISOString().split('T')[0]),
          apiClient.get('/api/macros?date_filter=' + new Date().toISOString().split('T')[0]),
          apiClient.get('/api/stress?date_filter=' + new Date().toISOString().split('T')[0]),
        ]);
        setStats({
          workouts: sessions.data.length,
          activities: activities.data.length,
          macros: macros.data.length,
          stress: stress.data.length,
        });
      } catch (error) {
        console.error('Error fetching stats:', error);
      }
    };
    fetchStats();
  }, []);

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Dashboard</Text>
      </View>
      <View style={styles.statsContainer}>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Workouts Today</Text>
          <Text style={styles.statValue}>{stats.workouts || 0}</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Activities Today</Text>
          <Text style={styles.statValue}>{stats.activities || 0}</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Macro Entries</Text>
          <Text style={styles.statValue}>{stats.macros || 0}</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Stress Entries</Text>
          <Text style={styles.statValue}>{stats.stress || 0}</Text>
        </View>
      </View>
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
    color: '#111827',
  },
  statsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 16,
    gap: 16,
  },
  statCard: {
    backgroundColor: 'white',
    borderRadius: 8,
    padding: 20,
    width: '47%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  statLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#6b7280',
    marginBottom: 8,
  },
  statValue: {
    fontSize: 36,
    fontWeight: 'bold',
    color: '#111827',
  },
});
