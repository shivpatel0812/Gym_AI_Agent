import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { MaterialCommunityIcons } from "@expo/vector-icons";
import apiClient from '../api/client';
import { colors, spacing, borderRadius, shadows } from '../theme';

export default function Dashboard() {
  const [stats, setStats] = useState<any>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const dateFilter = new Date().toISOString().split('T')[0];
        console.log('Fetching stats for date:', dateFilter);
        
        // Fetch all stats in parallel
        const [sessions, activities, macros, stress] = await Promise.all([
          apiClient.get('/api/workout-sessions?date_filter=' + dateFilter),
          apiClient.get('/api/physical-activities?date_filter=' + dateFilter),
          apiClient.get('/api/macros?date_filter=' + dateFilter),
          apiClient.get('/api/stress?date_filter=' + dateFilter),
        ]);
        
        setStats({
          workouts: sessions.data?.length || 0,
          activities: activities.data?.length || 0,
          macros: macros.data?.length || 0,
          stress: stress.data?.length || 0,
        });
      } catch (error: any) {
        console.error('Error fetching stats:', error);
        // Set default stats on error to prevent undefined values
        setStats({
          workouts: 0,
          activities: 0,
          macros: 0,
          stress: 0,
        });
        
        // Log detailed error information for debugging
        if (error.response) {
          console.error('API Error Response:', {
            status: error.response.status,
            statusText: error.response.statusText,
            data: error.response.data,
          });
        } else if (error.request) {
          console.error('Network Error - No response received:', {
            message: error.message,
            code: error.code,
          });
        } else {
          console.error('Error setting up request:', error.message);
        }
      } finally {
        setLoading(false);
      }
    };
    fetchStats();
  }, []);

  const StatCard = ({ label, value, icon }: { label: string; value: number; icon: string }) => (
    <View style={styles.statCardContainer}>
      <View style={styles.statCard}>
        <View style={styles.statIconContainer}>
          <MaterialCommunityIcons name={icon as any} size={22} color={colors.accentPrimary} />
        </View>
        <Text style={styles.statValue}>{value || 0}</Text>
        <Text style={styles.statLabel}>{label}</Text>
      </View>
    </View>
  );

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Welcome Back</Text>
          <Text style={styles.title}>Dashboard</Text>
        </View>
      </View>

      <View style={styles.statsContainer}>
        <StatCard
          label="Workouts Today"
          value={stats.workouts || 0}
          icon="dumbbell"
        />
        <StatCard
          label="Activities"
          value={stats.activities || 0}
          icon="run-fast"
        />
        <StatCard
          label="Macro Entries"
          value={stats.macros || 0}
          icon="food-apple"
        />
        <StatCard
          label="Wellness"
          value={stats.stress || 0}
          icon="heart-pulse"
        />
      </View>
    </ScrollView>
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
  greeting: {
    fontSize: 16,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  statsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: spacing.lg,
    gap: spacing.lg,
  },
  statCardContainer: {
    width: '47%',
    ...shadows.large,
  },
  statCard: {
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
    minHeight: 140,
    justifyContent: 'space-between',
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.border,
  },
  statIconContainer: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.md,
    backgroundColor: 'rgba(255, 107, 53, 0.12)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  statValue: {
    fontSize: 36,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  statLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
  },
});
