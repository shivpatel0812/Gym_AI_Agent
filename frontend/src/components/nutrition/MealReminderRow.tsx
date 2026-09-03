import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Linking,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { colors } from "../../theme";
import { getActiveNutritionPlan, type NutritionPlan } from "../../api/nutritionPlan";
import apiClient from "../../api/client";
import type { FoodItem, MacroEntry } from "./types";
import { toDateKey } from "./types";
import {
  DEFAULT_MEAL_REMINDER,
  formatTime,
  loadMealReminderSettings,
  saveMealReminderSettings,
  sendTestMealReminder,
  syncMealReminders,
  type MealReminderSettings,
  type MealReminderSlot,
} from "../../notifications/mealReminder";

function todayFoodsFromMacros(rows: MacroEntry[]): FoodItem[] {
  const key = toDateKey(new Date());
  const entry = rows.find((e) => String(e.date || "").slice(0, 10) === key);
  return entry?.food_items || [];
}

export default function MealReminderRow() {
  const [settings, setSettings] = useState<MealReminderSettings>(DEFAULT_MEAL_REMINDER);
  const [ready, setReady] = useState(false);
  const [plan, setPlan] = useState<NutritionPlan | null>(null);

  useEffect(() => {
    Promise.all([
      loadMealReminderSettings(),
      getActiveNutritionPlan().catch(() => null),
    ]).then(([stored, active]) => {
      setSettings(stored);
      setPlan(active);
      setReady(true);
    });
  }, []);

  const refreshAndSync = useCallback(
    async (next: MealReminderSettings) => {
      setSettings(next);
      await saveMealReminderSettings(next);
      let loggedByDate: Record<string, FoodItem[]> = {};
      try {
        const res = await apiClient.get("/api/macros");
        const rows: MacroEntry[] = Array.isArray(res.data) ? res.data : [];
        loggedByDate = { [toDateKey(new Date())]: todayFoodsFromMacros(rows) };
      } catch {
        // Still schedule; follow-ups may be slightly noisy offline.
      }
      const active = plan || (await getActiveNutritionPlan().catch(() => null));
      if (active) setPlan(active);
      const scheduled = await syncMealReminders(next, active, loggedByDate);
      if (next.enabled && scheduled === 0) {
        setSettings({ ...next, enabled: false });
        await saveMealReminderSettings({ ...next, enabled: false });
        Alert.alert(
          "Notifications are off",
          "Turn on notifications for GymAI in Settings to get meal reminders.",
          [
            { text: "Not now", style: "cancel" },
            { text: "Open Settings", onPress: () => Linking.openSettings() },
          ]
        );
      }
    },
    [plan]
  );

  useEffect(() => {
    if (!ready || !settings.enabled) return;
    let cancelled = false;
    void (async () => {
      let loggedByDate: Record<string, FoodItem[]> = {};
      try {
        const res = await apiClient.get("/api/macros");
        const rows: MacroEntry[] = Array.isArray(res.data) ? res.data : [];
        loggedByDate = { [toDateKey(new Date())]: todayFoodsFromMacros(rows) };
      } catch {
        // Schedule anyway.
      }
      if (cancelled) return;
      const active = plan || (await getActiveNutritionPlan().catch(() => null));
      if (cancelled) return;
      if (active && active.id !== plan?.id) setPlan(active);
      await syncMealReminders(settings, active, loggedByDate);
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, settings.enabled, plan?.id]);

  if (!ready) return null;

  const timeSummary = (["Breakfast", "Lunch", "Dinner"] as MealReminderSlot[])
    .map((slot) => formatTime(settings.times[slot].hour, settings.times[slot].minute))
    .join(" · ");

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <MaterialCommunityIcons name="food-apple-outline" size={17} color={colors.accentPrimary} />
        <View style={styles.copy}>
          <Text style={styles.title}>Meal reminders</Text>
          <Text style={styles.subtitle}>
            {settings.enabled
              ? `Lock-screen picks at ${timeSummary}`
              : "Notify at mealtime with your usual options"}
          </Text>
        </View>
        <Switch
          value={settings.enabled}
          onValueChange={(enabled) => refreshAndSync({ ...settings, enabled })}
          trackColor={{ false: colors.border, true: `${colors.accentPrimary}66` }}
          thumbColor={settings.enabled ? colors.accentPrimary : undefined}
        />
      </View>

      {settings.enabled ? (
        <>
          <View style={styles.followRow}>
            <Text style={styles.followLabel}>Follow-up if I forget</Text>
            <Switch
              value={settings.followUpEnabled}
              onValueChange={(followUpEnabled) =>
                refreshAndSync({ ...settings, followUpEnabled })
              }
              trackColor={{ false: colors.border, true: `${colors.accentPrimary}66` }}
              thumbColor={settings.followUpEnabled ? colors.accentPrimary : undefined}
            />
          </View>
          <TouchableOpacity
            style={styles.testBtn}
            onPress={async () => {
              const ok = await sendTestMealReminder(plan);
              if (!ok) {
                Alert.alert(
                  "Notifications are off",
                  "Turn on notifications for GymAI in Settings.",
                  [
                    { text: "Not now", style: "cancel" },
                    { text: "Open Settings", onPress: () => Linking.openSettings() },
                  ]
                );
                return;
              }
              Alert.alert(
                "Test scheduled",
                "A lunch-style reminder appears in about 5 seconds. Lock the phone to try one-tap log from the lock screen."
              );
            }}
          >
            <Text style={styles.testText}>Send test meal notification</Text>
          </TouchableOpacity>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.cardBackground,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  copy: { flex: 1 },
  title: { color: colors.textPrimary, fontSize: 14, fontWeight: "700" },
  subtitle: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  followRow: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  followLabel: { color: colors.textMuted, fontSize: 13 },
  testBtn: { marginTop: 8, paddingVertical: 8, alignItems: "center" },
  testText: { color: colors.accentPrimary, fontSize: 13, fontWeight: "700" },
});
