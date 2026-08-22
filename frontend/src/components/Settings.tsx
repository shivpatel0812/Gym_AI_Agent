import { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Linking,
  Modal,
  TextInput,
  ActivityIndicator,
  Share,
  Platform,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { signOut } from "firebase/auth";
import { auth } from "../firebase";
import { legal } from "../config";
import { deleteAccount, exportAccountData } from "../api/account";
import { fetchAiAccessStatus, AiAccessStatus } from "../api/aiAccess";
import { friendlyApiError } from "../lib/authErrors";
import { AI_DISCLAIMER } from "./legal/disclaimers";
import RequestAiAccessModal from "./ai/RequestAiAccessModal";
import Button from "./shared/Button";
import { colors, spacing, borderRadius } from "../theme";

const CONFIRM_WORD = "DELETE";

interface Row {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  title: string;
  subtitle?: string;
  onPress: () => void;
  danger?: boolean;
}

export default function Settings() {
  const [status, setStatus] = useState<AiAccessStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [requestOpen, setRequestOpen] = useState(false);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [exporting, setExporting] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      setStatus(await fetchAiAccessStatus());
    } catch {
      setStatus(null);
    } finally {
      setLoadingStatus(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadStatus();
    }, [loadStatus])
  );

  const openLink = (url: string) => {
    Linking.openURL(url).catch(() =>
      Alert.alert("Could not open link", `Please visit ${url} in your browser.`)
    );
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const data = await exportAccountData();
      const json = JSON.stringify(data, null, 2);
      await Share.share({
        title: "GymAI data export",
        message: json,
      });
    } catch (err: any) {
      Alert.alert("Export failed", friendlyApiError(err, "Could not export your data."));
    } finally {
      setExporting(false);
    }
  };

  const handleDelete = async () => {
    if (confirmText.trim().toUpperCase() !== CONFIRM_WORD) {
      setDeleteError(`Type ${CONFIRM_WORD} to confirm.`);
      return;
    }
    setDeleting(true);
    setDeleteError("");
    try {
      await deleteAccount();
      setDeleteOpen(false);
      // The auth user is already gone server-side; signing out clears the local
      // session so the app returns to the login screen instead of retrying with
      // a token for a user that no longer exists.
      await signOut(auth).catch(() => undefined);
    } catch (err: any) {
      setDeleteError(
        friendlyApiError(err, "Could not delete your account. Please try again.")
      );
    } finally {
      setDeleting(false);
    }
  };

  const aiRows: Row[] = [
    {
      icon: "robot-outline",
      title: "Request more AI access",
      subtitle:
        status?.request_status === "pending"
          ? "Your request is being reviewed"
          : status?.unlimited
          ? "You already have unlimited access"
          : "Ask for a higher daily limit",
      onPress: () => setRequestOpen(true),
    },
  ];

  const legalRows: Row[] = [
    {
      icon: "shield-lock-outline",
      title: "Privacy Policy",
      subtitle: "How your health and training data is handled",
      onPress: () => openLink(legal.privacyPolicyUrl),
    },
    {
      icon: "file-document-outline",
      title: "Terms of Use",
      onPress: () => openLink(legal.termsUrl),
    },
    {
      icon: "email-outline",
      title: "Contact support",
      subtitle: legal.supportEmail,
      onPress: () => openLink(`mailto:${legal.supportEmail}`),
    },
  ];

  const accountRows: Row[] = [
    {
      icon: "download-outline",
      title: exporting ? "Preparing export…" : "Export my data",
      subtitle: "Download everything stored under your account",
      onPress: handleExport,
    },
    {
      icon: "logout",
      title: "Sign out",
      onPress: () =>
        Alert.alert("Sign out", "Sign out of GymAI?", [
          { text: "Cancel", style: "cancel" },
          { text: "Sign out", style: "destructive", onPress: () => signOut(auth) },
        ]),
    },
    {
      icon: "delete-outline",
      title: "Delete my account",
      subtitle: "Permanently erase your account and all data",
      onPress: () => {
        setConfirmText("");
        setDeleteError("");
        setDeleteOpen(true);
      },
      danger: true,
    },
  ];

  const renderRow = (row: Row) => (
    <TouchableOpacity
      key={row.title}
      style={styles.row}
      onPress={row.onPress}
      activeOpacity={0.8}
    >
      <MaterialCommunityIcons
        name={row.icon}
        size={22}
        color={row.danger ? colors.danger : colors.accentPrimary}
      />
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowTitle, row.danger && styles.rowTitleDanger]}>
          {row.title}
        </Text>
        {!!row.subtitle && <Text style={styles.rowSubtitle}>{row.subtitle}</Text>}
      </View>
      <MaterialCommunityIcons name="chevron-right" size={20} color={colors.textMuted} />
    </TouchableOpacity>
  );

  const usedPct =
    status && !status.unlimited && status.daily_limit > 0
      ? Math.min(1, status.used_today / status.daily_limit)
      : 0;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.sectionTitle}>AI usage</Text>
      <View style={styles.usageCard}>
        {loadingStatus ? (
          <ActivityIndicator color={colors.accentPrimary} />
        ) : status ? (
          <>
            <View style={styles.usageHeader}>
              <Text style={styles.usageCount}>
                {status.unlimited
                  ? "Unlimited"
                  : `${status.remaining ?? 0} of ${status.daily_limit} left today`}
              </Text>
              <View style={styles.tierPill}>
                <Text style={styles.tierText}>{status.tier}</Text>
              </View>
            </View>
            {!status.unlimited && (
              <>
                <View style={styles.meterTrack}>
                  <View
                    style={[
                      styles.meterFill,
                      { width: `${usedPct * 100}%` },
                      usedPct >= 1 && styles.meterFull,
                    ]}
                  />
                </View>
                <Text style={styles.usageHint}>
                  Your daily allowance resets at midnight UTC.
                </Text>
              </>
            )}
            {status.request_status === "approved" && (
              <Text style={styles.approvedNote}>
                Your access request was approved — enjoy the higher limit.
              </Text>
            )}
            {status.request_status === "denied" && (
              <Text style={styles.deniedNote}>
                {status.request_reviewed_note ||
                  "Your last access request wasn't approved. You can send another."}
              </Text>
            )}
          </>
        ) : (
          <Text style={styles.rowSubtitle}>Couldn't load your AI usage right now.</Text>
        )}
      </View>
      <View style={styles.group}>{aiRows.map(renderRow)}</View>

      <View style={styles.disclaimerBox}>
        <MaterialCommunityIcons
          name="information-outline"
          size={16}
          color={colors.textSecondary}
        />
        <Text style={styles.disclaimerText}>{AI_DISCLAIMER}</Text>
      </View>

      <Text style={styles.sectionTitle}>Legal</Text>
      <View style={styles.group}>{legalRows.map(renderRow)}</View>

      <Text style={styles.sectionTitle}>Account</Text>
      <View style={styles.group}>{accountRows.map(renderRow)}</View>

      <Text style={styles.version}>
        GymAI · {auth.currentUser?.email ?? "signed in"}
      </Text>

      <RequestAiAccessModal
        visible={requestOpen}
        status={status}
        onClose={() => setRequestOpen(false)}
        onSubmitted={loadStatus}
      />

      <Modal
        visible={deleteOpen}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => !deleting && setDeleteOpen(false)}
      >
        <View style={styles.backdrop}>
          <View style={styles.dialog}>
            <MaterialCommunityIcons
              name="alert-outline"
              size={36}
              color={colors.danger}
              style={{ alignSelf: "center" }}
            />
            <Text style={styles.dialogTitle}>Delete your account?</Text>
            <Text style={styles.dialogBody}>
              This permanently erases your workouts, nutrition logs, wellness entries,
              plans, AI conversations, and profile. It cannot be undone.
            </Text>
            <Text style={styles.dialogBody}>
              Want a copy first? Close this and tap “Export my data”.
            </Text>

            <Text style={styles.confirmLabel}>
              Type {CONFIRM_WORD} to confirm
            </Text>
            <TextInput
              style={styles.confirmInput}
              value={confirmText}
              onChangeText={(value) => {
                setConfirmText(value);
                setDeleteError("");
              }}
              autoCapitalize="characters"
              autoCorrect={false}
              placeholder={CONFIRM_WORD}
              placeholderTextColor={colors.textMuted}
              editable={!deleting}
            />

            {!!deleteError && <Text style={styles.dialogError}>{deleteError}</Text>}

            <Button
              title="Delete my account permanently"
              variant="danger"
              onPress={handleDelete}
              loading={deleting}
              disabled={confirmText.trim().toUpperCase() !== CONFIRM_WORD}
              style={{ marginTop: spacing.md }}
            />
            <Button
              title="Cancel"
              variant="secondary"
              onPress={() => setDeleteOpen(false)}
              disabled={deleting}
              style={{ marginTop: spacing.sm }}
            />
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing["3xl"],
  },
  sectionTitle: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  usageCard: {
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    marginBottom: spacing.sm,
  },
  usageHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.md,
  },
  usageCount: {
    color: colors.textPrimary,
    fontSize: 17,
    fontWeight: "700",
  },
  tierPill: {
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "rgba(94, 234, 212, 0.14)",
  },
  tierText: {
    color: colors.ai,
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  meterTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.border,
    overflow: "hidden",
  },
  meterFill: {
    height: "100%",
    borderRadius: 3,
    backgroundColor: colors.accentPrimary,
  },
  meterFull: {
    backgroundColor: colors.danger,
  },
  usageHint: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: spacing.sm,
  },
  approvedNote: {
    color: colors.success,
    fontSize: 13,
    marginTop: spacing.md,
  },
  deniedNote: {
    color: colors.warning,
    fontSize: 13,
    marginTop: spacing.md,
  },
  group: {
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.lg,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowTitle: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: "600",
  },
  rowTitleDanger: {
    color: colors.danger,
  },
  rowSubtitle: {
    color: colors.textSecondary,
    fontSize: 13,
    marginTop: 2,
  },
  disclaimerBox: {
    flexDirection: "row",
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  disclaimerText: {
    flex: 1,
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
  },
  version: {
    color: colors.textMuted,
    fontSize: 12,
    textAlign: "center",
    marginTop: spacing.xl,
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "center",
    padding: spacing.lg,
  },
  dialog: {
    backgroundColor: colors.cardBackground,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
  },
  dialogTitle: {
    color: colors.textPrimary,
    fontSize: 20,
    fontWeight: "700",
    textAlign: "center",
    marginTop: spacing.md,
    marginBottom: spacing.md,
  },
  dialogBody: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: spacing.md,
  },
  confirmLabel: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: "600",
    marginBottom: spacing.sm,
  },
  confirmInput: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: Platform.OS === "ios" ? spacing.md : spacing.sm,
    color: colors.textPrimary,
    fontSize: 16,
    letterSpacing: 2,
  },
  dialogError: {
    color: colors.danger,
    fontSize: 13,
    marginTop: spacing.sm,
  },
});
