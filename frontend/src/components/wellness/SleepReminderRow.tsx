import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Linking,
  Platform,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";
import { colors } from "../../theme";
import {
  DEFAULT_SLEEP_REMINDER,
  formatTime,
  loadSleepReminderSettings,
  saveSleepReminderSettings,
  syncSleepReminders,
  type SleepReminderSettings,
} from "../../notifications";

interface Props {
  /** Dates (YYYY-MM-DD) that already have a sleep entry — never nag for these. */
  loggedDates: string[];
}

export default function SleepReminderRow({ loggedDates }: Props) {
  const [settings, setSettings] = useState<SleepReminderSettings>(DEFAULT_SLEEP_REMINDER);
  const [showTime, setShowTime] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    loadSleepReminderSettings().then((stored) => {
      setSettings(stored);
      setReady(true);
    });
  }, []);

  const apply = useCallback(
    async (next: SleepReminderSettings) => {
      setSettings(next);
      await saveSleepReminderSettings(next);
      const scheduled = await syncSleepReminders(next, loggedDates);

      // Turning it on but scheduling nothing means the OS said no. Say so —
      // silently doing nothing looks like the toggle is broken.
      if (next.enabled && scheduled === 0) {
        setSettings({ ...next, enabled: false });
        await saveSleepReminderSettings({ ...next, enabled: false });
        Alert.alert(
          "Notifications are off",
          "Turn on notifications for GymAI in Settings to get sleep reminders.",
          [
            { text: "Not now", style: "cancel" },
            { text: "Open Settings", onPress: () => Linking.openSettings() },
          ]
        );
      }
    },
    [loggedDates]
  );

  // Keep the queue honest as nights get logged: a reminder already scheduled
  // for a day that now has an entry should quietly disappear.
  useEffect(() => {
    if (!ready || !settings.enabled) return;
    syncSleepReminders(settings, loggedDates);
  }, [ready, settings, loggedDates]);

  if (!ready) return null;

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <MaterialCommunityIcons name="bell-outline" size={17} color={colors.ai} />
        <View style={styles.copy}>
          <Text style={styles.title}>Daily reminder</Text>
          <Text style={styles.subtitle}>
            {settings.enabled
              ? `Every morning at ${formatTime(settings.hour, settings.minute)}`
              : "A nudge to log the night before"}
          </Text>
        </View>
        <Switch
          value={settings.enabled}
          onValueChange={(enabled) => apply({ ...settings, enabled })}
          trackColor={{ false: colors.border, true: `${colors.ai}66` }}
          thumbColor={settings.enabled ? colors.ai : undefined}
        />
      </View>

      {settings.enabled && (
        <TouchableOpacity style={styles.timeBtn} onPress={() => setShowTime(true)}>
          <Text style={styles.timeLabel}>Remind me at</Text>
          <Text style={styles.timeValue}>
            {formatTime(settings.hour, settings.minute)}
          </Text>
        </TouchableOpacity>
      )}

      {showTime && (
        <DateTimePicker
          value={timeAsDate(settings)}
          mode="time"
          display={Platform.OS === "ios" ? "spinner" : "default"}
          onChange={(event, picked) => {
            if (Platform.OS !== "ios") setShowTime(false);
            if (event.type === "dismissed" || !picked) return;
            apply({
              ...settings,
              hour: picked.getHours(),
              minute: picked.getMinutes(),
            });
          }}
        />
      )}

      {showTime && Platform.OS === "ios" && (
        <TouchableOpacity style={styles.doneBtn} onPress={() => setShowTime(false)}>
          <Text style={styles.doneText}>Done</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

function timeAsDate(settings: SleepReminderSettings): Date {
  const date = new Date();
  date.setHours(settings.hour, settings.minute, 0, 0);
  return date;
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
  timeBtn: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  timeLabel: { color: colors.textMuted, fontSize: 13 },
  timeValue: { color: colors.ai, fontSize: 14, fontWeight: "700" },
  doneBtn: { alignSelf: "flex-end", paddingVertical: 6, paddingHorizontal: 4 },
  doneText: { color: colors.ai, fontSize: 14, fontWeight: "700" },
});
